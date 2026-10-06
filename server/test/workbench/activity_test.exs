defmodule Workbench.ActivityTest do
  use ExUnit.Case, async: true
  alias Workbench.Activity

  test "tool calls say what they do" do
    assert Activity.tool("Bash", %{"command" => "mix test\nsecond line"}) == "Running mix test"
    assert Activity.tool("Read", %{"file_path" => "/a/b/router.ex"}) == "Reading router.ex"
    assert Activity.tool("Edit", %{"file_path" => "/a/b.ts"}) == "Editing b.ts"
    assert Activity.tool("Patch", %{"changes" => [%{"path" => "a/x.ex"}, %{"path" => "a/y.ex"}]}) == "Editing x.ex and 1 more"
    assert Activity.tool("Grep", %{"pattern" => "TODO"}) == "Searching for TODO"
    assert Activity.tool("mcp__linear__get_issue", %{}) == "Calling linear get_issue"
    assert Activity.tool("Whatever", nil) == "Whatever"
  end

  test "long lines are cut" do
    assert String.length(Activity.tool("Bash", %{"command" => String.duplicate("x", 500)})) == 140
  end

  test "approvals name the tool" do
    assert Activity.approval("Bash", %{"command" => "rm -rf tmp"}) == "Needs approval: Bash rm -rf tmp"
    assert Activity.approval("Edit", %{"file_path" => "a.ts"}) == "Needs approval: Editing a.ts"
  end

  test "a message is reduced to its last line, without code blocks" do
    assert Activity.message("First.\n\nTypecheck passes. Pulling on the login route next.\n") == "Typecheck passes. Pulling on the login route next."
    assert Activity.message("Done:\n- one\n- two") == "two"
    assert Activity.message("Here is what I'd run:\n\n```bash\nls -la\n```\n") == "Here is what I'd run:"
    assert Activity.message("   ") == nil
    assert Activity.message(nil) == nil
  end
end
