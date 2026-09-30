#!/usr/bin/env node
// Stands in for `codex app-server` in tests: same JSON-RPC framing and
// message shapes as codex-cli 0.159 (see fixtures/codex/), scripted by the
// prompt text:
//   hi      reasoning + streamed agent message + token usage
//   run     command execution that needs approval; replies with the decision
//   patch   file change that needs approval
//   perm    permissions request; echoes the response
//   ask     request_user_input with two questions; echoes the response
//   mcp     a request Workbench doesn't support (mcpServer/elicitation/request)
//   fail    retrying errors, then a failed turn
//   slow    streams until turn/interrupt
//   policy  echoes the approval policy and sandbox sent with the turn
//   crash   exits with code 3
const readline = require("node:readline");
const out = (m) => process.stdout.write(JSON.stringify({ ...m, ...(m.method ? { emittedAtMs: Date.now() } : {}) }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const id = (p) => `${p}-${++n}`;
let thread = null;
let turn = null;
let interrupted = false;
let serverReq = 100;
const waiting = new Map(); // server request id -> resolve
let total = { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };

const threadObj = (tid, cwd) => ({ id: tid, sessionId: tid, preview: "", ephemeral: false, modelProvider: "openai", model: "gpt-stub", cwd, status: { type: "idle" }, turns: [] });

function ask(method, params) {
  const rid = ++serverReq;
  out({ id: rid, method, params });
  return new Promise((resolve) => waiting.set(rid, resolve));
}

async function agentMessage(text, chunks = 3) {
  const item = id("msg");
  out({ method: "item/started", params: { item: { type: "agentMessage", id: item, text: "", phase: null }, threadId: thread, turnId: turn } });
  const size = Math.ceil(text.length / chunks);
  for (let i = 0; i < text.length; i += size) {
    out({ method: "item/agentMessage/delta", params: { threadId: thread, turnId: turn, itemId: item, delta: text.slice(i, i + size) } });
    await sleep(5);
  }
  out({ method: "item/completed", params: { item: { type: "agentMessage", id: item, text, phase: null }, threadId: thread, turnId: turn } });
}

function complete(status, error = null) {
  out({ method: "turn/completed", params: { threadId: thread, turn: { id: turn, items: [], itemsView: "notLoaded", status, error, startedAt: 1, completedAt: 2, durationMs: 1000 } } });
  turn = null;
}

async function runTurn(text, params) {
  interrupted = false;
  out({ method: "turn/started", params: { threadId: thread, turn: { id: turn, items: [], itemsView: "notLoaded", status: "inProgress", error: null } } });
  const user = id("user");
  out({ method: "item/started", params: { item: { type: "userMessage", id: user, clientId: null, content: [{ type: "text", text, text_elements: [] }] }, threadId: thread, turnId: turn } });
  out({ method: "item/completed", params: { item: { type: "userMessage", id: user, clientId: null, content: [{ type: "text", text, text_elements: [] }] }, threadId: thread, turnId: turn } });

  if (text === "crash") {
    process.stderr.write("stub codex: boom\n");
    process.exit(3);
  }

  if (text === "hi") {
    const r = id("rs");
    out({ method: "item/started", params: { item: { type: "reasoning", id: r, summary: [], content: [] }, threadId: thread, turnId: turn } });
    out({ method: "item/reasoning/summaryTextDelta", params: { threadId: thread, turnId: turn, itemId: r, delta: "Greeting ", summaryIndex: 0 } });
    out({ method: "item/reasoning/textDelta", params: { threadId: thread, turnId: turn, itemId: r, delta: "RAW SHOULD NOT SHOW", contentIndex: 0 } });
    out({ method: "item/reasoning/summaryTextDelta", params: { threadId: thread, turnId: turn, itemId: r, delta: "the user", summaryIndex: 0 } });
    out({ method: "item/completed", params: { item: { type: "reasoning", id: r, summary: ["Greeting the user"], content: ["RAW SHOULD NOT SHOW"] }, threadId: thread, turnId: turn } });
    await agentMessage("Hello **there**");
    total = { ...total, totalTokens: total.totalTokens + 130, inputTokens: total.inputTokens + 120, cachedInputTokens: total.cachedInputTokens + 20, outputTokens: total.outputTokens + 10 };
    out({ method: "thread/tokenUsage/updated", params: { threadId: thread, turnId: turn, tokenUsage: { total, last: total, modelContextWindow: 200000 } } });
    return complete("completed");
  }

  if (text === "run") {
    const c = id("cmd");
    out({ method: "item/started", params: { item: { type: "commandExecution", id: c, command: "ls -la", cwd: params.cwd || process.cwd(), status: "inProgress", commandActions: [], aggregatedOutput: null, exitCode: null }, threadId: thread, turnId: turn } });
    const res = await ask("item/commandExecution/requestApproval", { kind: "command", threadId: thread, turnId: turn, itemId: c, startedAtMs: Date.now(), environmentId: null, reason: "needs to list files", command: "ls -la", cwd: process.cwd() });
    const decision = res.result && res.result.decision;
    out({ method: "serverRequest/resolved", params: { threadId: thread, requestId: serverReq } });
    const ok = decision === "accept" || decision === "acceptForSession";
    out({ method: "item/completed", params: { item: { type: "commandExecution", id: c, command: "ls -la", status: ok ? "completed" : "declined", aggregatedOutput: ok ? "total 0\n" : null, exitCode: ok ? 0 : null }, threadId: thread, turnId: turn } });
    await agentMessage(`decision=${decision}`, 1);
    return complete("completed");
  }

  if (text === "patch") {
    const f = id("patch");
    const changes = [{ path: "a.txt", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-hi\n+hello\n" }];
    out({ method: "item/started", params: { item: { type: "fileChange", id: f, changes, status: "inProgress" }, threadId: thread, turnId: turn } });
    const res = await ask("item/fileChange/requestApproval", { threadId: thread, turnId: turn, itemId: f, startedAtMs: Date.now(), reason: null, grantRoot: null });
    const decision = res.result.decision;
    out({ method: "item/completed", params: { item: { type: "fileChange", id: f, changes, status: decision === "decline" ? "declined" : "completed" }, threadId: thread, turnId: turn } });
    await agentMessage(`decision=${decision}`, 1);
    return complete("completed");
  }

  if (text === "perm") {
    const res = await ask("item/permissions/requestApproval", { threadId: thread, turnId: turn, itemId: id("perm"), environmentId: null, startedAtMs: Date.now(), cwd: process.cwd(), reason: "network", permissions: { network: { enabled: true }, fileSystem: null } });
    await agentMessage(`perm=${JSON.stringify(res.result)}`, 1);
    return complete("completed");
  }

  if (text === "ask") {
    const questions = [
      { id: "lang", header: "Language", question: "Which language?", isOther: false, isSecret: false, options: [{ label: "Go", description: "fast" }, { label: "Elixir", description: "fun" }] },
      { id: "name", header: "Name", question: "Project name?", isOther: true, isSecret: false, options: null },
    ];
    const res = await ask("item/tool/requestUserInput", { threadId: thread, turnId: turn, itemId: id("q"), questions, isBlocking: true, autoResolutionMs: null });
    await agentMessage(`ask=${JSON.stringify(res.result)}`, 1);
    return complete("completed");
  }

  if (text === "mcp") {
    const res = await ask("mcpServer/elicitation/request", { threadId: thread, turnId: turn, serverName: "x", message: "?" });
    await agentMessage(`mcp=${res.error ? res.error.code : "answered"}`, 1);
    return complete("completed");
  }

  if (text === "fail") {
    out({ method: "error", params: { error: { message: "Reconnecting... 1/5", codexErrorInfo: null, additionalDetails: null }, willRetry: true, threadId: thread, turnId: turn } });
    out({ method: "error", params: { error: { message: "stream disconnected", codexErrorInfo: null, additionalDetails: "401 Unauthorized" }, willRetry: false, threadId: thread, turnId: turn } });
    return complete("failed", { message: "You are not logged in. Run `codex login`.", codexErrorInfo: null, additionalDetails: null });
  }

  if (text === "slow") {
    const item = id("msg");
    out({ method: "item/started", params: { item: { type: "agentMessage", id: item, text: "" }, threadId: thread, turnId: turn } });
    for (let i = 0; i < 100 && !interrupted; i++) {
      out({ method: "item/agentMessage/delta", params: { threadId: thread, turnId: turn, itemId: item, delta: "tick " } });
      await sleep(30);
    }
    return; // turn/interrupt completes it
  }

  if (text === "model") {
    return agentMessage(`model=${p_or(params.model)} effort=${p_or(params.effort)}`, 1).then(() => complete("completed"));
  }

  if (text === "policy") {
    return agentMessage(`approval=${JSON.stringify(params.approvalPolicy)} sandbox=${params.sandboxPolicy && params.sandboxPolicy.type}`, 1).then(() => complete("completed"));
  }

  await agentMessage(`echo: ${text}`, 1);
  complete("completed");
}

function p_or(v) { return v === undefined ? "unset" : v; }

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id !== undefined && !m.method) {
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    return w && w(m);
  }
  const p = m.params || {};
  switch (m.method) {
    case "initialize":
      return out({ id: m.id, result: { userAgent: "stub/0.159.2", codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "linux" } });
    case "initialized":
      return;
    case "thread/start":
      thread = id("thread");
      out({ id: m.id, result: { thread: threadObj(thread, p.cwd), model: "gpt-stub", modelProvider: "openai", cwd: p.cwd, approvalPolicy: p.approvalPolicy, sandbox: { type: "workspaceWrite" } } });
      return out({ method: "thread/started", params: { thread: threadObj(thread, p.cwd) } });
    case "thread/resume":
      if (!String(p.threadId).startsWith("known-")) return out({ id: m.id, error: { code: -32600, message: `no rollout found for thread id ${p.threadId}` } });
      thread = p.threadId;
      return out({ id: m.id, result: { thread: threadObj(thread, p.cwd), model: "gpt-stub", modelProvider: "openai", cwd: p.cwd } });
    case "turn/start": {
      const text = (p.input || []).map((i) => i.text).join("");
      turn = id("turn");
      out({ id: m.id, result: { turn: { id: turn, items: [], itemsView: "notLoaded", status: "inProgress", error: null } } });
      runTurn(text, p);
      return;
    }
    case "model/list":
      return out({ id: m.id, result: { nextCursor: null, data: [
        { id: "gpt-a", model: "gpt-a", displayName: "GPT A", description: "the big one", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low", description: "quick" }, { reasoningEffort: "high", description: "deep" }], defaultReasoningEffort: "high" },
        { id: "gpt-hidden", model: "gpt-hidden", displayName: "Hidden", description: "", hidden: true, supportedReasoningEfforts: [], defaultReasoningEffort: "low" },
      ] } });
    case "turn/interrupt":
      interrupted = true;
      out({ id: m.id, result: {} });
      for (const [rid, w] of waiting) {
        waiting.delete(rid);
        out({ method: "serverRequest/resolved", params: { threadId: thread, requestId: rid } });
      }
      return complete("interrupted");
    default:
      return out({ id: m.id, error: { code: -32601, message: `stub: ${m.method}` } });
  }
});
process.stdin.on("end", () => process.exit(0));
