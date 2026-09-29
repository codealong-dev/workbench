defmodule Workbench.Host do
  @moduledoc "Which machine this is, for the UI and for SSH links from other machines (M7)."

  @doc """
  `ssh_target` is what another machine's editor connects to: `WB_SSH_HOST`
  (an `~/.ssh/config` alias or `user@host`) or `<user>@<hostname>`.
  """
  def info do
    name = hostname()
    user = System.get_env("USER")
    target = Application.get_env(:workbench, :ssh_host) || if(user, do: "#{user}@#{name}", else: name)
    %{name: name, ssh_target: target}
  end

  def hostname do
    {:ok, name} = :inet.gethostname()
    name |> to_string() |> String.replace_suffix(".local", "")
  end
end
