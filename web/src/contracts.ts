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
  /** Shared context inherited by every agent session in this thread. */
  initial_context: string | null;
  branch: string | null;
  base_ref: string | null;
  worktree_path: string;
  session_id: string | null;
  mode: Mode;
  model: string | null;
  effort?: string | null;
  status: Status;
  /** One line on what the agent is doing, asking for, or last said. */
  activity?: string | null;
  /** Set on a workspace opened to review a GitHub pull request (Workbench.PullRequests). */
  pr_number?: number | null;
  pr_url?: string | null;
  /** Set on a thread an automation made (Workbench.Automations). */
  automation_id?: string | null;
  /** User messages sent; only in the lobby list and `thread.messages`. */
  message_count?: number;
  inserted_at: string;
  updated_at: string;
}

/** One firing of an automation (Workbench.Automations.Run). */
export interface AutomationRun {
  id: string;
  automation_id: string;
  /** started: made a thread with the prompt; failed: couldn't (see error); missed: Workbench wasn't running and it was too late to catch up */
  status: "started" | "failed" | "missed";
  thread_id: string | null;
  error: string | null;
  /** when it was due; null for Run now */
  scheduled_for: string | null;
  inserted_at: string;
}

/** An agent run on a schedule (Workbench.Automations). */
export interface Automation {
  id: string;
  project_id: string;
  name: string;
  provider: Provider;
  prompt: string;
  /** five-field cron, in the server's local time */
  schedule: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  /** the latest few, newest first */
  runs: AutomationRun[];
  inserted_at: string;
  updated_at: string;
}

/** A GitHub pull request of a project, from `prs.list` (Workbench.PullRequests). */
export interface PullRequest {
  project_id: string;
  /** owner/name */
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  author: string | null;
  head: string;
  base: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  review_decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  additions: number;
  deletions: number;
  changed_files: number;
  body: string | null;
}

export interface PullRequestList {
  prs: PullRequest[];
  /** projects GitHub couldn't be asked about */
  errors: { project_id: string; reason: string }[];
  /** the projects on GitHub */
  repos: { project_id: string; repo: string }[];
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** An image in the conversation, stored by the server (Workbench.Uploads). */
export type ImageRef = { id: string; name: string; mime: string; url: string };

/** A non-image file you attached; the agent gets its path on the server. */
export type FileRef = {
  id: string;
  name: string;
  size: number;
  /** Where to fetch it, for a file you uploaded */
  url?: string;
  /** Its path in the worktree, for a file that was already there */
  worktree?: string;
};

// Timeline items (persisted by the server, rendered by the UI)
export type MessageItem = {
  id: string;
  kind: "user_message" | "assistant_message" | "reasoning";
  text: string;
  turn_id?: string | null;
  /** user_message: what you attached */
  images?: ImageRef[];
  files?: FileRef[];
};
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
  /** images the agent looked at or made (Claude's Read on a picture, Codex's view_image) */
  images?: ImageRef[];
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
    | { type: "tool.completed"; item_id: string; output: string; truncated: boolean; is_error: boolean; images?: ImageRef[] }
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

/** One chunk of a review guide: a few files that change for one reason. */
export interface GuideGroup {
  title: string;
  summary: string | null;
  /** paths of changed files, each in exactly one group */
  files: string[];
}

/** A thread's changes grouped by a model (Workbench.Guide). */
export interface Guide {
  summary: string | null;
  groups: GuideGroup[];
  provider: Provider;
  model: string | null;
  /** ISO 8601 */
  generated_at: string;
}

export interface GuideState {
  status: "idle" | "generating" | "error";
  /** ms since epoch, while generating */
  started_at: number | null;
  message: string | null;
}

export interface GuideData {
  guide: Guide | null;
  state: GuideState;
  /** the changes moved on since the guide was written */
  stale: boolean;
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

/** One file waiting to be committed. */
export interface UncommittedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

/** One file in Source Control: staged (in the index) or not. */
export interface ScmFile {
  path: string;
  old_path: string | null;
  status: FileStatus;
}

export interface ScmChanges {
  staged: ScmFile[];
  unstaged: ScmFile[];
}

export interface CommitStatus {
  branch: string | null;
  uncommitted: UncommittedFile[];
  remote: string | null;
  /** the branch it pushes to, e.g. origin/wb/x; null before the first push */
  upstream: string | null;
  /** commits no remote has */
  unpushed: number;
}

/** A commit in the push preview. */
export interface GraphCommit {
  sha: string;
  parents: string[];
  author: string;
  /** unix seconds */
  at: number;
  /** branches and tags pointing at it */
  refs: string[];
  subject: string;
  unpushed: boolean;
}

export interface CommitGraph {
  head: string;
  /** newest first */
  commits: GraphCommit[];
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

/** Find in files (`search`). include/exclude: comma separated globs. */
export interface SearchOptions {
  case_sensitive: boolean;
  whole_word: boolean;
  regex: boolean;
  include: string;
  exclude: string;
}

export interface SearchMatch {
  line: number;
  /** 1-based, of the first match on the line (UTF-16 units, as Monaco counts) */
  col: number;
  /** the line, or a window of it when long (`cut_left`/`cut_right`) */
  text: string;
  /** [start, end) into `text` */
  ranges: [number, number][];
  cut_left: boolean;
  cut_right: boolean;
}

export interface SearchResult {
  files: { path: string; matches: SearchMatch[] }[];
  total: number;
  /** stopped early: too many matches, or it took too long */
  truncated: boolean;
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
  /** Optional Claude subscription overage credits. Amounts use the provider's currency. */
  credits?: { used: number | null; limit: number | null; currency: string } | null;
}

export interface UsageStatus {
  fetched_at: number | null;
  error: string | null;
  loading: boolean;
}

export interface UsageSnapshot {
  usage: PlanUsage | null;
  fetched_at: number;
}

/** One lab (agent): on or off, and the models its chat picker offers. */
export interface LabSettings {
  enabled: boolean;
  /** At most MAX_LOADOUT model ids, in picker order; empty = every model. */
  models: string[];
}

/** The agent that reviews a thread's changes, as set up in Settings → Review. */
export interface ReviewSettings {
  provider: Provider;
  /** null = the agent's default model */
  model: string | null;
  /** null = the model's default effort */
  effort: string | null;
  mode: Mode;
  prompt: string;
}

/** The agent that writes a thread's review guide, as set up in Settings → Guide. It always runs read-only. */
export interface GuideSettings {
  provider: Provider;
  /** null = the agent's default model */
  model: string | null;
  /** null = the model's default effort */
  effort: string | null;
  /** how to group the changes; Workbench adds the reply format and the changes */
  prompt: string;
}

/** App-wide preferences (Workbench.Settings), shared by every browser. */
export interface Settings {
  labs: Record<Provider, LabSettings>;
  /** null until the review agent is set up */
  review: ReviewSettings | null;
  /** null until saved; the guide then uses Claude's Sonnet */
  guide: GuideSettings | null;
  /** null until saved; each agent then uses its small default model (Settings → Commit) */
  commit: CommitSettings | null;
}

/** The model that writes commit titles, per agent; an agent left out uses its default (COMMIT_DEFAULT_MODELS). */
export interface CommitSettings {
  models: Partial<Record<Provider, string>>;
}

/** What Workbench.Commit uses when nothing is saved. */
export const COMMIT_DEFAULT_MODELS: Partial<Record<Provider, string>> = { claude: "haiku", codex: "gpt-5.1-codex-mini" };

export const MAX_LOADOUT = 3;

/** A model a provider offers, in one shape for every provider. */
export interface ModelOption {
  id: string;
  name: string;
  description: string;
  efforts: { value: string; description: string }[];
  default_effort: string | null;
}
