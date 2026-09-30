defmodule WorkbenchWeb.RouterTest do
  use ExUnit.Case, async: true
  import Plug.Test

  @opts WorkbenchWeb.Router.init([])

  setup do
    # the router serves priv/static/index.html; make sure one exists
    index = Application.app_dir(:workbench, "priv/static/index.html")
    unless File.exists?(index) do
      File.mkdir_p!(Path.dirname(index))
      File.write!(index, "<html><head></head><body></body></html>")
    end

    :ok
  end

  defp call(conn), do: WorkbenchWeb.Router.call(conn, @opts)

  test "loopback gets the page with the token" do
    conn = call(%{conn(:get, "/") | remote_ip: {127, 0, 0, 1}})
    assert conn.status == 200
    assert conn.resp_body =~ ~s(name="wb-token" content="test-token")
  end

  test "another machine without the cookie gets a sign-in page, no token" do
    conn = call(%{conn(:get, "/") | remote_ip: {100, 64, 1, 2}})
    assert conn.status == 401
    refute conn.resp_body =~ "test-token"
  end

  test "the login link sets the cookie; the cookie then opens the page" do
    conn = call(%{conn(:get, "/?token=test-token") | remote_ip: {100, 64, 1, 2}})
    assert conn.status == 302
    assert %{value: "test-token", http_only: true} = conn.resp_cookies["wb_token"]

    conn = call(%{conn(:get, "/") |> put_req_cookie("wb_token", "test-token") | remote_ip: {100, 64, 1, 2}})
    assert conn.status == 200
    assert conn.resp_body =~ "test-token"

    conn = call(%{conn(:get, "/?token=nope") | remote_ip: {100, 64, 1, 2}})
    assert conn.status == 401
  end

  test "origin check allows configured hosts only" do
    alias WorkbenchWeb.UserSocket
    assert UserSocket.check_origin?(URI.parse("http://127.0.0.1:5173"))
    refute UserSocket.check_origin?(URI.parse("http://evil.example"))
    Application.put_env(:workbench, :allowed_origins, ["macmini"])
    assert UserSocket.check_origin?(URI.parse("http://macmini:4000"))
    Application.delete_env(:workbench, :allowed_origins)
  end

  test "editor icons: the cached app icon, else 404" do
    path = Path.join([Workbench.Home.dir(), "icons", "cursor.png"])
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, <<137, 80, 78, 71>>)
    on_exit(fn -> File.rm(path) end)

    conn = call(conn(:get, "/api/editor-icon/cursor"))
    assert conn.status == 200
    assert ["image/png" <> _] = Plug.Conn.get_resp_header(conn, "content-type")
    assert call(conn(:get, "/api/editor-icon/nope")).status == 404
  end
end
