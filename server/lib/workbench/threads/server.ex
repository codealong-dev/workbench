defmodule Workbench.Threads.Server do
  @moduledoc """
  One process per thread. Owns the provider process, is the only writer of
  the thread's row and items, and broadcasts every event on
  `"thread:<id>"`.

  Rules (see the plan):

    * the provider spawns lazily on the first send, resuming `session_id`
    * stdout is split into lines; each line goes through `handle_line/2`
    * text and reasoning deltas are buffered and pushed every `flush_ms`;
      any other event flushes the buffer first, so ordering is preserved
    * only completed things are persisted; deltas never are
    * `session.started` writes `session_id` right away so a crash can resume
    * unexpected provider exit: `error` event, status `error`; the next send
      respawns with resume
    * idle for `idle_timeout_ms`: the provider process is closed
  """
  use GenServer, restart: :transient
  require Logger

  alias Workbench.{Items, Provider, Repo, Threads}
  alias Workbench.Threads.Thread

  @busy ~w(running awaiting_approval)
  @stderr_keep 4_000

  def start_link(id), do: GenServer.start_link(__MODULE__, id, name: via(id))
  def via(id), do: {:via, Registry, {Workbench.Threads.Registry, id}}

  # -- init -------------------------------------------------------------------

  @impl true
  def init(id) do
    case Repo.get(Thread, id) do
      nil ->
        :ignore

      thread ->
        Process.flag(:trap_exit, true)
        Logger.metadata(thread_id: id)

        st = %{
          thread: thread,
          status: "idle",
          provider: Provider.module(thread.provider),
          pstate: nil,
          # Monotonic across restarts so clients can drop duplicates by seq.
          seq: System.system_time(:microsecond),
          turn_id: nil,
          line_buf: "",
          stderr: "",
          delta_buf: [],
          flush_ref: nil,
          idle_ref: nil,
          # item_id => %{"id", "kind", "text"} for items still streaming
          live: %{},
          # request_id => approval.requested event
          pending: %{},
          # item_id => tool item, until tool.completed
          tools: %{}
        }

        {:ok, st, {:continue, {:recover, thread.status}}}
    end
  end

  @impl true
  def handle_continue({:recover, previous}, st) when previous in @busy do
    st = emit(st, %{"type" => "error", "message" => "Server restarted; the turn in progress was lost.", "fatal" => false})
    {:noreply, persist_status(st, "idle")}
  end

  def handle_continue({:recover, _}, st), do: {:noreply, persist_status(st, "idle")}

  # -- calls ------------------------------------------------------------------

  @impl true
  def handle_call({:send, _text}, _from, %{status: s} = st) when s in @busy do
    {:reply, {:error, :busy}, st}
  end

  def handle_call({:send, text}, _from, st) do
    st = if st.status == "error", do: close_provider(st), else: st

    with {:ok, st} <- ensure_provider(st),
         {:ok, pstate} <- st.provider.send_turn(st.pstate, text) do
      st =
        %{st | pstate: pstate}
        |> emit(%{
          "type" => "item.completed",
          "item" => %{"id" => "u-" <> uid(), "kind" => "user_message", "text" => text}
        })
        |> set_status("running")
        |> touch()

      {:reply, :ok, st}
    else
      {:error, reason} ->
        message = if is_binary(reason), do: reason, else: inspect(reason)

        st =
          st
          |> emit(%{"type" => "error", "message" => "Could not start agent: " <> message, "fatal" => true})
          |> set_status("error")

        {:reply, {:error, message}, st}
    end
  end

  def handle_call(:interrupt, _from, %{pstate: p, status: s} = st) when p != nil and s in @busy do
    {:ok, p} = st.provider.interrupt(p)
    {:reply, :ok, %{st | pstate: p}}
  end

  def handle_call(:interrupt, _from, st), do: {:reply, :ok, st}

  def handle_call({:respond, rid, decision}, _from, st) do
    cond do
      decision not in ~w(allow allow_session deny) ->
        {:reply, {:error, :bad_decision}, st}

      not Map.has_key?(st.pending, rid) or st.pstate == nil ->
        {:reply, {:error, :unknown_request}, st}

      true ->
        {:ok, p} = st.provider.respond(st.pstate, rid, decision)
        st = resolve(%{st | pstate: p}, rid, decision)
        {:reply, :ok, touch(st)}
    end
  end

  def handle_call({:set_mode, mode}, _from, st) do
    if mode in Thread.modes() do
      thread = st.thread |> Ecto.Changeset.change(mode: mode) |> Repo.update!()
      st = %{st | thread: thread}

      st =
        if st.pstate do
          {:ok, p} = st.provider.set_mode(st.pstate, mode)
          %{st | pstate: p}
        else
          st
        end

      Threads.broadcast_lobby({:thread_upserted, thread})
      {:reply, :ok, st}
    else
      {:reply, {:error, :bad_mode}, st}
    end
  end

  def handle_call(:snapshot, _from, st) do
    st = flush(st)

    snap = %{
      thread: Thread.to_json(%{st.thread | status: st.status}),
      status: st.status,
      seq: st.seq,
      items: Items.last(st.thread.id, 200),
      live: Map.values(st.live),
      pending: Map.values(st.pending)
    }

    {:reply, snap, st}
  end

  # -- provider output ----------------------------------------------------------

  @impl true
  def handle_info({:stdout, io, data}, %{pstate: %{io: io}} = st) do
    {lines, rest} = split_lines(st.line_buf <> data)
    st = Enum.reduce(lines, %{st | line_buf: rest}, &handle_line/2)
    {:noreply, touch(st)}
  end

  def handle_info({:stderr, io, data}, %{pstate: %{io: io}} = st) do
    Logger.debug(["agent stderr: ", data])
    tail = String.slice(st.stderr <> data, -@stderr_keep, @stderr_keep)
    {:noreply, %{st | stderr: tail}}
  end

  def handle_info({:EXIT, pid, reason}, %{pstate: %{pid: pid}} = st), do: {:noreply, provider_exited(st, reason)}

  def handle_info({:DOWN, _ref, :process, pid, reason}, %{pstate: %{pid: pid}} = st),
    do: {:noreply, provider_exited(st, reason)}

  def handle_info(:flush, st), do: {:noreply, flush(%{st | flush_ref: nil})}

  def handle_info(:idle, %{status: "idle", pstate: p} = st) when p != nil do
    Logger.info("closing idle agent process")
    {:noreply, close_provider(st)}
  end

  def handle_info(:idle, st), do: {:noreply, %{st | idle_ref: nil}}

  def handle_info(msg, st) do
    Logger.debug("ignored message: #{inspect(msg, limit: 5)}")
    {:noreply, st}
  end

  @impl true
  def terminate(_reason, st) do
    flush(st)
    if st.pstate, do: st.provider.close(st.pstate)
    :ok
  end

  # -- events -----------------------------------------------------------------

  defp handle_line(line, st) do
    case String.trim(line) do
      "" ->
        st

      line ->
        {events, p} = st.provider.handle_line(st.pstate, line)
        Enum.reduce(events, %{st | pstate: p}, &emit(&2, &1))
    end
  end

  # Apply one provider (or server) event: update state, persist, broadcast.
  defp emit(st, %{"type" => type} = ev) when type in ~w(text.delta reasoning.delta) do
    id = ev["item_id"]
    kind = if type == "text.delta", do: "assistant_message", else: "reasoning"

    live =
      Map.update(st.live, id, %{"id" => id, "kind" => kind, "text" => ev["text"]}, fn item ->
        %{item | "text" => item["text"] <> ev["text"]}
      end)

    {env, st} = stamp(st, ev)
    schedule_flush(%{st | live: live, delta_buf: [env | st.delta_buf]})
  end

  defp emit(st, %{"type" => "session.started"} = ev) do
    st =
      if ev["session_id"] && ev["session_id"] != st.thread.session_id do
        thread = st.thread |> Ecto.Changeset.change(session_id: ev["session_id"]) |> Repo.update!()
        %{st | thread: thread}
      else
        st
      end

    broadcast(st, ev)
  end

  defp emit(st, %{"type" => "turn.started"} = ev) do
    %{st | turn_id: ev["turn_id"]} |> broadcast(ev) |> set_status("running")
  end

  defp emit(st, %{"type" => "item.completed", "item" => item} = ev) do
    item = Map.put_new(item, "turn_id", st.turn_id)
    ev = %{ev | "item" => item}
    st = %{st | live: Map.delete(st.live, item["id"])} |> flush()
    {env, st} = stamp(st, ev)
    Items.put(st.thread.id, env["seq"], item)
    publish(st, env)
  end

  defp emit(st, %{"type" => "tool.started"} = ev) do
    item = %{
      "id" => ev["item_id"],
      "kind" => "tool",
      "name" => ev["name"],
      "input" => ev["input"],
      "parent_id" => ev["parent_id"],
      "status" => "running",
      "turn_id" => st.turn_id
    }

    st = flush(st)
    {env, st} = stamp(st, ev)
    Items.put(st.thread.id, env["seq"], item)
    publish(%{st | tools: Map.put(st.tools, item["id"], item)}, env)
  end

  defp emit(st, %{"type" => "tool.completed"} = ev) do
    id = ev["item_id"]
    base = Map.get(st.tools, id, %{"id" => id, "kind" => "tool", "name" => "tool", "input" => nil, "turn_id" => st.turn_id})

    item =
      Map.merge(base, %{
        "output" => ev["output"],
        "is_error" => ev["is_error"] || false,
        "truncated" => ev["truncated"] || false,
        "status" => "done"
      })

    st = flush(st)
    {env, st} = stamp(st, ev)
    Items.put(st.thread.id, env["seq"], item)
    publish(%{st | tools: Map.delete(st.tools, id)}, env)
  end

  defp emit(st, %{"type" => "approval.requested", "request_id" => rid} = ev) do
    st = %{st | pending: Map.put(st.pending, rid, ev)}
    st |> broadcast(ev) |> set_status("awaiting_approval")
  end

  # The server emits approval.resolved itself when the user answers; a
  # provider's own copy (or one for an unknown request) is dropped.
  defp emit(st, %{"type" => "approval.resolved"}), do: st

  defp emit(st, %{"type" => "turn.completed"} = ev) do
    turn_id = ev["turn_id"] || st.turn_id || uid()

    item = %{
      "id" => "turn:" <> turn_id,
      "kind" => "turn",
      "turn_id" => turn_id,
      "status" => ev["status"] || "ok",
      "usage" => ev["usage"],
      "cost_usd" => ev["cost_usd"]
    }

    st = st |> cancel_pending() |> flush()
    {env, st} = stamp(st, ev)
    Items.put(st.thread.id, env["seq"], item)

    %{st | live: %{}, tools: %{}, turn_id: nil}
    |> publish(env)
    |> set_status("idle")
  end

  defp emit(st, %{"type" => "error"} = ev) do
    st = broadcast(st, ev)
    if ev["fatal"], do: set_status(st, "error"), else: st
  end

  defp emit(st, ev) do
    Logger.debug("unknown event #{inspect(ev["type"])}")
    st
  end

  defp resolve(st, rid, decision) do
    st = %{st | pending: Map.delete(st.pending, rid)}
    st = broadcast(st, %{"type" => "approval.resolved", "request_id" => rid, "decision" => decision})

    if st.status == "awaiting_approval" and map_size(st.pending) == 0,
      do: set_status(st, "running"),
      else: st
  end

  defp cancel_pending(st) do
    Enum.reduce(Map.keys(st.pending), st, &resolve(&2, &1, "cancelled"))
  end

  defp set_status(%{status: s} = st, s), do: st

  defp set_status(st, status) do
    st = broadcast(%{st | status: status}, %{"type" => "status.changed", "status" => status})
    persist_status(st, status)
  end

  defp persist_status(st, status) do
    thread =
      if st.thread.status != status,
        do: st.thread |> Ecto.Changeset.change(status: status) |> Repo.update!(),
        else: st.thread

    Threads.broadcast_lobby({:thread_status, thread.id, status})
    %{st | thread: thread, status: status}
  end

  # -- broadcasting -----------------------------------------------------------

  defp broadcast(st, ev) do
    st = flush(st)
    {env, st} = stamp(st, ev)
    publish(st, env)
  end

  defp publish(st, env) do
    Phoenix.PubSub.broadcast(Workbench.PubSub, Threads.topic(st.thread.id), {:event, env})
    st
  end

  defp stamp(st, ev) do
    seq = st.seq + 1
    env = Map.merge(ev, %{"thread_id" => st.thread.id, "seq" => seq, "at" => System.system_time(:millisecond)})
    {env, %{st | seq: seq}}
  end

  defp schedule_flush(%{flush_ref: nil} = st) do
    ms = Application.get_env(:workbench, :flush_ms, 30)
    %{st | flush_ref: Process.send_after(self(), :flush, ms)}
  end

  defp schedule_flush(st), do: st

  defp flush(%{delta_buf: []} = st), do: st

  defp flush(st) do
    if st.flush_ref, do: Process.cancel_timer(st.flush_ref)
    Phoenix.PubSub.broadcast(Workbench.PubSub, Threads.topic(st.thread.id), {:events, Enum.reverse(st.delta_buf)})
    %{st | delta_buf: [], flush_ref: nil}
  end

  # -- provider lifecycle -----------------------------------------------------

  defp provider_exited(st, reason) do
    st = %{st | pstate: nil, line_buf: ""}

    if st.status in @busy do
      detail = st.stderr |> String.trim() |> String.slice(-600, 600)

      msg =
        "Agent process exited (#{Workbench.Provider.Proc.describe_exit(reason)})" <>
          if(detail != "", do: ": " <> detail, else: "")

      st
      |> cancel_pending()
      |> Map.merge(%{live: %{}, tools: %{}, turn_id: nil})
      |> emit(%{"type" => "error", "message" => msg, "fatal" => true})
      |> set_status("error")
    else
      st
    end
  end

  defp ensure_provider(%{pstate: nil} = st) do
    opts = %{
      thread_id: st.thread.id,
      cwd: st.thread.worktree_path,
      resume: st.thread.session_id,
      mode: st.thread.mode,
      model: st.thread.model
    }

    case st.provider.open(opts) do
      {:ok, pstate} -> {:ok, %{st | pstate: pstate, line_buf: "", stderr: ""}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_provider(st), do: {:ok, st}

  defp close_provider(%{pstate: nil} = st), do: st

  defp close_provider(st) do
    st.provider.close(st.pstate)
    %{st | pstate: nil, line_buf: ""}
  end

  defp touch(st) do
    if st.idle_ref, do: Process.cancel_timer(st.idle_ref)
    ms = Application.get_env(:workbench, :idle_timeout_ms, :timer.minutes(15))
    %{st | idle_ref: Process.send_after(self(), :idle, ms)}
  end

  defp split_lines(buf) do
    parts = String.split(buf, "\n")
    {Enum.drop(parts, -1), List.last(parts)}
  end

  defp uid, do: Base.url_encode64(:crypto.strong_rand_bytes(9), padding: false)
end
