// Stands in for sidecar/dist/claude.js in tests: same stdin ops, canned events.
// Writes some lines in two chunks to exercise the server's line buffering.
const readline = require("node:readline");
const out = (e) => process.stdout.write(JSON.stringify(e) + "\n");
let n = 0;
readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const op = JSON.parse(line);
  if (op.op === "start") out({ type: "session.started", session_id: op.resume || "stub-session", model: "stub", cwd: process.cwd(), initial_context: op.initial_context });
  if (op.op === "usage") out({ type: "usage", usage: { plan: "max", windows: [
    { id: "five_hour", label: "Session (5h)", used_pct: 42, resets_at: new Date(Date.now() + 3 * 3600000).toISOString() },
    { id: "seven_day", label: "Weekly", used_pct: 18, resets_at: new Date(Date.now() + 4 * 86400000).toISOString() },
  ] } });
  if (op.op === "send") {
    n++;
    if (op.text === "crash") { process.stderr.write("stub: boom\n"); process.exit(3); }
    out({ type: "turn.started", turn_id: `t${n}` });
    const half = JSON.stringify({ type: "text.delta", item_id: `m${n}`, text: "Hel" });
    process.stdout.write(half.slice(0, 10));
    await new Promise((r) => setTimeout(r, 20));
    process.stdout.write(half.slice(10) + "\n" + JSON.stringify({ type: "text.delta", item_id: `m${n}`, text: "lo" }) + "\n");
    out({ type: "item.completed", item: { id: `m${n}`, kind: "assistant_message", text: "Hello" } });
    out({ type: "turn.completed", turn_id: `t${n}`, status: "ok", usage: { input_tokens: 1, output_tokens: 1 } });
  }
  if (op.op === "stop") process.exit(0);
});
process.stdin.on("end", () => process.exit(0));
