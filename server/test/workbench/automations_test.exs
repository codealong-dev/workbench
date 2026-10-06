defmodule Workbench.AutomationsTest do
  use Workbench.ThreadCase
  alias Workbench.{Automations, Projects, Repo}
  alias Workbench.Automations.Automation

  setup %{dir: dir} do
    {:ok, p} = Projects.add(git_repo(dir, %{setup: ["sleep 0.2", "touch .setup-ran"]}))
    {:ok, p: p}
  end

  defp attrs(p, more \\ %{}) do
    Map.merge(%{"project_id" => p.id, "name" => " Nightly audit ", "provider" => "fake", "prompt" => "Audit the deps.", "schedule" => "0  3 * * *"}, more)
  end

  test "save: creates, validates and schedules the next run", %{p: p} do
    Threads.subscribe_lobby()
    assert {:ok, a} = Automations.save(attrs(p))
    assert a.name == "Nightly audit"
    assert a.schedule == "0 3 * * *"
    assert a.enabled
    assert DateTime.compare(a.next_run_at, DateTime.utc_now()) == :gt
    assert_receive {:automation_upserted, %Automation{id: id}}
    assert id == a.id

    assert {:error, cs} = Automations.save(attrs(p, %{"schedule" => "every night"}))
    assert %{schedule: ["needs five fields" <> _]} = errors_on(cs)
    assert {:error, cs} = Automations.save(attrs(p, %{"provider" => "nope", "prompt" => ""}))
    assert %{provider: _, prompt: _} = errors_on(cs)
    assert {:error, "project not found"} = Automations.save(attrs(p, %{"project_id" => Ecto.UUID.generate()}))

    # turning it off clears the next run; back on schedules one
    assert {:ok, off} = Automations.save(%{"id" => a.id, "enabled" => false})
    assert off.next_run_at == nil
    assert {:ok, on} = Automations.save(%{"id" => a.id, "enabled" => true})
    assert on.next_run_at
    assert [%Automation{id: ^id}] = Automations.list()

    assert :ok = Automations.delete(a.id)
    assert_receive {:automation_deleted, ^id}
    assert Automations.list() == []
  end

  test "run: a bypass thread in its own worktree, prompt sent after setup", %{p: p} do
    {:ok, a} = Automations.save(attrs(p))
    assert {:ok, run} = Automations.run(a)
    assert run.status == "started"
    assert run.scheduled_for == nil

    t = Threads.get(run.thread_id)
    assert t.automation_id == a.id
    assert t.mode == "bypassPermissions"
    assert t.title =~ ~r/^Nightly audit · \w{3} \d{1,2} \d\d:\d\d$/
    assert t.branch =~ ~r"^wb/nightly-audit-[0-9a-f]{6}$"

    # the prompt waits for setup, then goes
    wait_until(fn -> Enum.any?(Items.last(t.id), &(&1["kind"] == "user_message")) end)
    assert File.exists?(Path.join(t.worktree_path, ".setup-ran"))
    assert [%{"kind" => "user_message", "text" => "Audit the deps."}] = Enum.filter(Items.last(t.id), &(&1["kind"] == "user_message"))

    assert [%Automation{runs: [%{id: run_id}], last_run_at: %DateTime{}}] = Automations.list()
    assert run_id == run.id
  end

  test "run: a failure is recorded, not raised", %{p: p} do
    {:ok, a} = Automations.save(attrs(p))
    File.rm_rf!(p.repo_path)
    assert {:ok, %{status: "failed", error: error, thread_id: nil}} = Automations.run(a)
    assert is_binary(error) and error != ""
    assert [%{status: "failed"}] = runs(a)
  end

  test "due: moves each on, runs recent ones once, records old ones as missed", %{p: p} do
    now = DateTime.utc_now()
    {:ok, recent} = Automations.save(attrs(p, %{"name" => "recent"}))
    {:ok, stale} = Automations.save(attrs(p, %{"name" => "stale"}))
    {:ok, later} = Automations.save(attrs(p, %{"name" => "later"}))
    {:ok, off} = Automations.save(attrs(p, %{"name" => "off", "enabled" => false}))
    set_next(recent, DateTime.add(now, -2, :hour))
    set_next(stale, DateTime.add(now, -13, :hour))

    assert [{%Automation{id: id}, due_at}] = Automations.due(now)
    assert id == recent.id
    assert DateTime.compare(due_at, DateTime.add(now, -2, :hour)) == :eq

    # both moved past now, so the next tick finds nothing
    for a <- [recent, stale], do: assert(DateTime.compare(Automations.get(a.id).next_run_at, now) == :gt)
    assert Automations.due(now) == []

    assert [%{status: "missed", scheduled_for: %DateTime{}}] = runs(stale)
    assert runs(recent) == []
    assert Automations.get(later.id).next_run_at == later.next_run_at
    assert Automations.get(off.id).next_run_at == nil
  end

  defp set_next(a, at), do: a |> Ecto.Changeset.change(next_run_at: at) |> Repo.update!()
  defp runs(a), do: Enum.find(Automations.list(), &(&1.id == a.id)).runs

  defp errors_on(cs), do: Ecto.Changeset.traverse_errors(cs, fn {msg, _} -> msg end)

  defp wait_until(fun, tries \\ 100) do
    cond do
      fun.() -> :ok
      tries == 0 -> flunk("condition not met in time")
      true -> Process.sleep(50) && wait_until(fun, tries - 1)
    end
  end
end
