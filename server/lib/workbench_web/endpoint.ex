defmodule WorkbenchWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :workbench

  socket "/socket", WorkbenchWeb.UserSocket,
    websocket: [check_origin: {WorkbenchWeb.UserSocket, :check_origin?, []}],
    longpoll: false

  # The built SPA (web/ builds into priv/static).
  plug Plug.Static,
    at: "/",
    from: :workbench,
    gzip: false,
    only: ~w(assets fonts favicon.svg favicon.ico)

  plug Plug.RequestId
  plug Plug.Parsers, parsers: [:json], pass: ["application/json"], json_decoder: Jason
  plug WorkbenchWeb.Router
end
