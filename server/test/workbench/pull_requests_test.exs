defmodule Workbench.PullRequestsTest do
  use Workbench.ThreadCase
  alias Workbench.{Projects, PullRequests, Review}

  @commit ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m"]

  # An "origin" with a PR the way GitHub keeps one (refs/pull/7/head), and a
  # clone of it as the project.
  setup %{dir: dir} do
    origin = git_repo(dir)
    git!(origin, ["checkout", "-q", "-b", "feature"])
    File.write!(Path.join(origin, "feature.txt"), "new\n")
    git!(origin, ["add", "-A"])
    git!(origin, @commit ++ ["feature"])
    head = git!(origin, ["rev-parse", "HEAD"])
    git!(origin, ["update-ref", "refs/pull/7/head", head])
    git!(origin, ["checkout", "-q", "main"])
    git!(origin, ["branch", "-D", "feature"])
    # main moves on after the PR was opened
    File.write!(Path.join(origin, "later.txt"), "later\n")
    git!(origin, ["add", "-A"])
    git!(origin, @commit ++ ["later on main"])

    clone = Path.join(dir, "clone")
    {_, 0} = System.cmd("git", ["clone", "-q", origin, clone])
    {:ok, p} = Projects.add(clone)
    {:ok, p: p, head: head}
  end

  defp pr(attrs \\ %{}) do
    Map.merge(
      %{
        "number" => 7,
        "title" => "Add the feature",
        "url" => "https://github.com/acme/app/pull/7",
        "state" => "OPEN",
        "author" => %{"login" => "octo"},
        "headRefName" => "feature",
        "baseRefName" => "main",
        "body" => "Adds a file."
      },
      attrs
    )
  end

  test "open checks the PR's head out in its own worktree, compared against the base", %{p: p, head: head} do
    assert {:ok, t} = PullRequests.open(p, "acme/app", pr(%{"headRefOid" => head}), "fake")

    assert t.pr_number == 7
    assert t.pr_url == "https://github.com/acme/app/pull/7"
    assert t.title == "#7 Add the feature"
    assert t.branch =~ ~r"^wb/pr-7-add-the-feature-[0-9a-f]{6}$"
    assert t.base_ref == "origin/main"
    assert git!(t.worktree_path, ["rev-parse", "HEAD"]) == head
    assert t.initial_context =~ "Reviewing pull request #7 in acme/app: Add the feature"
    assert t.initial_context =~ "Author: @octo · Branch: feature into main"
    assert t.initial_context =~ "## Description\n\nAdds a file."

    # only what the PR changed, not what main did since
    {:ok, d} = Review.diff(Threads.get(t.id), summary: true)
    assert Enum.map(d.files, & &1.path) == ["feature.txt"]
  end

  test "a merged PR compares against the base as it was before the merge", %{p: p, head: head, dir: dir} do
    origin = Path.join(dir, "repo")
    before = git!(origin, ["rev-parse", "HEAD"])
    git!(origin, ["-c", "user.name=t", "-c", "user.email=t@t", "merge", "-q", "--no-ff", "-m", "merge #7", head])
    merge = git!(origin, ["rev-parse", "HEAD"])

    assert {:ok, t} = PullRequests.open(p, "acme/app", pr(%{"headRefOid" => head, "state" => "MERGED", "mergeCommit" => %{"oid" => merge}}), "fake")
    assert String.starts_with?(before, t.base_ref)
    {:ok, d} = Review.diff(Threads.get(t.id), summary: true)
    assert Enum.map(d.files, & &1.path) == ["feature.txt"]
  end

  test "without a head sha it starts from the fetched pull ref", %{p: p, head: head} do
    assert {:ok, t} = PullRequests.open(p, "acme/app", pr(), "fake")
    assert git!(t.worktree_path, ["rev-parse", "HEAD"]) == head
  end

  test "a PR that isn't on origin is an error", %{p: p} do
    assert {:error, "could not fetch the pull request: " <> _} = PullRequests.open(p, "acme/app", pr(%{"number" => 99}), "fake")
  end

  test "reviewing a PR that has a workspace returns it", %{p: p, head: head} do
    {:ok, t} = PullRequests.open(p, "acme/app", pr(%{"headRefOid" => head}), "fake")
    assert {:ok, same} = PullRequests.review(p.id, 7)
    assert same.id == t.id
  end

  test "search_args: author and review filters become a GitHub search" do
    assert PullRequests.search_args(%{}) == []
    assert PullRequests.search_args(%{"author" => "me"}) == ["--search", "author:@me"]
    assert PullRequests.search_args(%{"author" => "octo-cat", "review" => "requested"}) == ["--search", "author:octo-cat review-requested:@me"]
    assert PullRequests.search_args(%{"author" => "x y:z", "review" => "bogus"}) == []
  end

  test "repo_slug reads github.com remotes" do
    assert PullRequests.repo_slug("git@github.com:acme/app.git") == {:ok, "acme/app"}
    assert PullRequests.repo_slug("https://github.com/acme/app") == {:ok, "acme/app"}
    assert PullRequests.repo_slug("ssh://git@github.com/acme/app.git\n") == {:ok, "acme/app"}
    assert PullRequests.repo_slug("git@gitlab.com:acme/app.git") == nil
  end
end
