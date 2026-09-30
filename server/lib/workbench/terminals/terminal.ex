defmodule Workbench.Terminals.Terminal do
  @moduledoc false
  # One shell on a PTY. Output is coalesced for a few ms before it is
  # broadcast, and the last @keep bytes are kept for clients that attach later.
  use GenServer, restart: :temporary
  require Logger

  alias Workbench.Terminals

  @keep 256_000
  @flush_ms 8

  def start_link(%{id: id} = args) do
    GenServer.start_link(__MODULE__, args, name: {:via, Registry, {Workbench.Terminals.Registry, id, %{owner_id: args.owner_id}}})
  end

  @impl true
  def init(args) do
    Process.flag(:trap_exit, true)
    shell = shell()

    env =
      [
        {"TERM", "xterm-256color"},
        {"COLORTERM", "truecolor"},
        {"PATH", System.get_env("PATH", "/usr/bin:/bin")},
        {"LANG", System.get_env("LANG") || "en_US.UTF-8"},
        {"SHELL", shell},
        {"WB_WORKTREE", args.cwd}
      ]
      |> Enum.map(fn {k, v} -> {String.to_charlist(k), String.to_charlist(v)} end)

    opts = [
      :stdin,
      {:stdout, self()},
      {:stderr, :stdout},
      :pty,
      :pty_echo,
      {:winsz, {args.rows, args.cols}},
      {:cd, String.to_charlist(args.cwd)},
      {:env, env},
      :link,
      :kill_group,
      {:kill_timeout, 1}
    ]

    case :exec.run([String.to_charlist(shell), ~c"-l"], opts) do
      {:ok, pid, os_pid} ->
        {:ok,
         Map.merge(args, %{
           pid: pid,
           os_pid: os_pid,
           shell: Path.basename(shell),
           buffer: "",
           pending: [],
           flush_ref: nil,
           created_at: DateTime.utc_now()
         })}

      {:error, reason} ->
        {:stop, {:shell_failed, reason}}
    end
  end

  @impl true
  def handle_call(:info, _from, st), do: {:reply, info(st), st}

  def handle_call(:attach, _from, st) do
    st = flush(st)
    {:reply, Map.put(info(st), :buffer, st.buffer), st}
  end

  @impl true
  def handle_cast({:input, data}, st) do
    :exec.send(st.os_pid, data)
    {:noreply, st}
  end

  def handle_cast({:resize, cols, rows}, st) when cols > 0 and rows > 0 and cols < 1000 and rows < 500 do
    :exec.winsz(st.os_pid, rows, cols)
    {:noreply, %{st | cols: cols, rows: rows}}
  end

  def handle_cast({:resize, _, _}, st), do: {:noreply, st}

  @impl true
  def handle_info({:stdout, os_pid, data}, %{os_pid: os_pid} = st) do
    st = %{st | pending: [st.pending | data]}
    st = if st.flush_ref, do: st, else: %{st | flush_ref: Process.send_after(self(), :flush, @flush_ms)}
    {:noreply, st}
  end

  def handle_info(:flush, st), do: {:noreply, flush(%{st | flush_ref: nil})}

  def handle_info({:EXIT, pid, reason}, %{pid: pid} = st) do
    # output can trail the exit (different sender)
    st = drain(st) |> flush()
    code = exit_code(reason)
    Phoenix.PubSub.broadcast(Workbench.PubSub, Terminals.topic(st.id), {:term_exit, st.id, code})
    {:stop, :normal, %{st | pid: nil}}
  end

  def handle_info(_msg, st), do: {:noreply, st}

  @impl true
  def terminate(_reason, st) do
    if st.pid, do: :exec.stop(st.os_pid)
    Terminals.changed(st.owner_id)
    :ok
  end

  defp flush(%{pending: []} = st), do: st

  defp flush(st) do
    if st.flush_ref, do: Process.cancel_timer(st.flush_ref)
    data = IO.iodata_to_binary(st.pending)
    Phoenix.PubSub.broadcast(Workbench.PubSub, Terminals.topic(st.id), {:term_output, st.id, data})
    buffer = st.buffer <> data
    buffer = if byte_size(buffer) > @keep, do: binary_part(buffer, byte_size(buffer) - @keep, @keep), else: buffer
    %{st | pending: [], flush_ref: nil, buffer: buffer}
  end

  defp drain(st) do
    receive do
      {:stdout, os_pid, data} when os_pid == st.os_pid -> drain(%{st | pending: [st.pending | data]})
    after
      30 -> st
    end
  end

  defp info(st) do
    %{
      id: st.id,
      owner_id: st.owner_id,
      n: st.n,
      title: "#{st.shell} #{st.n}",
      cwd: st.cwd,
      cols: st.cols,
      rows: st.rows,
      created_at: st.created_at
    }
  end

  defp exit_code(:normal), do: 0
  defp exit_code({:exit_status, s}) when is_integer(s), do: s |> :exec.status() |> status_code()
  defp exit_code(_), do: -1

  defp status_code({:status, c}), do: c
  defp status_code({:signal, _sig, _core}), do: -1

  # launchd doesn't set SHELL; fall back to what macOS and Linux ship
  defp shell do
    [System.get_env("SHELL"), "/bin/zsh", "/bin/bash", "/bin/sh"]
    |> Enum.find(&(&1 && File.exists?(&1)))
  end
end
