defmodule Workbench.Guide do
  @moduledoc """
  A review guide: a thread's changes grouped into a few ordered chunks, each
  with a title and a short explanation, core changes first.

  A small model writes it. `generate/1` starts the configured agent (see
  `Workbench.Settings` `"guide"`) on its own in the workspace's worktree, in
  plan mode, sends it the changed files and as much of the patch as fits,
  and reads one JSON reply, like `Workbench.Models` does to list models.
  Approval requests are denied: the guide is written from what it was sent
  and what the agent can read.

  The reply is never trusted: `normalize/2` drops paths that aren't in the
  diff, places each file once, and puts files the model left out in a last
  chunk.

  One guide per workspace (the root thread), stored with the fingerprint of
  the changes it describes. When the changes move on the guide is `stale`
  but still shown.

  `view/1` returns what the UI needs:

      %{guide: %{"summary", "groups" => [%{"title", "summary", "files"}],
                 "provider", "model", "generated_at"} | nil,
        state: %{"status" => "idle" | "generating" | "error",
                 "started_at" => ms | nil, "message" => binary | nil},
        stale: boolean}

  Transitions are broadcast as `{:guide, root_id}` on `subscribe/1`.
  """
  use GenServer
  use Ecto.Schema
  require Logger

  alias Workbench.{OneShot, Repo, Review, Settings, Threads}

  @budget 200_000
  @timeout_ms 180_000
  @max_title 80
  @max_summary 600

  @default_prompt """
  You are preparing a review guide for a code change, the way a careful engineer would walk a teammate through a pull request.

  Group the changed files into a few ordered chunks that each tell one part of the story:
  - Put the core of the implementation first, then supporting changes (wiring, config, migrations), and tests and low-signal changes (formatting, generated files, lockfiles) last.
  - Keep files that change together for one reason in the same chunk.
  - Name each chunk for what it does, in a few words ("Update endpoint", not "Changes to controller").
  - Write each summary as one or two sentences on why the chunk exists and what it changes, not as a list of edits.
  """

  @format """
  Reply with a single JSON object and nothing else, no code fences:
  {"summary": "one sentence on the whole change", "groups": [{"title": "...", "summary": "...", "files": ["path"]}]}
  Use 2 to 8 groups (one if there is a single file). Every changed file goes in exactly one group, with its path exactly as listed below. You may read files in the worktree for context, but you can't run commands.
  [workbench-guide]
  """

  @primary_key {:root_id, :binary_id, autogenerate: false}
  schema "review_guides" do
    field :fingerprint, :string
    field :value, :string
    timestamps(type: :utc_datetime_usec)
  end

  def default_prompt, do: String.trim(@default_prompt)

  @doc "The guide agent's settings: what was saved, else Claude's Sonnet."
  def config do
    Settings.guide() || %{"provider" => "claude", "model" => "sonnet", "effort" => nil, "prompt" => default_prompt()}
  end

  # -- API --------------------------------------------------------------------

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  def subscribe(root_id), do: Phoenix.PubSub.subscribe(Workbench.PubSub, topic(root_id))

  @doc "Start writing the guide for a workspace. Does nothing if one is already being written."
  def generate(root_id), do: GenServer.call(__MODULE__, {:generate, root_id})

  @doc "Stop the guide being written, if any."
  def cancel(root_id), do: GenServer.call(__MODULE__, {:cancel, root_id})

  def view(root_id) do
    row = Repo.get(__MODULE__, root_id)

    %{
      guide: row && Jason.decode!(row.value),
      state: GenServer.call(__MODULE__, {:state, root_id}),
      stale: row != nil and stale?(root_id, row.fingerprint)
    }
  end

  defp stale?(root_id, fingerprint) do
    with %{} = thread <- Threads.get(root_id),
         {:ok, %{files: files}} <- Review.diff(thread, summary: true) do
      fingerprint(files) != fingerprint
    else
      _ -> false
    end
  end

  # -- server -----------------------------------------------------------------

  @impl true
  def init(_), do: {:ok, %{runs: %{}, errors: %{}}}

  @impl true
  def handle_call({:generate, root_id}, _from, %{runs: runs} = st) do
    with false <- Map.has_key?(runs, root_id),
         %{} = thread <- Threads.get(root_id) do
      cfg = config()
      task = Task.Supervisor.async_nolink(Workbench.TaskSupervisor, fn -> write(thread, cfg) end)
      run = %{ref: task.ref, pid: task.pid, started_at: System.system_time(:millisecond), cfg: cfg}
      st = %{st | runs: Map.put(runs, root_id, run), errors: Map.delete(st.errors, root_id)}
      changed(root_id)
      {:reply, :ok, st}
    else
      true -> {:reply, :ok, st}
      nil -> {:reply, {:error, "thread not found"}, st}
    end
  end

  def handle_call({:cancel, root_id}, _from, %{runs: runs} = st) do
    case Map.pop(runs, root_id) do
      {nil, _} ->
        {:reply, :ok, st}

      {%{ref: ref, pid: pid}, runs} ->
        Process.demonitor(ref, [:flush])
        # the agent is linked to the task: it goes down with it
        Process.exit(pid, :kill)
        changed(root_id)
        {:reply, :ok, %{st | runs: runs}}
    end
  end

  def handle_call({:state, root_id}, _from, st) do
    state =
      case {st.runs[root_id], st.errors[root_id]} do
        {%{started_at: at}, _} -> %{"status" => "generating", "started_at" => at, "message" => nil}
        {nil, msg} when is_binary(msg) -> %{"status" => "error", "started_at" => nil, "message" => msg}
        _ -> %{"status" => "idle", "started_at" => nil, "message" => nil}
      end

    {:reply, state, st}
  end

  @impl true
  def handle_info({ref, result}, st) when is_reference(ref) do
    Process.demonitor(ref, [:flush])
    {:noreply, finish(st, ref, result)}
  end

  def handle_info({:DOWN, ref, :process, _, reason}, st),
    do: {:noreply, finish(st, ref, {:error, "the guide writer crashed: #{inspect(reason)}"})}

  def handle_info(_, st), do: {:noreply, st}

  defp finish(st, ref, result) do
    case Enum.find(st.runs, fn {_, r} -> r.ref == ref end) do
      nil ->
        st

      {root_id, run} ->
        st = %{st | runs: Map.delete(st.runs, root_id)}

        st =
          case result do
            {:ok, guide, fingerprint} ->
              store(root_id, fingerprint, Map.merge(guide, %{"provider" => run.cfg["provider"], "model" => run.cfg["model"], "generated_at" => DateTime.to_iso8601(DateTime.utc_now())}))
              st

            {:error, msg} ->
              Logger.warning("guide for #{root_id} failed: #{msg}")
              %{st | errors: Map.put(st.errors, root_id, msg)}
          end

        changed(root_id)
        st
    end
  end

  defp store(root_id, fingerprint, guide) do
    now = DateTime.utc_now()

    Repo.insert_all(__MODULE__, [%{root_id: root_id, fingerprint: fingerprint, value: Jason.encode!(guide), inserted_at: now, updated_at: now}],
      on_conflict: {:replace, [:fingerprint, :value, :updated_at]},
      conflict_target: :root_id
    )
  end

  defp changed(root_id), do: Phoenix.PubSub.broadcast(Workbench.PubSub, topic(root_id), {:guide, root_id})
  defp topic(root_id), do: "guide:" <> root_id

  # -- writing the guide (runs in a task) ---------------------------------------

  defp write(thread, cfg) do
    with {:ok, %{files: [_ | _] = files} = diff} <- Review.diff(thread),
         {:ok, text} <- ask(thread, cfg, prompt(cfg["prompt"], diff)),
         {:ok, guide} <- parse(text, Enum.map(files, & &1.path)) do
      {:ok, guide, fingerprint(files)}
    else
      {:ok, _} -> {:error, "There are no changes to write a guide for."}
      {:error, reason} -> {:error, if(is_binary(reason), do: reason, else: inspect(reason))}
    end
  end

  @doc "A short hash of what changed (paths, statuses, line counts): when it differs, the guide is stale."
  def fingerprint(files) do
    files
    |> Enum.map(&"#{&1.path}|#{&1.status}|#{&1.additions}|#{&1.deletions}")
    |> Enum.sort()
    |> Enum.join("\n")
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end

  @doc """
  The message sent to the model: the configured instructions, the reply
  format, the changed files, and the patch of as many of them as fit in the
  budget (the rest are listed as not included).
  """
  def prompt(instructions, %{files: files} = diff) do
    {patches, left_out} = fit(diff[:patch], files)

    listing =
      Enum.map_join(files, "\n", fn f ->
        from = if f.old_path, do: " from #{f.old_path}", else: ""
        note = if f.path in left_out, do: ", patch not included", else: ""
        counts = if f.binary, do: "binary", else: "+#{f.additions} -#{f.deletions}"
        "- #{f.path} (#{f.status}#{from}, #{counts}#{note})"
      end)

    where =
      if diff.base == "HEAD",
        do: "The changes are the uncommitted ones in the worktree.",
        else: "The changes are everything in the worktree against `#{diff.base}`."

    """
    #{String.trim(instructions)}

    #{@format}
    #{where}

    Changed files:
    #{listing}
    #{if patches == "", do: "", else: "\nPatch:\n\n" <> patches}
    """
  end

  # whole per-file sections of the patch, in order, until the budget is spent
  defp fit(nil, files), do: {"", Enum.map(files, & &1.path)}

  defp fit(patch, files) do
    sections = String.split(patch, ~r/^(?=diff --git )/m, trim: true)

    {kept, _} =
      Enum.reduce(sections, {[], 0}, fn s, {kept, used} ->
        if used + byte_size(s) <= @budget, do: {[s | kept], used + byte_size(s)}, else: {kept, used}
      end)

    kept = Enum.reverse(kept)
    included = MapSet.new(for s <- kept, p <- [section_path(s)], p, do: p)
    {Enum.join(kept), for(f <- files, f.path not in included, do: f.path)}
  end

  defp section_path(section) do
    case Regex.run(~r{^diff --git a/.+ b/(.+)$}m, section) do
      [_, path] -> path
      _ -> nil
    end
  end

  # -- the one-shot turn --------------------------------------------------------

  defp ask(thread, cfg, text), do: OneShot.ask(cfg, text, id: "guide-#{thread.id}", cwd: thread.worktree_path, initial_context: thread.initial_context, timeout: @timeout_ms, label: "guide")

  # -- reading the reply --------------------------------------------------------

  @doc "The model's reply as a guide over exactly `paths`, or an error."
  def parse(text, paths) do
    with {:ok, raw} <- decode(text), do: normalize(raw, paths)
  end

  # from the first `{` to the last `}`: tolerates code fences and a line of prose around it
  defp decode(text) do
    with [json] <- Regex.run(~r/\{.*\}/s, text),
         {:ok, %{} = raw} <- Jason.decode(json) do
      {:ok, raw}
    else
      _ -> {:error, "the agent's answer wasn't a guide (no JSON)"}
    end
  end

  @doc "Place every path in `paths` in exactly one group; drop what isn't in the diff."
  def normalize(%{"groups" => groups} = raw, paths) when is_list(groups) do
    known = MapSet.new(paths)

    {kept, seen} =
      Enum.reduce(groups, {[], MapSet.new()}, fn
        %{"files" => files} = g, {acc, seen} when is_list(files) ->
          mine = files |> Enum.filter(&(is_binary(&1) and &1 in known and &1 not in seen)) |> Enum.uniq()

          if mine == [],
            do: {acc, seen},
            else: {[%{"title" => clip(g["title"], @max_title) || "Changes", "summary" => clip(g["summary"], @max_summary), "files" => mine} | acc], MapSet.union(seen, MapSet.new(mine))}

        _, acc ->
          acc
      end)

    case {Enum.reverse(kept), Enum.reject(paths, &(&1 in seen))} do
      {[], _} -> {:error, "the agent's guide had no usable groups"}
      {groups, []} -> {:ok, %{"summary" => clip(raw["summary"], @max_summary), "groups" => groups}}
      {groups, rest} -> {:ok, %{"summary" => clip(raw["summary"], @max_summary), "groups" => groups ++ [%{"title" => "Other changes", "summary" => nil, "files" => rest}]}}
    end
  end

  def normalize(_, _), do: {:error, "the agent's guide had no groups"}

  defp clip(s, max) when is_binary(s) do
    case String.trim(s) do
      "" -> nil
      s -> String.slice(s, 0, max)
    end
  end

  defp clip(_, _), do: nil
end
