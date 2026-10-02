defmodule Workbench.ClaudeFromPathTest do
  # The macOS app ships without Claude Code and asks for the installed `claude` (WB_CLAUDE_FROM_PATH=1).
  use ExUnit.Case, async: false

  setup do
    old = Map.new(~w(PATH WB_CLAUDE_BIN WB_CLAUDE_FROM_PATH), &{&1, System.get_env(&1)})

    on_exit(fn ->
      Enum.each(old, fn
        {k, nil} -> System.delete_env(k)
        {k, v} -> System.put_env(k, v)
      end)
    end)

    System.delete_env("WB_CLAUDE_BIN")
    System.put_env("WB_CLAUDE_FROM_PATH", "1")
  end

  test "says how to install Claude Code when `claude` is not on PATH" do
    empty = Path.join(System.tmp_dir!(), "wb-empty-path-#{System.unique_integer([:positive])}")
    File.mkdir_p!(empty)
    System.put_env("PATH", empty)

    assert {:error, msg} = Workbench.Provider.Claude.open(%{cwd: empty, mode: "default"})
    assert msg =~ "claude not found on PATH"
    assert msg =~ "Install Claude Code"
  end
end
