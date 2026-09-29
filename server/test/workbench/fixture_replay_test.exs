defmodule Workbench.FixtureReplayTest do
  use Workbench.ThreadCase

  @fixture Path.expand("../../../fixtures/claude-approval.jsonl", __DIR__)

  setup do
    Application.put_env(:workbench, :fake_script, @fixture)
    on_exit(fn -> Application.delete_env(:workbench, :fake_script) end)
  end

  test "a recorded Claude turn replays through the server, approval included", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "anything")

    [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
    :ok = Threads.respond(t.id, req["request_id"], "allow")
    collect_until(type?("turn.completed"))

    kinds = Items.last(t.id) |> Enum.map(& &1["kind"])
    assert kinds == ~w(user_message tool assistant_message turn)
    assert [%{"name" => "Bash", "status" => "done", "output" => "made"}] = Items.last(t.id) |> Enum.filter(&(&1["kind"] == "tool"))
  end
end
