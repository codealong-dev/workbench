defmodule Workbench.CodexProviderTest do
  use Workbench.ThreadCase
  alias Workbench.Provider.Codex

  @stub Path.expand("../support/stubs/codex_app_server_stub.js", __DIR__)
  @recorded Path.expand("../../../fixtures/codex/interrupted-turn.jsonl", __DIR__)

  describe "offline: a recorded codex-cli 0.159 session" do
    test "handshake, turn and interrupt map to our events and requests" do
      me = self()
      opts = %{cwd: "/work/proj", mode: "default", resume: nil}
      p = Codex.new_state(%{io: :none, pid: me}, opts, &send(me, {:wrote, &1}))
      # as if open/1 had sent `initialize` as request 1
      p = %{p | calls: %{1 => :initialize}, next_id: 2}
      {:ok, p} = Codex.send_turn(p, "say hi")

      {events, _p} =
        @recorded
        |> File.stream!()
        |> Enum.reduce({[], p}, fn line, {acc, p} ->
          {evs, p} = Codex.handle_line(p, line)
          # interrupt once the turn has started, like the recording did
          p = if Enum.any?(evs, &(&1["type"] == "turn.started")), do: elem(Codex.interrupt(p), 1), else: p
          {acc ++ evs, p}
        end)

      assert [
               %{"type" => "session.started", "session_id" => tid, "model" => "gpt-6.1-sol"},
               %{"type" => "turn.started", "turn_id" => turn},
               %{"type" => "turn.completed", "turn_id" => turn, "status" => "interrupted"}
             ] = events

      # retrying errors ("Reconnecting... 2/5") are not surfaced
      refute Enum.any?(events, &(&1["type"] == "error"))

      assert_received {:wrote, %{"method" => "initialized"}}
      assert_received {:wrote, %{"id" => 2, "method" => "thread/start", "params" => %{"approvalPolicy" => "untrusted", "sandbox" => "workspace-write", "cwd" => "/work/proj"}}}

      assert_received {:wrote,
                       %{
                         "id" => 3,
                         "method" => "turn/start",
                         "params" => %{"threadId" => ^tid, "input" => [%{"type" => "text", "text" => "say hi"}], "sandboxPolicy" => %{"type" => "workspaceWrite"}}
                       }}

      assert_received {:wrote, %{"id" => 4, "method" => "turn/interrupt", "params" => %{"threadId" => ^tid, "turnId" => ^turn}}}
    end

    test "mode mapping" do
      assert {"untrusted", "read-only", %{"type" => "readOnly"}} = Codex.mode_policy("plan")
      assert {"untrusted", "workspace-write", %{"type" => "workspaceWrite"}} = Codex.mode_policy("default")
      assert {"on-request", "workspace-write", _} = Codex.mode_policy("acceptEdits")
      assert {"never", "danger-full-access", %{"type" => "dangerFullAccess"}} = Codex.mode_policy("bypassPermissions")
    end
  end

  describe "end to end through a stub app-server" do
    setup do
      System.put_env("WB_CODEX_BIN", @stub)
      on_exit(fn -> System.delete_env("WB_CODEX_BIN") end)
    end

    test "streams reasoning and text, persists items, reports usage", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "hi")
      events = collect_until(type?("turn.completed"))

      assert %{"session_id" => "thread-" <> _, "model" => "gpt-stub"} = Enum.find(events, &(&1["type"] == "session.started"))
      reasoning = for %{"type" => "reasoning.delta", "text" => x} <- events, into: "", do: x
      assert reasoning == "Greeting the user"
      text = for %{"type" => "text.delta", "text" => x} <- events, into: "", do: x
      assert text == "Hello **there**"

      assert %{"status" => "ok", "usage" => %{"input_tokens" => 100, "cache_read_input_tokens" => 20, "output_tokens" => 10}} = List.last(events)
      assert ~w(user_message reasoning assistant_message turn) == Items.last(t.id) |> Enum.map(& &1["kind"])
      assert "thread-" <> _ = Threads.get(t.id).session_id
    end

    test "command approval: allow runs it, deny declines it", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)

      :ok = Threads.send_message(t.id, "run")
      [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
      assert %{"tool" => "Bash", "input" => %{"command" => "ls -la"}, "reason" => "needs to list files"} = req
      :ok = Threads.respond(t.id, req["request_id"], "allow")
      events = collect_until(type?("turn.completed"))
      assert [%{"output" => "total 0\n", "is_error" => false}] = for(%{"type" => "tool.completed"} = e <- events, do: e)
      assert Enum.any?(events, &(&1["type"] == "item.completed" and &1["item"]["text"] == "decision=accept"))

      :ok = Threads.send_message(t.id, "run")
      [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
      :ok = Threads.respond(t.id, req["request_id"], "deny")
      events = collect_until(type?("turn.completed"))
      assert [%{"output" => "Declined", "is_error" => true}] = for(%{"type" => "tool.completed"} = e <- events, do: e)
      assert Enum.any?(events, &(&1["type"] == "item.completed" and &1["item"]["text"] == "decision=decline"))
    end

    test "file change approval for the session shows the patch", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "patch")

      [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
      assert %{"tool" => "Patch", "input" => %{"changes" => [%{"path" => "a.txt", "diff" => "@@ -1 +1 @@" <> _}]}} = req
      :ok = Threads.respond(t.id, req["request_id"], "allow_session")
      events = collect_until(type?("turn.completed"))
      assert [%{"output" => "M a.txt", "is_error" => false}] = for(%{"type" => "tool.completed"} = e <- events, do: e)
      assert Enum.any?(events, &(&1["type"] == "item.completed" and &1["item"]["text"] == "decision=acceptForSession"))
      assert [%{"name" => "Patch", "status" => "done"}] = Items.last(t.id) |> Enum.filter(&(&1["kind"] == "tool"))
    end

    test "permissions request grants what was asked for the turn", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "perm")
      [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
      assert req["tool"] == "Permissions"
      :ok = Threads.respond(t.id, req["request_id"], "allow")
      events = collect_until(type?("turn.completed"))
      echo = Enum.find_value(events, &(&1["type"] == "item.completed" && &1["item"]["text"]))
      assert echo == ~s(perm={"permissions":{"network":{"enabled":true}},"scope":"turn"})
    end

    test "request_user_input becomes an AskUserQuestion card and returns the answers", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "ask")
      [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()

      assert %{
               "tool" => "AskUserQuestion",
               "input" => %{
                 "questions" => [
                   %{"id" => "lang", "header" => "Language", "options" => [%{"label" => "Go"}, %{"label" => "Elixir"}], "allowOther" => false},
                   %{"id" => "name", "options" => [], "allowOther" => true}
                 ]
               }
             } = req

      assert {:error, :bad_answers} = Threads.respond(t.id, req["request_id"], "answer", %{"lang" => "Go"})
      :ok = Threads.respond(t.id, req["request_id"], "answer", %{"lang" => ["Elixir"], "name" => ["workbench"]})
      events = collect_until(type?("turn.completed"))
      assert Enum.any?(events, &(&1["type"] == "approval.resolved" and &1["answers"] == %{"lang" => ["Elixir"], "name" => ["workbench"]}))
      echo = Enum.find_value(events, &(&1["type"] == "item.completed" && &1["item"]["text"]))
      assert Jason.decode!(String.trim_leading(echo, "ask=")) == %{"answers" => %{"lang" => %{"answers" => ["Elixir"]}, "name" => %{"answers" => ["workbench"]}}}
      # no item for request_user_input in Codex, so Workbench records one
      assert %{"name" => "AskUserQuestion", "answers" => %{"lang" => ["Elixir"]}, "input" => %{"questions" => [_, _]}} =
               Enum.find(Items.last(t.id), &(&1["kind"] == "tool" and &1["name"] == "AskUserQuestion"))
    end

    test "skipping request_user_input sends no answers", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "ask")
      [req | _] = collect_until(type?("approval.requested")) |> Enum.reverse()
      :ok = Threads.respond(t.id, req["request_id"], "deny")
      events = collect_until(type?("turn.completed"))
      assert Enum.any?(events, &(&1["type"] == "item.completed" and &1["item"]["text"] == ~s(ask={"answers":{}})))
    end

    test "unsupported server requests are declined so the turn can finish", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "mcp")
      events = collect_until(type?("turn.completed"))
      assert Enum.any?(events, &(&1["type"] == "error" and &1["message"] =~ "mcpServer/elicitation/request"))
      assert Enum.any?(events, &(&1["type"] == "item.completed" and &1["item"]["text"] == "mcp=-32601"))
      assert Threads.snapshot(t.id).status == "idle"
    end

    test "a failed turn surfaces the reason and leaves the thread usable", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "fail")
      events = collect_until(type?("turn.completed"))
      errors = for %{"type" => "error"} = e <- events, do: e["message"]
      assert errors == ["stream disconnected: 401 Unauthorized", "You are not logged in. Run `codex login`."]
      assert %{"status" => "error"} = List.last(events)
      refute Enum.any?(events, &(&1["type"] == "error" and &1["fatal"]))

      :ok = Threads.send_message(t.id, "again")
      collect_until(type?("turn.completed"))
    end

    test "interrupt stops a streaming turn", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "slow")
      collect_until(type?("text.delta"))
      :ok = Threads.interrupt(t.id)
      assert %{"status" => "interrupted"} = collect_until(type?("turn.completed")) |> List.last()
    end

    test "mode changes apply to the next turn", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "policy")
      events = collect_until(type?("turn.completed"))
      assert Enum.any?(events, &(&1["type"] == "item.completed" and &1["item"]["text"] == ~s(approval="untrusted" sandbox=workspaceWrite)))

      :ok = Threads.set_mode(t.id, "bypassPermissions")
      :ok = Threads.send_message(t.id, "policy")
      events = collect_until(type?("turn.completed"))
      assert Enum.any?(events, &(&1["type"] == "item.completed" and &1["item"]["text"] == ~s(approval="never" sandbox=dangerFullAccess)))
    end

    test "resume: a known session continues, an unknown one starts fresh", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      # plain threads start their server on the first message, so it reads this
      Workbench.Repo.update!(Ecto.Changeset.change(Threads.get(t.id), session_id: "known-abc"))
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "hello")
      events = collect_until(type?("turn.completed"))
      assert %{"session_id" => "known-abc"} = Enum.find(events, &(&1["type"] == "session.started"))

      t2 = create_thread(dir, %{provider: "codex"})
      Workbench.Repo.update!(Ecto.Changeset.change(Threads.get(t2.id), session_id: "gone-123"))
      Threads.subscribe(t2.id)
      :ok = Threads.send_message(t2.id, "hello")
      events = collect_until(type?("turn.completed"))
      assert Enum.any?(events, &(&1["type"] == "error" and &1["message"] =~ "Could not resume"))
      assert %{"session_id" => "thread-" <> _} = Enum.find(events, &(&1["type"] == "session.started"))
      assert "thread-" <> _ = Threads.get(t2.id).session_id
    end

    test "codex crashing mid-turn is a fatal error with its stderr", %{dir: dir} do
      t = create_thread(dir, %{provider: "codex"})
      Threads.subscribe(t.id)
      :ok = Threads.send_message(t.id, "crash")
      events = collect_until(&(&1["type"] == "error" and &1["fatal"]))
      assert List.last(events)["message"] =~ "stub codex: boom"
    end
  end

  test "a missing codex binary is reported, not crashed on", %{dir: dir} do
    System.put_env("WB_CODEX_BIN", "/nonexistent/codex")
    on_exit(fn -> System.delete_env("WB_CODEX_BIN") end)
    t = create_thread(dir, %{provider: "codex"})
    assert {:error, _} = Threads.send_message(t.id, "hi")
    assert Threads.snapshot(t.id).status == "error"
  end
end
