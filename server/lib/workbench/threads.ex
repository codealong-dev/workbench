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

  @doc "The shared context page, resolved to the workspace's root."
  def context(id) do
    case context_thread(id) do
      %Thread{} = root -> {:ok, context_document(root.initial_context)}
      nil -> {:error, :not_found}
    end
  end

  def context_topic(id), do: "wb:context:" <> id

  def context_document(content) do
    content = content || ""
    %{content: content, hash: Workbench.Files.hash(content)}
  end

  @doc "Save shared context with conflict detection; existing agents pick it up on their next turn."
  def write_context(id, content, base_hash) when is_binary(content) do
    case context_thread(id) do
      %Thread{id: root_id} -> call(root_id, {:write_context, content, base_hash})
      nil -> {:error, :not_found}
    end
  end

  defp context_thread(id) do
    case get(id) do
      %Thread{archived_at: nil, parent_id: nil} = root -> root
      %Thread{archived_at: nil, parent_id: root_id} ->
        case get(root_id) do
          %Thread{archived_at: nil} = root -> root
          _ -> nil
        end
      _ -> nil
    end
  end

  @doc false
  # Called by the root server so concurrent saves are serialized.
  def persist_context(root, content, base_hash) do
    now = context_document(get(root.id).initial_context)

    if is_binary(base_hash) and base_hash != now.hash do
      {:error, {:conflict, now}}
    else
      value = if String.trim(content) == "", do: nil, else: content
      query = from t in Thread, where: (t.id == ^root.id or t.parent_id == ^root.id) and is_nil(t.archived_at)

      with {:ok, threads} <- Repo.transaction(fn ->
        Repo.update_all(query, set: [initial_context: value, updated_at: DateTime.utc_now()])
        Repo.all(query)
      end) do
        for thread <- threads, do: broadcast_lobby({:thread_upserted, thread})
        Phoenix.PubSub.broadcast(Workbench.PubSub, context_topic(root.id), {:context_changed, value})
        {:ok, context_document(value)}
      end
    end
  end

  @doc """
  Create a thread.

  With `project_id`, the thread gets its own worktree on branch `wb/<slug>`
  cut from `base_ref` (default: the project's default branch), and the
  project's setup commands run in it. Pass `isolate: false` to run in the
  repo itself instead.

  With `parent_id`, the thread is another session in the parent's worktree:
  same project, path and branch, no new worktree and no setup. Sessions
  nest one level; a child of a child hangs off the root. Every session
  inherits the root's initial context.

  With `start_ref` too, the thread's branch starts there rather than at
  `base_ref` (see `Workbench.PullRequests`).

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
          base_ref: root.base_ref,
          initial_context: root.initial_context
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
    slug = Worktrees.slug(attrs[:slug] || attrs[:title])

    with {:ok, wt} <- Worktrees.create(project, slug, blank_to_nil(attrs[:base_ref]), attrs[:start_ref]) do
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

  @doc "Start a turn. `images` are attached pictures, `%{\"data\" => base64, \"mime\", \"name\"}` (see Workbench.Uploads). `files` are any other attachments, `%{\"data\" => base64, \"name\"}`."
  def send_message(id, text, images \\ [], files \\ []) when is_binary(text) and is_list(images) and is_list(files),
    do: call(id, {:send, text, images, files})

  @doc "Send the first message once the project's setup is done (right away if there is none)."
  def send_when_ready(id, text) when is_binary(text), do: call(id, {:send_when_ready, text})
  def interrupt(id), do: call(id, :interrupt)
  def respond(id, request_id, decision, answers \\ nil), do: call(id, {:respond, request_id, decision, answers})
  def set_mode(id, mode), do: call(id, {:set_mode, mode})

  @doc "The provider's models (see Workbench.Models)."
  def models(id), do: call(id, :models)

  @doc """
  The provider's plan usage (see Workbench.Usage) as `{:ok, usage}`, from the
  cache. With `refresh?` and a stale cache, also asks a running agent
  (starting one if needed; no turn); the answer arrives on `Workbench.Usage`'s topic.
  """
  def usage(id, refresh?), do: call(id, {:usage, refresh?})

  @doc "Model and effort for the next responses; nil means the provider's default."
  def set_model(id, model, effort) when (is_binary(model) or is_nil(model)) and (is_binary(effort) or is_nil(effort)),
    do: call(id, {:set_model, model, effort})

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
