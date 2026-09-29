// The wire contract between Phoenix and the UI. Mirrors the plan's Contracts
// table; Workbench.Threads.Server is the only producer.

export type Provider = "claude" | "codex" | "fake";
export type Mode = "default" | "acceptEdits" | "plan" | "bypassPermissions";
export type Status = "idle" | "running" | "awaiting_approval" | "error";
export type Decision = "allow" | "allow_session" | "deny";

export interface Project {
  id: string;
  name: string;
  repo_path: string;
  default_branch: string | null;
}

export interface Thread {
  id: string;
  project_id: string | null;
  provider: Provider;
  title: string | null;
  branch: string | null;
  base_ref: string | null;
  worktree_path: string;
  session_id: string | null;
  mode: Mode;
  model: string | null;
  status: Status;
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
    | { type: "approval.resolved"; request_id: string; decision: Decision | "cancelled" }
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
