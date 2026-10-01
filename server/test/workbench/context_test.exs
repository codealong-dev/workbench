defmodule Workbench.ContextTest do
  use Workbench.ThreadCase

  test "saving from any session updates the root, existing sessions, and future agents", %{dir: dir} do
    root = create_thread(dir, %{initial_context: "Original task"})
    {:ok, child} = Threads.create(%{parent_id: root.id, provider: "fake"})
    Threads.snapshot(child.id)
    Threads.subscribe_lobby()
    {:ok, old} = Threads.context(child.id)
    content = "Original task\nAdditional requirements\nhttps://notion.so/spec"

    assert {:ok, saved} = Threads.write_context(child.id, content, old.hash)
    assert saved.content == content
    refute saved.hash == old.hash
    assert {:ok, ^saved} = Threads.context(root.id)
    assert Threads.get(root.id).initial_context == content
    assert Threads.get(child.id).initial_context == content
    assert Threads.snapshot(child.id).thread.initial_context == content
    assert_receive {:thread_upserted, %{id: root_id, initial_context: ^content}}
    assert root_id == root.id
    assert_receive {:thread_upserted, %{id: child_id, initial_context: ^content}}
    assert child_id == child.id

    {:ok, next} = Threads.create(%{parent_id: child.id, provider: "codex"})
    assert next.initial_context == content
    assert Items.last(root.id) == []
    assert Items.last(child.id) == []
  end

  test "stale saves return the saved context without overwriting it; context can be cleared", %{dir: dir} do
    root = create_thread(dir)
    {:ok, child} = Threads.create(%{parent_id: root.id, provider: "fake"})
    {:ok, original} = Threads.context(root.id)
    assert original.content == ""
    assert {:ok, saved} = Threads.write_context(root.id, "New requirements", original.hash)
    assert {:error, {:conflict, ^saved}} = Threads.write_context(child.id, "Stale requirements", original.hash)
    assert {:ok, ^saved} = Threads.context(child.id)
    assert {:ok, cleared} = Threads.write_context(root.id, "", saved.hash)
    assert cleared == original
    assert Threads.get(child.id).initial_context == nil
    assert {:error, :not_found} = Threads.context(Ecto.UUID.generate())
  end
end
