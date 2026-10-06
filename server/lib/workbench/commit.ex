defmodule Workbench.Commit do
  @moduledoc """
  Committing a thread's work from the UI: what is waiting to be committed, a
  commit title written by a small model, the commit, and the history around
  it for the push preview.

  The title is written by the thread's own agent with a small model (Claude's
  Haiku, Codex's mini model; the choice is in `Workbench.Settings` `"commit"`),
  from the uncommitted patch and the latest commit titles, so it matches the
  repo's style. It only ever suggests: the user edits it before committing.

  `status/1` returns:

      %{branch, uncommitted: [%{path, status}], remote: url | nil,
        upstream: "origin/x" | nil, unpushed: n}

  `graph/1` returns the commits around the thread's branch, newest first:

      %{head: sha, commits: [%{sha, parents: [sha], author, at, refs: [name], subject, unpushed}]}
  """
  alias Workbench.{Git, OneShot, Settings}
  alias Workbench.Threads.Thread

  @budget 60_000
  @timeout_ms 60_000
  @max_title 200
  @graph_size 30

  @defaults %{"claude" => "haiku", "codex" => "gpt-5.1-codex-mini", "fake" => nil}

  @format """
  Write the commit title for the changes below: one line, at most 72 characters, imperative mood ("Add", "Fix", "Rename"), no trailing period, no quotes or backticks.
  Match the style of the recent commit titles (for instance a `feat:` or `fix:` prefix if they use one).
  Reply with the title and nothing else. You can't run commands.
  [workbench-commit]
  """

  def default_model(provider), do: Map.get(@defaults, provider)

  @doc "The agent that writes the title: the thread's own, with the chosen model for it."
  def config(%{provider: provider}) do
    chosen = get_in(Settings.commit() || %{}, ["models", provider])
    %{"provider" => provider, "model" => chosen || default_model(provider), "effort" => nil}
  end

  # -- what is there to commit ----------------------------------------------------

  def status(%Thread{worktree_path: wt, branch: branch}) do
    with :ok <- check_dir(wt) do
      remote =
        case Git.run(wt, ["remote", "get-url", "origin"]) do
          {:ok, url} -> url
          _ -> nil
        end

      upstream =
        case Git.run(wt, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) do
          {:ok, ref} -> ref
          _ -> nil
        end

      {:ok, %{branch: branch || current_branch(wt), uncommitted: uncommitted(wt), remote: remote, upstream: upstream, unpushed: length(unpushed(wt))}}
    end
  end

  defp current_branch(wt) do
    case Git.run(wt, ["symbolic-ref", "--short", "-q", "HEAD"]) do
      {:ok, b} -> b
      _ -> nil
    end
  end

  # `git status --porcelain -z -uall`: "XY path\0", renames add "old\0"
  defp uncommitted(wt) do
    wt
    |> Git.cmd(["status", "--porcelain", "-z", "-uall"])
    |> elem(0)
    |> String.split("\0", trim: true)
    |> porcelain([])
  end

  defp porcelain([], acc), do: Enum.reverse(acc)

  defp porcelain([<<x, y, ?\s, path::binary>>, _old | rest], acc) when x in [?R, ?C] or y in [?R, ?C],
    do: porcelain(rest, [%{path: path, status: "renamed"} | acc])

  defp porcelain([<<x, y, ?\s, path::binary>> | rest], acc), do: porcelain(rest, [%{path: path, status: state(x, y)} | acc])
  defp porcelain([_ | rest], acc), do: porcelain(rest, acc)

  defp state(??, ??), do: "untracked"
  defp state(x, y) when ?D in [x, y], do: "deleted"
  defp state(x, y) when ?A in [x, y], do: "added"
  defp state(_, _), do: "modified"

  # commits no remote branch has
  defp unpushed(wt) do
    case Git.run(wt, ["rev-list", "HEAD", "--not", "--remotes"]) do
      {:ok, ""} -> []
      {:ok, out} -> String.split(out, "\n")
      {:error, _} -> []
    end
  end

  # -- the title ------------------------------------------------------------------

  @doc "A suggested commit title for what is uncommitted: `{:ok, title}` or `{:error, message}`."
  def suggest(%Thread{worktree_path: wt} = t, opts \\ []) do
    with :ok <- check_dir(wt),
         [_ | _] = files <- uncommitted(wt),
         {files, cached?} = suggest_scope(wt, files, opts),
         {:ok, text} <- OneShot.ask(config(t), prompt(wt, files, cached?), id: "commit-#{t.id}", cwd: wt, initial_context: t.initial_context, timeout: @timeout_ms, label: "commit"),
         {:ok, title} <- clean(text) do
      {:ok, title}
    else
      [] -> {:error, "There is nothing to commit."}
      {:error, reason} -> {:error, if(is_binary(reason), do: reason, else: inspect(reason))}
    end
  end

  # With `staged: true` and something staged, only the index is going to be committed.
  defp suggest_scope(wt, files, opts) do
    case if(opts[:staged], do: split(wt).staged, else: []) do
      [] -> {files, false}
      staged -> {staged, true}
    end
  end

  @doc "The message sent to the model: the whole working tree, or with `cached?` just the index."
  def prompt(wt, files, cached? \\ false) do
    {patch, _} = Git.cmd(wt, ["diff", if(cached?, do: "--cached", else: "HEAD"), "--no-color", "--no-ext-diff", "-M"])

    recent =
      case Git.run(wt, ["log", "-n", "8", "--format=%s"]) do
        {:ok, out} when out != "" -> out
        _ -> "(none yet)"
      end

    listing = Enum.map_join(files, "\n", &"- #{&1.path} (#{&1.status})")

    """
    #{String.trim(@format)}

    Recent commit titles:
    #{recent}

    Changed files:
    #{listing}

    Patch of the tracked changes#{if byte_size(patch) > @budget, do: " (cut)", else: ""}:

    #{binary_part(patch, 0, min(byte_size(patch), @budget)) |> String.replace_invalid()}
    """
  end

  @doc "The first line of the reply, without quotes, fences or a final period."
  def clean(text) when is_binary(text) do
    line =
      text
      |> String.split("\n")
      |> Enum.map(&String.trim/1)
      |> Enum.find("", &(&1 != "" and not String.starts_with?(&1, "```")))
      |> String.trim("`")
      |> String.trim("\"")
      |> String.trim_trailing(".")
      |> String.trim()

    if line == "", do: {:error, "the agent suggested no title"}, else: {:ok, String.slice(line, 0, @max_title)}
  end

  # -- committing -----------------------------------------------------------------

  @doc """
  Commit with `title`: `{:ok, %{sha, title}}`. Everything is staged first,
  unless `staged: true`, which commits the index as it is (and stages
  everything only when nothing is staged, like VS Code's smart commit).
  """
  def commit(thread, title, opts \\ [])

  def commit(%Thread{worktree_path: wt}, title, opts) when is_binary(title) do
    title = String.trim(title)

    cond do
      title == "" -> {:error, "write a commit title"}
      String.contains?(title, "\n") -> {:error, "the title is one line"}
      byte_size(title) > 500 -> {:error, "the title is too long"}
      true -> do_commit(wt, title, opts[:staged] == true)
    end
  end

  def commit(_, _, _), do: {:error, "write a commit title"}

  defp do_commit(wt, title, staged?) do
    with :ok <- check_dir(wt),
         [_ | _] <- uncommitted(wt),
         :ok <- stage_for_commit(wt, staged?),
         {:ok, _} <- Git.run(wt, ["commit", "-m", title]),
         {:ok, sha} <- Git.run(wt, ["rev-parse", "HEAD"]) do
      {:ok, %{sha: sha, title: title}}
    else
      [] -> {:error, "There is nothing to commit."}
      {:error, _} = err -> err
    end
  end

  defp stage_for_commit(wt, false), do: ok(Git.run(wt, ["add", "-A"]))
  defp stage_for_commit(wt, true), do: if(split(wt).staged == [], do: ok(Git.run(wt, ["add", "-A"])), else: :ok)

  defp ok({:ok, _}), do: :ok
  defp ok(err), do: err

  # -- source control: staged and unstaged ------------------------------------------

  @doc """
  What `git status` shows, split like VS Code does: `%{staged: [file], unstaged: [file]}`
  with `file` = `%{path, old_path, status}`. A file with edits both in the index and
  on disk is in both lists; untracked files are unstaged.
  """
  def changes(%Thread{worktree_path: wt}) do
    with :ok <- check_dir(wt), do: {:ok, split(wt)}
  end

  defp split(wt) do
    {staged, unstaged} =
      wt
      |> entries()
      |> Enum.reduce({[], []}, fn {x, y, path, old}, {st, un} ->
        st = if x in [?A, ?M, ?D, ?R, ?C, ?T], do: [file(path, old, column(x)) | st], else: st
        un = if x == ?? or y != ?\s, do: [file(path, nil, if(x == ??, do: "untracked", else: column(y))) | un], else: un
        {st, un}
      end)

    %{staged: Enum.reverse(staged), unstaged: Enum.reverse(unstaged)}
  end

  defp file(path, old, status), do: %{path: path, old_path: old, status: status}

  defp column(?A), do: "added"
  defp column(?D), do: "deleted"
  defp column(c) when c in [?R, ?C], do: "renamed"
  defp column(_), do: "modified"

  # `git status --porcelain -z`: {x, y, path, old_path | nil}
  defp entries(wt) do
    wt
    |> Git.cmd(["status", "--porcelain", "-z", "-uall"])
    |> elem(0)
    |> String.split("\0", trim: true)
    |> entries([])
  end

  defp entries([], acc), do: Enum.reverse(acc)
  defp entries([<<x, y, ?\s, path::binary>>, old | rest], acc) when x in [?R, ?C] or y in [?R, ?C], do: entries(rest, [{x, y, path, old} | acc])
  defp entries([<<x, y, ?\s, path::binary>> | rest], acc), do: entries(rest, [{x, y, path, nil} | acc])
  defp entries([_ | rest], acc), do: entries(rest, acc)

  @doc "Stage `paths`, or everything when `paths` is nil: `{:ok, changes}`."
  def stage(%Thread{worktree_path: wt}, paths) do
    with :ok <- check_dir(wt),
         {:ok, paths} <- safe_paths(paths),
         {:ok, _} <- git_paths(wt, ["add", "-A"], paths) do
      {:ok, split(wt)}
    end
  end

  @doc "Take `paths` (all when nil) out of the index; the files keep their edits: `{:ok, changes}`."
  def unstage(%Thread{worktree_path: wt}, paths) do
    with :ok <- check_dir(wt),
         {:ok, paths} <- safe_paths(paths),
         {:ok, _} <- git_paths(wt, ["reset", "-q"], with_old_paths(wt, paths)) do
      {:ok, split(wt)}
    end
  end

  # a staged rename is two paths to git
  defp with_old_paths(_wt, nil), do: nil

  defp with_old_paths(wt, paths) do
    olds = for {_, _, path, old} <- entries(wt), old != nil, path in paths, do: old
    Enum.uniq(paths ++ olds)
  end

  @doc """
  Throw away the edits on disk of `paths` (all unstaged files when nil): tracked
  files go back to the index, untracked files are deleted. Staged work is kept.
  """
  def discard(%Thread{worktree_path: wt}, paths) do
    with :ok <- check_dir(wt),
         {:ok, paths} <- safe_paths(paths) do
      unstaged = split(wt).unstaged
      unstaged = if paths, do: Enum.filter(unstaged, &(&1.path in paths)), else: unstaged
      {untracked, tracked} = Enum.split_with(unstaged, &(&1.status == "untracked"))

      with :ok <- discard_group(wt, ["restore", "--worktree"], tracked),
           :ok <- discard_group(wt, ["clean", "-f", "-q"], untracked) do
        {:ok, split(wt)}
      end
    end
  end

  defp discard_group(_wt, _cmd, []), do: :ok
  defp discard_group(wt, cmd, files), do: ok(git_paths(wt, cmd, Enum.map(files, & &1.path)))

  # Paths come from the client: they stay inside the worktree and are never read as options or patterns.
  defp safe_paths(nil), do: {:ok, nil}

  defp safe_paths(paths) when is_list(paths) do
    safe = for p <- paths, is_binary(p), {:ok, rel} <- [Path.safe_relative(p)], rel not in ["", "."], do: rel
    if length(safe) == length(paths), do: {:ok, safe}, else: {:error, "path is outside the worktree"}
  end

  defp safe_paths(_), do: {:error, "path is outside the worktree"}

  defp git_paths(wt, cmd, nil), do: Git.run(wt, ["--literal-pathspecs" | cmd])
  defp git_paths(_wt, _cmd, []), do: {:ok, ""}
  defp git_paths(wt, cmd, paths), do: Git.run(wt, ["--literal-pathspecs" | cmd] ++ ["--" | paths])

  # -- history --------------------------------------------------------------------

  @doc "The recent commits of the thread's branch, its base and its upstream, topologically ordered."
  def graph(%Thread{worktree_path: wt, base_ref: base}) do
    with :ok <- check_dir(wt),
         {:ok, head} <- Git.run(wt, ["rev-parse", "HEAD"]) do
      tips = Enum.filter(["HEAD", base, upstream(wt)], &(is_binary(&1) and exists?(wt, &1))) |> Enum.uniq()
      unpushed = MapSet.new(unpushed(wt))
      format = Enum.join(~w(%H %P %an %at %D %s), "%x1f")
      {out, _} = Git.cmd(wt, ["log", "--topo-order", "-n", "#{@graph_size}", "--format=#{format}%x1e"] ++ tips ++ ["--"])

      commits =
        out
        |> String.split("\x1e", trim: true)
        |> Enum.flat_map(fn rec ->
          case rec |> String.trim_leading("\n") |> String.split("\x1f") do
            [sha, parents, author, at, refs, subject] ->
              [
                %{
                  sha: sha,
                  parents: String.split(parents),
                  author: author,
                  at: String.to_integer(at),
                  refs: refs |> String.split(",", trim: true) |> Enum.map(&String.trim/1) |> Enum.map(&String.replace_prefix(&1, "HEAD -> ", "")),
                  subject: subject,
                  unpushed: MapSet.member?(unpushed, sha)
                }
              ]

            _ ->
              []
          end
        end)

      {:ok, %{head: head, commits: commits}}
    end
  end

  defp upstream(wt) do
    case Git.run(wt, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) do
      {:ok, ref} -> ref
      _ -> nil
    end
  end

  defp exists?(wt, ref), do: match?({:ok, _}, Git.run(wt, ["rev-parse", "--verify", "-q", ref <> "^{commit}"]))

  defp check_dir(dir), do: if(File.dir?(dir), do: :ok, else: {:error, "worktree #{dir} no longer exists"})
end
