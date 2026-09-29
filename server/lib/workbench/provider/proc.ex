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
