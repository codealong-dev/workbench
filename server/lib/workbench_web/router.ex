defmodule WorkbenchWeb.Router do
  @moduledoc """
  Everything except the socket and static assets returns the SPA's
  index.html with the socket token injected, but only for a browser that
  may have it:

    * on this machine (loopback): always
    * from another machine (M7, over Tailscale): only with the `wb_token`
      cookie, which the one-time login link `/?token=...` sets. Get the link
      with `make link` on the Workbench machine.
  """
  use Plug.Router

  @cookie "wb_token"
  @year 365 * 24 * 3600

  plug :match
  plug :dispatch

  get "/api/health" do
    send_resp(conn, 200, ~s({"ok":true}))
  end

  # the editors' own app icons, for the "Open in" button
  get "/api/editor-icon/:id" do
    case Workbench.Editors.icon(id) do
      {:ok, path} ->
        conn
        |> put_resp_content_type("image/png")
        |> Plug.Conn.put_resp_header("cache-control", "public, max-age=86400")
        |> send_file(200, path)

      {:error, _} ->
        send_resp(conn, 404, "")
    end
  end

  # files attached to a conversation, for the preview; same access as the page
  get "/api/uploads/:thread_id/files/:id/:name" do
    conn = Plug.Conn.fetch_cookies(conn)

    with true <- local?(conn) or valid?(conn.cookies[@cookie], Workbench.Home.token()),
         {:ok, path} <- Workbench.Uploads.file_path(thread_id, id, name) do
      conn
      |> put_resp_content_type("application/octet-stream", nil)
      |> Plug.Conn.put_resp_header("cache-control", "private, max-age=31536000, immutable")
      |> Plug.Conn.put_resp_header("x-content-type-options", "nosniff")
      |> Plug.Conn.put_resp_header("content-disposition", "attachment")
      |> send_file(200, path)
    else
      false -> send_resp(conn, 401, "")
      :error -> send_resp(conn, 404, "")
    end
  end

  # images in a conversation (Workbench.Uploads); same access as the page
  get "/api/uploads/:thread_id/:file" do
    conn = Plug.Conn.fetch_cookies(conn)

    with true <- local?(conn) or valid?(conn.cookies[@cookie], Workbench.Home.token()),
         {:ok, path, mime} <- Workbench.Uploads.path(thread_id, file) do
      conn
      |> put_resp_content_type(mime, nil)
      |> Plug.Conn.put_resp_header("cache-control", "private, max-age=31536000, immutable")
      |> Plug.Conn.put_resp_header("x-content-type-options", "nosniff")
      |> send_file(200, path)
    else
      false -> send_resp(conn, 401, "")
      :error -> send_resp(conn, 404, "")
    end
  end

  match _ do
    conn = Plug.Conn.fetch_cookies(conn) |> Plug.Conn.fetch_query_params()
    token = Workbench.Home.token()

    cond do
      valid?(conn.query_params["token"], token) ->
        conn
        |> Plug.Conn.put_resp_cookie(@cookie, token, max_age: @year, http_only: true, same_site: "Strict")
        |> Plug.Conn.put_resp_header("location", "/")
        |> send_resp(302, "")

      local?(conn) or valid?(conn.cookies[@cookie], token) ->
        index(conn, token)

      true ->
        conn
        |> put_resp_content_type("text/html")
        |> send_resp(401, """
        <!doctype html><meta charset="utf-8"><title>Workbench</title>
        <body style="font:14px system-ui;max-width:32rem;margin:15vh auto;color:#444">
        <h1 style="font-size:18px">Workbench</h1>
        <p>This browser isn't signed in. On the Workbench machine run <code>make link</code>
        and open the link it prints here, once.</p></body>
        """)
    end
  end

  defp index(conn, token) do
    case File.read(Application.app_dir(:workbench, "priv/static/index.html")) do
      {:ok, html} ->
        html = String.replace(html, "</head>", ~s(<meta name="wb-token" content="#{token}"></head>), global: false)

        conn
        |> put_resp_content_type("text/html")
        |> Plug.Conn.put_resp_header("cache-control", "no-store")
        |> send_resp(200, html)

      {:error, _} ->
        send_resp(conn, 404, "web not built: run `make web` (or use the Vite dev server on :5173)")
    end
  end

  defp valid?(given, token) when is_binary(given), do: Plug.Crypto.secure_compare(given, token)
  defp valid?(_, _), do: false

  defp local?(%{remote_ip: {127, _, _, _}}), do: true
  defp local?(%{remote_ip: {0, 0, 0, 0, 0, 0, 0, 1}}), do: true
  defp local?(_), do: false
end
