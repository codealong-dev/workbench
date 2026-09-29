defmodule Workbench.ReviewTest do
  use Workbench.ThreadCase
  alias Workbench.{Projects, Review}

  setup %{dir: dir} do
    repo = git_repo(dir)
    File.write!(Path.join(repo, "a.txt"), "one\ntwo\nthree\n")
    File.write!(Path.join(repo, "old_name.txt"), "rename me\nkeep this\nand this\n")
    File.write!(Path.join(repo, "gone.txt"), "bye\n")
    git!(repo, ["add", "-A"])
    git!(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "files"])
    {:ok, p} = Projects.add(repo)
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", title: "review"})
    {:ok, repo: repo, t: t}
  end

  test "diff covers commits, uncommitted edits, renames, deletes and untracked files", %{t: t} do
    wt = t.worktree_path
    # committed on the thread branch
    File.write!(Path.join(wt, "committed.txt"), "c1\nc2\n")
    git!(wt, ["add", "committed.txt"])
    git!(wt, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "on branch"])
    # uncommitted
    File.write!(Path.join(wt, "a.txt"), "one\nTWO\nthree\nfour\n")
    git!(wt, ["mv", "old_name.txt", "new_name.txt"])
    File.rm!(Path.join(wt, "gone.txt"))
    File.mkdir_p!(Path.join(wt, "src"))
    File.write!(Path.join(wt, "src/new.ex"), "defmodule New do\nend\n")
    File.write!(Path.join(wt, "blob.bin"), <<0, 1, 2, 3>>)

    {:ok, d} = Review.diff(Threads.get(t.id))
    assert d.base == "main"
    assert d.truncated == false
    by = Map.new(d.files, &{&1.path, &1})

    assert %{status: "modified", additions: 2, deletions: 1} = by["a.txt"]
    assert %{status: "added", additions: 2} = by["committed.txt"]
    assert %{status: "renamed", old_path: "old_name.txt"} = by["new_name.txt"]
    assert %{status: "deleted", deletions: 1} = by["gone.txt"]
    assert %{status: "untracked", additions: 2, binary: false} = by["src/new.ex"]
    assert %{status: "untracked", binary: true} = by["blob.bin"]

    assert d.patch =~ "diff --git a/a.txt b/a.txt"
    assert d.patch =~ "+TWO"
    assert d.patch =~ "+c1"
    assert d.patch =~ "rename from old_name.txt"
    assert d.patch =~ "+defmodule New do"

    {:ok, s} = Review.diff(Threads.get(t.id), summary: true)
    refute Map.has_key?(s, :patch)
    assert length(s.files) == 6

    {:ok, one} = Review.diff(Threads.get(t.id), path: "a.txt")
    assert one.patch =~ "+four"
    refute one.patch =~ "committed.txt"
    {:ok, un} = Review.diff(Threads.get(t.id), path: "src/new.ex")
    assert un.patch =~ "+defmodule New do"
  end

  test "clean worktree has no changes", %{t: t} do
    assert {:ok, %{files: [], patch: ""}} = Review.diff(Threads.get(t.id))
  end

  test "in-repo threads diff against HEAD", %{repo: repo} do
    {:ok, p} = Projects.add(repo)
    {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", isolate: false})
    File.write!(Path.join(repo, "a.txt"), "changed\n")
    {:ok, d} = Review.diff(Threads.get(t.id))
    assert d.base == "HEAD"
    assert [%{path: "a.txt", status: "modified"}] = d.files
  end

  test "missing worktree is an error, not a crash", %{t: t} do
    assert {:error, "worktree " <> _} = Review.diff(%{Threads.get(t.id) | worktree_path: "/nope"})
  end

  test "unknown editor is rejected" do
    assert {:error, "unknown editor" <> _} = Workbench.Editors.open("emacs", "/tmp")
  end
end
