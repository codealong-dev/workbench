// Claude sidecar: one process per thread, spawned by Workbench.Provider.Claude
// with cwd = the thread's worktree.
//
// stdin:  one JSON op per line: start, send {text, images?: [{path, mime}]}, interrupt, approve, set_mode, stop
// stdout: one normalized event per line (nothing else is ever written there)
// stderr: logs
//
// Uses the Claude Code login on this machine (subscription or API key), like
// running `claude` in a terminal. Personal use only.

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { query, type EffortLevel, type PermissionMode, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { toModels } from "./models.ts";
import { toUsage } from "./usage.ts";
import { Inbox } from "./inbox.ts";
import { initialState, normalize, type Event } from "./normalize.ts";
import { toQuestions, withAnswers } from "./questions.ts";

type Decision = "allow" | "allow_session" | "deny" | "answer";
type Response = { decision: Decision; answers?: Record<string, string[]> };
type Op =
  | { op: "start"; cwd?: string; resume?: string | null; model?: string | null; effort?: EffortLevel | null; mode?: PermissionMode }
  | { op: "set_model"; model?: string | null; effort?: EffortLevel | null }
  | { op: "models" }
  | { op: "usage" }
  | { op: "send"; text: string; images?: { path: string; mime: string }[] }
  | { op: "interrupt" }
  | { op: "approve"; request_id: string; decision: Decision; answers?: Record<string, string[]> }
  | { op: "set_mode"; mode: PermissionMode }
  | { op: "stop" };

const log = (...a: unknown[]) => process.stderr.write(`[sidecar] ${a.map(String).join(" ")}\n`);
const emit = (e: Event) => process.stdout.write(JSON.stringify(e) + "\n");

const inbox = new Inbox<SDKUserMessage>();
const pending = new Map<string, (r: Response) => void>();
const st = initialState();
let q: Query | null = null;
let stopping = false;

function start(op: Extract<Op, { op: "start" }>) {
  if (q) return log("already started");
  const claudeBin = process.env.WB_CLAUDE_BIN;

  q = query({
    prompt: inbox,
    options: {
      cwd: op.cwd ?? process.cwd(),
      ...(op.resume ? { resume: op.resume } : {}),
      ...(op.model && op.model !== "default" ? { model: op.model } : {}),
      ...(op.effort ? { effort: op.effort } : {}),
      permissionMode: op.mode ?? "default",
      // Without this the CLI refuses bypassPermissions, both at start and when
      // the user switches to it mid-conversation (setPermissionMode rejects).
      // The mode itself is still whatever the user picked.
      allowDangerouslySkipPermissions: true,
      ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project", "local"], // CLAUDE.md, skills, hooks, permissions
      includePartialMessages: true,
      stderr: (data) => process.stderr.write(data),
      canUseTool: async (tool, input, opts) => {
        const request_id = opts.toolUseID ?? randomUUID();
        const asking = tool === "AskUserQuestion";
        emit({
          type: "approval.requested",
          request_id,
          tool,
          input: asking ? { questions: toQuestions(input) } : input,
          reason: opts.title ?? opts.decisionReason ?? null,
        });

        const r = await new Promise<Response>((resolve) => {
          pending.set(request_id, resolve);
          opts.signal.addEventListener("abort", () => resolve({ decision: "deny" }), { once: true });
        });
        pending.delete(request_id);

        if (asking) {
          return r.decision === "answer"
            ? { behavior: "allow", updatedInput: withAnswers(input, r.answers ?? {}) }
            : { behavior: "deny", message: "The user skipped these questions. Continue with your best judgement, or ask again later." };
        }
        if (r.decision === "deny") return { behavior: "deny", message: "Denied by user" };
        return {
          behavior: "allow",
          updatedInput: input,
          ...(r.decision === "allow_session" && opts.suggestions ? { updatedPermissions: opts.suggestions } : {}),
        };
      },
    },
  });

  pump(q);
}

async function pump(q: Query) {
  try {
    for await (const m of q) {
      for (const e of normalize(st, m)) emit(e);
      if (m.type === "result") void usage(); // the turn just spent some of the plan
    }
    if (!stopping) {
      emit({ type: "error", message: "Claude session ended unexpectedly", fatal: true });
      process.exit(1);
    }
  } catch (err) {
    if (stopping) return;
    emit({ type: "error", message: `Claude SDK error: ${(err as Error)?.message ?? err}`, fatal: true });
    process.exit(1);
  }
}

// Plan limits are account-wide, so the server caches the answer for every thread.
async function usage() {
  if (!q) return;
  try {
    const r = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    emit({ type: "usage", usage: toUsage(r) } as Event);
  } catch (e) {
    log("usage failed:", (e as Error)?.message ?? e);
    emit({ type: "usage", usage: null, error: String((e as Error)?.message ?? e) } as Event);
  }
}

// Attached images go in as image blocks ahead of the text, like a paste in `claude`.
async function send(text: string, images: { path: string; mime: string }[] = []) {
  if (!q) return emit({ type: "error", message: "send before start", fatal: false });
  st.turnId = randomUUID();
  emit({ type: "turn.started", turn_id: st.turnId });
  const pictures = await Promise.all(
    images.map(async (img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.mime, data: (await readFile(img.path)).toString("base64") },
    })),
  );
  const content = pictures.length ? [...pictures, ...(text ? [{ type: "text" as const, text }] : [])] : text;
  inbox.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null } as SDKUserMessage);
}

async function interrupt() {
  if (!q || !st.turnId) return;
  st.interrupting = true;
  for (const resolve of pending.values()) resolve({ decision: "deny" });
  await q.interrupt().catch((e) => log("interrupt failed:", e?.message ?? e));
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  inbox.close();
  if (q && st.turnId) await Promise.race([q.interrupt().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  q?.close();
  process.exit(code);
}

async function handle(op: Op) {
  switch (op.op) {
    case "start":
      return start(op);
    case "send":
      return send(op.text, op.images);
    case "interrupt":
      return interrupt();
    case "approve":
      return pending.get(op.request_id)?.({ decision: op.decision, answers: op.answers });
    case "set_mode":
      return q?.setPermissionMode(op.mode).catch((e) => {
        log("set_mode failed:", e?.message ?? e);
        emit({ type: "error", message: `Could not switch to ${op.mode}: ${e?.message ?? e}`, fatal: false });
      });
    case "set_model":
      if (!q) return;
      try {
        await q.setModel(op.model && op.model !== "default" ? op.model : undefined);
        await q.applyFlagSettings({ effortLevel: op.effort ?? null });
      } catch (e) {
        emit({ type: "error", message: `Could not switch model: ${(e as Error)?.message ?? e}`, fatal: false });
      }
      return;
    case "models":
      if (!q) return emit({ type: "models", models: [], error: "not started" } as Event);
      return q
        .supportedModels()
        .then((ms) => emit({ type: "models", models: toModels(ms) } as Event))
        .catch((e) => emit({ type: "models", models: [], error: String(e?.message ?? e) } as Event));
    case "usage":
      return usage();
    case "stop":
      return stop(0);
  }
}

createInterface({ input: process.stdin })
  .on("line", (line) => {
    if (!line.trim()) return;
    let op: Op;
    try {
      op = JSON.parse(line);
    } catch {
      return log("bad op:", line.slice(0, 200));
    }
    handle(op).catch((e) => log(`op ${op.op} failed:`, e?.stack ?? e));
  })
  .on("close", () => stop(0)); // stdin EOF: the server is gone

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
