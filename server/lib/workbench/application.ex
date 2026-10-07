defmodule Workbench.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    Workbench.Home.ensure!()
    Workbench.LoginEnv.load()

    children = [
      Workbench.Repo,
      {Ecto.Migrator, repos: [Workbench.Repo], skip: !Application.get_env(:workbench, :migrate_on_boot, true)},
      {Phoenix.PubSub, name: Workbench.PubSub},
      {Task.Supervisor, name: Workbench.TaskSupervisor},
      Workbench.Models,
      Workbench.Usage,
      Workbench.Guide,
      {Registry, keys: :unique, name: Workbench.Threads.Registry},
      {DynamicSupervisor, name: Workbench.Threads.Supervisor, strategy: :one_for_one},
      {Registry, keys: :unique, name: Workbench.Terminals.Registry},
      {DynamicSupervisor, name: Workbench.Terminals.Supervisor, strategy: :one_for_one},
      {Registry, keys: :unique, name: Workbench.Watcher.Registry},
      {DynamicSupervisor, name: Workbench.Watcher.Supervisor, strategy: :one_for_one},
      WorkbenchWeb.Endpoint
    ]

    # off in tests, which call Workbench.Automations.due/1 themselves
    children = if Application.get_env(:workbench, :automations, true), do: children ++ [Workbench.Automations.Scheduler], else: children

    Supervisor.start_link(children, strategy: :one_for_one, name: Workbench.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    WorkbenchWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
