defmodule Workbench.LoginEnv do
  @moduledoc """
  Apps started by launchd or Finder get a minimal PATH (/usr/bin:/bin...), so
  `git`, `node`, `zed` or `code` from Homebrew/asdf would not be found. At
  boot we ask the user's login shell for its PATH (like VS Code does) and put
  it in front of ours.

  erlexec's port program starts before this runs, so its children only see
  the new PATH because `Workbench.Provider.Proc` passes it explicitly.
  """
  require Logger

  @marker "__WB_PATH__"
  @timeout 5_000

  def load do
    if Application.get_env(:workbench, :login_path, true), do: do_load(), else: :skipped
  end

  defp do_load do
    shell = System.get_env("SHELL") || "/bin/zsh"

    task =
      Task.async(fn ->
        System.cmd(shell, ["-ilc", ~s(printf '#{@marker}%s#{@marker}' "$PATH")],
          stderr_to_stdout: true,
          env: [{"WB_LOGIN_PROBE", "1"}]
        )
      end)

    case Task.yield(task, @timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, {out, _}} ->
        case Regex.run(~r/#{@marker}(.*?)#{@marker}/s, out) do
          [_, login_path] when login_path != "" ->
            merged = merge(login_path, System.get_env("PATH") || "")
            System.put_env("PATH", merged)
            {:ok, merged}

          _ ->
            Logger.warning("could not read PATH from #{shell}; keeping #{System.get_env("PATH")}")
            :error
        end

      _ ->
        Logger.warning("#{shell} took over #{@timeout}ms to start; keeping the current PATH")
        :error
    end
  rescue
    e ->
      Logger.warning("login PATH probe failed: #{Exception.message(e)}")
      :error
  end

  @doc "Login-shell entries first, then anything only the current PATH had, without duplicates."
  def merge(login, current) do
    (String.split(login, ":", trim: true) ++ String.split(current, ":", trim: true))
    |> Enum.uniq()
    |> Enum.join(":")
  end
end
