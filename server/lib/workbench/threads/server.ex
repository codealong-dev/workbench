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

  alias Workbench.{Activity, Items, Provider, Repo, Threads, Uploads}
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

      %Thread{archived_at: %DateTime{}} ->
        :ignore

      thread ->
        Process.flag(:trap_exit, true)
        Logger.metadata(thread_id: id)
        Phoenix.PubSub.subscribe(Workbench.PubSub, Threads.context_topic(thread.parent_id || id))

        st = %{
          thread: thread,
          status: "idle",
          provider: Provider.module(thread.provider),
          pstate: nil,
          provider_context: nil,
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
          tools: %{},
          # project setup commands in flight: %{cmds, env, n, current: %{io, pid, item_id, out}}
          setup: nil,
          # a first message waiting for setup to finish (Threads.send_when_ready/2)
          queued: nil,
          # callers waiting for the provider's model list
          model_waiters: []
        }

        {:ok, st, {:continue, {:recover, thread.status}}}
    end
  end

  @impl true
  def handle_continue({:recover, previous}, st) when previous in @busy do
    Items.interrupt_running_tools(st.thread.id)
    st = emit(st, %{"type" => "error", "message" => "Server restarted; the turn in progress was lost.", "fatal" => false})
    {:noreply, persist_status(st, "idle")}
  end

  def handle_continue({:recover, _}, st) do
    # also covers a BEAM that died without marking the thread busy
    Items.interrupt_running_tools(st.thread.id)
    {:noreply, persist_status(st, "idle")}
  end

  # Archive: stop everything, tear down, remove the worktree (branch kept), exit.
  def handle_continue(:archive, st) do
    st = st |> flush() |> close_provider() |> stop_setup()
    thread = st.thread
    # child sessions borrow the root's worktree; only the root tears it down
    if is_nil(thread.parent_id) do
      Threads.archive_children(thread.id)
      Workbench.Terminals.close_all(thread.id)
    end

    with nil <- thread.parent_id,
         %{} = project <- thread.project_id && Workbench.Projects.get(thread.project_id),
         true <- Workbench.Worktrees.managed?(project, thread.worktree_path) do
      env = [{"WB_REPO", project.repo_path}, {"WB_WORKTREE", thread.worktree_path}]

      for cmd <- Workbench.Projects.config(project).teardown do
        case Workbench.Provider.Proc.run_sync(cmd, thread.worktree_path, env, :timer.minutes(2)) do
          {:ok, _} -> :ok
          {:error, out} -> Logger.warning("teardown `#{cmd}` failed: #{out}")
        end
      end

      case Workbench.Worktrees.remove(project, thread.worktree_path) do
        :ok -> :ok
        {:error, msg} -> Logger.warning("worktree remove failed: #{msg}")
      end
    end

    Uploads.remove_all(thread.id)

    thread =
      thread
      |> Ecto.Changeset.change(archived_at: DateTime.utc_now(), status: "idle")
      |> Repo.update!()

    Threads.broadcast_lobby({:thread_archived, thread.id})
    {:stop, :normal, %{st | thread: thread, status: "idle"}}
  end

  # -- calls ------------------------------------------------------------------

  @impl true
  def handle_call({:send, _text, _images, _files}, _from, %{status: s} = st) when s in @busy do
    {:reply, {:error, :busy}, st}
  end

  # setup runs first, then the message goes
  def handle_call({:send_when_ready, text}, _from, %{setup: %{}} = st), do: {:reply, :ok, %{st | queued: text}}
  def handle_call({:send_when_ready, text}, from, st), do: handle_call({:send, text, [], []}, from, st)

  def handle_call({:send, text, images, files}, _from, st) do
    with {:ok, refs} <- attach(st.thread.id, images),
         {:ok, file_refs} <- attach_files(st.thread, files) do
      send_turn(st, text, refs, file_refs)
    else
      {:error, message} -> {:reply, {:error, message}, st}
    end
  end

  def handle_call(:interrupt, _from, %{setup: %{current: %{io: io}}} = st) do
    Workbench.Provider.Proc.stop(io)
    {:reply, :ok, %{st | setup: %{st.setup | cmds: []}}}
  end

  def handle_call(:interrupt, _from, %{pstate: p, status: s} = st) when p != nil and s in @busy do
    {:ok, p} = st.provider.interrupt(p)
    {:reply, :ok, %{st | pstate: p}}
  end

  def handle_call(:interrupt, _from, st), do: {:reply, :ok, st}

  def handle_call({:respond, rid, decision, answers}, _from, st) do
    cond do
      decision not in ~w(allow allow_session deny answer) ->
        {:reply, {:error, :bad_decision}, st}

      decision == "answer" and not valid_answers?(answers) ->
        {:reply, {:error, :bad_answers}, st}

      not Map.has_key?(st.pending, rid) or st.pstate == nil ->
        {:reply, {:error, :unknown_request}, st}

      true ->
        answers = if decision == "answer", do: answers
        {:ok, p} = st.provider.respond(st.pstate, rid, decision, answers)
        st = resolve(%{st | pstate: p}, rid, decision, answers)
        {:reply, :ok, touch(st)}
    end
  end

  def handle_call({:set_mode, mode}, _from, st) do
    st = refresh_context(st)
    if mode in Thread.modes() do
      thread = st.thread |> Ecto.Changeset.change(mode: mode) |> Repo.update!()
      st = %{st | thread: thread}

      st =
        if st.pstate do
          {:ok, p} = st.provider.set_mode(st.pstate, mode)
          %{st | pstate: p} |> allow_covered(mode)
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
    st = st |> refresh_context() |> flush()

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

  def handle_call({:write_context, content, base_hash}, _from, st) do
    result = Threads.persist_context(st.thread, content, base_hash)
    {:reply, result, refresh_context(st)}
  end

  def handle_call(:archive, _from, st), do: {:reply, :ok, st, {:continue, :archive}}

  # The provider's models: from the cache, else ask a running agent (starting
  # one if needed; no turn, so nothing is spent).
  def handle_call(:models, from, st) do
    case Workbench.Models.get(st.thread.provider) do
      models when is_list(models) and models != [] ->
        {:reply, {:ok, models}, st}

      _ ->
        with {:ok, st} <- ensure_provider(st),
             {:ok, p} <- st.provider.list_models(st.pstate) do
          if st.model_waiters == [], do: Process.send_after(self(), :models_timeout, 12_000)
          {:noreply, touch(%{st | pstate: p, model_waiters: [from | st.model_waiters]})}
        else
          {:error, reason} -> {:reply, {:error, if(is_binary(reason), do: reason, else: inspect(reason))}, st}
        end
    end
  end

  def handle_call({:usage, refresh?}, _from, st) do
    provider = st.thread.provider
    cached = with {usage, _at} <- Workbench.Usage.get(provider), do: usage

    st =
      if refresh? and Workbench.Usage.stale?(provider) and supports_usage?(st.provider),
        do: request_usage(st),
        else: st

    {:reply, {:ok, cached}, st}
  end

  def handle_call({:set_model, model, effort}, _from, st) do
    st = refresh_context(st)
    thread = st.thread |> Ecto.Changeset.change(model: model, effort: effort) |> Repo.update!()
    st = %{st | thread: thread}

    st =
      if st.pstate do
        {:ok, p} = st.provider.set_model(st.pstate, model, effort)
        %{st | pstate: p}
      else
        st
      end

    Threads.broadcast_lobby({:thread_upserted, thread})
    {:reply, :ok, st}
  end

  @impl true
  def handle_cast({:setup, cmds, env}, st) do
    st = %{st | setup: %{cmds: cmds, env: env, n: 0, current: nil}} |> set_status("running")
    {:noreply, next_setup(st)}
  end

  # -- provider output ----------------------------------------------------------

  @impl true
  def handle_info({:context_changed, context}, st) do
    {:noreply, %{st | thread: %{st.thread | initial_context: context}}}
  end

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

  # erlexec delivers output and the exit from different processes, so the exit
  # can overtake the last output. Give in-flight output a moment to arrive.
  @drain_ms 50

  def handle_info({:EXIT, pid, reason}, %{pstate: %{pid: pid}} = st) do
    Process.send_after(self(), {:provider_exited, pid, reason}, @drain_ms)
    {:noreply, st}
  end

  def handle_info({:DOWN, _ref, :process, pid, reason}, %{pstate: %{pid: pid}} = st) do
    Process.send_after(self(), {:provider_exited, pid, reason}, @drain_ms)
    {:noreply, st}
  end

  def handle_info({:provider_exited, pid, reason}, %{pstate: %{pid: pid}} = st),
    do: {:noreply, provider_exited(st, reason)}

  def handle_info(:models_timeout, %{model_waiters: []} = st), do: {:noreply, st}

  def handle_info(:models_timeout, st) do
    for from <- st.model_waiters, do: GenServer.reply(from, {:error, "the agent did not list its models"})
    {:noreply, %{st | model_waiters: []}}
  end

  def handle_info(:flush, st), do: {:noreply, flush(%{st | flush_ref: nil})}

  def handle_info(:idle, %{status: "idle", pstate: p} = st) when p != nil do
    Logger.info("closing idle agent process")
    {:noreply, close_provider(st)}
  end

  def handle_info(:idle, st), do: {:noreply, %{st | idle_ref: nil}}

  def handle_info({stream, io, data}, %{setup: %{current: %{io: io} = cur}} = st)
      when stream in [:stdout, :stderr] do
    out = String.slice(cur.out <> data, -16_000, 16_000)
    {:noreply, %{st | setup: %{st.setup | current: %{cur | out: out}}}}
  end

  def handle_info({:EXIT, pid, reason}, %{setup: %{current: %{pid: pid}}} = st) do
    Process.send_after(self(), {:setup_exited, pid, reason}, @drain_ms)
    {:noreply, st}
  end

  def handle_info({:setup_exited, pid, reason}, %{setup: %{current: %{pid: pid}}} = st),
    do: {:noreply, setup_finished(st, reason)}

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
    st = refresh_context(st)
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
    %{st | turn_id: ev["turn_id"]} |> set_activity("Thinking…") |> broadcast(ev) |> set_status("running")
  end

  # not part of the conversation: cached and handed to whoever asked
  defp emit(st, %{"type" => "models", "models" => models} = ev) do
    if models != [], do: Workbench.Models.put(st.thread.provider, models)
    reply = if models == [] and ev["error"], do: {:error, ev["error"]}, else: {:ok, models}
    for from <- st.model_waiters, do: GenServer.reply(from, reply)
    %{st | model_waiters: []}
  end

  # account-wide, not part of the conversation: cached and broadcast to every
  # thread; a failed fetch keeps whatever was cached
  defp emit(st, %{"type" => "usage"} = ev) do
    if ev["error"],
      do: Logger.debug(["usage unavailable: ", ev["error"]]),
      else: Workbench.Usage.put(st.thread.provider, ev["usage"])

    st
  end

  defp emit(st, %{"type" => "item.completed", "item" => item} = ev) do
    item = Map.put_new(item, "turn_id", st.turn_id)
    ev = %{ev | "item" => item}
    st = %{st | live: Map.delete(st.live, item["id"])} |> flush()
    {env, st} = stamp(st, ev)
    Items.put(st.thread.id, env["seq"], item)
    st = if item["kind"] == "assistant_message", do: set_activity(st, Activity.message(item["text"])), else: st
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

    %{st | tools: Map.put(st.tools, item["id"], item)}
    |> set_activity(Activity.tool(item["name"], item["input"]))
    |> publish(env)
  end

  defp emit(st, %{"type" => "tool.completed"} = ev) do
    id = ev["item_id"]
    base = Map.get(st.tools, id, %{"id" => id, "kind" => "tool", "name" => "tool", "input" => nil, "turn_id" => st.turn_id})
    # images the agent looked at or made: stored, and only their refs go out
    {images, ev} = Map.pop(ev, "images")
    refs = Uploads.store_all(st.thread.id, Enum.map(List.wrap(images), &named(&1, base["input"])))
    ev = if refs == [], do: ev, else: Map.put(ev, "images", refs)

    item =
      Map.merge(base, %{
        "output" => ev["output"],
        "is_error" => ev["is_error"] || false,
        "truncated" => ev["truncated"] || false,
        "status" => "done"
      })

    item = if refs == [], do: item, else: Map.put(item, "images", refs)

    st = flush(st)
    {env, st} = stamp(st, ev)
    Items.put(st.thread.id, env["seq"], item)
    publish(%{st | tools: Map.delete(st.tools, id)}, env)
  end

  defp emit(st, %{"type" => "approval.requested", "request_id" => rid} = ev) do
    st = %{st | pending: Map.put(st.pending, rid, ev)}
    st |> set_activity(Activity.approval(ev["tool"], ev["input"])) |> broadcast(ev) |> set_status("awaiting_approval")
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

  # an image returned inline (Claude's Read) is named after the file it came from
  defp named(%{} = img, %{} = input) do
    case input["file_path"] || input["path"] do
      path when is_binary(path) -> Map.put_new(img, "name", Path.basename(path))
      _ -> img
    end
  end

  defp named(img, _input), do: img

  # Switching to a more permissive mode also answers the approvals it
  # covers: the agent is waiting on them, and the new mode says yes.
  @edit_tools ~w(Edit Write MultiEdit NotebookEdit Patch)
  defp covered?("bypassPermissions", tool), do: tool != "AskUserQuestion"
  defp covered?("acceptEdits", tool), do: tool in @edit_tools
  defp covered?(_, _), do: false

  defp allow_covered(st, mode) do
    for {rid, %{"tool" => tool}} <- st.pending, covered?(mode, tool), reduce: st do
      st ->
        {:ok, p} = st.provider.respond(st.pstate, rid, "allow", nil)
        resolve(%{st | pstate: p}, rid, "allow")
    end
  end

  defp valid_answers?(answers) when is_map(answers) and map_size(answers) <= 20 do
    Enum.all?(answers, fn {k, v} -> is_binary(k) and is_list(v) and length(v) <= 20 and Enum.all?(v, &is_binary/1) end)
  end

  defp valid_answers?(_), do: false

  defp resolve(st, rid, decision, answers \\ nil) do
    request = st.pending[rid]
    st = %{st | pending: Map.delete(st.pending, rid)}
    question? = match?(%{"tool" => "AskUserQuestion"}, request) and decision in ~w(answer deny)
    picked = if decision == "answer", do: answers || %{}, else: %{}

    ev = %{"type" => "approval.resolved", "request_id" => rid, "decision" => decision}
    st = broadcast(st, if(question?, do: Map.put(ev, "answers", picked), else: ev))
    st = if question?, do: record_answers(st, rid, request, picked), else: st

    if st.status == "awaiting_approval" and map_size(st.pending) == 0,
      do: set_status(st, "running"),
      else: st
  end

  # The answers belong on the question's tool item so they survive a reload.
  # Claude (and the fake) have one with the request's id; Codex's
  # request_user_input has no item, so it gets one.
  defp record_answers(st, rid, request, picked) do
    if Map.has_key?(st.tools, rid) do
      %{st | tools: Map.update!(st.tools, rid, &Map.put(&1, "answers", picked))}
    else
      emit(st, %{
        "type" => "item.completed",
        "item" => %{
          "id" => rid,
          "kind" => "tool",
          "name" => "AskUserQuestion",
          "input" => request["input"],
          "answers" => picked,
          "output" => nil,
          "is_error" => false,
          "status" => "done"
        }
      })
    end
  end

  defp cancel_pending(st) do
    Enum.reduce(Map.keys(st.pending), st, &resolve(&2, &1, "cancelled"))
  end

  # what the sidebar says the agent is doing; only a change is stored and sent
  defp set_activity(st, text) when text in [nil, ""], do: st
  defp set_activity(%{thread: %{activity: text}} = st, text), do: st

  defp set_activity(st, text) do
    thread = st.thread |> Ecto.Changeset.change(activity: text) |> Repo.update!()
    Threads.broadcast_lobby({:thread_activity, thread.id, text})
    %{st | thread: thread}
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

  # -- sending ----------------------------------------------------------------

  defp send_turn(st, text, refs, file_refs) do
    st = if st.status == "error", do: close_provider(st), else: st
    files = for r <- refs, do: %{"path" => Path.join(Uploads.dir(st.thread.id), r["id"]), "mime" => r["mime"]}
    message = %{"id" => "u-" <> uid(), "kind" => "user_message", "text" => text}
    message = if refs == [], do: message, else: Map.put(message, "images", refs)
    # the path stays on the server: the timeline only needs the name and size
    message = if file_refs == [], do: message, else: Map.put(message, "files", Enum.map(file_refs, &Map.delete(&1, "path")))

    with {:ok, st} <- ensure_provider(st),
         {:ok, pstate} <- st.provider.send_turn(st.pstate, with_files(text, file_refs), files) do
      st =
        %{st | pstate: pstate}
        |> emit(%{"type" => "item.completed", "item" => message})
        |> set_status("running")
        |> touch()

      Threads.broadcast_lobby({:thread_messages, st.thread.id, Items.count(st.thread.id, "user_message")})
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

  @max_images 10

  # Other files reach the agent as paths it can read, after what you typed.
  defp with_files(text, []), do: text

  defp with_files(text, file_refs) do
    list = Enum.map_join(file_refs, "\n", &"- #{&1["path"]}")
    String.trim("#{text}\n\nAttached files:\n#{list}")
  end

  defp attach_files(_thread, files) when length(files) > @max_images,
    do: {:error, "at most #{@max_images} files per message"}

  # a file is new (`data`), one from earlier in the conversation (`upload`, an
  # id), or one in the worktree (`worktree`, a path inside it)
  defp attach_files(thread, files) do
    Enum.reduce_while(files, {:ok, []}, fn file, {:ok, refs} ->
      case file_ref(thread, file) do
        {:ok, ref} ->
          {:cont, {:ok, refs ++ [ref]}}

        {:error, reason} ->
          name = if is_map(file) and is_binary(file["name"]), do: file["name"], else: "a file"
          {:halt, {:error, "could not attach #{name}: #{reason |> to_string() |> String.replace("_", " ")}"}}
      end
    end)
  end

  # Store attached images before the turn starts, so a bad one fails the send.
  defp attach(_id, images) when length(images) > @max_images,
    do: {:error, "at most #{@max_images} images per message"}

  defp attach(id, images) do
    Enum.reduce_while(images, {:ok, []}, fn img, {:ok, refs} ->
      # bytes only: a path here would let a client copy any image on disk
      case Uploads.store(id, if(is_map(img), do: Map.take(img, ["data", "mime", "name"]), else: img)) do
        {:ok, ref} ->
          {:cont, {:ok, refs ++ [ref]}}

        {:error, reason} ->
          name = if is_map(img) and is_binary(img["name"]), do: img["name"], else: "an image"
          {:halt, {:error, "could not attach #{name}: #{reason |> to_string() |> String.replace("_", " ")}"}}
      end
    end)
  end

  defp file_ref(thread, %{"upload" => id}) when is_binary(id), do: Uploads.resolve(thread.id, id)

  defp file_ref(thread, %{"worktree" => rel}) when is_binary(rel) do
    with {:ok, %{path: safe, size: size, binary: _}} <- Workbench.Files.read(thread.worktree_path, rel) do
      {:ok, %{"id" => "w-" <> Base.encode16(:crypto.hash(:sha256, safe), case: :lower) |> binary_part(0, 18), "name" => Path.basename(safe), "size" => size, "path" => Path.join(thread.worktree_path, safe), "worktree" => safe}}
    end
  end

  defp file_ref(thread, file) when is_map(file), do: Uploads.store_file(thread.id, Map.take(file, ["data", "name"]))
  defp file_ref(thread, file), do: Uploads.store_file(thread.id, file)

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

  defp supports_usage?(provider), do: Code.ensure_loaded?(provider) and function_exported?(provider, :list_usage, 1)

  defp request_usage(st) do
    with {:ok, st} <- ensure_provider(st),
         {:ok, p} <- st.provider.list_usage(st.pstate) do
      touch(%{st | pstate: p})
    else
      {:error, reason} ->
        Logger.debug(["could not start the agent for usage: ", inspect(reason)])
        st
    end
  end

  defp ensure_provider(st) do
    st = refresh_context(st)
    st = if st.pstate && st.provider_context != st.thread.initial_context && st.status not in @busy, do: close_provider(st), else: st
    open_provider(st)
  end

  defp refresh_context(st) do
    root = Threads.get(st.thread.parent_id || st.thread.id)
    if root, do: %{st | thread: %{st.thread | initial_context: root.initial_context}}, else: st
  end

  defp open_provider(%{pstate: nil} = st) do
    opts = %{
      thread_id: st.thread.id,
      cwd: st.thread.worktree_path,
      resume: st.thread.session_id,
      initial_context: st.thread.initial_context,
      mode: st.thread.mode,
      model: st.thread.model,
      effort: st.thread.effort
    }

    case st.provider.open(opts) do
      {:ok, pstate} -> {:ok, %{st | pstate: pstate, provider_context: st.thread.initial_context, line_buf: "", stderr: ""}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp open_provider(st), do: {:ok, st}

  # -- project setup commands ---------------------------------------------------

  defp next_setup(%{setup: %{cmds: []}} = st), do: setup_done(st)

  defp next_setup(%{setup: %{cmds: [cmd | rest]} = setup} = st) do
    n = setup.n + 1
    item_id = "setup-#{uid()}"
    st = emit(st, %{"type" => "tool.started", "item_id" => item_id, "name" => "Setup", "input" => %{"command" => cmd}})

    case Workbench.Provider.Proc.start(["sh", "-c", cmd], st.thread.worktree_path, setup.env) do
      {:ok, %{io: io, pid: pid}} ->
        %{st | setup: %{setup | cmds: rest, n: n, current: %{io: io, pid: pid, item_id: item_id, out: ""}}}

      {:error, reason} ->
        st
        |> emit(%{"type" => "tool.completed", "item_id" => item_id, "output" => inspect(reason), "is_error" => true, "truncated" => false})
        |> emit(%{"type" => "error", "message" => "Setup could not start `#{cmd}`: #{inspect(reason)}", "fatal" => false})
        |> setup_done()
    end
  end

  defp setup_finished(%{setup: %{current: cur} = setup} = st, reason) do
    ok = reason == :normal
    {output, truncated} = tail(cur.out, 8_000)

    st =
      emit(st, %{
        "type" => "tool.completed",
        "item_id" => cur.item_id,
        "output" => output,
        "truncated" => truncated,
        "is_error" => not ok
      })

    if ok do
      next_setup(%{st | setup: %{setup | current: nil}})
    else
      st
      |> emit(%{
        "type" => "error",
        "message" => "Setup failed (#{Workbench.Provider.Proc.describe_exit(reason)}). The worktree is ready, but later setup steps were skipped.",
        "fatal" => false
      })
      |> setup_done()
    end
  end

  # a queued first message goes even if setup failed: the error is in the
  # timeline, and the agent may well be able to sort it out
  defp setup_done(st) do
    st = %{st | setup: nil} |> set_status("idle")

    case st.queued do
      nil ->
        st

      text ->
        {:reply, _, st} = send_turn(%{st | queued: nil}, text, [], [])
        st
    end
  end

  defp stop_setup(%{setup: %{current: %{io: io}}} = st) do
    Workbench.Provider.Proc.stop(io)
    %{st | setup: nil}
  end

  defp stop_setup(st), do: %{st | setup: nil}

  defp tail(s, max) when byte_size(s) <= max, do: {s, false}
  defp tail(s, max), do: {"…" <> String.slice(s, -max, max), true}

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
