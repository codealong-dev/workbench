defmodule Workbench.ClaudeProviderTest do
  use Workbench.ThreadCase

  setup do
    old = Application.get_env(:workbench, :sidecar_path)
    Application.put_env(:workbench, :sidecar_path, Path.expand("../support/stubs/sidecar_stub.js", __DIR__))
    on_exit(fn -> Application.put_env(:workbench, :sidecar_path, old) end)
  end

  test "runs the sidecar in the thread's cwd and reassembles split lines", %{dir: dir} do
    t = create_thread(dir, %{provider: "claude"})
    Threads.subscribe(t.id)

    :ok = Threads.send_message(t.id, "hi")
    events = collect_until(type?("turn.completed"))

    assert [%{"cwd" => cwd}] = Enum.filter(events, &(&1["type"] == "session.started"))
    # macOS: /var is a symlink to /private/var
    assert realpath(cwd) == realpath(dir)
    assert "HelLo" != for(%{"type" => "text.delta", "text" => x} <- events, into: "", do: x)
    assert "Hello" == for(%{"type" => "text.delta", "text" => x} <- events, into: "", do: x)
    refute Enum.any?(events, &(&1["type"] == "error"))
  end

  test "agent exit mid-turn surfaces stderr as a fatal error", %{dir: dir} do
    t = create_thread(dir, %{provider: "claude"})
    Threads.subscribe(t.id)

    :ok = Threads.send_message(t.id, "crash")
    events = collect_until(&(&1["type"] == "error"))
    assert List.last(events)["message"] =~ "stub: boom"
    assert List.last(events)["fatal"]
  end

  test "shared context reaches new and resumed agents without becoming a user message", %{
    dir: dir
  } do
    root = create_thread(dir, %{initial_context: "ENG-42\nTask details"})
    {:ok, child} = Threads.create(%{parent_id: root.id, provider: "claude"})
    Threads.subscribe(child.id)

    :ok = Threads.send_message(child.id, "hi")
    events = collect_until(type?("turn.completed"))

    assert Enum.find(events, &(&1["type"] == "session.started"))["initial_context"] ==
             root.initial_context

    assert [%{"text" => "hi"}] =
             Enum.filter(Items.last(child.id), &(&1["kind"] == "user_message"))

    :ok =
      DynamicSupervisor.terminate_child(Workbench.Threads.Supervisor, Threads.whereis(child.id))

    :ok = Threads.send_message(child.id, "again")
    events = collect_until(type?("turn.completed"))

    assert %{"session_id" => "stub-session", "initial_context" => context} =
             Enum.find(events, &(&1["type"] == "session.started"))

    assert context == root.initial_context

    assert Enum.map(
             Enum.filter(Items.last(child.id), &(&1["kind"] == "user_message")),
             & &1["text"]
           ) == ["hi", "again"]
  end

  test "closing the server kills the OS process", %{dir: dir} do
    t = create_thread(dir, %{provider: "claude"})
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "hi")
    collect_until(type?("turn.completed"))

    %{pstate: %{io: os_pid}} = :sys.get_state(Threads.whereis(t.id))
    assert alive?(os_pid)

    Process.exit(Threads.whereis(t.id), :kill)
    Process.sleep(300)
    refute alive?(os_pid)
  end

  test "editing context keeps an active turn alive and resumes with the new context on the next turn", %{dir: dir} do
    root = create_thread(dir, %{initial_context: "Original task"})
    {:ok, child} = Threads.create(%{parent_id: root.id, provider: "claude"})
    Threads.subscribe(child.id)
    :ok = Threads.send_message(child.id, "hi")
    %{pstate: %{io: before_pid}} = :sys.get_state(Threads.whereis(child.id))
    {:ok, context} = Threads.context(child.id)

    assert {:ok, _} = Threads.write_context(root.id, "Original task\nNew requirements", context.hash)
    assert %{pstate: %{io: ^before_pid}} = :sys.get_state(Threads.whereis(child.id))
    collect_until(type?("turn.completed"))

    :ok = Threads.send_message(child.id, "continue")
    events = collect_until(type?("turn.completed"))
    assert %{"session_id" => "stub-session", "initial_context" => "Original task\nNew requirements"} = Enum.find(events, &(&1["type"] == "session.started"))
    refute Enum.any?(events, &(&1["type"] == "error"))
    assert Items.last(child.id) |> Enum.filter(&(&1["kind"] == "user_message")) |> Enum.map(& &1["text"]) == ["hi", "continue"]
  end

  defp realpath(p), do: p |> then(&System.cmd("pwd", ["-P"], cd: &1)) |> elem(0) |> String.trim()

  defp alive?(os_pid), do: match?({_, 0}, System.cmd("kill", ["-0", to_string(os_pid)], stderr_to_stdout: true))
end
