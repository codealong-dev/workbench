// Spike 02 stand-in for the Claude sidecar: on `send` it spawns a long-running
// child (like claude spawning a shell), records pids, streams a bit, then hangs.
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const op = JSON.parse(line);
  if (op.op === "start") process.stdout.write(JSON.stringify({ type: "session.started", session_id: "spike", model: "spike" }) + "\n");
  if (op.op === "send") {
    const child = spawn("sleep", ["600"], { stdio: "ignore" });
    const grandchild = spawn("sh", ["-c", "sleep 601 & wait"], { stdio: "ignore" });
    writeFileSync(process.env.WB_HOME + "/agent-pids", `${process.pid} ${child.pid} ${grandchild.pid}\n`);
    process.stdout.write(JSON.stringify({ type: "turn.started", turn_id: "t1" }) + "\n");
    process.stdout.write(JSON.stringify({ type: "text.delta", item_id: "m1", text: "working..." }) + "\n");
  }
});
// Deliberately ignore stdin EOF and SIGTERM handling: erlexec's group kill must still get us.
