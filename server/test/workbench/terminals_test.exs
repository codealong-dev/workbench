defmodule Workbench.TerminalsTest do
  use Workbench.ThreadCase
  import Phoenix.ChannelTest
  alias Workbench.Terminals

  @endpoint WorkbenchWeb.Endpoint

  defp output_until(id, pattern, acc \\ "", timeout \\ 5_000) do
    receive do
      {:term_output, ^id, data} ->
        acc = acc <> data
        if acc =~ pattern, do: acc, else: output_until(id, pattern, acc, timeout)
    after
      timeout -> flunk("no #{inspect(pattern)} in terminal output: #{inspect(acc)}")
    end
  end

  test "a shell on a PTY: runs commands in the worktree, resizes, keeps scrollback", %{dir: dir} do
    {:ok, t} = Terminals.create("owner-1", dir, cols: 100, rows: 30)
    assert %{title: _, n: 1, cols: 100, rows: 30} = t
    {:ok, %{buffer: _}} = Terminals.attach(t.id)

    Terminals.input(t.id, "echo wb-$((40+2)) && pwd && tty && stty size\n")
    out = output_until(t.id, "30 100")
    assert out =~ "wb-42"
    assert out =~ Path.basename(dir)
    assert out =~ ~r"/dev/(pts|ttys)"
    assert out =~ "30 100"

    Terminals.resize(t.id, 120, 40)
    Terminals.input(t.id, "stty size\n")
    assert output_until(t.id, "40 120") =~ "40 120"

    # a later attach replays what happened
    {:ok, %{buffer: buffer}} = Terminals.attach(t.id)
    assert buffer =~ "wb-42"
  end

  test "list per owner, numbered; close and exit remove them", %{dir: dir} do
    Phoenix.PubSub.subscribe(Workbench.PubSub, Terminals.owner_topic("owner-2"))
    {:ok, a} = Terminals.create("owner-2", dir)
    {:ok, b} = Terminals.create("owner-2", dir)
    {:ok, _} = Terminals.create("someone-else", dir)
    assert_receive {:terminals_changed, "owner-2"}
    assert [%{id: a_id, n: 1}, %{id: b_id, n: 2}] = Terminals.list("owner-2")
    assert {a_id, b_id} == {a.id, b.id}

    :ok = Terminals.close(a.id)
    assert [%{id: ^b_id}] = Terminals.list("owner-2")

    {:ok, _} = Terminals.attach(b.id)
    Terminals.input(b.id, "exit 3\n")
    assert_receive {:term_exit, ^b_id, 3}, 5_000
    Process.sleep(50)
    assert Terminals.list("owner-2") == []

    Terminals.close_all("someone-else")
    assert Terminals.list("someone-else") == []
  end

  test "archiving a thread closes its terminals; channels stream them", %{dir: dir} do
    File.write!(Path.join(dir, "marker.txt"), "")
    {:ok, socket} = connect(WorkbenchWeb.UserSocket, %{"token" => "test-token"})
    {:ok, _, lobby} = subscribe_and_join(socket, "lobby", %{})
    ref = push(lobby, "thread.create", %{"provider" => "fake", "cwd" => dir})
    assert_reply ref, :ok, %{thread: %{id: tid}}
    {:ok, _snap, chan} = subscribe_and_join(socket, "thread:" <> tid, %{})

    ref = push(chan, "terminal.create", %{"cols" => 90, "rows" => 20})
    assert_reply ref, :ok, %{id: term_id, owner_id: ^tid, cols: 90}
    assert_push "terminals", %{terminals: [%{id: ^term_id}]}

    {:ok, %{buffer: _}, term} = subscribe_and_join(socket, "terminal:" <> term_id, %{})
    push(term, "input", %{"data" => "ls\n"})
    assert_push "output", %{data: _}, 5_000

    ref = push(chan, "terminal.close", %{"id" => term_id})
    assert_reply ref, :ok
    assert_push "terminals", %{terminals: []}

    ref = push(chan, "terminal.create", %{})
    assert_reply ref, :ok, %{id: term2}
    :ok = Threads.archive(tid)
    Process.sleep(300)
    assert Terminals.list(tid) == []
    assert {:error, :not_found} = Terminals.attach(term2)
  end
end
