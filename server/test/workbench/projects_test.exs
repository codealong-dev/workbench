defmodule Workbench.ProjectsTest do
  use Workbench.ThreadCase
  alias Workbench.{Projects, Worktrees}

  setup %{dir: dir} do
    File.rm_rf!(Path.join(Workbench.Home.dir(), "worktrees"))
    {:ok, repo: git_repo(dir, %{setup: ["echo setting up in $WB_WORKTREE", "touch .setup-ran"], teardown: ["touch $WB_REPO/.teardown-ran"]})}
  end

  test "add: resolves the repo root, detects the default branch, is idempotent", %{repo: repo} do
    File.mkdir_p!(Path.join(repo, "sub"))
    assert {:ok, p} = Projects.add(Path.join(repo, "sub"))
    assert realpath(p.repo_path) == realpath(repo)
    assert p.default_branch == "main"
    assert p.name == "repo"
    assert {:ok, same} = Projects.add(repo)
    assert same.id == p.id
    assert {:error, _} = Projects.add("/definitely/not/here")
    assert {:error, "git rev-parse" <> _} = Projects.add(System.tmp_dir!())
  end

  test "thread gets its own worktree and branch; setup runs and streams", %{repo: repo} do
    {:ok, p} = Projects.add(repo)
    Threads.subscribe_lobby()
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", title: "Fix the flaky auth test!"})

    assert t.branch =~ ~r"^wb/fix-the-flaky-auth-test-[0-9a-f]{6}$"
    assert t.base_ref == "main"
    assert Worktrees.managed?(p, t.worktree_path)
    assert File.exists?(Path.join(t.worktree_path, "README.md"))
    assert git!(t.worktree_path, ["rev-parse", "--abbrev-ref", "HEAD"]) == t.branch

    Threads.subscribe(t.id)
    events = collect_until(&(&1["type"] == "status.changed" and &1["status"] == "idle"), 5_000)
    completed = for %{"type" => "tool.completed"} = e <- events, do: e
    assert [%{"output" => "setting up in " <> path, "is_error" => false}, %{"is_error" => false}] = completed
    assert String.trim(path) == t.worktree_path
    assert File.exists?(Path.join(t.worktree_path, ".setup-ran"))

    # setup items are part of the thread's history
    assert ["tool", "tool"] == Items.last(t.id) |> Enum.map(& &1["kind"])
  end

  test "failing setup reports an error and leaves the thread usable", %{dir: dir} do
    repo = git_repo(Path.join(dir, "x"), %{setup: ["echo boom >&2; exit 3", "echo never"]})
    {:ok, p} = Projects.add(repo)
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", title: "s"})
    Threads.subscribe(t.id)

    events = collect_until(&(&1["type"] == "status.changed" and &1["status"] == "idle"), 5_000)
    assert [%{"is_error" => true, "output" => "boom\n"}] = for(%{"type" => "tool.completed"} = e <- events, do: e)
    assert Enum.any?(events, &(&1["type"] == "error" and &1["message"] =~ "exit code 3"))

    assert :ok = Threads.send_message(t.id, "still works")
    collect_until(type?("turn.completed"))
  end

  test "isolate: false runs in the repo itself", %{repo: repo} do
    {:ok, p} = Projects.add(repo)
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", isolate: false})
    assert t.worktree_path == p.repo_path
    assert t.branch == "main"
    refute Worktrees.managed?(p, t.worktree_path)
  end

  test "bad base ref fails cleanly", %{repo: repo} do
    {:ok, p} = Projects.add(repo)
    assert {:error, "git worktree add" <> _} = Threads.create(%{project_id: p.id, provider: "fake", base_ref: "nope"})
  end

  test "archive: teardown, worktree removed, branch kept, hidden", %{repo: repo} do
    {:ok, p} = Projects.add(repo)
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", title: "arch"})
    Threads.subscribe(t.id)
    collect_until(&(&1["type"] == "status.changed" and &1["status"] == "idle"), 5_000)
    Threads.subscribe_lobby()

    ref = Process.monitor(Threads.whereis(t.id))
    assert :ok = Threads.archive(t.id)
    assert_receive {:thread_archived, id}, 5_000
    assert id == t.id
    assert_receive {:DOWN, ^ref, :process, _, :normal}

    assert File.exists?(Path.join(repo, ".teardown-ran"))
    refute File.exists?(t.worktree_path)
    assert git!(repo, ["branch", "--list", t.branch]) =~ t.branch
    refute Enum.any?(Threads.list(), &(&1.id == t.id))
    assert {:error, :not_found} = Threads.ensure_started(t.id)
  end

  test "archiving an in-repo thread never removes the repo", %{repo: repo} do
    {:ok, p} = Projects.add(repo)
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", isolate: false})
    Threads.subscribe_lobby()
    :ok = Threads.archive(t.id)
    assert_receive {:thread_archived, _}, 5_000
    assert File.exists?(Path.join(repo, "README.md"))
    refute File.exists?(Path.join(repo, ".teardown-ran"))
  end

  test "three threads run at once, each in its own worktree", %{repo: repo} do
    {:ok, p} = Projects.add(repo)

    threads =
      for i <- 1..3 do
        {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", title: "parallel #{i}"})
        Threads.subscribe(t.id)
        t
      end

    assert threads |> Enum.map(& &1.worktree_path) |> Enum.uniq() |> length() == 3
    # wait for all setups, then send to all three
    Process.sleep(1_000)
    for t <- threads, do: assert(:ok = Threads.send_message(t.id, "go #{t.id}"))

    running = for t <- threads, do: Threads.snapshot(t.id).status
    assert running == ~w(running running running)

    done =
      Enum.reduce_while(1..600, MapSet.new(), fn _, acc ->
        receive do
          {:event, %{"type" => "turn.completed", "thread_id" => id}} ->
            acc = MapSet.put(acc, id)
            if MapSet.size(acc) == 3, do: {:halt, acc}, else: {:cont, acc}

          _ ->
            {:cont, acc}
        after
          5_000 -> {:halt, acc}
        end
      end)

    assert MapSet.size(done) == 3
  end

  defp realpath(p), do: p |> then(&System.cmd("pwd", ["-P"], cd: &1)) |> elem(0) |> String.trim()
end
