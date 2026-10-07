defmodule Workbench.UsageTest do
  use ExUnit.Case, async: false
  alias Workbench.Usage

  @stub Path.expand("../support/stubs/codex_app_server_stub.js", __DIR__)

  setup do
    bin = System.get_env("WB_CODEX_BIN")
    cached = Usage.get("codex")
    System.put_env("WB_CODEX_BIN", @stub)
    :persistent_term.erase({Usage, "codex"})
    on_exit(fn ->
      if bin, do: System.put_env("WB_CODEX_BIN", bin), else: System.delete_env("WB_CODEX_BIN")
      if cached, do: :persistent_term.put({Usage, "codex"}, cached), else: :persistent_term.erase({Usage, "codex"})
    end)
    :ok
  end

  test "an account probe reports and caches Codex limits without a chat" do
    Usage.subscribe()
    assert {:ok, %{"plan" => "plus", "windows" => [%{"used_pct" => 35}, %{"used_pct" => 12}]} = usage} = Usage.list("codex")
    assert_receive {:usage, "codex", ^usage}
    assert {^usage, at} = Usage.get("codex")
    assert {:ok, ^usage} = Usage.list("codex")
    assert {^usage, ^at} = Usage.get("codex")
    refute_receive {:usage, "codex", _}, 100
  end

  test "expired readings refresh and a failed refresh preserves the last good reading" do
    old = %{"plan" => "plus", "windows" => []}
    :persistent_term.put({Usage, "codex"}, {old, System.system_time(:millisecond) - 61_000})
    assert Usage.stale?("codex")
    assert {:ok, usage} = Usage.list("codex")
    refute usage == old
    refute Usage.stale?("codex")
    cached = Usage.get("codex")
    System.put_env("WB_CODEX_BIN", "/definitely/not/here")
    assert {:error, "codex not found at " <> _} = Usage.list("codex", true)
    assert Usage.get("codex") == cached
  end
end
