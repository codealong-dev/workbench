defmodule Workbench.Threads do
  @moduledoc """
  Public API for threads. Every call goes through the thread's
  `Workbench.Threads.Server`, started on demand; the agent process itself is
  only spawned on the first `send_message/2`.
  """
  import Ecto.Query

  alias Workbench.Repo
  alias Workbench.Threads.{Server, Thread}

  @lobby "lobby"

  def lobby_topic, do: @lobby
  def topic(id), do: "thread:" <> id

  def subscribe(id), do: Phoenix.PubSub.subscribe(Workbench.PubSub, topic(id))
  def subscribe_lobby, do: Phoenix.PubSub.subscribe(Workbench.PubSub, @lobby)

  def broadcast_lobby(msg), do: Phoenix.PubSub.broadcast(Workbench.PubSub, @lobby, msg)

  def list do
    Repo.all(from t in Thread, where: is_nil(t.archived_at), order_by: [desc: t.inserted_at])
  end

  def get(id), do: Repo.get(Thread, id)

  @doc """
  Create a thread. In M1 `worktree_path` is any existing directory; M2 adds
  projects and creates a git worktree per thread.
  """
  def create(attrs) do
    with {:ok, thread} <- attrs |> Thread.create_changeset() |> Repo.insert() do
      broadcast_lobby({:thread_upserted, thread})
      {:ok, thread}
    end
  end

  def send_message(id, text) when is_binary(text), do: call(id, {:send, text})
  def interrupt(id), do: call(id, :interrupt)
  def respond(id, request_id, decision), do: call(id, {:respond, request_id, decision})
  def set_mode(id, mode), do: call(id, {:set_mode, mode})

  @doc "Current state for a joining client: thread, status, seq, items, live text, pending approvals."
  def snapshot(id), do: call(id, :snapshot)

  def ensure_started(id) do
    case Registry.lookup(Workbench.Threads.Registry, id) do
      [{pid, _}] ->
        {:ok, pid}

      [] ->
        case DynamicSupervisor.start_child(Workbench.Threads.Supervisor, {Server, id}) do
          # init/1 returns :ignore when the thread row does not exist
          :ignore -> {:error, :not_found}
          {:ok, pid} -> {:ok, pid}
          {:error, {:already_started, pid}} -> {:ok, pid}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  def whereis(id) do
    case Registry.lookup(Workbench.Threads.Registry, id) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end

  defp call(id, msg) do
    with {:ok, pid} <- ensure_started(id) do
      GenServer.call(pid, msg, 15_000)
    end
  end
end
