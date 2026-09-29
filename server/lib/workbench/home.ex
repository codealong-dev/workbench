defmodule Workbench.Home do
  @moduledoc """
  The data directory (`~/.workbench` or `WB_HOME`) and the socket token.

  The token is generated on first boot into `<home>/token` and must be sent
  as a socket param; see `WorkbenchWeb.UserSocket`.
  """

  def dir, do: Application.get_env(:workbench, :home) || Path.expand("~/.workbench")

  def ensure! do
    File.mkdir_p!(dir())
    token()
    :ok
  end

  def token do
    case Application.get_env(:workbench, :token) do
      nil ->
        token = read_or_create_token()
        Application.put_env(:workbench, :token, token)
        token

      token ->
        token
    end
  end

  defp read_or_create_token do
    path = Path.join(dir(), "token")

    case File.read(path) do
      {:ok, token} when byte_size(token) > 16 ->
        String.trim(token)

      _ ->
        token = :crypto.strong_rand_bytes(24) |> Base.url_encode64(padding: false)
        File.write!(path, token)
        File.chmod!(path, 0o600)
        token
    end
  end
end
