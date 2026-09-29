defmodule Workbench.Threads do
  @moduledoc """
  Public API for threads. Every call goes through the thread's
  `Workbench.Threads.Server`, started on demand; the agent process itself is
  only spawned on the first `send_message/2`.
  """
  import Ecto.Query

  alias Workbench.{Projects, Repo, Worktrees}
  alias Workbench.Threads.{Server, Thread}

  @lobby "lobby"

  def lobby_topic, do: @lobby
  def topic(id), do: "thread:" <> id

  def subscribe(id), do: Phoenix.PubSub.subscribe(Workbench.PubSub, topic(id))
  def subscribe_lobby, do: Phoenix.PubSub.subscribe(Workbench.PubSub, @lobby)

  def broadcast_lobby(msg), do: Phoenix.PubSub.broadcast(Workbench.PubSub, @lobby, msg)

  def list do
    Repo.all(from t in Thread, where: is_nil(t.archived_at), order_by: [desc: t.inserted_at])
  end

  def get(id), do: Repo.get(Thread, id)

  @doc """
  Create a thread.

  With `project_id`, the thread gets its own worktree on branch `wb/<slug>`
  cut from `base_ref` (default: the project's default branch), and the
  project's setup commands run in it. Pass `isolate: false` to run in the
  repo itself instead.

  Without a project, `worktree_path` must be an existing directory (M1 mode).
  """
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
  worktree (the branch is kept) and hide the thread.
  """
  def archive(id), do: call(id, :archive)

  def send_message(id, text) when is_binary(text), do: call(id, {:send, text})
  def interrupt(id), do: call(id, :interrupt)
  def respond(id, request_id, decision), do: call(id, {:respond, request_id, decision})
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
