defmodule Workbench.PullRequests do
  @moduledoc """
  The projects' GitHub pull requests, through the `gh` CLI (so whatever
  `gh auth login` set up is what we use; no token of our own).

  `list/1` asks every project whose `origin` is on GitHub (or the one in
  `project_id`) for its pull requests, at the same time, and returns them newest first:

      %{prs: [%{project_id, repo, number, title, url, state, draft, author,
                head, base, created_at, updated_at, merged_at,
                review_decision, additions, deletions, changed_files, body}],
        errors: [%{project_id, reason}],
        repos: [%{project_id, repo}]}  # the projects on GitHub

  Filters: `state` "open" | "merged" | "closed" | "all", `project_id`,
  `author` ("me" or a login) and `review`, one of `@reviews`.

  `review/3` opens a pull request as a workspace: a thread whose worktree is
  checked out at the PR's head, on its own `wb/pr-<n>-…` branch, compared
  against the PR's base. So the changes, the guide, the review agent and the
  chats work on it as on any thread. The PR's description becomes the
  thread's initial context, and a guide starts being written. Opening the
  same PR again returns the workspace it already has.
  """
  import Ecto.Query

  alias Workbench.{Git, Projects, Repo, Threads}
  alias Workbench.Projects.Project
  alias Workbench.Threads.Thread

  @limit 50
  @timeout_ms 30_000
  @fields ~w(number title url state isDraft author headRefName baseRefName createdAt updatedAt mergedAt reviewDecision additions deletions changedFiles body)
  @view_fields ~w(number title url state isDraft author headRefName baseRefName headRefOid mergeCommit body)

  # review filter -> GitHub search qualifier
  @reviews %{
    "requested" => "review-requested:@me",
    "reviewed" => "reviewed-by:@me",
    "approved" => "review:approved",
    "changes_requested" => "review:changes_requested",
    "none" => "review:none"
  }

  def reviews, do: Map.keys(@reviews)

  # -- listing --------------------------------------------------------------------

  def list(filters \\ %{}) do
    # every project on GitHub, or the one asked for (whose error is worth showing)
    targets =
      case filters["project_id"] do
        id when is_binary(id) and id != "" ->
          for p <- List.wrap(Projects.get(id)), do: {p, github_repo(p)}

        _ ->
          for p <- Projects.list(), {:ok, _} = repo <- [github_repo(p)], do: {p, repo}
      end

    results =
      targets
      |> Task.async_stream(fn {p, repo} -> list_repo(p, repo, filters) end, timeout: @timeout_ms + 5_000, on_timeout: :kill_task, max_concurrency: 8)
      |> Enum.zip(targets)
      |> Enum.map(fn
        {{:ok, result}, {p, _}} -> {p, result}
        {{:exit, _}, {p, _}} -> {p, {:error, "GitHub took too long to answer"}}
      end)

    %{
      prs: Enum.sort_by(for({_, {:ok, prs}} <- results, pr <- prs, do: pr), & &1.updated_at, :desc),
      errors: for({p, {:error, reason}} <- results, do: %{project_id: p.id, reason: reason}),
      repos: for({p, {:ok, repo}} <- targets, do: %{project_id: p.id, repo: repo})
    }
  end

  defp list_repo(_p, {:error, _} = err, _filters), do: err

  defp list_repo(%Project{} = p, {:ok, repo}, filters) do
    args = ["pr", "list", "-R", repo, "--limit", "#{@limit}", "--json", Enum.join(@fields, ",")] ++ state_args(filters["state"]) ++ search_args(filters)

    with {:ok, out} <- gh(args),
         {:ok, prs} when is_list(prs) <- Jason.decode(out) do
      {:ok, Enum.map(prs, &to_json(&1, p, repo))}
    else
      {:ok, _} -> {:error, "unexpected answer from gh"}
      {:error, %Jason.DecodeError{}} -> {:error, "unexpected answer from gh"}
      {:error, _} = err -> err
    end
  end

  defp state_args(state) when state in ["open", "merged", "closed", "all"], do: ["--state", state]
  defp state_args(_), do: ["--state", "open"]

  @doc "The `--search` for the author and review filters, if any."
  def search_args(filters) do
    author =
      case filters["author"] do
        "me" -> "author:@me"
        login when is_binary(login) and login != "" -> if login =~ ~r/^[\w.\-\[\]]+$/, do: "author:#{login}"
        _ -> nil
      end

    case Enum.reject([author, @reviews[filters["review"]]], &is_nil/1) do
      [] -> []
      qs -> ["--search", Enum.join(qs, " ")]
    end
  end

  defp to_json(pr, %Project{id: project_id}, repo) do
    %{
      project_id: project_id,
      repo: repo,
      number: pr["number"],
      title: pr["title"],
      url: pr["url"],
      state: String.downcase(pr["state"] || "open"),
      draft: pr["isDraft"] == true,
      author: get_in(pr, ["author", "login"]),
      head: pr["headRefName"],
      base: pr["baseRefName"],
      created_at: pr["createdAt"],
      updated_at: pr["updatedAt"],
      merged_at: pr["mergedAt"],
      review_decision: blank(pr["reviewDecision"]),
      additions: pr["additions"],
      deletions: pr["deletions"],
      changed_files: pr["changedFiles"],
      body: blank(pr["body"])
    }
  end

  # -- reviewing --------------------------------------------------------------------

  @doc "The workspace reviewing pull request `number` of a project, made if there is none yet."
  def review(project_id, number, provider \\ "claude") when is_integer(number) do
    with {:ok, p} <- fetch_project(project_id) do
      case existing(p.id, number) do
        %Thread{} = t ->
          {:ok, t}

        nil ->
          with {:ok, repo} <- github_repo(p),
               {:ok, out} <- gh(["pr", "view", "#{number}", "-R", repo, "--json", Enum.join(@view_fields, ",")]),
               {:ok, pr} <- Jason.decode(out),
               {:ok, thread} <- open(p, repo, pr, provider) do
            _ = Workbench.Guide.generate(thread.id)
            {:ok, thread}
          end
      end
    end
  end

  @doc false
  # Fetches the PR's head and base from origin and makes the thread. `pr` is
  # `gh pr view --json` of @view_fields.
  def open(%Project{} = p, repo, %{"number" => number} = pr, provider) do
    with {:ok, base_ref} <- fetch(p, pr) do
      attrs = %{
        project_id: p.id,
        provider: provider,
        title: "##{number} #{pr["title"]}",
        slug: "pr #{number} #{pr["title"]}",
        initial_context: context(repo, pr),
        base_ref: base_ref,
        start_ref: pr["headRefOid"] || "refs/workbench/pr/#{number}",
        isolate: true,
        pr_number: number,
        pr_url: pr["url"]
      }

      Threads.create(attrs)
    end
  end

  defp existing(project_id, number) do
    Repo.one(
      from t in Thread,
        where: t.project_id == ^project_id and t.pr_number == ^number and is_nil(t.parent_id) and is_nil(t.archived_at),
        order_by: [desc: t.inserted_at],
        limit: 1
    )
  end

  # The head goes to refs/workbench/pr/<n> (GitHub keeps refs/pull/<n>/head,
  # forks included). Open PRs compare against origin's base branch, like
  # GitHub does. Merged ones against the base as it was before the merge (the
  # merge commit's first parent), since the head is in the base by now.
  defp fetch(%Project{repo_path: repo}, %{"number" => n} = pr) do
    base = pr["baseRefName"]

    with {:ok, _} <- git_fetch(repo, ["+refs/pull/#{n}/head:refs/workbench/pr/#{n}", "+refs/heads/#{base}:refs/remotes/origin/#{base}"]) do
      case {String.upcase(pr["state"] || ""), get_in(pr, ["mergeCommit", "oid"])} do
        {"MERGED", oid} when is_binary(oid) ->
          with {:error, _} <- Git.run(repo, ["rev-parse", "--verify", "-q", oid <> "^{commit}"]),
               do: git_fetch(repo, [oid])

          case Git.run(repo, ["rev-parse", "--short=12", oid <> "^1"]) do
            {:ok, sha} -> {:ok, sha}
            {:error, _} -> {:ok, "origin/#{base}"}
          end

        _ ->
          {:ok, "origin/#{base}"}
      end
    end
  end

  defp git_fetch(repo, refspecs) do
    task = Task.async(fn -> Git.run(repo, ["fetch", "--no-tags", "--quiet", "origin" | refspecs]) end)

    case Task.yield(task, 120_000) || Task.shutdown(task, :brutal_kill) do
      {:ok, {:ok, _} = ok} -> ok
      {:ok, {:error, msg}} -> {:error, "could not fetch the pull request: #{msg}"}
      nil -> {:error, "fetching the pull request timed out"}
    end
  end

  @doc "The initial context of a PR's workspace: what it is and its description."
  def context(repo, pr) do
    author = get_in(pr, ["author", "login"])

    head =
      [
        "Reviewing pull request ##{pr["number"]} in #{repo}: #{pr["title"]}",
        pr["url"],
        Enum.join(Enum.reject([author && "Author: @#{author}", pr["headRefName"] && "Branch: #{pr["headRefName"]} into #{pr["baseRefName"]}"], &is_nil/1), " · ")
      ]
      |> Enum.reject(&(&1 in [nil, ""]))
      |> Enum.join("\n")

    case blank(pr["body"]) do
      nil -> head
      body -> head <> "\n\n## Description\n\n" <> String.trim(body)
    end
  end

  # -- GitHub ------------------------------------------------------------------------

  @doc "`owner/name` of a project whose origin is on github.com."
  def github_repo(%Project{repo_path: path}) do
    case Git.run(path, ["remote", "get-url", "origin"]) do
      {:ok, url} -> with nil <- repo_slug(url), do: {:error, "origin isn't on GitHub"}
      {:error, _} -> {:error, "no `origin` remote"}
    end
  end

  @doc "`{:ok, \"owner/name\"}` for a github.com remote URL, else nil."
  def repo_slug(url) do
    case Regex.run(~r{^(?:https?://|ssh://)?(?:[^@/]+@)?github\.com[:/]([^/]+/[^/]+?)(?:\.git)?/?$}, String.trim(url)) do
      [_, slug] -> {:ok, slug}
      _ -> nil
    end
  end

  defp gh(args) do
    case System.find_executable("gh") do
      nil ->
        {:error, "the GitHub CLI (gh) isn't installed; brew install gh, then gh auth login"}

      exe ->
        task = Task.async(fn -> System.cmd(exe, args, stderr_to_stdout: true, env: [{"GH_PROMPT_DISABLED", "1"}, {"NO_COLOR", "1"}]) end)

        case Task.yield(task, @timeout_ms) || Task.shutdown(task, :brutal_kill) do
          {:ok, {out, 0}} -> {:ok, out}
          {:ok, {out, _}} -> {:error, gh_error(out)}
          nil -> {:error, "GitHub took too long to answer"}
        end
    end
  rescue
    e in ErlangError -> {:error, "gh failed: #{Exception.message(e)}"}
  end

  defp gh_error(out) do
    out = String.trim(out)

    cond do
      out =~ ~r/gh auth login|not logged/i -> "gh isn't logged in; run gh auth login"
      out == "" -> "gh failed"
      true -> out |> String.split("\n") |> List.first() |> String.slice(0, 300)
    end
  end

  defp fetch_project(id) do
    case Projects.get(id) do
      nil -> {:error, "project not found"}
      p -> {:ok, p}
    end
  end

  defp blank(v) when v in [nil, ""], do: nil
  defp blank(v), do: v
end
