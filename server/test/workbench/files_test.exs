defmodule Workbench.FilesTest do
  use Workbench.ThreadCase
  alias Workbench.Files

  test "list: tracked and untracked files, ignored ones left out", %{dir: dir} do
    repo = git_repo(dir)
    File.write!(Path.join(repo, ".gitignore"), "*.log\n")
    File.mkdir_p!(Path.join(repo, "lib/deep"))
    File.write!(Path.join(repo, "lib/deep/a.ex"), "defmodule A, do: nil\n")
    File.write!(Path.join(repo, "debug.log"), "noise")
    File.rm!(Path.join(repo, "README.md"))

    assert {:ok, %{files: files, truncated: false}} = Files.list(repo)
    assert ".gitignore" in files
    assert "lib/deep/a.ex" in files
    refute "debug.log" in files
    # deleted but still in the index
    refute "README.md" in files
    assert files == Enum.sort(files)
  end

  test "list: outside git, walks the directory and skips build folders", %{dir: dir} do
    File.mkdir_p!(Path.join(dir, "src"))
    File.mkdir_p!(Path.join(dir, "node_modules/x"))
    File.write!(Path.join(dir, "src/main.go"), "package main\n")
    File.write!(Path.join(dir, "node_modules/x/i.js"), "")
    assert {:ok, %{files: ["src/main.go"]}} = Files.list(dir)
  end

  test "read: text, binary, missing, and paths that leave the worktree", %{dir: dir} do
    File.write!(Path.join(dir, "a.txt"), "héllo\n")
    File.write!(Path.join(dir, "img.bin"), <<137, 80, 78, 71, 0, 1, 2>>)
    outside = Path.join(System.tmp_dir!(), "wb-outside-#{System.unique_integer([:positive])}")
    File.write!(outside, "secret")
    on_exit(fn -> File.rm(outside) end)
    File.ln_s!(outside, Path.join(dir, "link"))

    assert {:ok, %{path: "a.txt", content: "héllo\n", binary: false, truncated: false, size: 7}} = Files.read(dir, "a.txt")
    assert {:ok, %{content: nil, binary: true}} = Files.read(dir, "img.bin")
    assert {:error, "nope.txt does not exist"} = Files.read(dir, "nope.txt")
    assert {:error, "path is outside the worktree"} = Files.read(dir, "../etc/passwd")
    assert {:error, "path is outside the worktree"} = Files.read(dir, "/etc/passwd")
    assert {:error, "path is outside the worktree"} = Files.read(dir, "link")
  end

  test "read: big files are cut at 1MB", %{dir: dir} do
    File.write!(Path.join(dir, "big.txt"), String.duplicate("a", 1_200_000))
    assert {:ok, %{truncated: true, size: 1_200_000, content: c}} = Files.read(dir, "big.txt")
    assert byte_size(c) == 1_000_000
  end

  test "write: saves, refuses when the file changed since it was read, overwrite with nil", %{dir: dir} do
    File.write!(Path.join(dir, "a.txt"), "one\n")
    {:ok, %{hash: h1}} = Files.read(dir, "a.txt")
    assert {:ok, %{hash: h2, size: 4}} = Files.write(dir, "a.txt", "two\n", h1)
    assert File.read!(Path.join(dir, "a.txt")) == "two\n"

    # an agent edits it meanwhile
    File.write!(Path.join(dir, "a.txt"), "agent\n")
    assert {:error, {:conflict, %{content: "agent\n", hash: h3}}} = Files.write(dir, "a.txt", "mine\n", h2)
    assert File.read!(Path.join(dir, "a.txt")) == "agent\n"
    assert {:ok, _} = Files.write(dir, "a.txt", "mine\n", h3)
    assert {:ok, _} = Files.write(dir, "new/dir/b.txt", "b", nil)
    assert File.read!(Path.join(dir, "new/dir/b.txt")) == "b"
    assert {:error, "path is outside the worktree"} = Files.write(dir, "../x", "x", nil)
  end

  test "base content: the file at the merge base; new files are empty", %{dir: dir} do
    repo = git_repo(dir)
    git!(repo, ["checkout", "-q", "-b", "feature"])
    File.write!(Path.join(repo, "README.md"), "changed\n")
    File.write!(Path.join(repo, "new.txt"), "n\n")
    t = %Workbench.Threads.Thread{worktree_path: repo, base_ref: "main"}
    assert {:ok, %{content: base, exists: true, base: "main"}} = Workbench.Review.base_content(t, "README.md")
    assert base == git!(repo, ["show", "main:README.md"]) <> "\n" or base =~ "repo"
    assert {:ok, %{content: "", exists: false}} = Workbench.Review.base_content(t, "new.txt")
    assert {:error, _} = Workbench.Review.base_content(t, "../etc/passwd")
  end

  test "watcher: subscribers hear about changed files, not ignored ones", %{dir: dir} do
    File.mkdir_p!(Path.join(dir, "node_modules"))
    :ok = Workbench.Watcher.subscribe(dir)
    Process.sleep(250)
    File.write!(Path.join(dir, "node_modules/x.js"), "x")
    File.write!(Path.join(dir, "watched.txt"), "hi")
    assert_receive {:files_changed, ^dir, paths}, 3_000
    assert "watched.txt" in paths
    refute Enum.any?(paths, &String.starts_with?(&1, "node_modules"))
  end
end
