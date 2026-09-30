defmodule Workbench.Threads do
  @moduledoc """
  Public API for threads. Every call goes through the thread's
  `Workbench.Threads.Server`, started on demand; the agent process itself is
  only spawned on the first `send_message/2`.
  """
  import Ecto.Query

  alias Workbench.{Projects, Repo, Worktrees}
  alias Workbench.Threads.{Server, Thread}

  # PubSub topics. Not the channel topics ("lobby", "thread:<id>"): a channel
  # process is already subscribed to its own topic on the endpoint's PubSub,
  # so reusing those names delivered every message twice.
  @lobby "wb:lobby"

  def lobby_topic, do: @lobby
  def topic(id), do: "wb:thread:" <> id

  def subscribe(id), do: Phoenix.PubSub.subscribe(Workbench.PubSub, topic(id))
  def subscribe_lobby, do: Phoenix.PubSub.subscribe(Workbench.PubSub, @lobby)

  def broadcast_lobby(msg), do: Phoenix.PubSub.broadcast(Workbench.PubSub, @lobby, msg)

  def list do
    threads = Repo.all(from t in Thread, where: is_nil(t.archived_at), order_by: [desc: t.inserted_at])
    counts = Workbench.Items.counts("user_message", Enum.map(threads, & &1.id))
    Enum.map(threads, &%{&1 | message_count: Map.get(counts, &1.id, 0)})
  end

  def children(id) do
    Repo.all(from t in Thread, where: t.parent_id == ^id and is_nil(t.archived_at), order_by: t.inserted_at)
  end

  def get(id), do: Repo.get(Thread, id)

  @doc """
  Create a thread.

  With `project_id`, the thread gets its own worktree on branch `wb/<slug>`
  cut from `base_ref` (default: the project's default branch), and the
  project's setup commands run in it. Pass `isolate: false` to run in the
  repo itself instead.

  With `parent_id`, the thread is another session in the parent's worktree:
  same project, path and branch, no new worktree and no setup. Sessions
  nest one level; a child of a child hangs off the root.

  Without a project, `worktree_path` must be an existing directory (M1 mode).
  """
  def create(%{parent_id: parent_id} = attrs) when is_binary(parent_id) do
    case get(parent_id) do
      %Thread{archived_at: nil} = parent ->
        root = if parent.parent_id, do: get(parent.parent_id) || parent, else: parent

        attrs
        |> Map.drop([:isolate, :cwd])
        |> Map.merge(%{
          parent_id: root.id,
          project_id: root.project_id,
          worktree_path: root.worktree_path,
          branch: root.branch,
          base_ref: root.base_ref
        })
        |> insert()

      _ ->
        {:error, "parent thread not found"}
    end
  end

  def create(%{project_id: project_id} = attrs) when is_binary(project_id) do
    with {:ok, project} <- fetch_project(project_id),
         {:ok, place} <- place(project, attrs) do
      attrs =
        Map.merge(attrs, %{worktree_path: place.path, branch: place.branch, base_ref: place.base_ref})

      case insert(attrs) do
        {:ok, thread} ->
          setup = if place.isolated, do: Projects.config(project).setup, else: []
          if setup != [], do: run_setup(thread, project, setup)
          {:ok, thread}

        {:error, _} = err ->
          if place.isolated, do: Worktrees.remove(project, place.path)
          err
      end
    end
  end

  def create(attrs), do: insert(attrs)

  defp insert(attrs) do
    with {:ok, thread} <- attrs |> Thread.create_changeset() |> Repo.insert() do
      broadcast_lobby({:thread_upserted, thread})
      {:ok, thread}
    end
  end

  defp fetch_project(id) do
    case Projects.get(id) do
      nil -> {:error, "project not found"}
      p -> {:ok, p}
    end
  end

  defp place(project, %{isolate: false}) do
    branch =
      case Workbench.Git.run(project.repo_path, ["symbolic-ref", "--short", "HEAD"]) do
        {:ok, b} -> b
        _ -> nil
      end

    {:ok, %{path: project.repo_path, branch: branch, base_ref: nil, isolated: false}}
  end

  defp place(project, attrs) do
    slug = Worktrees.slug(attrs[:title])

    with {:ok, wt} <- Worktrees.create(project, slug, blank_to_nil(attrs[:base_ref])) do
      {:ok, Map.put(wt, :isolated, true)}
    end
  end

  defp run_setup(thread, project, commands) do
    env = [{"WB_REPO", project.repo_path}, {"WB_WORKTREE", thread.worktree_path}]
    with {:ok, pid} <- ensure_started(thread.id), do: GenServer.cast(pid, {:setup, commands, env})
  end

  defp blank_to_nil(""), do: nil
  defp blank_to_nil(v), do: v

  @doc """
  Archive: stop the agent, run the project's teardown commands, remove the
  worktree (the branch is kept) and hide the thread. A root session archives
  its child sessions first; archiving a child only stops and hides it.
  """
  def archive(id), do: call(id, :archive)

  @doc false
  # Called by a root's server before it tears the worktree down.
  def archive_children(id) do
    for child <- children(id) do
      case whereis(child.id) do
        nil ->
          Repo.update!(Ecto.Changeset.change(child, archived_at: DateTime.utc_now(), status: "idle"))
          broadcast_lobby({:thread_archived, child.id})

        pid ->
          ref = Process.monitor(pid)
          GenServer.call(pid, :archive, 15_000)

          receive do
            {:DOWN, ^ref, _, _, _} -> :ok
          after
            :timer.minutes(1) -> Process.demonitor(ref, [:flush])
          end
      end
    end

    :ok
  end

  def send_message(id, text) when is_binary(text), do: call(id, {:send, text})
  def interrupt(id), do: call(id, :interrupt)
  def respond(id, request_id, decision, answers \\ nil), do: call(id, {:respond, request_id, decision, answers})
  def set_mode(id, mode), do: call(id, {:set_mode, mode})

  @doc "Current state for a joining client: thread, status, seq, items, live text, pending approvals."
  def snapshot(id), do: call(id, :snapshot)

  def ensure_started(id) do
    case Registry.lookup(Workbench.Threads.Registry, id) do
      [{pid, _}] ->
        {:ok, pid}

      [] ->
        case DynamicSupervisor.start_child(Workbench.Threads.Supervisor, {Server, id}) do
          # init/1 returns :ignore when the thread row does not exist
          :ignore -> {:error, :not_found}
          {:ok, pid} -> {:ok, pid}
          {:error, {:already_started, pid}} -> {:ok, pid}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  def whereis(id) do
    case Registry.lookup(Workbench.Threads.Registry, id) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end

  defp call(id, msg) do
    with {:ok, pid} <- ensure_started(id) do
      GenServer.call(pid, msg, 15_000)
    end
  end
end
