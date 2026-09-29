defmodule WorkbenchWeb.UserSocket do
  @moduledoc """
  Any web page can open a WebSocket to localhost, so connecting needs the
  token from `~/.workbench/token` and a localhost Origin.
  """
  use Phoenix.Socket

  channel "lobby", WorkbenchWeb.LobbyChannel
  channel "thread:*", WorkbenchWeb.ThreadChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    if Plug.Crypto.secure_compare(token, Workbench.Home.token()),
      do: {:ok, socket},
      else: :error
  end

  def connect(_params, _socket, _info), do: :error

  @impl true
  def id(_socket), do: nil

  @doc false
  def check_origin?(%URI{host: host}) when host in ["127.0.0.1", "localhost"], do: true
  def check_origin?(_), do: false
end
