defmodule Workbench.Review do
  @moduledoc """
  What a thread changed.

  Worktree threads diff against the merge base with their base ref, which
  covers commits on the thread branch plus uncommitted work. Threads running
  in the repo itself diff against HEAD (uncommitted work only). Untracked
  files show up as added.

  `diff/2` returns:

      %{
        base: "main",
        files: [%{path, old_path, status, additions, deletions, binary}],
        patch: "diff --git ..." | nil,   # nil when larger than @max_patch
        truncated: boolean
      }

  With `path:` it returns the patch of that one file (for large diffs).
  """
  alias Workbench.Git
  alias Workbench.Threads.Thread

  @max_patch 1_500_000
  @max_untracked 200
  @max_untracked_bytes 512_000

  def diff(%Thread{} = t, opts \\ []) do
    wt = t.worktree_path

    with :ok <- check_dir(wt),
         {:ok, range} <- range(t) do
      files = changed_files(wt, range) ++ untracked_files(wt)

      cond do
        path = opts[:path] ->
          {:ok, %{base: label(t), path: path, patch: file_patch(wt, range, path, files)}}

        opts[:summary] ->
          {:ok, %{base: label(t), files: files}}

        true ->
          patch = full_patch(wt, range, files)
          too_big = byte_size(patch) > @max_patch
          {:ok, %{base: label(t), files: files, patch: if(too_big, do: nil, else: patch), truncated: too_big}}
      end
    end
  end

  @doc """
  Push the thread's branch to `origin` (M7: work done on another machine
  reaches you as a branch). Returns the remote and, for GitHub/GitLab, a
  link to open a PR from it.
  """
  def push(%Thread{worktree_path: wt, branch: branch} = t) do
    with :ok <- check_dir(wt),
         :ok <- if(is_binary(branch), do: :ok, else: {:error, "this thread has no branch"}),
         {:ok, url} <- origin_url(wt),
         {:ok, out} <- git_with_timeout(wt, ["push", "-u", "origin", branch], 90_000) do
      {:ok, %{branch: branch, remote: url, output: out, pr_url: pr_url(url, t.base_ref, branch)}}
    end
  end

  defp origin_url(wt) do
    case Git.run(wt, ["remote", "get-url", "origin"]) do
      {:ok, url} -> {:ok, url}
      {:error, _} -> {:error, "no `origin` remote in this repo"}
    end
  end

  defp git_with_timeout(wt, args, timeout) do
    task = Task.async(fn -> Git.run(wt, args) end)

    case Task.yield(task, timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, result} -> result
      nil -> {:error, "git #{hd(args)} timed out after #{div(timeout, 1000)}s"}
    end
  end

  @doc "A 'create PR' link for GitHub and GitLab remotes, else nil."
  def pr_url(remote, base, branch) do
    with [_, host, repo] <- Regex.run(~r{^(?:https?://|ssh://)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?/?$}, remote) do
      cond do
        host == "github.com" and base -> "https://github.com/#{repo}/compare/#{base}...#{branch}?expand=1"
        host == "github.com" -> "https://github.com/#{repo}/pull/new/#{branch}"
        String.contains?(host, "gitlab") -> "https://#{host}/#{repo}/-/merge_requests/new?merge_request%5Bsource_branch%5D=#{URI.encode_www_form(branch)}"
        true -> nil
      end
    else
      _ -> nil
    end
  end

  defp check_dir(dir), do: if(File.dir?(dir), do: :ok, else: {:error, "worktree #{dir} no longer exists"})

  defp label(%Thread{base_ref: nil}), do: "HEAD"
  defp label(%Thread{base_ref: base}), do: base

  # The arguments that select what to compare against the working tree.
  defp range(%Thread{base_ref: nil}), do: {:ok, ["HEAD"]}

  defp range(%Thread{worktree_path: wt, base_ref: base}) do
    case Git.run(wt, ["merge-base", base, "HEAD"]) do
      {:ok, sha} -> {:ok, [sha]}
      {:error, _} -> {:error, "base #{base} not found; was the branch deleted?"}
    end
  end

  # -- tracked changes ------------------------------------------------------

  defp changed_files(wt, range) do
    counts = numstat(wt, range)

    wt
    |> Git.cmd(["diff", "--name-status", "-z", "-M" | range])
    |> elem(0)
    |> String.split("\0", trim: true)
    |> parse_name_status([])
    |> Enum.map(fn f ->
      {adds, dels, binary} = Map.get(counts, f.path, {0, 0, false})
      Map.merge(f, %{additions: adds, deletions: dels, binary: binary})
    end)
  end

  defp parse_name_status([], acc), do: Enum.reverse(acc)

  defp parse_name_status([<<kind, _score::binary>>, old, new | rest], acc) when kind in [?R, ?C] do
    parse_name_status(rest, [%{path: new, old_path: old, status: if(kind == ?R, do: "renamed", else: "copied")} | acc])
  end

  defp parse_name_status([code, path | rest], acc) do
    status =
      case code do
        "A" -> "added"
        "D" -> "deleted"
        "T" -> "modified"
        _ -> "modified"
      end

    parse_name_status(rest, [%{path: path, old_path: nil, status: status} | acc])
  end

  defp parse_name_status([_], acc), do: Enum.reverse(acc)

  # numstat -z: "adds\tdels\tpath\0", renames: "adds\tdels\t\0old\0new\0"
  defp numstat(wt, range) do
    wt
    |> Git.cmd(["diff", "--numstat", "-z", "-M" | range])
    |> elem(0)
    |> String.split("\0")
    |> parse_numstat(%{})
  end

  defp parse_numstat([], acc), do: acc

  defp parse_numstat([entry | rest], acc) do
    case String.split(entry, "\t") do
      [a, d, ""] ->
        case rest do
          [_old, new | rest] -> parse_numstat(rest, Map.put(acc, new, counts(a, d)))
          _ -> acc
        end

      [a, d, path] ->
        parse_numstat(rest, Map.put(acc, path, counts(a, d)))

      _ ->
        parse_numstat(rest, acc)
    end
  end

  defp counts("-", "-"), do: {0, 0, true}
  defp counts(a, d), do: {String.to_integer(a), String.to_integer(d), false}

  # -- untracked files ------------------------------------------------------

  defp untracked_files(wt) do
    wt
    |> Git.cmd(["ls-files", "--others", "--exclude-standard", "-z"])
    |> elem(0)
    |> String.split("\0", trim: true)
    |> Enum.take(@max_untracked)
    |> Enum.map(fn path ->
      full = Path.join(wt, path)
      {lines, binary} = count_lines(full)
      %{path: path, old_path: nil, status: "untracked", additions: lines, deletions: 0, binary: binary}
    end)
  end

  defp count_lines(file) do
    case File.stat(file) do
      {:ok, %{size: size}} when size > @max_untracked_bytes ->
        {0, true}

      {:ok, _} ->
        body = File.read!(file)
        if String.contains?(body, <<0>>), do: {0, true}, else: {length(String.split(body, "\n", trim: true)), false}

      _ ->
        {0, false}
    end
  end

  # -- patches --------------------------------------------------------------

  defp full_patch(wt, range, files) do
    {tracked, _} = Git.cmd(wt, ["diff", "--no-color", "--no-ext-diff", "-M" | range])

    untracked =
      for %{status: "untracked", binary: false, path: p} <- files, into: "" do
        untracked_patch(wt, p)
      end

    tracked <> untracked
  end

  defp file_patch(wt, range, path, files) do
    if Enum.any?(files, &(&1.path == path and &1.status == "untracked")) do
      untracked_patch(wt, path)
    else
      old = Enum.find_value(files, fn f -> f.path == path && f.old_path end)
      paths = if old, do: [old, path], else: [path]
      Git.cmd(wt, ["diff", "--no-color", "--no-ext-diff", "-M" | range] ++ ["--" | paths]) |> elem(0)
    end
  end

  # `git diff --no-index` exits 1 when files differ, which is the point here.
  defp untracked_patch(wt, path) do
    {out, _} = Git.cmd(wt, ["diff", "--no-color", "--no-index", "--", "/dev/null", path])
    out
  end
end
