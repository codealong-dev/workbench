defmodule WorkbenchWeb.ThreadChannel do
  @moduledoc """
  `thread:<id>`: subscribe before taking the snapshot so nothing is missed;
  the client drops events whose `seq` is at or below the snapshot's.
  """
  use Phoenix.Channel

  alias Workbench.Threads
  alias WorkbenchWeb.ChannelHelpers, as: H

  @impl true
  def join("thread:" <> id, _params, socket) do
    case Threads.ensure_started(id) do
      {:ok, _pid} ->
        Threads.subscribe(id)
        {:ok, Threads.snapshot(id), assign(socket, :thread_id, id)}

      {:error, :not_found} ->
        {:error, %{reason: "not_found"}}

      {:error, reason} ->
        {:error, %{reason: inspect(reason)}}
    end
  end

  @impl true
  def handle_in("send", %{"text" => text}, socket) when is_binary(text) and text != "" do
    result(Threads.send_message(socket.assigns.thread_id, text), socket)
  end

  def handle_in("interrupt", _params, socket) do
    result(Threads.interrupt(socket.assigns.thread_id), socket)
  end

  def handle_in("approve", %{"request_id" => rid, "decision" => decision}, socket) do
    result(Threads.respond(socket.assigns.thread_id, rid, decision), socket)
  end

  def handle_in("set_mode", %{"mode" => mode}, socket) do
    result(Threads.set_mode(socket.assigns.thread_id, mode), socket)
  end

  def handle_in(event, _params, socket) do
    {:reply, {:error, %{reason: "unknown or malformed message: #{event}"}}, socket}
  end

  @impl true
  def handle_info({:event, env}, socket) do
    push(socket, "event", env)
    {:noreply, socket}
  end

  def handle_info({:events, batch}, socket) do
    push(socket, "event", %{batch: batch})
    {:noreply, socket}
  end

  defp result(:ok, socket), do: {:reply, :ok, socket}
  defp result({:error, reason}, socket), do: {:reply, {:error, %{reason: H.reason(reason)}}, socket}
end
