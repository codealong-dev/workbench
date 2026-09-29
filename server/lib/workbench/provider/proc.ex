defmodule Workbench.Provider.Proc do
  @moduledoc """
  Thin wrapper over erlexec for agent processes.

  Each agent runs as the leader of its own process group, and `kill_group`
  makes sure its children (the `claude` binary, shells it spawned) die with
  it. If the BEAM itself dies, erlexec's port program sees stdin close and
  kills every group it manages, so nothing is left behind.

  Messages go to the calling process: `{:stdout, os_pid, data}`,
  `{:stderr, os_pid, data}` and, because the process is linked and the
  server traps exits, `{:EXIT, pid, reason}` when it ends. The link also
  means erlexec kills the group if the owning server dies.
  """

  @doc """
  Start `argv` in `cwd`. Returns `%{io: os_pid, pid: exec_pid}`: `io` tags
  output messages, `pid` is what the exit message carries.
  """
  def start([exe | args], cwd, env \\ []) do
    exe = System.find_executable(exe) || exe
    # erlexec's port program was started before Workbench.LoginEnv fixed PATH
    env = [{"PATH", System.get_env("PATH", "/usr/bin:/bin")} | Enum.reject(env, &(elem(&1, 0) == "PATH"))]

    opts = [
      :stdin,
      {:stdout, self()},
      {:stderr, self()},
      :link,
      {:cd, String.to_charlist(cwd)},
      {:env, Enum.map(env, fn {k, v} -> {String.to_charlist(k), String.to_charlist(v)} end)},
      {:group, 0},
      :kill_group,
      {:kill_timeout, 3}
    ]

    case :exec.run([String.to_charlist(exe) | Enum.map(args, &String.to_charlist/1)], opts) do
      {:ok, pid, os_pid} -> {:ok, %{io: os_pid, pid: pid}}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Write one JSON object followed by a newline."
  def write_json(os_pid, map) do
    :exec.send(os_pid, Jason.encode!(map) <> "\n")
  end

  @doc """
  Run a shell command to completion (or `timeout` ms, then kill its group).
  Returns `{:ok, output}` or `{:error, output}`. The caller must trap exits.
  """
  def run_sync(cmd, cwd, env, timeout) do
    case start(["sh", "-c", cmd], cwd, env) do
      {:ok, %{io: io, pid: pid}} -> collect(io, pid, "", System.monotonic_time(:millisecond) + timeout)
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  defp collect(io, pid, acc, deadline) do
    receive do
      {s, ^io, data} when s in [:stdout, :stderr] -> collect(io, pid, acc <> data, deadline)
      {:EXIT, ^pid, reason} ->
        # output can arrive after the exit (different sender processes)
        acc = drain(io, acc)
        if reason == :normal, do: {:ok, acc}, else: {:error, acc <> "(#{describe_exit(reason)})"}
    after
      max(deadline - System.monotonic_time(:millisecond), 0) ->
        stop(io)
        {:error, acc <> "(timed out)"}
    end
  end

  defp drain(io, acc) do
    receive do
      {s, ^io, data} when s in [:stdout, :stderr] -> drain(io, acc <> data)
    after
      50 -> acc
    end
  end

  @doc "Human-readable exit reason."
  def describe_exit({:exit_status, status}) do
    case :exec.status(status) do
      {:status, code} -> "exit code #{code}"
      {:signal, sig, _core} -> "signal #{sig}"
    end
  end

  def describe_exit(reason), do: inspect(reason)

  @doc "Close stdin, then terminate the group (SIGTERM, SIGKILL after kill_timeout)."
  def stop(os_pid) do
    _ = :exec.send(os_pid, :eof)
    _ = :exec.stop(os_pid)
    :ok
  catch
    _, _ -> :ok
  end
end
