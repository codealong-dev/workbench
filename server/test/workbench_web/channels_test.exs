defmodule WorkbenchWeb.ChannelsTest do
  use Workbench.ThreadCase
  import Phoenix.ChannelTest

  @endpoint WorkbenchWeb.Endpoint

  test "socket requires the token" do
    assert :error = connect(WorkbenchWeb.UserSocket, %{"token" => "wrong"})
    assert :error = connect(WorkbenchWeb.UserSocket, %{})
    assert {:ok, _} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
  end

  test "lobby creates a thread; thread channel streams a turn", %{dir: dir} do
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    {:ok, %{threads: []}, lobby} = subscribe_and_join(socket, "lobby", %{})

    ref = push(lobby, "thread.create", %{"provider" => "fake", "cwd" => dir, "title" => "t"})
    assert_reply ref, :ok, %{thread: %{id: id, status: "idle"}}
    assert_push "thread.upserted", %{id: ^id}
    # once: PubSub topics must not double up with the channel's own topic
    refute_push "thread.upserted", %{id: ^id}, 100

    ref = push(lobby, "thread.create", %{"provider" => "fake", "cwd" => "/definitely/not/here"})
    assert_reply ref, :error, %{reason: "worktree_path is not a directory"}

    {:ok, snap, chan} = subscribe_and_join(socket, "thread:" <> id, %{})
    assert %{status: "idle", items: [], live: [], pending: []} = snap

    ref = push(chan, "send", %{"text" => "hi"})
    assert_reply ref, :ok
    assert_push "event", %{"type" => "item.completed", "item" => %{"kind" => "user_message"}}
    assert_push "event", %{batch: [%{"type" => "reasoning.delta"} | _]}, 2_000
    assert_push "event", %{"type" => "turn.completed"}, 3_000
    assert_push "thread.status", %{id: ^id, status: "idle"}

    ref = push(chan, "set_mode", %{"mode" => "nonsense"})
    assert_reply ref, :error, %{reason: "bad_mode"}
    ref = push(chan, "set_mode", %{"mode" => "plan"})
    assert_reply ref, :ok
    assert Threads.get(id).mode == "plan"
  end

  test "projects: add, branches, create a worktree thread, archive it", %{dir: dir} do
    repo = git_repo(dir)
    git!(repo, ["branch", "feature-x"])
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    {:ok, %{projects: []}, lobby} = subscribe_and_join(socket, "lobby", %{})

    ref = push(lobby, "project.add", %{"path" => repo})
    assert_reply ref, :ok, %{project: %{id: pid, name: "repo", default_branch: "main"}}
    assert_push "project.upserted", %{id: ^pid}

    ref = push(lobby, "project.add", %{"path" => "/nope"})
    assert_reply ref, :error, %{reason: _}

    ref = push(lobby, "project.branches", %{"project_id" => pid})
    assert_reply ref, :ok, %{branches: branches, default: "main"}
    assert Enum.sort(branches) == ["feature-x", "main"]

    ref = push(lobby, "thread.create", %{"project_id" => pid, "provider" => "fake", "title" => "From feature", "base_ref" => "feature-x"})
    assert_reply ref, :ok, %{thread: %{id: tid, branch: "wb/from-feature-" <> _, base_ref: "feature-x", project_id: ^pid}}

    ref = push(lobby, "thread.create", %{"parent_id" => tid, "provider" => "codex", "title" => "Codex"})
    assert_reply ref, :ok, %{thread: %{id: cid, parent_id: ^tid, branch: "wb/from-feature-" <> _, provider: "codex"}}

    ref = push(lobby, "thread.archive", %{"id" => cid})
    assert_reply ref, :ok
    assert_push "thread.archived", %{id: ^cid}, 5_000
    ref = push(lobby, "thread.create", %{"parent_id" => tid, "provider" => "fake"})
    assert_reply ref, :ok, %{thread: %{id: cid2}}

    {:ok, _snap, chan} = subscribe_and_join(socket, "thread:" <> tid, %{})
    ref = push(chan, "archive", %{})
    assert_reply ref, :ok
    assert_push "thread.archived", %{id: ^cid2}, 5_000
    assert_push "thread.archived", %{id: ^tid}, 5_000
  end

  test "thread channel: files and file", %{dir: dir} do
    File.write!(Path.join(dir, "x.md"), "# hi\n")
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    {:ok, _, lobby} = subscribe_and_join(socket, "lobby", %{})
    ref = push(lobby, "thread.create", %{"provider" => "fake", "cwd" => dir})
    assert_reply ref, :ok, %{thread: %{id: tid}}
    {:ok, _snap, chan} = subscribe_and_join(socket, "thread:" <> tid, %{})

    ref = push(chan, "files", %{})
    assert_reply ref, :ok, %{files: ["x.md"], truncated: false}
    ref = push(chan, "file", %{"path" => "x.md"})
    assert_reply ref, :ok, %{content: "# hi\n", binary: false}
    ref = push(chan, "file", %{"path" => "../x"})
    assert_reply ref, :error, %{reason: "path is outside the worktree"}
  end

  test "joining an unknown thread fails" do
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    assert {:error, %{reason: "not_found"}} = subscribe_and_join(socket, "thread:" <> Ecto.UUID.generate(), %{})
  end
end
