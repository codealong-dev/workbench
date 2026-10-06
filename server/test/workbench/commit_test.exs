defmodule Workbench.CommitTest do
  use Workbench.ThreadCase
  alias Workbench.{Commit, Projects, Settings}

  setup %{dir: dir} do
    repo = git_repo(dir)
    File.write!(Path.join(repo, "a.txt"), "one\n")
    git!(repo, ["add", "-A"])
    git!(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "feat: files"])
    {:ok, p} = Projects.add(repo)
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", title: "commit"})
    {:ok, repo: repo, t: Threads.get(t.id)}
  end

  defp edit(t, name, body), do: File.write!(Path.join(t.worktree_path, name), body)

  describe "config/1" do
    test "defaults to a small model per agent, overridable in settings" do
      assert %{"provider" => "claude", "model" => "haiku"} = Commit.config(%{provider: "claude"})
      assert %{"provider" => "codex", "model" => "gpt-5.1-codex-mini"} = Commit.config(%{provider: "codex"})

      assert {:ok, %{"commit" => %{"models" => %{"claude" => "sonnet"}}}} = Settings.put("commit", %{"models" => %{"claude" => "sonnet"}})
      assert %{"model" => "sonnet"} = Commit.config(%{provider: "claude"})
      assert %{"model" => "gpt-5.1-codex-mini"} = Commit.config(%{provider: "codex"})
    end

    test "settings are validated and can be forgotten" do
      assert {:error, "commit: unknown agent"} = Settings.put("commit", %{"models" => %{"gemini" => "x"}})
      assert {:error, "commit: models must be model ids"} = Settings.put("commit", %{"models" => %{"claude" => ""}})
      assert {:error, "commit: unknown field"} = Settings.put("commit", %{"models" => %{}, "x" => 1})
      assert {:ok, %{"commit" => nil}} = Settings.put("commit", nil)
    end
  end

  test "status lists what is uncommitted", %{t: t} do
    assert {:ok, %{uncommitted: [], remote: nil, upstream: nil, branch: branch}} = Commit.status(t)
    assert branch == t.branch

    edit(t, "a.txt", "one\ntwo\n")
    edit(t, "new.txt", "n\n")
    assert {:ok, %{uncommitted: files}} = Commit.status(t)
    assert Enum.sort_by(files, & &1.path) == [%{path: "a.txt", status: "modified"}, %{path: "new.txt", status: "untracked"}]
  end

  test "suggest asks the agent, and refuses with nothing to commit", %{t: t} do
    assert {:error, "There is nothing to commit."} = Commit.suggest(t)
    edit(t, "new.txt", "n\n")
    assert {:ok, "Update new.txt"} = Commit.suggest(t)
  end

  test "clean keeps the first line of a reply" do
    assert {:ok, "Fix the thing"} = Commit.clean("```\n\"Fix the thing.\"\n```\nBecause.")
    assert {:ok, "feat: x"} = Commit.clean("`feat: x`")
    assert {:error, _} = Commit.clean("  \n ")
  end

  test "commit stages everything and commits it", %{t: t} do
    assert {:error, "write a commit title"} = Commit.commit(t, "  ")
    assert {:error, "There is nothing to commit."} = Commit.commit(t, "x")

    edit(t, "a.txt", "one\ntwo\n")
    edit(t, "new.txt", "n\n")
    git!(t.worktree_path, ["config", "user.name", "t"])
    git!(t.worktree_path, ["config", "user.email", "t@t"])
    assert {:ok, %{sha: sha, title: "Add things"}} = Commit.commit(t, " Add things ")
    assert git!(t.worktree_path, ["log", "-1", "--format=%H %s"]) =~ "#{sha} Add things"
    assert {:ok, %{uncommitted: []}} = Commit.status(t)
  end

  test "graph shows the branch, its parent commits and what is unpushed", %{dir: dir, repo: repo, t: t} do
    wt = t.worktree_path
    git!(wt, ["config", "user.name", "t"])
    git!(wt, ["config", "user.email", "t@t"])
    edit(t, "x.txt", "x\n")
    assert {:ok, _} = Commit.commit(t, "On the branch")

    assert {:ok, %{head: head, commits: [top, base | _]}} = Commit.graph(t)
    assert top.sha == head
    assert top.subject == "On the branch"
    assert top.parents == [base.sha]
    assert top.unpushed
    assert t.branch in top.refs
    assert base.subject == "feat: files"

    bare = Path.join(dir, "origin.git")
    {_, 0} = System.cmd("git", ["init", "-q", "--bare", bare])
    git!(repo, ["remote", "add", "origin", bare])
    assert {:ok, _} = Workbench.Review.push(t)

    assert {:ok, %{upstream: upstream, unpushed: 0, remote: ^bare}} = Commit.status(t)
    assert upstream == "origin/#{t.branch}"
    assert {:ok, %{commits: [%{unpushed: false} | _]}} = Commit.graph(t)
  end

  describe "source control" do
    defp paths(files), do: files |> Enum.map(&{&1.path, &1.status}) |> Enum.sort()

    test "changes splits the index from the disk, and a half-staged file is in both", %{t: t} do
      edit(t, "a.txt", "one\ntwo\n")
      edit(t, "new.txt", "n\n")
      git!(t.worktree_path, ["add", "a.txt"])
      edit(t, "a.txt", "one\ntwo\nthree\n")

      assert {:ok, %{staged: staged, unstaged: unstaged}} = Commit.changes(t)
      assert paths(staged) == [{"a.txt", "modified"}]
      assert paths(unstaged) == [{"a.txt", "modified"}, {"new.txt", "untracked"}]
    end

    test "stage and unstage one file or all of them", %{t: t} do
      edit(t, "a.txt", "changed\n")
      edit(t, "new.txt", "n\n")

      assert {:ok, %{staged: [%{path: "new.txt", status: "added"}], unstaged: [%{path: "a.txt"}]}} = Commit.stage(t, ["new.txt"])
      assert {:ok, %{staged: staged, unstaged: []}} = Commit.stage(t, nil)
      assert paths(staged) == [{"a.txt", "modified"}, {"new.txt", "added"}]

      assert {:ok, %{staged: [%{path: "a.txt"}], unstaged: [%{path: "new.txt", status: "untracked"}]}} = Commit.unstage(t, ["new.txt"])
      assert {:ok, %{staged: [], unstaged: unstaged}} = Commit.unstage(t, nil)
      assert paths(unstaged) == [{"a.txt", "modified"}, {"new.txt", "untracked"}]
    end

    test "deleted and renamed files stage and unstage", %{t: t} do
      File.rm!(Path.join(t.worktree_path, "a.txt"))
      assert {:ok, %{staged: [%{path: "a.txt", status: "deleted"}], unstaged: []}} = Commit.stage(t, ["a.txt"])
      assert {:ok, %{staged: [], unstaged: [%{path: "a.txt", status: "deleted"}]}} = Commit.unstage(t, ["a.txt"])

      git!(t.worktree_path, ["checkout", "--", "a.txt"])
      git!(t.worktree_path, ["mv", "a.txt", "b.txt"])
      assert {:ok, %{staged: [%{path: "b.txt", old_path: "a.txt", status: "renamed"}]}} = Commit.changes(t)
      assert {:ok, %{staged: [], unstaged: unstaged}} = Commit.unstage(t, ["b.txt"])
      assert paths(unstaged) == [{"a.txt", "deleted"}, {"b.txt", "untracked"}]
    end

    test "discard restores tracked files, deletes untracked ones and keeps what is staged", %{t: t} do
      edit(t, "a.txt", "staged\n")
      git!(t.worktree_path, ["add", "a.txt"])
      edit(t, "a.txt", "staged\nand more\n")
      edit(t, "new.txt", "n\n")

      assert {:ok, %{staged: [%{path: "a.txt"}], unstaged: []}} = Commit.discard(t, nil)
      assert File.read!(Path.join(t.worktree_path, "a.txt")) == "staged\n"
      refute File.exists?(Path.join(t.worktree_path, "new.txt"))
    end

    test "paths outside the worktree or that look like options are refused", %{t: t, dir: dir} do
      File.write!(Path.join(dir, "outside.txt"), "x")
      for op <- [&Commit.stage/2, &Commit.unstage/2, &Commit.discard/2], bad <- ["../outside.txt", "/etc/passwd", "", [1]] do
        assert {:error, "path is outside the worktree"} = op.(t, [bad])
      end

      assert {:error, _} = Commit.stage(t, "a.txt")
      edit(t, "-n", "x\n")
      assert {:ok, %{staged: [%{path: "-n"}]}} = Commit.stage(t, ["-n"])
    end

    test "a staged commit leaves the other edits alone; with nothing staged it takes everything", %{t: t} do
      edit(t, "a.txt", "changed\n")
      edit(t, "new.txt", "n\n")
      Commit.stage(t, ["new.txt"])

      assert {:ok, %{title: "add new"}} = Commit.commit(t, "add new", staged: true)
      assert {:ok, %{staged: [], unstaged: [%{path: "a.txt"}]}} = Commit.changes(t)
      assert git!(t.worktree_path, ["show", "--name-only", "--format=", "HEAD"]) == "new.txt"

      assert {:ok, _} = Commit.commit(t, "the rest", staged: true)
      assert {:ok, %{staged: [], unstaged: []}} = Commit.changes(t)
    end

    test "suggest looks at the index only when something is staged", %{t: t} do
      edit(t, "a.txt", "changed\n")
      edit(t, "new.txt", "n\n")
      Commit.stage(t, ["new.txt"])
      assert {:ok, "Update new.txt"} = Commit.suggest(t, staged: true)
    end
  end
end
