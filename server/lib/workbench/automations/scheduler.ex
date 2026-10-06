defmodule Workbench.Automations.Scheduler do
  @moduledoc """
  Checks for due automations every `@tick_ms` and runs each in its own task
  (see `Workbench.Automations.due/1`). A timer per automation would be lost
  over a sleep; a short tick picks things up soon after waking.
  """
  use GenServer
  require Logger

  alias Workbench.Automations

  @tick_ms :timer.seconds(30)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    # first look once the rest of the app is up
    Process.send_after(self(), :tick, :timer.seconds(5))
    {:ok, nil}
  end

  @impl true
  def handle_info(:tick, st) do
    try do
      for {a, due_at} <- Automations.due() do
        Task.Supervisor.start_child(Workbench.TaskSupervisor, fn -> Automations.run(a, due_at) end)
      end
    rescue
      e -> Logger.error("automations: #{Exception.message(e)}")
    end

    Process.send_after(self(), :tick, @tick_ms)
    {:noreply, st}
  end
end
