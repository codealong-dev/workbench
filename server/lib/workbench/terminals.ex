defmodule Workbench.Terminals do
  @moduledoc """
  Real shells in a thread's worktree, over a PTY (erlexec `pty`).

  Terminals belong to a root thread (its sessions share them, as they share
  the worktree) and outlive browser tabs: output is kept in a scrollback
  buffer so a client that joins later, or reloads, sees what happened. They
  end when the shell exits, when closed, or when the thread is archived.

  PubSub:
    * `"wb:terminal:<id>"`: `{:term_output, id, data}`, `{:term_exit, id, code}`
    * `"wb:terminals:<owner_id>"`: `{:terminals_changed, owner_id}`
  """
  alias Workbench.Terminals.Terminal

  @registry Workbench.Terminals.Registry
  @supervisor Workbench.Terminals.Supervisor

  # not "terminal:<id>", the channel topic (see Workbench.Threads)
  def topic(id), do: "wb:terminal:" <> id
  def owner_topic(owner_id), do: "wb:terminals:" <> owner_id

  @doc "Start a login shell in `cwd`, owned by `owner_id`."
  def create(owner_id, cwd, opts \\ []) do
    n = next_number(owner_id)
    id = Ecto.UUID.generate()

    spec = {Terminal, %{id: id, owner_id: owner_id, cwd: cwd, n: n, cols: opts[:cols] || 80, rows: opts[:rows] || 24}}

    case DynamicSupervisor.start_child(@supervisor, spec) do
      {:ok, pid} ->
        changed(owner_id)
        {:ok, GenServer.call(pid, :info)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "The owner's terminals, oldest first."
  def list(owner_id) do
    @registry
    |> Registry.select([{{:_, :"$1", %{owner_id: :"$2"}}, [{:==, :"$2", owner_id}], [:"$1"]}])
    |> Enum.map(&safe_call(&1, :info))
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(& &1.n)
  end

  @doc "Scrollback and info; subscribes the caller to the terminal's output."
  def attach(id) do
    with {:ok, pid} <- whereis(id) do
      Phoenix.PubSub.subscribe(Workbench.PubSub, topic(id))
      {:ok, GenServer.call(pid, :attach)}
    end
  end

  def input(id, data) when is_binary(data), do: cast(id, {:input, data})
  def resize(id, cols, rows) when is_integer(cols) and is_integer(rows), do: cast(id, {:resize, cols, rows})

  def close(id) do
    with {:ok, pid} <- whereis(id), do: GenServer.stop(pid, :normal)
  catch
    :exit, _ -> :ok
  end

  def close_all(owner_id), do: Enum.each(list(owner_id), &close(&1.id))

  @doc false
  def changed(owner_id), do: Phoenix.PubSub.broadcast(Workbench.PubSub, owner_topic(owner_id), {:terminals_changed, owner_id})

  defp whereis(id) do
    case Registry.lookup(@registry, id) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  defp cast(id, msg) do
    with {:ok, pid} <- whereis(id), do: GenServer.cast(pid, msg)
  end

  defp safe_call(pid, msg) do
    GenServer.call(pid, msg)
  catch
    :exit, _ -> nil
  end

  defp next_number(owner_id) do
    case list(owner_id) do
      [] -> 1
      ts -> Enum.max_by(ts, & &1.n).n + 1
    end
  end
end
