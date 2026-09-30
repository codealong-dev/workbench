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
end
