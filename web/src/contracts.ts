// The wire contract between Phoenix and the UI. Mirrors the plan's Contracts
// table; Workbench.Threads.Server is the only producer.

export type Provider = "claude" | "codex" | "fake";
export type Mode = "default" | "acceptEdits" | "plan" | "bypassPermissions";
export type Status = "idle" | "running" | "awaiting_approval" | "error";
export type Decision = "allow" | "allow_session" | "deny" | "answer";

/** AskUserQuestion (Claude) and request_user_input (Codex), in one shape. */
export interface Question {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
  allowOther: boolean;
  secret: boolean;
}

/** question id -> picked labels (or typed text) */
export type Answers = Record<string, string[]>;

export interface Project {
  id: string;
  name: string;
  repo_path: string;
  default_branch: string | null;
}

export interface Thread {
  id: string;
  project_id: string | null;
  /** Set on a child session: another agent in the parent's worktree. */
  parent_id: string | null;
  provider: Provider;
  title: string | null;
  branch: string | null;
  base_ref: string | null;
  worktree_path: string;
  session_id: string | null;
  mode: Mode;
  model: string | null;
  effort?: string | null;
  status: Status;
  /** User messages sent; only in the lobby list and `thread.messages`. */
  message_count?: number;
  inserted_at: string;
  updated_at: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

// Timeline items (persisted by the server, rendered by the UI)
export type MessageItem = { id: string; kind: "user_message" | "assistant_message" | "reasoning"; text: string; turn_id?: string | null };
export type ToolItem = {
  id: string;
  kind: "tool";
  name: string;
  input: unknown;
  output?: string;
  is_error?: boolean;
  truncated?: boolean;
  parent_id?: string | null;
  status: "running" | "done";
  /** AskUserQuestion: what the user picked ({} when skipped) */
  answers?: Answers;
};
export type TurnItem = { id: string; kind: "turn"; turn_id: string; status: "ok" | "interrupted" | "error"; usage?: Usage; cost_usd?: number | null };
export type ErrorItem = { id: string; kind: "error"; message: string };
export type Item = (MessageItem | ToolItem | TurnItem | ErrorItem) & { seq?: number };

export type LiveItem = { id: string; kind: "assistant_message" | "reasoning"; text: string };

type Env = { thread_id: string; seq: number; at: number };

export type Approval = { request_id: string; tool: string; input: unknown; reason?: string | null };

export type ThreadEvent = Env &
  (
    | { type: "session.started"; session_id: string; model: string }
    | { type: "turn.started"; turn_id: string }
    | { type: "text.delta"; item_id: string; text: string }
    | { type: "reasoning.delta"; item_id: string; text: string }
    | { type: "item.completed"; item: MessageItem }
    | { type: "tool.started"; item_id: string; name: string; input: unknown; parent_id?: string }
    | { type: "tool.completed"; item_id: string; output: string; truncated: boolean; is_error: boolean }
    | ({ type: "approval.requested" } & Approval)
    | { type: "approval.resolved"; request_id: string; decision: Decision | "cancelled"; answers?: Answers }
    | { type: "turn.completed"; turn_id: string; status: TurnItem["status"]; usage?: Usage; cost_usd?: number | null }
    | { type: "status.changed"; status: Status }
    | { type: "error"; message: string; fatal: boolean }
  );

export interface Snapshot {
  thread: Thread;
  status: Status;
  seq: number;
  items: Item[];
  live: LiveItem[];
  pending: Approval[];
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";

export interface DiffFile {
  path: string;
  old_path: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffResult {
  base: string;
  files: DiffFile[];
  patch?: string | null;
  truncated?: boolean;
}

export type Editor = "zed" | "code" | "cursor" | "finder";

export interface HostInfo {
  name: string;
  ssh_target: string;
}

export interface PushResult {
  branch: string;
  remote: string;
  output: string;
  pr_url: string | null;
}

export interface FileList {
  files: string[];
  truncated: boolean;
}

export interface FileContent {
  path: string;
  /** null for binary files */
  content: string | null;
  size: number;
  binary: boolean;
  /** cut at 1MB */
  truncated: boolean;
  /** what a save sends back to detect changes made meanwhile; null when truncated */
  hash?: string | null;
}

export interface TerminalInfo {
  id: string;
  owner_id: string;
  n: number;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  created_at: string;
}

/** One plan limit of a provider (Claude: the 5-hour session, the weekly caps). */
export interface UsageWindow {
  id: string;
  label: string;
  /** 0-100 */
  used_pct: number;
  /** ISO 8601 */
  resets_at: string | null;
}

/** How much of a provider's plan limits is used. */
export interface PlanUsage {
  plan: string | null;
  windows: UsageWindow[];
}

/** A model a provider offers, in one shape for every provider. */
export interface ModelOption {
  id: string;
  name: string;
  description: string;
  efforts: { value: string; description: string }[];
  default_effort: string | null;
}
