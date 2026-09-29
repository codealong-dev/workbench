defmodule WorkbenchWeb.LobbyChannel do
  @moduledoc """
  Thread list and creation. M2 adds projects; in M1 a thread is created
  directly on a directory (`cwd`).
  """
  use Phoenix.Channel

  alias Workbench.Threads
  alias Workbench.Threads.Thread
  alias WorkbenchWeb.ChannelHelpers, as: H

  @impl true
  def join("lobby", _params, socket) do
    Threads.subscribe_lobby()
    {:ok, %{projects: [], threads: Enum.map(Threads.list(), &Thread.to_json/1)}, socket}
  end

  @impl true
  def handle_in("thread.create", params, socket) do
    attrs = %{
      provider: params["provider"] || "claude",
      title: params["title"],
      worktree_path: params["cwd"] && Path.expand(params["cwd"]),
      mode: params["mode"] || "default",
      model: params["model"]
    }

    case Threads.create(attrs) do
      {:ok, thread} -> {:reply, {:ok, %{thread: Thread.to_json(thread)}}, socket}
      {:error, changeset} -> {:reply, {:error, %{reason: H.errors(changeset)}}, socket}
    end
  end

  @impl true
  def handle_info({:thread_upserted, thread}, socket) do
    push(socket, "thread.upserted", Thread.to_json(thread))
    {:noreply, socket}
  end

  def handle_info({:thread_status, id, status}, socket) do
    push(socket, "thread.status", %{id: id, status: status})
    {:noreply, socket}
  end
end
