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

  test "joining an unknown thread fails" do
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    assert {:error, %{reason: "not_found"}} = subscribe_and_join(socket, "thread:" <> Ecto.UUID.generate(), %{})
  end
end
