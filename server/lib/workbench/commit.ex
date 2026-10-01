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
  def suggest(%Thread{worktree_path: wt} = t) do
    with :ok <- check_dir(wt),
         [_ | _] = files <- uncommitted(wt),
         {:ok, text} <- OneShot.ask(config(t), prompt(wt, files), id: "commit-#{t.id}", cwd: wt, timeout: @timeout_ms, label: "commit"),
         {:ok, title} <- clean(text) do
      {:ok, title}
    else
      [] -> {:error, "There is nothing to commit."}
      {:error, reason} -> {:error, if(is_binary(reason), do: reason, else: inspect(reason))}
    end
  end

  @doc "The message sent to the model."
  def prompt(wt, files) do
    {patch, _} = Git.cmd(wt, ["diff", "HEAD", "--no-color", "--no-ext-diff", "-M"])

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

  @doc "Stage everything and commit it with `title`: `{:ok, %{sha, title}}`."
  def commit(%Thread{worktree_path: wt}, title) when is_binary(title) do
    title = String.trim(title)

    cond do
      title == "" -> {:error, "write a commit title"}
      String.contains?(title, "\n") -> {:error, "the title is one line"}
      byte_size(title) > 500 -> {:error, "the title is too long"}
      true -> do_commit(wt, title)
    end
  end

  def commit(_, _), do: {:error, "write a commit title"}

  defp do_commit(wt, title) do
    with :ok <- check_dir(wt),
         [_ | _] <- uncommitted(wt),
         {:ok, _} <- Git.run(wt, ["add", "-A"]),
         {:ok, _} <- Git.run(wt, ["commit", "-m", title]),
         {:ok, sha} <- Git.run(wt, ["rev-parse", "HEAD"]) do
      {:ok, %{sha: sha, title: title}}
    else
      [] -> {:error, "There is nothing to commit."}
      {:error, _} = err -> err
    end
  end

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
