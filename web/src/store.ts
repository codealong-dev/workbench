import { create } from "zustand";
import type { Approval, HostInfo, Item, LiveItem, ModelOption, PlanUsage, Project, Settings, Snapshot, Status, Thread, ThreadEvent, ToolItem } from "./contracts";

export interface ThreadState {
  thread: Thread;
  status: Status;
  lastSeq: number;
  items: Item[];
  live: LiveItem[]; // in order of first delta
  pending: Approval[];
  model: string | null;
}

interface Store {
  host: HostInfo | null;
  setHost: (host: HostInfo) => void;
  projects: Project[];
  threads: Thread[];
  byId: Record<string, ThreadState>;
  /** Plan limits per provider; they belong to the account, not a thread. */
  usage: Record<string, PlanUsage | null>;
  setUsage: (provider: string, usage: PlanUsage | null) => void;
  /** Null until the lobby is joined. */
  settings: Settings | null;
  setSettings: (settings: Settings) => void;
  /** Each provider's model list, as last listed (the server keeps it across restarts). */
  models: Record<string, ModelOption[]>;
  setModels: (provider: string, models: ModelOption[]) => void;
  setLobby: (projects: Project[], threads: Thread[]) => void;
  upsertProject: (project: Project) => void;
  removeThread: (id: string) => void;
  upsertThread: (thread: Thread) => void;
  setThreadStatus: (id: string, status: Status) => void;
  /** Threads that finished a turn while nobody was looking; opening one clears it. */
  unseen: Record<string, true>;
  viewing: string | null;
  setViewing: (id: string | null) => void;
  setThreadActivity: (id: string, activity: string) => void;
  setMessageCount: (id: string, count: number) => void;
  hydrate: (snap: Snapshot) => void;
  apply: (events: ThreadEvent[]) => void;
}

export const useStore = create<Store>((set) => ({
  host: null,
  setHost: (host) => set({ host }),
  projects: [],
  threads: [],
  byId: {},
  usage: {},

  setUsage: (provider, usage) => set((s) => ({ usage: { ...s.usage, [provider]: usage } })),

  settings: null,
  setSettings: (settings) => set({ settings }),
  models: {},
  setModels: (provider, models) => set((s) => ({ models: { ...s.models, [provider]: models } })),

  setLobby: (projects, threads) => set({ projects, threads }),

  upsertProject: (project) =>
    set((s) => ({
      projects: s.projects.some((p) => p.id === project.id)
        ? s.projects.map((p) => (p.id === project.id ? project : p))
        : [...s.projects, project].sort((a, b) => a.name.localeCompare(b.name)),
    })),

  removeThread: (id) =>
    set((s) => {
      const { [id]: _gone, ...byId } = s.byId;
      return { threads: s.threads.filter((t) => t.id !== id), byId };
    }),

  upsertThread: (thread) =>
    set((s) => {
      const i = s.threads.findIndex((t) => t.id === thread.id);
      // upserts carry no message_count; keep the one we have
      const threads = i === -1 ? [thread, ...s.threads] : s.threads.map((t) => (t.id === thread.id ? { ...t, ...thread } : t));
      const ts = s.byId[thread.id];
      return { threads, byId: ts ? { ...s.byId, [thread.id]: { ...ts, thread } } : s.byId };
    }),

  unseen: {},
  viewing: null,
  setViewing: (id) =>
    set((s) => {
      if (!id || !s.unseen[id]) return { viewing: id };
      const { [id]: _seen, ...unseen } = s.unseen;
      return { viewing: id, unseen };
    }),

  setThreadStatus: (id, status) =>
    set((s) => {
      const was = s.threads.find((t) => t.id === id)?.status;
      const finished = status === "idle" && (was === "running" || was === "awaiting_approval") && s.viewing !== id;
      return {
        threads: s.threads.map((t) => (t.id === id ? { ...t, status } : t)),
        ...(finished ? { unseen: { ...s.unseen, [id]: true as const } } : {}),
      };
    }),

  setThreadActivity: (id, activity) =>
    set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, activity } : t)) })),

  setMessageCount: (id, count) =>
    set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, message_count: count } : t)) })),

  hydrate: (snap) =>
    set((s) => ({
      byId: {
        ...s.byId,
        [snap.thread.id]: {
          thread: snap.thread,
          status: snap.status,
          lastSeq: snap.seq,
          items: snap.items,
          live: snap.live,
          pending: snap.pending,
          model: s.byId[snap.thread.id]?.model ?? null,
        },
      },
    })),

  apply: (events) =>
    set((s) => {
      const byId = { ...s.byId };
      for (const ev of events) {
        const ts = byId[ev.thread_id];
        if (!ts || ev.seq <= ts.lastSeq) continue; // duplicate after rejoin
        byId[ev.thread_id] = applyEvent(ts, ev);
      }
      return { byId };
    }),
}));

/** The only reducer: one event in, next thread state out. */
export function applyEvent(ts: ThreadState, ev: ThreadEvent): ThreadState {
  const next: ThreadState = { ...ts, lastSeq: ev.seq };

  switch (ev.type) {
    case "session.started":
      return { ...next, model: ev.model };

    case "turn.started":
      return next;

    case "text.delta":
    case "reasoning.delta": {
      const kind = ev.type === "text.delta" ? "assistant_message" : "reasoning";
      const i = ts.live.findIndex((l) => l.id === ev.item_id);
      const live =
        i === -1
          ? [...ts.live, { id: ev.item_id, kind, text: ev.text } as LiveItem]
          : ts.live.map((l, j) => (j === i ? { ...l, text: l.text + ev.text } : l));
      return { ...next, live };
    }

    case "item.completed":
      return {
        ...next,
        live: ts.live.filter((l) => l.id !== ev.item.id),
        items: [...ts.items, { ...ev.item, seq: ev.seq }],
      };

    case "tool.started": {
      const item: ToolItem = {
        id: ev.item_id,
        kind: "tool",
        name: ev.name,
        input: ev.input,
        parent_id: ev.parent_id ?? null,
        status: "running",
      };
      return { ...next, items: [...ts.items, { ...item, seq: ev.seq }] };
    }

    case "tool.completed":
      return {
        ...next,
        items: ts.items.map((it) =>
          it.id === ev.item_id && it.kind === "tool"
            ? { ...it, output: ev.output, is_error: ev.is_error, truncated: ev.truncated, status: "done", ...(ev.images ? { images: ev.images } : {}) }
            : it,
        ),
      };

    case "approval.requested":
      return { ...next, pending: [...ts.pending, { request_id: ev.request_id, tool: ev.tool, input: ev.input, reason: ev.reason }] };

    case "approval.resolved":
      return {
        ...next,
        pending: ts.pending.filter((p) => p.request_id !== ev.request_id),
        // a question's answers live on its tool item
        items: ev.answers ? ts.items.map((it) => (it.id === ev.request_id && it.kind === "tool" ? { ...it, answers: ev.answers } : it)) : ts.items,
      };

    case "turn.completed":
      return {
        ...next,
        live: [],
        items: [
          ...ts.items,
          { id: `turn:${ev.turn_id}`, kind: "turn", turn_id: ev.turn_id, status: ev.status, usage: ev.usage, cost_usd: ev.cost_usd, seq: ev.seq },
        ],
      };

    case "status.changed":
      return { ...next, status: ev.status };

    case "error":
      return { ...next, items: [...ts.items, { id: `err:${ev.seq}`, kind: "error", message: ev.message, seq: ev.seq }] };

    default:
      return next;
  }
}
