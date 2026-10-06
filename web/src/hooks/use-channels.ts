import { useEffect, useRef, useState } from "react";
import type { Channel } from "phoenix";
import { socket } from "@/socket";
import { useStore } from "@/store";
import type { Automation, HostInfo, ModelOption, PlanUsage, Project, Settings, Snapshot, Thread, ThreadEvent } from "@/contracts";

type Reply = { ok: true; payload?: unknown } | { ok: false; reason: string; payload?: unknown };

/** Push and resolve with the reply, so callers can surface errors. */
export function push(channel: Channel | null, event: string, payload: object = {}, timeout?: number): Promise<Reply> {
  return new Promise((resolve) => {
    if (!channel) return resolve({ ok: false, reason: "not connected" });
    channel
      .push(event, payload, timeout)
      .receive("ok", (p) => resolve({ ok: true, payload: p }))
      .receive("error", (p: { reason?: string }) => resolve({ ok: false, reason: p?.reason ?? "error", payload: p }))
      .receive("timeout", () => resolve({ ok: false, reason: "timeout" }));
  });
}

let lobby: Channel | null = null;

/** Joins the lobby once; keeps the thread list and statuses in the store. */
export function useLobby() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (lobby) return;
    const ch = socket.channel("lobby", {});
    lobby = ch;
    const { setLobby, upsertThread, upsertProject, removeThread, setThreadStatus } = useStore.getState();
    ch.on("project.upserted", (p: Project) => upsertProject(p));
    ch.on("thread.upserted", (t: Thread) => upsertThread(t));
    ch.on("thread.status", ({ id, status }) => setThreadStatus(id, status));
    ch.on("thread.activity", ({ id, activity }) => useStore.getState().setThreadActivity(id, activity));
    ch.on("thread.messages", ({ id, count }) => useStore.getState().setMessageCount(id, count));
    ch.on("thread.archived", ({ id }) => removeThread(id));
    ch.on("settings.updated", (s: Settings) => useStore.getState().setSettings(s));
    ch.on("automation.upserted", (a: Automation) => useStore.getState().upsertAutomation(a));
    ch.on("automation.deleted", ({ id }) => useStore.getState().removeAutomation(id));
    ch.onClose(() => setConnected(false));
    ch.onError(() => setConnected(false));
    ch.join().receive("ok", (reply: { host: HostInfo; projects: Project[]; threads: Thread[]; settings: Settings; models: Record<string, ModelOption[]>; automations: Automation[] }) => {
      const s = useStore.getState();
      s.setHost(reply.host);
      s.setSettings(reply.settings);
      for (const [provider, models] of Object.entries(reply.models ?? {})) if (!s.models[provider]) s.setModels(provider, models);
      setLobby(reply.projects, reply.threads);
      s.setAutomations(reply.automations ?? []);
      setConnected(true);
    });
  }, []);

  return { connected };
}

export const lobbyChannel = () => lobby;

// One channel per thread, shared by everything that shows it (a chat tab,
// the workspace around it): Phoenix allows one join per topic per socket.
interface Shared {
  ch: Channel;
  refs: number;
  error: string | null;
  listeners: Set<() => void>;
  leaveTimer: ReturnType<typeof setTimeout> | null;
}
const shared = new Map<string, Shared>();

function acquire(id: string): Shared {
  const existing = shared.get(id);
  if (existing) {
    existing.refs++;
    if (existing.leaveTimer) clearTimeout(existing.leaveTimer);
    existing.leaveTimer = null;
    return existing;
  }

  const ch = socket.channel(`thread:${id}`, {});
  const entry: Shared = { ch, refs: 1, error: null, listeners: new Set(), leaveTimer: null };
  shared.set(id, entry);
  const { hydrate, apply } = useStore.getState();

  let provider: string | null = null;
  const setUsage = (usage: PlanUsage | null) => {
    if (provider) useStore.getState().setUsage(provider, usage);
  };

  ch.on("event", (p: ThreadEvent | { batch: ThreadEvent[] }) => apply("batch" in p ? p.batch : [p]));
  ch.on("usage", ({ usage }: { usage: PlanUsage | null }) => setUsage(usage));
  ch.join()
    .receive("ok", (snap: Snapshot) => {
      hydrate(snap);
      provider = snap.thread.provider;
      // what the server has now; asking to refresh may start the agent, and the fresh numbers arrive as a `usage` push
      void push(ch, "usage", { refresh: true }).then((r) => {
        const usage = r.ok ? (r.payload as { usage: PlanUsage | null }).usage : null;
        if (usage) setUsage(usage);
      });
    })
    .receive("error", (e: { reason?: string }) => {
      entry.error = e?.reason ?? "join failed";
      entry.listeners.forEach((l) => l());
    });
  return entry;
}

function release(id: string) {
  const entry = shared.get(id);
  if (!entry || --entry.refs > 0) return;
  // a tab switch unmounts and remounts right away; don't rejoin for that
  entry.leaveTimer = setTimeout(() => {
    shared.delete(id);
    entry.ch.leave();
  }, 2000);
}

/** Joins thread:<id> while mounted (shared). Rejoins (after a reconnect) re-hydrate from a fresh snapshot. */
export function useThreadChannel(id: string | null) {
  const ref = useRef<Channel | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const entry = acquire(id);
    ref.current = entry.ch;
    const onChange = () => setJoinError(entry.error);
    entry.listeners.add(onChange);
    onChange();
    return () => {
      entry.listeners.delete(onChange);
      ref.current = null;
      release(id);
    };
  }, [id]);

  return { channel: ref, joinError };
}
