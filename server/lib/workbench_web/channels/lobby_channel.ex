defmodule WorkbenchWeb.LobbyChannel do
  @moduledoc """
  Projects and the thread list.

    * join -> `{projects, threads}`
    * `project.add` `{path}` -> `{project}`
    * `project.branches` `{project_id}` -> `{branches, default}`
    * `thread.create` `{project_id, provider, title?, base_ref?, mode?, isolate?}` -> `{thread}`
      (or `{cwd, ...}` without a project, as in M1; or `{parent_id, provider, ...}`
      for another session in an existing thread's worktree)
    * `thread.archive` `{id}` -> ok (same as the thread channel's `archive`)
    * `settings.put` `{key, value}` -> `{settings}` (see Workbench.Settings)
    * `models.list` `{provider, refresh?}` -> `{models}`; may start the agent
      just to ask, so the reply can take a few seconds
    * pushes: `project.upserted`, `thread.upserted`, `thread.status`,
      `thread.messages` `{id, count}`, `thread.archived`, `settings.updated`
  """
  use Phoenix.Channel

  alias Workbench.{Models, Projects, Settings, Threads}
  alias Workbench.Projects.Project
  alias Workbench.Threads.Thread
  alias WorkbenchWeb.ChannelHelpers, as: H

  @impl true
  def join("lobby", _params, socket) do
    Threads.subscribe_lobby()

    {:ok,
     %{
       host: Workbench.Host.info(),
       projects: Enum.map(Projects.list(), &Project.to_json/1),
       threads: Enum.map(Threads.list(), &Thread.to_json/1),
       settings: Settings.all(),
       models: Models.cached(Settings.providers())
     }, socket}
  end

  @impl true
  def handle_in("project.add", %{"path" => path}, socket) when is_binary(path) and path != "" do
    case Projects.add(path) do
      {:ok, project} ->
        Threads.broadcast_lobby({:project_upserted, project})
        {:reply, {:ok, %{project: Project.to_json(project)}}, socket}

      {:error, %Ecto.Changeset{} = cs} ->
        {:reply, {:error, %{reason: H.errors(cs)}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  def handle_in("project.branches", %{"project_id" => id}, socket) do
    case Projects.get(id) do
      nil -> {:reply, {:error, %{reason: "project not found"}}, socket}
      p -> {:reply, {:ok, %{branches: Projects.branches(p), default: p.default_branch}}, socket}
    end
  end

  def handle_in("thread.create", params, socket) do
    attrs =
      %{
        provider: params["provider"] || "claude",
        title: blank(params["title"]),
        mode: params["mode"] || "default",
        model: blank(params["model"])
      }
      |> then(fn a ->
        case {blank(params["parent_id"]), blank(params["project_id"])} do
          {parent_id, _} when is_binary(parent_id) ->
            Map.put(a, :parent_id, parent_id)

          {nil, nil} ->
            Map.put(a, :worktree_path, params["cwd"] && Path.expand(params["cwd"]))

          {nil, project_id} ->
            Map.merge(a, %{
              project_id: project_id,
              base_ref: blank(params["base_ref"]),
              isolate: params["isolate"] != false
            })
        end
      end)

    case Threads.create(attrs) do
      {:ok, thread} -> {:reply, {:ok, %{thread: Thread.to_json(thread)}}, socket}
      {:error, %Ecto.Changeset{} = cs} -> {:reply, {:error, %{reason: H.errors(cs)}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  def handle_in("thread.archive", %{"id" => id}, socket) when is_binary(id) do
    case Threads.archive(id) do
      :ok -> {:reply, :ok, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  def handle_in("settings.put", %{"key" => key, "value" => value}, socket) when is_binary(key) do
    case Settings.put(key, value) do
      {:ok, settings} -> {:reply, {:ok, %{settings: settings}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  # answered from a task: a probe must not hold up the lobby
  def handle_in("models.list", %{"provider" => provider} = params, socket) do
    if provider in Settings.providers() do
      ref = socket_ref(socket)

      Task.Supervisor.start_child(Workbench.TaskSupervisor, fn ->
        case Models.list(provider, params["refresh"] == true) do
          {:ok, models} -> reply(ref, {:ok, %{models: models}})
          {:error, reason} -> reply(ref, {:error, %{reason: reason}})
        end
      end)

      {:noreply, socket}
    else
      {:reply, {:error, %{reason: "unknown agent #{inspect(provider)}"}}, socket}
    end
  end

  def handle_in(event, _params, socket) do
    {:reply, {:error, %{reason: "unknown or malformed message: #{event}"}}, socket}
  end

  @impl true
  def handle_info({:thread_upserted, thread}, socket) do
    push(socket, "thread.upserted", Thread.to_json(thread))
    {:noreply, socket}
  end

  def handle_info({:thread_status, id, status}, socket) do
    push(socket, "thread.status", %{id: id, status: status})
    {:noreply, socket}
  end

  def handle_info({:thread_messages, id, count}, socket) do
    push(socket, "thread.messages", %{id: id, count: count})
    {:noreply, socket}
  end

  def handle_info({:thread_archived, id}, socket) do
    push(socket, "thread.archived", %{id: id})
    {:noreply, socket}
  end

  def handle_info({:settings, settings}, socket) do
    push(socket, "settings.updated", settings)
    {:noreply, socket}
  end

  def handle_info({:project_upserted, project}, socket) do
    push(socket, "project.upserted", Project.to_json(project))
    {:noreply, socket}
  end

  defp blank(v) when v in [nil, ""], do: nil
  defp blank(v), do: v
end
