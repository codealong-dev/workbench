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
        snap = Threads.snapshot(id)
        # terminals belong to the root thread; its sessions share them
        owner = snap.thread.parent_id || id
        Phoenix.PubSub.subscribe(Workbench.PubSub, Workbench.Terminals.owner_topic(owner))
        {:ok, snap, assign(socket, thread_id: id, terminal_owner: owner)}

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

  # `{request_id, decision}`; for AskUserQuestion `{request_id, decision: "answer", answers: {id => [labels]}}`
  def handle_in("approve", %{"request_id" => rid, "decision" => decision} = params, socket) do
    result(Threads.respond(socket.assigns.thread_id, rid, decision, params["answers"]), socket)
  end

  def handle_in("set_mode", %{"mode" => mode}, socket) do
    result(Threads.set_mode(socket.assigns.thread_id, mode), socket)
  end

  # `models` -> {models}; `set_model` {model, effort} (either may be null = default)
  def handle_in("models", _params, socket) do
    case Threads.models(socket.assigns.thread_id) do
      {:ok, models} -> {:reply, {:ok, %{models: models}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  def handle_in("set_model", params, socket) do
    model = if is_binary(params["model"]) and params["model"] != "", do: params["model"]
    effort = if is_binary(params["effort"]) and params["effort"] != "", do: params["effort"]
    result(Threads.set_model(socket.assigns.thread_id, model, effort), socket)
  end

  # `{}` full diff, `{summary: true}` file list only, `{path}` one file's patch.
  def handle_in("diff", params, socket) do
    opts = [summary: params["summary"] == true, path: params["path"]]

    with %{} = thread <- Threads.get(socket.assigns.thread_id),
         {:ok, diff} <- Workbench.Review.diff(thread, opts) do
      {:reply, {:ok, diff}, socket}
    else
      nil -> {:reply, {:error, %{reason: "not_found"}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  # The worktree's files (tracked + untracked, not ignored), and one file's text.
  def handle_in("files", _params, socket) do
    with_thread(socket, &Workbench.Files.list(&1.worktree_path))
  end

  def handle_in("file", %{"path" => path}, socket) when is_binary(path) do
    with_thread(socket, &Workbench.Files.read(&1.worktree_path, path))
  end

  # Terminals in the worktree: `terminals` -> {terminals}, `terminal.create`
  # {cols?, rows?} -> terminal, `terminal.close` {id}. The list is pushed as
  # `terminals` whenever it changes.
  def handle_in("terminals", _params, socket) do
    {:reply, {:ok, %{terminals: Workbench.Terminals.list(socket.assigns.terminal_owner)}}, socket}
  end

  def handle_in("terminal.create", params, socket) do
    with %{} = thread <- Threads.get(socket.assigns.thread_id),
         {:ok, term} <-
           Workbench.Terminals.create(socket.assigns.terminal_owner, thread.worktree_path,
             cols: int(params["cols"], 80),
             rows: int(params["rows"], 24)
           ) do
      {:reply, {:ok, term}, socket}
    else
      nil -> {:reply, {:error, %{reason: "not_found"}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  def handle_in("terminal.close", %{"id" => id}, socket) when is_binary(id) do
    if Enum.any?(Workbench.Terminals.list(socket.assigns.terminal_owner), &(&1.id == id)),
      do: Workbench.Terminals.close(id)

    {:reply, :ok, socket}
  end

  def handle_in("open_editor", %{"editor" => editor} = params, socket) do
    case Threads.get(socket.assigns.thread_id) do
      nil -> {:reply, {:error, %{reason: "not_found"}}, socket}
      thread -> result(Workbench.Editors.open(editor, thread.worktree_path, params["path"]), socket)
    end
  end

  def handle_in("push", _params, socket) do
    with %{} = thread <- Threads.get(socket.assigns.thread_id),
         {:ok, pushed} <- Workbench.Review.push(thread) do
      {:reply, {:ok, pushed}, socket}
    else
      nil -> {:reply, {:error, %{reason: "not_found"}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  def handle_in("archive", _params, socket) do
    result(Threads.archive(socket.assigns.thread_id), socket)
  end

  def handle_in(event, _params, socket) do
    {:reply, {:error, %{reason: "unknown or malformed message: #{event}"}}, socket}
  end

  @impl true
  def handle_info({:event, env}, socket) do
    push(socket, "event", env)
    {:noreply, socket}
  end

  def handle_info({:terminals_changed, owner}, socket) do
    push(socket, "terminals", %{terminals: Workbench.Terminals.list(owner)})
    {:noreply, socket}
  end

  def handle_info({:events, batch}, socket) do
    push(socket, "event", %{batch: batch})
    {:noreply, socket}
  end

  defp int(v, _default) when is_integer(v) and v > 0, do: v
  defp int(_, default), do: default

  defp with_thread(socket, fun) do
    with %{} = thread <- Threads.get(socket.assigns.thread_id),
         {:ok, reply} <- fun.(thread) do
      {:reply, {:ok, reply}, socket}
    else
      nil -> {:reply, {:error, %{reason: "not_found"}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: H.reason(reason)}}, socket}
    end
  end

  defp result(:ok, socket), do: {:reply, :ok, socket}
  defp result({:error, reason}, socket), do: {:reply, {:error, %{reason: H.reason(reason)}}, socket}
end
