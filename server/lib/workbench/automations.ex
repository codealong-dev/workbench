defmodule Workbench.Automations do
  @moduledoc """
  Agent runs on a schedule, like a nightly dependency audit.

  An automation is a project, an agent, a prompt and a cron schedule
  (`Workbench.Cron`, local time). When it is due, `Workbench.Automations.Scheduler`
  makes a thread for it, the way the new-thread dialog does: its own worktree
  on a `wb/<slug>` branch from the project's default branch, the project's
  setup, and permissions bypassed since nobody is there to approve anything.
  The prompt is sent as the first message once setup is done. You review the
  thread in the morning like any other.

  Workbench only fires while it is running. A run that came due while it
  wasn't still fires if it is less than `catch_up_ms` late (12 hours by
  default), so a nightly run on a laptop that slept through it happens when
  the laptop wakes; older ones are recorded as `missed`. Several missed
  occurrences make one run, never a burst.
  """
  import Ecto.Query
  require Logger

  alias Workbench.{Cron, Projects, Repo, Threads}
  alias Workbench.Automations.{Automation, Run}

  @runs_shown 5

  def list do
    automations = Repo.all(from a in Automation, order_by: [asc: fragment("lower(?)", a.name)])
    runs = recent_runs(Enum.map(automations, & &1.id))
    Enum.map(automations, &%{&1 | runs: Map.get(runs, &1.id, [])})
  end

  def get(id), do: Repo.get(Automation, id)

  defp with_runs(%Automation{} = a), do: %{a | runs: Map.get(recent_runs([a.id]), a.id, [])}

  defp recent_runs([]), do: %{}

  defp recent_runs(ids) do
    ranked =
      from r in Run,
        where: r.automation_id in ^ids,
        select: %{id: r.id, n: over(row_number(), partition_by: r.automation_id, order_by: [desc: r.inserted_at])}

    Repo.all(from r in Run, join: k in subquery(ranked), on: k.id == r.id, where: k.n <= @runs_shown, order_by: [desc: r.inserted_at])
    |> Enum.group_by(& &1.automation_id)
  end

  @doc "Create (no `id`) or update an automation, rescheduling it."
  def save(attrs) do
    {automation, attrs} =
      case Map.pop(attrs, "id") do
        {nil, attrs} -> {%Automation{}, attrs}
        {id, attrs} -> {get(id), attrs}
      end

    with %Automation{} <- automation || {:error, "automation not found"},
         cs = Automation.changeset(automation, attrs),
         :ok <- check_project(cs),
         {:ok, a} <- cs |> schedule(DateTime.utc_now()) |> Repo.insert_or_update() do
      broadcast(a)
    end
  end

  defp check_project(cs) do
    case Ecto.Changeset.get_field(cs, :project_id) do
      nil -> :ok
      id -> if Projects.get(id), do: :ok, else: {:error, "project not found"}
    end
  end

  # the next run, from now, whenever the schedule or the switch changes
  defp schedule(%Ecto.Changeset{valid?: true} = cs, now) do
    if Ecto.Changeset.changed?(cs, :schedule) or Ecto.Changeset.changed?(cs, :enabled) or is_nil(cs.data.id) do
      Ecto.Changeset.put_change(cs, :next_run_at, next_run(Ecto.Changeset.get_field(cs, :enabled), Ecto.Changeset.get_field(cs, :schedule), now))
    else
      cs
    end
  end

  defp schedule(cs, _now), do: cs

  defp next_run(false, _schedule, _now), do: nil

  defp next_run(true, schedule, now) do
    case Cron.parse(schedule) do
      {:ok, cron} -> Cron.next(cron, now)
      {:error, _} -> nil
    end
  end

  def delete(id) do
    case get(id) do
      nil ->
        {:error, "automation not found"}

      a ->
        Repo.delete!(a)
        Threads.broadcast_lobby({:automation_deleted, id})
        :ok
    end
  end

  @doc """
  The automations due at `now`: each is moved on to its next occurrence,
  then run if it isn't too late to, or recorded as missed. Returns what to
  run as `{automation, scheduled_for}`; the caller runs them (`run/2`), so
  one slow worktree doesn't hold up the others.
  """
  def due(now \\ DateTime.utc_now()) do
    late = DateTime.add(now, -catch_up_ms(), :millisecond)

    from(a in Automation, where: a.enabled and not is_nil(a.next_run_at) and a.next_run_at <= ^now)
    |> Repo.all()
    |> Enum.flat_map(fn a ->
      due_at = a.next_run_at
      # moved on before anything runs, so a crash or a slow run can't fire it twice
      a = a |> Ecto.Changeset.change(next_run_at: next_run(true, a.schedule, now)) |> Repo.update!()

      if DateTime.compare(due_at, late) == :lt do
        record(a, %{status: "missed", scheduled_for: due_at})
        []
      else
        [{a, due_at}]
      end
    end)
  end

  defp catch_up_ms, do: Application.get_env(:workbench, :automation_catch_up_ms, :timer.hours(12))

  @doc """
  Run an automation now: a thread with the prompt as its first message.
  `scheduled_for` is when it was due, or nil when started by hand.
  """
  def run(%Automation{} = a, scheduled_for \\ nil) do
    attrs = %{
      project_id: a.project_id,
      provider: a.provider,
      mode: "bypassPermissions",
      title: "#{a.name} · #{stamp(scheduled_for || DateTime.utc_now())}",
      slug: a.name,
      isolate: true,
      automation_id: a.id
    }

    result =
      with {:ok, thread} <- Threads.create(attrs),
           :ok <- Threads.send_when_ready(thread.id, a.prompt) do
        {:ok, thread}
      end

    run =
      case result do
        {:ok, thread} ->
          record(a, %{status: "started", thread_id: thread.id, scheduled_for: scheduled_for})

        {:error, reason} ->
          Logger.warning("automation #{a.name} failed: #{inspect(reason)}")
          record(a, %{status: "failed", error: describe(reason), scheduled_for: scheduled_for})
      end

    {:ok, run}
  end

  defp record(a, attrs) do
    run = Repo.insert!(struct(Run, Map.put(attrs, :automation_id, a.id)))
    a = a |> Ecto.Changeset.change(last_run_at: run.inserted_at) |> Repo.update!()
    broadcast(a)
    run
  end

  defp broadcast(a) do
    a = with_runs(a)
    Threads.broadcast_lobby({:automation_upserted, a})
    {:ok, a}
  end

  # local time, as the schedule is: "Oct 7 03:00"
  defp stamp(utc) do
    {{_, m, d}, {h, min, _}} = utc |> DateTime.to_naive() |> NaiveDateTime.to_erl() |> :calendar.universal_time_to_local_time()
    month = ~w(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec) |> Enum.at(m - 1)
    "#{month} #{d} #{pad(h)}:#{pad(min)}"
  end

  defp pad(n), do: n |> Integer.to_string() |> String.pad_leading(2, "0")

  defp describe(%Ecto.Changeset{} = cs), do: WorkbenchWeb.ChannelHelpers.errors(cs)
  defp describe(r) when is_binary(r), do: r
  defp describe(r), do: inspect(r)
end
