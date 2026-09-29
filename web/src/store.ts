import { create } from "zustand";
import type { Approval, HostInfo, Item, LiveItem, Project, Snapshot, Status, Thread, ThreadEvent, ToolItem } from "./contracts";

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
  setLobby: (projects: Project[], threads: Thread[]) => void;
  upsertProject: (project: Project) => void;
  removeThread: (id: string) => void;
  upsertThread: (thread: Thread) => void;
  setThreadStatus: (id: string, status: Status) => void;
  hydrate: (snap: Snapshot) => void;
  apply: (events: ThreadEvent[]) => void;
}

export const useStore = create<Store>((set) => ({
  host: null,
  setHost: (host) => set({ host }),
  projects: [],
  threads: [],
  byId: {},

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
      const threads = i === -1 ? [thread, ...s.threads] : s.threads.map((t) => (t.id === thread.id ? thread : t));
      const ts = s.byId[thread.id];
      return { threads, byId: ts ? { ...s.byId, [thread.id]: { ...ts, thread } } : s.byId };
    }),

  setThreadStatus: (id, status) =>
    set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, status } : t)) })),

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
            ? { ...it, output: ev.output, is_error: ev.is_error, truncated: ev.truncated, status: "done" }
            : it,
        ),
      };

    case "approval.requested":
      return { ...next, pending: [...ts.pending, { request_id: ev.request_id, tool: ev.tool, input: ev.input, reason: ev.reason }] };

    case "approval.resolved":
      return { ...next, pending: ts.pending.filter((p) => p.request_id !== ev.request_id) };

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
