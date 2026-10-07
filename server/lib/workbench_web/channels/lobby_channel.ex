defmodule WorkbenchWeb.LobbyChannel do
  @moduledoc """
  Projects and the thread list.

    * join -> `{projects, threads}`
    * `project.add` `{path}` -> `{project}`
    * `project.branches` `{project_id}` -> `{branches, default}`
    * `thread.create` `{project_id, provider, title?, initial_context?, base_ref?, mode?, model?, effort?, isolate?, prompt?}` -> `{thread}`
      (or `{cwd, ...}` without a project, as in M1; or `{parent_id, provider, ...}`
      for another session in an existing thread's worktree). With `prompt`, it
      is sent as the first message; if that fails the reply carries `send_error`.
    * `thread.archive` `{id}` -> ok (same as the thread channel's `archive`)
    * `settings.put` `{key, value}` -> `{settings}` (see Workbench.Settings)
    * `models.list` `{provider, refresh?}` -> `{models}`; may start the agent
      just to ask, so the reply can take a few seconds
    * `usage.list` `{provider, refresh?}` -> `{usage, fetched_at}`; account limits,
      queried without a turn, and pushed as `usage` `{provider, usage, fetched_at}`
    * `prs.list` `{state?, project_id?, author?, review?}` -> `{prs, errors}`; asks
      GitHub through `gh`, so it can take a few seconds (see Workbench.PullRequests)
    * `pr.review` `{project_id, number, provider?}` -> `{thread}`: the workspace
      reviewing that pull request, checked out the first time
    * `automation.save` `{id?, project_id, name, provider, prompt, schedule, enabled}`
      -> `{automation}`: creates one without `id` (see Workbench.Automations)
    * `automation.delete` `{id}` -> ok; its threads stay
    * `automation.run` `{id}` -> `{run}`: runs it now, as if it were due
    * pushes: `project.upserted`, `thread.upserted`, `thread.status`,
      `thread.messages` `{id, count}`, `thread.activity` `{id, activity}`, `thread.archived`, `settings.updated`,
      `automation.upserted`, `automation.deleted` `{id}`
  """
  use Phoenix.Channel

  alias Workbench.{Automations, Models, Projects, PullRequests, Settings, Threads, Usage}
  alias Workbench.Automations.{Automation, Run}
  alias Workbench.Projects.Project
  alias Workbench.Threads.Thread
  alias WorkbenchWeb.ChannelHelpers, as: H

  @impl true
  def join("lobby", _params, socket) do
    Threads.subscribe_lobby()
    Usage.subscribe()

    {:ok,
     %{
       host: Workbench.Host.info(),
       projects: Enum.map(Projects.list(), &Project.to_json/1),
       threads: Enum.map(Threads.list(), &Thread.to_json/1),
       settings: Settings.all(),
       models: Models.cached(Settings.providers()),
       usage: Usage.cached(Settings.providers()),
       automations: Enum.map(Automations.list(), &Automation.to_json/1)
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
        initial_context: blank(params["initial_context"]),
        mode: params["mode"] || "bypassPermissions",
        model: blank(params["model"]),
        effort: blank(params["effort"])
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
      {:ok, thread} ->
        reply = %{thread: Thread.to_json(thread)}

        reply =
          with prompt when is_binary(prompt) <- blank(params["prompt"]),
               {:error, reason} <- Threads.send_when_ready(thread.id, prompt) do
            Map.put(reply, :send_error, H.reason(reason))
          else
            _ -> reply
          end

        {:reply, {:ok, reply}, socket}

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

  def handle_in("usage.list", %{"provider" => provider} = params, socket) do
    if provider in Settings.providers() do
      ref = socket_ref(socket)

      Task.Supervisor.start_child(Workbench.TaskSupervisor, fn ->
        case Usage.list(provider, params["refresh"] == true) do
          {:ok, usage} ->
            {_cached, at} = Usage.get(provider)
            reply(ref, {:ok, %{usage: usage, fetched_at: at}})

          {:error, reason} ->
            reply(ref, {:error, %{reason: reason}})
        end
      end)

      {:noreply, socket}
    else
      {:reply, {:error, %{reason: "unknown agent #{inspect(provider)}"}}, socket}
    end
  end

  # both answered from a task: gh and git fetch talk to GitHub
  def handle_in("prs.list", params, socket) do
    ref = socket_ref(socket)
    filters = Map.take(params, ~w(state project_id author review))
    Task.Supervisor.start_child(Workbench.TaskSupervisor, fn -> reply(ref, {:ok, PullRequests.list(filters)}) end)
    {:noreply, socket}
  end

  def handle_in("pr.review", %{"project_id" => project_id, "number" => number} = params, socket) when is_binary(project_id) and is_integer(number) do
    ref = socket_ref(socket)
    provider = if params["provider"] in Thread.providers(), do: params["provider"], else: "claude"

    Task.Supervisor.start_child(Workbench.TaskSupervisor, fn ->
      case PullRequests.review(project_id, number, provider) do
        {:ok, thread} -> reply(ref, {:ok, %{thread: Thread.to_json(thread)}})
        {:error, %Ecto.Changeset{} = cs} -> reply(ref, {:error, %{reason: H.errors(cs)}})
        {:error, reason} -> reply(ref, {:error, %{reason: H.reason(reason)}})
      end
    end)

    {:noreply, socket}
  end

  def handle_in("automation.save", params, socket) when is_map(params) do
    attrs = Map.take(params, ~w(id project_id name provider prompt schedule enabled))

    case Automations.save(attrs) do
      {:ok, a} -> {:reply, {:ok, %{automation: Automation.to_json(a)}}, socket}
      {:error, %Ecto.Changeset{} = cs} -> {:reply, {:error, %{reason: H.errors(cs)}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  def handle_in("automation.delete", %{"id" => id}, socket) when is_binary(id) do
    case Automations.delete(id) do
      :ok -> {:reply, :ok, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  # from a task: making the worktree and running setup takes a while
  def handle_in("automation.run", %{"id" => id}, socket) when is_binary(id) do
    case Automations.get(id) do
      nil ->
        {:reply, {:error, %{reason: "automation not found"}}, socket}

      a ->
        ref = socket_ref(socket)
        Task.Supervisor.start_child(Workbench.TaskSupervisor, fn ->
          {:ok, run} = Automations.run(a)
          reply(ref, {:ok, %{run: Run.to_json(run)}})
        end)

        {:noreply, socket}
    end
  end

  def handle_in(event, _params, socket) do
    {:reply, {:error, %{reason: "unknown or malformed message: #{event}"}}, socket}
  end

  @impl true
  def handle_info({:usage, provider, usage}, socket) do
    {_cached, at} = Usage.get(provider)
    push(socket, "usage", %{provider: provider, usage: usage, fetched_at: at})
    {:noreply, socket}
  end

  def handle_info({:thread_upserted, thread}, socket) do
    push(socket, "thread.upserted", Thread.to_json(thread))
    {:noreply, socket}
  end

  def handle_info({:thread_status, id, status}, socket) do
    push(socket, "thread.status", %{id: id, status: status})
    {:noreply, socket}
  end

  def handle_info({:thread_activity, id, text}, socket) do
    push(socket, "thread.activity", %{id: id, activity: text})
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

  def handle_info({:automation_upserted, a}, socket) do
    push(socket, "automation.upserted", Automation.to_json(a))
    {:noreply, socket}
  end

  def handle_info({:automation_deleted, id}, socket) do
    push(socket, "automation.deleted", %{id: id})
    {:noreply, socket}
  end

  def handle_info({:project_upserted, project}, socket) do
    push(socket, "project.upserted", Project.to_json(project))
    {:noreply, socket}
  end

  defp blank(v) when v in [nil, ""], do: nil
  defp blank(v), do: v
end
