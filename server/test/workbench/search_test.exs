defmodule Workbench.SearchTest do
  use Workbench.ThreadCase
  alias Workbench.Search

  defp write(root, path, content) do
    File.mkdir_p!(Path.dirname(Path.join(root, path)))
    File.write!(Path.join(root, path), content)
  end

  defp paths(%{files: files}), do: Enum.map(files, & &1.path)

  test "matches grouped by file, every match on a line ranged, ignored files left out", %{dir: dir} do
    repo = git_repo(dir)
    write(repo, ".gitignore", "*.log\n")
    write(repo, "lib/a.ex", "foo = 1\nbar = foo + Foo\n")
    write(repo, "lib/b.ex", "nothing here\n")
    write(repo, "debug.log", "foo\n")

    assert {:ok, %{files: [%{path: "lib/a.ex", matches: [m1, m2]}], total: 2, truncated: false}} = Search.search(repo, "foo")
    assert %{line: 1, col: 1, text: "foo = 1", ranges: [[0, 3]]} = m1
    # case-insensitive by default
    assert %{line: 2, col: 7, ranges: [[6, 9], [12, 15]]} = m2

    assert {:ok, %{total: 1}} = Search.search(repo, "Foo", %{"case_sensitive" => true})
  end

  test "whole word, regex, and a bad regex", %{dir: dir} do
    repo = git_repo(dir)
    write(repo, "x.txt", "cat catalog\nconcat\n")

    assert {:ok, %{total: 1, files: [%{matches: [%{ranges: [[0, 3]]}]}]}} = Search.search(repo, "cat", %{"whole_word" => true})
    assert {:ok, %{total: 2, files: [%{matches: [%{ranges: [[0, 3]]}, _]}]}} = Search.search(repo, "c\\w*t\\b", %{"regex" => true})
    assert {:ok, %{total: 1}} = Search.search(repo, "^con", %{"regex" => true})
    assert {:error, "Invalid regular expression" <> _} = Search.search(repo, "(", %{"regex" => true})
    # without regex, special characters are literal
    assert {:ok, %{total: 0}} = Search.search(repo, "c.t")
  end

  test "include and exclude globs", %{dir: dir} do
    repo = git_repo(dir)
    write(repo, "src/a.ts", "needle\n")
    write(repo, "src/deep/b.ts", "needle\n")
    write(repo, "docs/c.md", "needle\n")

    assert {:ok, r} = Search.search(repo, "needle", %{"include" => "*.ts"})
    assert paths(r) == ["src/a.ts", "src/deep/b.ts"]
    assert {:ok, r} = Search.search(repo, "needle", %{"include" => "src", "exclude" => "deep"})
    assert paths(r) == ["src/a.ts"]
    assert {:ok, r} = Search.search(repo, "needle", %{"exclude" => "src/**, "})
    assert paths(r) == ["docs/c.md"]
  end

  test "long lines are cut around the match; offsets count UTF-16 units", %{dir: dir} do
    repo = git_repo(dir)
    write(repo, "min.js", String.duplicate("a", 500) <> "needle" <> String.duplicate("b", 500) <> "\n")
    write(repo, "emoji.txt", "😀 é needle\n")

    assert {:ok, %{files: [%{path: "emoji.txt", matches: [e]}, %{path: "min.js", matches: [m]}]}} = Search.search(repo, "needle")
    # 😀 is two UTF-16 units, é one
    assert %{col: 6, ranges: [[5, 11]]} = e
    assert %{col: 501, cut_left: true, cut_right: true, ranges: [[40, 46]]} = m
    assert String.length(m.text) == 240
  end

  test "outside git: searches the directory, skipping build folders", %{dir: dir} do
    write(dir, "src/main.go", "needle\n")
    write(dir, "node_modules/x/i.js", "needle\n")
    assert {:ok, r} = Search.search(dir, "needle")
    assert paths(r) == ["src/main.go"]
  end

  test "empty query", %{dir: dir} do
    assert {:ok, %{files: [], total: 0}} = Search.search(dir, "")
  end
end
