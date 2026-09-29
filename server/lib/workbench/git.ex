defmodule Workbench.Git do
  @moduledoc "Thin `git` wrapper: `{:ok, trimmed_stdout}` or `{:error, message}`."

  def run(dir, args) do
    case System.cmd("git", ["-C", dir | args], stderr_to_stdout: true, env: [{"GIT_TERMINAL_PROMPT", "0"}]) do
      {out, 0} -> {:ok, String.trim(out)}
      {out, _} -> {:error, "git #{Enum.join(args, " ")}: #{String.trim(out)}"}
    end
  rescue
    e in ErlangError -> {:error, "git not available: #{Exception.message(e)}"}
  end

  def toplevel(dir) do
    if File.dir?(dir), do: run(dir, ["rev-parse", "--show-toplevel"]), else: {:error, "#{dir} is not a directory"}
  end

  @doc "origin/HEAD's branch, else the checked-out branch, else main."
  def default_branch(repo) do
    with {:error, _} <- strip_origin(run(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])),
         {:error, _} <- run(repo, ["symbolic-ref", "--short", "HEAD"]) do
      "main"
    else
      {:ok, branch} -> branch
    end
  end

  defp strip_origin({:ok, "origin/" <> b}), do: {:ok, b}
  defp strip_origin(other), do: other

  @doc "Local branches, most recently committed first; `wb/*` thread branches last."
  def branches(repo) do
    case run(repo, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"]) do
      {:ok, ""} -> []
      {:ok, out} -> out |> String.split("\n") |> Enum.sort_by(&String.starts_with?(&1, "wb/"))
      {:error, _} -> []
    end
  end
end
