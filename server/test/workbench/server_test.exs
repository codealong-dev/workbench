defmodule Workbench.ServerTest do
  use Workbench.ThreadCase

  test "a turn streams, persists completed items and returns to idle", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)

    assert :ok = Threads.send_message(t.id, "hello **world**")
    events = collect_until(type?("turn.completed"))
    ts = types(events)

    assert "session.started" in ts
    assert "text.delta" in ts
    assert "reasoning.delta" in ts
    assert Enum.count(ts, &(&1 == "item.completed")) == 4
    assert ["tool.started", "tool.completed"] == Enum.filter(ts, &String.starts_with?(&1, "tool."))

    # seq strictly increasing, even across batches
    seqs = Enum.map(events, & &1["seq"])
    assert seqs == Enum.sort(seqs) and seqs == Enum.uniq(seqs)

    # streamed text equals the completed item's text
    [first_msg | _] = for %{"type" => "item.completed", "item" => %{"kind" => "assistant_message"} = i} <- events, do: i
    streamed = for(%{"type" => "text.delta", "item_id" => id, "text" => x} <- events, id == first_msg["id"], do: x) |> Enum.join()
    assert streamed == first_msg["text"]

    assert_receive {:event, %{"type" => "status.changed", "status" => "idle"}}

    kinds = Items.last(t.id) |> Enum.map(& &1["kind"])
    assert kinds == ~w(user_message reasoning assistant_message tool assistant_message turn)
    assert [%{"status" => "done", "output" => "total 3" <> _}] = Items.last(t.id) |> Enum.filter(&(&1["kind"] == "tool"))

    # session id persisted for resume
    assert "fake-" <> _ = Threads.get(t.id).session_id
  end

  test "deltas are batched", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "batch me please with a longer prompt")
    collect_until(type?("turn.completed"))
    # at least one batch arrived (flush_ms is 5 in test, line delay 12ms => mostly 1 per batch,
    # but the reasoning+text deltas never arrive as single :event messages)
    refute_received {:event, %{"type" => "text.delta"}}
  end

  test "send while running is rejected", %{dir: dir} do
    t = create_thread(dir)
    :ok = Threads.send_message(t.id, "one")
    assert {:error, :busy} = Threads.send_message(t.id, "two")
  end

  test "approval round trip", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "please approve this")

    [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
    assert_receive {:event, %{"type" => "status.changed", "status" => "awaiting_approval"}}

    snap = Threads.snapshot(t.id)
    assert [%{"request_id" => rid}] = snap.pending
    assert rid == req["request_id"]

    assert {:error, :unknown_request} = Threads.respond(t.id, "nope", "allow")
    assert :ok = Threads.respond(t.id, rid, "deny")

    events = collect_until(type?("turn.completed"))
    assert [%{"decision" => "deny"}] = Enum.filter(events, &(&1["type"] == "approval.resolved"))
    assert [%{"is_error" => true}] = Enum.filter(events, &(&1["type"] == "tool.completed"))
  end

  test "interrupt ends the turn as interrupted", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "long one")
    collect_until(type?("text.delta"))
    :ok = Threads.interrupt(t.id)
    events = collect_until(type?("turn.completed"))
    assert %{"status" => "interrupted"} = List.last(events)
    assert Threads.snapshot(t.id).status == "idle"
  end

  test "snapshot mid-turn carries live text", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "stream")
    collect_until(type?("text.delta"))
    snap = Threads.snapshot(t.id)
    assert snap.status == "running"
    assert [%{"kind" => _, "text" => text} | _] = snap.live
    assert text != ""
  end

  test "provider death mid-turn sets error; next send respawns and resumes", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "first")
    %{"session_id" => sid} = collect_until(type?("session.started")) |> List.last()
    collect_until(type?("text.delta"))

    %{pstate: %{io: io}} = :sys.get_state(Threads.whereis(t.id))
    Process.exit(io, :kill)
    # the fake's monitor reports :killed

    events = collect_until(&(&1["type"] == "status.changed" and &1["status"] == "error"))
    assert Enum.any?(events, &(&1["type"] == "error" and &1["fatal"]))

    :ok = Threads.send_message(t.id, "again")
    events = collect_until(type?("turn.completed"))
    assert [%{"session_id" => ^sid}] = Enum.filter(events, &(&1["type"] == "session.started"))
  end

  test "server crash restarts idle and reports the lost turn", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "first")
    collect_until(type?("text.delta"))

    pid = Threads.whereis(t.id)
    Process.exit(pid, :kill)
    Process.sleep(50)

    new = Threads.whereis(t.id)
    assert new && new != pid
    events = collect_until(&(&1["type"] == "error"))
    assert List.last(events)["message"] =~ "lost"
    assert Threads.snapshot(t.id).status == "idle"
  end

  test "tool calls cut off by a restart are marked interrupted", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "please approve")
    collect_until(type?("approval.requested"))
    assert [%{"status" => "running"}] = Items.last(t.id) |> Enum.filter(&(&1["kind"] == "tool"))

    Process.exit(Threads.whereis(t.id), :kill)
    Process.sleep(50)
    _ = Threads.snapshot(t.id)
    assert [%{"status" => "done", "is_error" => true}] = Items.last(t.id) |> Enum.filter(&(&1["kind"] == "tool"))
  end

  test "unknown thread id" do
    assert {:error, :not_found} = Threads.ensure_started(Ecto.UUID.generate())
  end

  test "AskUserQuestion: answers reach the provider and come back resolved", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "please ask me something")
    [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
    assert %{"tool" => "AskUserQuestion", "input" => %{"questions" => [%{"id" => q1}, %{"id" => q2, "multiSelect" => true}]}} = req
    assert Threads.snapshot(t.id).status == "awaiting_approval"

    assert {:error, :bad_answers} = Threads.respond(t.id, req["request_id"], "answer", nil)
    answers = %{q1 => ["Word cycling"], q2 => ["Timeline", "Indicator"]}
    :ok = Threads.respond(t.id, req["request_id"], "answer", answers)
    events = collect_until(type?("turn.completed"))
    assert Enum.any?(events, &(&1["type"] == "approval.resolved" and &1["decision"] == "answer" and &1["answers"] == answers))
    assert %{"output" => "answers=" <> json, "answers" => ^answers} = Enum.find(Items.last(t.id), &(&1["kind"] == "tool" and &1["name"] == "AskUserQuestion"))
    assert Jason.decode!(json) == answers
  end

  test "switching to a permissive mode answers the approvals it covers", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "please approve this")
    [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
    assert req["tool"] == "Bash"

    # acceptEdits doesn't cover Bash: still waiting
    :ok = Threads.set_mode(t.id, "acceptEdits")
    assert [%{"request_id" => rid}] = Threads.snapshot(t.id).pending
    assert rid == req["request_id"]

    :ok = Threads.set_mode(t.id, "bypassPermissions")
    events = collect_until(type?("turn.completed"))
    assert Enum.any?(events, &(&1["type"] == "approval.resolved" and &1["decision"] == "allow" and &1["request_id"] == rid))
    assert [%{"is_error" => false}] = for(%{"type" => "tool.completed"} = e <- events, do: e)
    assert Threads.snapshot(t.id).pending == []
    assert Threads.get(t.id).mode == "bypassPermissions"
  end

  test "a question is never auto-answered by a mode switch", %{dir: dir} do
    t = create_thread(dir)
    Threads.subscribe(t.id)
    :ok = Threads.send_message(t.id, "ask me")
    collect_until(type?("approval.requested"))
    :ok = Threads.set_mode(t.id, "bypassPermissions")
    assert [%{"tool" => "AskUserQuestion"}] = Threads.snapshot(t.id).pending
  end
end
