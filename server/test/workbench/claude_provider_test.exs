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
    assert "HelLo" != (for %{"type" => "text.delta", "text" => x} <- events, into: "", do: x)
    assert "Hello" == (for %{"type" => "text.delta", "text" => x} <- events, into: "", do: x)
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

  defp realpath(p), do: p |> then(&System.cmd("pwd", ["-P"], cd: &1)) |> elem(0) |> String.trim()

  defp alive?(os_pid), do: match?({_, 0}, System.cmd("kill", ["-0", to_string(os_pid)], stderr_to_stdout: true))
end
