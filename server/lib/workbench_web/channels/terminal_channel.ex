defmodule WorkbenchWeb.TerminalChannel do
  @moduledoc """
  `terminal:<id>`: one shell.

    * join -> `{id, title, cols, rows, buffer}` (buffer: base64 scrollback)
    * `input` `{data}`: keystrokes, as typed
    * `resize` `{cols, rows}`
    * pushes `output` `{data}` (base64, raw PTY bytes) and `exit` `{code}`
  """
  use Phoenix.Channel

  alias Workbench.Terminals

  @impl true
  def join("terminal:" <> id, _params, socket) do
    case Terminals.attach(id) do
      {:ok, info} -> {:ok, %{info | buffer: Base.encode64(info.buffer)}, assign(socket, :terminal_id, id)}
      {:error, :not_found} -> {:error, %{reason: "not_found"}}
    end
  end

  @impl true
  def handle_in("input", %{"data" => data}, socket) when is_binary(data) do
    Terminals.input(socket.assigns.terminal_id, data)
    {:noreply, socket}
  end

  def handle_in("resize", %{"cols" => cols, "rows" => rows}, socket) when is_integer(cols) and is_integer(rows) do
    Terminals.resize(socket.assigns.terminal_id, cols, rows)
    {:noreply, socket}
  end

  def handle_in(event, _params, socket) do
    {:reply, {:error, %{reason: "unknown or malformed message: #{event}"}}, socket}
  end

  @impl true
  def handle_info({:term_output, _id, data}, socket) do
    push(socket, "output", %{data: Base.encode64(data)})
    {:noreply, socket}
  end

  def handle_info({:term_exit, _id, code}, socket) do
    push(socket, "exit", %{code: code})
    {:noreply, socket}
  end
end
