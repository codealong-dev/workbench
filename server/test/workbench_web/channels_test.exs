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

  # 1x1 PNG
  @png "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

  test "images: attached, stored, served, and echoed back by the agent", %{dir: dir} do
    home = Application.get_env(:workbench, :home)
    Application.put_env(:workbench, :home, Path.join(dir, "home"))
    on_exit(fn -> Application.put_env(:workbench, :home, home) end)

    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    %{id: id} = create_thread(dir)
    {:ok, _snap, chan} = subscribe_and_join(socket, "thread:" <> id, %{})

    ref = push(chan, "send", %{"text" => "", "images" => []})
    assert_reply ref, :error, %{reason: "empty message"}

    ref = push(chan, "send", %{"text" => "", "images" => [%{"data" => @png, "mime" => "image/svg+xml", "name" => "x.svg"}]})
    assert_reply ref, :error, %{reason: "could not attach x.svg: unsupported image"}

    # a client can't make the server copy a file from disk
    ref = push(chan, "send", %{"text" => "", "images" => [%{"path" => "/etc/hosts.png", "mime" => "image/png"}]})
    assert_reply ref, :error, %{reason: "could not attach an image: bad image"}

    ref = push(chan, "send", %{"text" => "look", "images" => [%{"data" => @png, "mime" => "image/png", "name" => "dot.png"}]})
    assert_reply ref, :ok

    assert_push "event", %{"type" => "item.completed", "item" => %{"kind" => "user_message", "images" => [%{"name" => "dot.png", "url" => url}]}}
    assert url =~ ~r"^/api/uploads/#{id}/[0-9a-f]{32}\.png$"

    # the fake "reads" what you attached; only refs go out, never the bytes
    assert_push "event", %{"type" => "tool.completed", "images" => [%{"url" => echoed} = ref_]}, 2_000
    refute Map.has_key?(ref_, "data")
    assert echoed != url
    assert_push "event", %{"type" => "turn.completed"}, 3_000

    assert [%{"images" => [_]}] = Enum.filter(Items.last(id), &(&1["kind"] == "user_message"))
    assert [%{"images" => [_]}] = Enum.filter(Items.last(id), &(&1["kind"] == "tool" and &1["name"] == "Read"))

    router = WorkbenchWeb.Router.init([])
    get = fn path, ip -> WorkbenchWeb.Router.call(%{Plug.Test.conn(:get, path) | remote_ip: ip}, router) end

    conn = get.(url, {127, 0, 0, 1})
    assert conn.status == 200
    assert conn.resp_body == Base.decode64!(@png)
    assert ["image/png"] = Plug.Conn.get_resp_header(conn, "content-type")

    assert get.(url, {100, 64, 1, 2}).status == 401
    assert get.("/api/uploads/#{id}/..%2F..%2Ftoken", {127, 0, 0, 1}).status == 404
    assert get.("/api/uploads/#{id}/#{String.duplicate("0", 32)}.png", {127, 0, 0, 1}).status == 404

    [{pid, _}] = Registry.lookup(Workbench.Threads.Registry, id)
    mon = Process.monitor(pid)
    :ok = Threads.archive(id)
    assert_receive {:DOWN, ^mon, _, _, _}, 2_000
    refute File.exists?(Workbench.Uploads.dir(id))
  end

  test "usage: cached answer on ask, refresh starts the agent and is pushed to the channel", %{dir: dir} do
    :persistent_term.erase({Workbench.Usage, "fake"})
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    %{id: id} = create_thread(dir)
    {:ok, _snap, chan} = subscribe_and_join(socket, "thread:" <> id, %{})

    ref = push(chan, "usage", %{})
    assert_reply ref, :ok, %{usage: nil}
    refute_push "usage", _, 100

    ref = push(chan, "usage", %{"refresh" => true})
    assert_reply ref, :ok, %{usage: nil}
    assert_push "usage", %{usage: %{"plan" => "max", "windows" => [%{"id" => "five_hour", "used_pct" => 42.0} | _]}}, 2_000

    ref = push(chan, "usage", %{"refresh" => true})
    assert_reply ref, :ok, %{usage: %{"plan" => "max"}}
    refute_push "usage", _, 100
    :persistent_term.erase({Workbench.Usage, "fake"})
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

    # save from the editor; a stale base is a conflict carrying what's on disk
    ref = push(chan, "file", %{"path" => "x.md"})
    assert_reply ref, :ok, %{hash: h1}
    # the test watcher polls mtimes, which have 1s resolution
    Process.sleep(1_100)
    ref = push(chan, "file.write", %{"path" => "x.md", "content" => "# edited\n", "base_hash" => h1})
    assert_reply ref, :ok, %{hash: _}
    assert_push "files.changed", %{paths: ["x.md"]}, 3_000
    ref = push(chan, "file.write", %{"path" => "x.md", "content" => "# again\n", "base_hash" => h1})
    assert_reply ref, :error, %{reason: "conflict", content: "# edited\n"}
  end

  test "workspace layout: saved on the root thread, shared by its sessions", %{dir: dir} do
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    {:ok, _, lobby} = subscribe_and_join(socket, "lobby", %{})
    ref = push(lobby, "thread.create", %{"provider" => "fake", "cwd" => dir})
    assert_reply ref, :ok, %{thread: %{id: root}}
    {:ok, child} = Threads.create(%{parent_id: root, provider: "fake"})

    {:ok, _, chan} = subscribe_and_join(socket, "thread:" <> root, %{})
    ref = push(chan, "layout.get", %{})
    assert_reply ref, :ok, %{layout: nil}
    ref = push(chan, "layout.put", %{"layout" => %{"grid" => %{"root" => 1}, "panels" => %{}}})
    assert_reply ref, :ok
    ref = push(chan, "layout.put", %{"layout" => "nope"})
    assert_reply ref, :error, %{reason: _}

    {:ok, _, chan2} = subscribe_and_join(socket, "thread:" <> child.id, %{})
    ref = push(chan2, "layout.get", %{})
    assert_reply ref, :ok, %{layout: %{"grid" => %{"root" => 1}}}
  end

  test "lobby: settings and model lists without a thread" do
    Workbench.Models.forget("fake")
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    {:ok, %{settings: %{"labs" => %{"fake" => %{"enabled" => true}}}, models: models}, lobby} = subscribe_and_join(socket, "lobby", %{})
    refute Map.has_key?(models, "fake")

    ref = push(lobby, "settings.put", %{"key" => "labs", "value" => %{"fake" => %{"models" => ["fake-fast"]}}})
    assert_reply ref, :ok, %{settings: %{"labs" => %{"fake" => %{"models" => ["fake-fast"]}}}}
    assert_push "settings.updated", %{"labs" => %{"fake" => %{"models" => ["fake-fast"]}}}
    ref = push(lobby, "settings.put", %{"key" => "labs", "value" => %{"fake" => %{"models" => ~w(a b c d)}}})
    assert_reply ref, :error, %{reason: "fake: at most 3 models"}

    # no thread: the agent is started just to ask, then the answer is cached
    ref = push(lobby, "models.list", %{"provider" => "fake"})
    assert_reply ref, :ok, %{models: [%{"id" => "fake-smart"}, %{"id" => "fake-fast"}]}, 3_000
    assert [_, _] = Workbench.Models.get("fake")
    ref = push(lobby, "models.list", %{"provider" => "nope"})
    assert_reply ref, :error, %{reason: _}
    Workbench.Models.forget("fake")
  end

  test "lobby: a new session can start with its model, effort and first message", %{dir: dir} do
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    {:ok, _, lobby} = subscribe_and_join(socket, "lobby", %{})

    ref = push(lobby, "thread.create", %{"provider" => "fake", "cwd" => dir, "title" => "Review", "model" => "fake-fast", "effort" => "low", "mode" => "plan", "prompt" => "Review this."})
    assert_reply ref, :ok, %{thread: %{id: id, model: "fake-fast", effort: "low", mode: "plan"}} = reply
    refute Map.has_key?(reply, :send_error)

    assert %{items: [%{"kind" => "user_message", "text" => "Review this."} | _]} = Threads.snapshot(id)
  end

  test "joining an unknown thread fails" do
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    assert {:error, %{reason: "not_found"}} = subscribe_and_join(socket, "thread:" <> Ecto.UUID.generate(), %{})
  end

  test "commit flow over the thread channel: status, suggested title, commit, push", %{dir: dir} do
    repo = git_repo(dir)
    File.write!(Path.join(repo, "a.txt"), "one\n")
    git!(repo, ["add", "-A"])
    git!(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"])
    bare = Path.join(dir, "origin.git")
    {_, 0} = System.cmd("git", ["init", "-q", "--bare", bare])
    git!(repo, ["remote", "add", "origin", bare])
    {:ok, p} = Workbench.Projects.add(repo)
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", title: "c"})
    git!(t.worktree_path, ["config", "user.name", "t"])
    git!(t.worktree_path, ["config", "user.email", "t@t"])
    File.write!(Path.join(t.worktree_path, "b.txt"), "b\n")

    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    {:ok, _, chan} = subscribe_and_join(socket, "thread:" <> t.id, %{})

    ref = push(chan, "commit.status", %{})
    assert_reply ref, :ok, %{status: %{uncommitted: [%{path: "b.txt", status: "untracked"}], unpushed: 2}, graph: %{commits: [_ | _]}}, 5_000

    ref = push(chan, "commit.suggest", %{})
    assert_reply ref, :ok, %{title: "Update b.txt"}, 5_000

    ref = push(chan, "commit", %{"title" => " "})
    assert_reply ref, :error, %{reason: "write a commit title"}

    ref = push(chan, "commit", %{"title" => "Add b"})
    assert_reply ref, :ok, %{sha: sha, title: "Add b"}, 5_000

    ref = push(chan, "push", %{})
    assert_reply ref, :ok, %{branch: branch}, 5_000
    assert git!(bare, ["rev-parse", branch]) == sha

    ref = push(chan, "commit.status", %{})
    assert_reply ref, :ok, %{status: %{uncommitted: [], unpushed: 0}, graph: %{commits: [%{subject: "Add b", unpushed: false} | _]}}, 5_000
  end
end
