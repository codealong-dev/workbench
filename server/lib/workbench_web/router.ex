defmodule WorkbenchWeb.Router do
  @moduledoc """
  Everything except the socket and static assets returns the SPA's
  index.html, with the socket token injected so the page can connect.
  """
  use Plug.Router

  plug :match
  plug :dispatch

  get "/api/health" do
    send_resp(conn, 200, ~s({"ok":true}))
  end

  match _ do
    index = Application.app_dir(:workbench, "priv/static/index.html")

    case File.read(index) do
      {:ok, html} ->
        token = Workbench.Home.token()
        html = String.replace(html, "</head>", ~s(<meta name="wb-token" content="#{token}"></head>), global: false)

        conn
        |> put_resp_content_type("text/html")
        |> send_resp(200, html)

      {:error, _} ->
        send_resp(conn, 404, "web not built: run `make web` (or use the Vite dev server on :5173)")
    end
  end
end
