import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, normalize, MAX_OUTPUT } from "../src/normalize.ts";

const se = (event: unknown, parent: string | null = null) => ({ type: "stream_event", event, parent_tool_use_id: parent });

test("streamed text and thinking become deltas and completed items", () => {
  const st = initialState();
  st.turnId = "t1";
  const msgs = [
    { type: "system", subtype: "init", session_id: "s1", model: "claude-x" },
    se({ type: "message_start", message: { id: "msg_1" } }),
    se({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
    se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
    se({ type: "content_block_stop", index: 0 }),
    { type: "assistant", message: { id: "msg_1", content: [{ type: "thinking", thinking: "hmm" }] }, parent_tool_use_id: null },
    se({ type: "content_block_start", index: 1, content_block: { type: "text" } }),
    se({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hel" } }),
    se({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "lo" } }),
    se({ type: "content_block_stop", index: 1 }),
    { type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "Hello" }] }, parent_tool_use_id: null },
    se({ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tu_1", name: "Bash" } }),
    se({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"command\"" } }),
    se({ type: "content_block_stop", index: 2 }),
    { type: "assistant", message: { id: "msg_1", content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }] }, parent_tool_use_id: null },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "a\nb" }] }] }, parent_tool_use_id: null },
    { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 },
  ];
  const events = msgs.flatMap((m) => normalize(st, m));
  assert.deepEqual(
    events.map((e) => e.type),
    ["session.started", "reasoning.delta", "item.completed", "text.delta", "text.delta", "item.completed", "tool.started", "tool.completed", "turn.completed"],
  );
  assert.deepEqual(events[2], { type: "item.completed", item: { id: "msg_1:0", kind: "reasoning", text: "hmm" } });
  assert.deepEqual(events[5], { type: "item.completed", item: { id: "msg_1:1", kind: "assistant_message", text: "Hello" } });
  assert.equal(events[3].item_id, "msg_1:1");
  assert.deepEqual(events[6], { type: "tool.started", item_id: "tu_1", name: "Bash", input: { command: "ls" } });
  assert.deepEqual(events[7], { type: "tool.completed", item_id: "tu_1", output: "a\nb", truncated: false, is_error: false });
  assert.equal(events[8].status, "ok");
  assert.equal(events[8].turn_id, "t1");
  assert.equal(events[8].cost_usd, 0.01);
  assert.equal(st.turnId, null);
});

test("non-streamed assistant text is still emitted", () => {
  const st = initialState();
  const ev = normalize(st, { type: "assistant", uuid: "u1", message: { id: "msg_2", content: [{ type: "text", text: "API error" }] }, parent_tool_use_id: null });
  assert.deepEqual(ev, [{ type: "item.completed", item: { id: "u1:0", kind: "assistant_message", text: "API error" } }]);
});

test("subagent: text dropped, tools kept with parent_id", () => {
  const st = initialState();
  assert.deepEqual(normalize(st, se({ type: "message_start", message: { id: "m" } }, "tu_parent")), []);
  const ev = normalize(st, {
    type: "assistant",
    parent_tool_use_id: "tu_parent",
    message: { id: "m", content: [{ type: "text", text: "sub says" }, { type: "tool_use", id: "tu_2", name: "Read", input: { file_path: "x" } }] },
  });
  assert.deepEqual(ev, [{ type: "tool.started", item_id: "tu_2", name: "Read", input: { file_path: "x" }, parent_id: "tu_parent" }]);
});

test("large tool output is truncated", () => {
  const st = initialState();
  const [ev] = normalize(st, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: "x".repeat(MAX_OUTPUT + 10), is_error: true }] } });
  assert.equal((ev.output as string).length, MAX_OUTPUT);
  assert.equal(ev.truncated, true);
  assert.equal(ev.is_error, true);
});

test("images in a tool result come out for the timeline", () => {
  const st = initialState();
  const content = [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0K" } }];
  const [ev] = normalize(st, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content }] } });
  assert.equal(ev.output, "[image]");
  assert.deepEqual(ev.images, [{ data: "iVBORw0K", mime: "image/png" }]);
});

test("interrupt and error results", () => {
  const st = initialState();
  st.interrupting = true;
  assert.equal(normalize(st, { type: "result", subtype: "error_during_execution", is_error: true })[0].status, "interrupted");
  assert.equal(st.interrupting, false);
  const ev = normalize(st, { type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" });
  assert.deepEqual(ev.map((e) => e.type), ["error", "turn.completed"]);
  assert.match(ev[0].message as string, /Not logged in/);
  assert.equal(ev[1].status, "error");
});
