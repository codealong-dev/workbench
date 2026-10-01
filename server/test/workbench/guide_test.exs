defmodule Workbench.GuideTest do
  use Workbench.ThreadCase
  alias Workbench.{Guide, Projects, Settings}

  @paths ["lib/a.ex", "lib/b.ex", "test/a_test.exs"]

  describe "parse/2" do
    test "reads the JSON out of fences and prose" do
      reply = """
      Here you go:
      ```json
      {"summary": "S", "groups": [{"title": "Core", "summary": "Why", "files": ["lib/a.ex", "lib/b.ex"]}, {"title": "Tests", "summary": "", "files": ["test/a_test.exs"]}]}
      ```
      """

      assert {:ok, %{"summary" => "S", "groups" => [core, tests]}} = Guide.parse(reply, @paths)
      assert core == %{"title" => "Core", "summary" => "Why", "files" => ["lib/a.ex", "lib/b.ex"]}
      assert tests == %{"title" => "Tests", "summary" => nil, "files" => ["test/a_test.exs"]}
    end

    test "drops unknown paths, places each file once, collects the missing ones last" do
      raw = %{
        "groups" => [
          %{"title" => "One", "files" => ["lib/a.ex", "nope.ex", "lib/a.ex"]},
          %{"title" => "Dup", "files" => ["lib/a.ex"]},
          %{"title" => "Junk", "files" => "lib/b.ex"},
          %{"title" => "Empty", "files" => []}
        ]
      }

      assert {:ok, %{"groups" => [one, other]}} = Guide.normalize(raw, @paths)
      assert one["files"] == ["lib/a.ex"]
      assert other == %{"title" => "Other changes", "summary" => nil, "files" => ["lib/b.ex", "test/a_test.exs"]}
    end

    test "errors when there is nothing usable" do
      assert {:error, "the agent's answer wasn't a guide (no JSON)"} = Guide.parse("sorry, no", @paths)
      assert {:error, "the agent's guide had no usable groups"} = Guide.normalize(%{"groups" => [%{"title" => "x", "files" => ["nope"]}]}, @paths)
      assert {:error, _} = Guide.normalize(%{"summary" => "x"}, @paths)
    end

    test "clips long titles and summaries" do
      raw = %{"groups" => [%{"title" => String.duplicate("t", 500), "summary" => String.duplicate("s", 5000), "files" => ["lib/a.ex"]}]}
      assert {:ok, %{"groups" => [g | _]}} = Guide.normalize(raw, @paths)
      assert String.length(g["title"]) == 80
      assert String.length(g["summary"]) == 600
    end
  end

  describe "prompt/2" do
    defp file(path, extra \\ %{}), do: Map.merge(%{path: path, old_path: nil, status: "modified", additions: 2, deletions: 1, binary: false}, extra)

    test "lists the files and includes the patch when it fits" do
      patch = "diff --git a/lib/a.ex b/lib/a.ex\n--- a/lib/a.ex\n+++ b/lib/a.ex\n@@ -1 +1 @@\n-x\n+y\n"
      text = Guide.prompt("Group it.", %{base: "main", files: [file("lib/a.ex"), file("new.ex", %{old_path: "old.ex", status: "renamed"})], patch: patch})

      assert text =~ "Group it."
      assert text =~ "[workbench-guide]"
      assert text =~ "against `main`"
      assert text =~ "- lib/a.ex (modified, +2 -1)"
      assert text =~ "- new.ex (renamed from old.ex, +2 -1, patch not included)"
      assert text =~ "+y"
    end

    test "leaves out the files that don't fit the budget, whole" do
      big = String.duplicate("+line\n", 40_000)
      patch = "diff --git a/small.ex b/small.ex\n@@ -1 +1 @@\n+x\n" <> "diff --git a/big.ex b/big.ex\n@@ -1 +1 @@\n" <> big
      text = Guide.prompt("Group it.", %{base: "HEAD", files: [file("small.ex"), file("big.ex")], patch: patch})

      assert text =~ "uncommitted"
      assert text =~ "- small.ex (modified, +2 -1)"
      assert text =~ "- big.ex (modified, +2 -1, patch not included)"
      refute text =~ big
    end

    test "without a patch (too large) lists every file as not included" do
      text = Guide.prompt("Group it.", %{base: "main", files: [file("a.ex")], patch: nil})
      assert text =~ "patch not included"
      refute text =~ "Patch:"
    end
  end

  test "fingerprint changes with the changes, not their order" do
    a = file("a.ex")
    b = file("b.ex")
    assert Guide.fingerprint([a, b]) == Guide.fingerprint([b, a])
    refute Guide.fingerprint([a, b]) == Guide.fingerprint([a, file("b.ex", %{additions: 3})])
  end

  describe "generate/1 with the fake agent" do
    setup %{dir: dir} do
      repo = git_repo(dir)
      {:ok, p} = Projects.add(repo)
      {:ok, t} = Threads.create(%{project_id: p.id, provider: "fake", title: "guide"})
      {:ok, _} = Settings.put("guide", %{"provider" => "fake", "model" => nil, "effort" => nil, "prompt" => "Group it."})
      Guide.subscribe(t.id)
      {:ok, t: t}
    end

    defp changes(t, files) do
      for {name, body} <- files, do: File.write!(Path.join(t.worktree_path, name), body)
    end

    test "writes, stores and flags the guide stale when the changes move on", %{t: t} do
      assert %{guide: nil, state: %{"status" => "idle"}, stale: false} = Guide.view(t.id)

      changes(t, [{"a.txt", "a\n"}, {"b.txt", "b\n"}, {"c.txt", "c\n"}])
      assert :ok = Guide.generate(t.id)
      assert_receive {:guide, _}
      assert %{state: %{"status" => "generating", "started_at" => started}} = Guide.view(t.id)
      assert is_integer(started)
      # asking again while one is running is a no-op
      assert :ok = Guide.generate(t.id)

      assert_receive {:guide, _}, 5_000
      assert %{guide: guide, state: %{"status" => "idle"}, stale: false} = Guide.view(t.id)
      assert [%{"title" => "Core changes", "files" => core}, %{"title" => "Supporting changes", "files" => rest}] = guide["groups"]
      assert Enum.sort(core ++ rest) == ["a.txt", "b.txt", "c.txt"]
      assert guide["provider"] == "fake"
      assert guide["generated_at"]

      changes(t, [{"d.txt", "d\n"}])
      assert %{guide: ^guide, stale: true} = Guide.view(t.id)
    end

    test "no changes: an error, nothing stored", %{t: t} do
      assert :ok = Guide.generate(t.id)
      assert_receive {:guide, _}
      assert_receive {:guide, _}, 5_000
      assert %{guide: nil, state: %{"status" => "error", "message" => "There are no changes to write a guide for."}} = Guide.view(t.id)

      # the next run clears the error
      changes(t, [{"a.txt", "a\n"}])
      assert :ok = Guide.generate(t.id)
      assert_receive {:guide, _}
      assert %{state: %{"status" => "generating"}} = Guide.view(t.id)
      Guide.cancel(t.id)
    end

    test "cancel stops the run", %{t: t} do
      changes(t, [{"a.txt", "a\n"}])
      assert :ok = Guide.generate(t.id)
      assert_receive {:guide, _}
      assert :ok = Guide.cancel(t.id)
      assert_receive {:guide, _}
      assert %{guide: nil, state: %{"status" => "idle"}} = Guide.view(t.id)
      refute_receive {:guide, _}, 800
      assert %{guide: nil} = Guide.view(t.id)
    end
  end
end
