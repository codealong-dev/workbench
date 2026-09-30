defmodule Workbench.Watcher do
  @moduledoc """
  Watches a worktree for file changes (FSEvents on macOS, inotify on Linux)
  while someone is looking at it, so open editors can reload what an agent,
  a terminal or another editor changed.

  `subscribe(root)` from a channel process: starts the watcher if needed and
  subscribes the caller to `{:files_changed, root, [relative paths]}`. The
  watcher stops a little after its last subscriber goes away.
  """
  use GenServer, restart: :temporary
  require Logger

  @registry Workbench.Watcher.Registry
  @supervisor Workbench.Watcher.Supervisor
  @debounce_ms 120
  @linger_ms 30_000
  @ignore ~w(.git node_modules _build deps .elixir_ls dist build target .next .turbo coverage)

  def topic(root), do: "wb:files:" <> root

  def subscribe(root) do
    Phoenix.PubSub.subscribe(Workbench.PubSub, topic(root))

    pid =
      case DynamicSupervisor.start_child(@supervisor, {__MODULE__, root}) do
        {:ok, pid} -> pid
        {:error, {:already_started, pid}} -> pid
        _ -> nil
      end

    if pid, do: GenServer.cast(pid, {:user, self()})
    :ok
  end

  def start_link(root), do: GenServer.start_link(__MODULE__, root, name: {:via, Registry, {@registry, root}})

  @impl true
  def init(root) do
    real = realpath(root)
    opts = [dirs: [real]] ++ Application.get_env(:workbench, :watch_opts, [])

    case FileSystem.start_link(opts) do
      {:ok, fs} ->
        FileSystem.subscribe(fs)
        {:ok, %{root: root, real: real, fs: fs, users: MapSet.new(), pending: MapSet.new(), timer: nil, stop: nil}}

      other ->
        # no watcher available (e.g. Linux without inotify-tools): editors
        # still reload when an agent finishes
        Logger.info("not watching #{root}: #{inspect(other)}")
        :ignore
    end
  end

  @impl true
  def handle_cast({:user, pid}, st) do
    Process.monitor(pid)
    if st.stop, do: Process.cancel_timer(st.stop)
    {:noreply, %{st | users: MapSet.put(st.users, pid), stop: nil}}
  end

  @impl true
  def handle_info({:file_event, fs, {path, _events}}, %{fs: fs} = st) do
    case relative(st, to_string(path)) do
      nil ->
        {:noreply, st}

      rel ->
        timer = st.timer || Process.send_after(self(), :flush, @debounce_ms)
        {:noreply, %{st | pending: MapSet.put(st.pending, rel), timer: timer}}
    end
  end

  def handle_info({:file_event, fs, :stop}, %{fs: fs} = st), do: {:stop, :normal, st}

  def handle_info(:flush, st) do
    Phoenix.PubSub.broadcast(Workbench.PubSub, topic(st.root), {:files_changed, st.root, Enum.sort(st.pending)})
    {:noreply, %{st | pending: MapSet.new(), timer: nil}}
  end

  def handle_info({:DOWN, _, :process, pid, _}, st) do
    users = MapSet.delete(st.users, pid)
    stop = if MapSet.size(users) == 0, do: Process.send_after(self(), :linger_over, @linger_ms), else: st.stop
    {:noreply, %{st | users: users, stop: stop}}
  end

  def handle_info(:linger_over, %{users: users} = st) do
    if MapSet.size(users) == 0, do: {:stop, :normal, st}, else: {:noreply, st}
  end

  def handle_info(_, st), do: {:noreply, st}

  defp relative(st, path) do
    rel =
      cond do
        String.starts_with?(path, st.real <> "/") -> String.replace_prefix(path, st.real <> "/", "")
        String.starts_with?(path, st.root <> "/") -> String.replace_prefix(path, st.root <> "/", "")
        true -> nil
      end

    if rel && not ignored?(rel), do: rel
  end

  defp ignored?(rel), do: rel |> Path.split() |> Enum.any?(&(&1 in @ignore))

  defp realpath(path) do
    case System.cmd("realpath", [path], stderr_to_stdout: true) do
      {out, 0} -> String.trim(out)
      _ -> path
    end
  end
end
