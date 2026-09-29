import { useEffect, useRef, useState } from "react";
import type { Channel } from "phoenix";
import { socket } from "@/socket";
import { useStore } from "@/store";
import type { Project, Snapshot, Thread, ThreadEvent } from "@/contracts";

type Reply = { ok: true; payload?: unknown } | { ok: false; reason: string };

/** Push and resolve with the reply, so callers can surface errors. */
export function push(channel: Channel | null, event: string, payload: object = {}): Promise<Reply> {
  return new Promise((resolve) => {
    if (!channel) return resolve({ ok: false, reason: "not connected" });
    channel
      .push(event, payload)
      .receive("ok", (p) => resolve({ ok: true, payload: p }))
      .receive("error", (p: { reason?: string }) => resolve({ ok: false, reason: p?.reason ?? "error" }))
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
    ch.on("thread.archived", ({ id }) => removeThread(id));
    ch.onClose(() => setConnected(false));
    ch.onError(() => setConnected(false));
    ch.join().receive("ok", (reply: { projects: Project[]; threads: Thread[] }) => {
      setLobby(reply.projects, reply.threads);
      setConnected(true);
    });
  }, []);

  return { connected };
}

export const lobbyChannel = () => lobby;

/** Joins thread:<id> while mounted. Rejoins (after a reconnect) re-hydrate from a fresh snapshot. */
export function useThreadChannel(id: string | null) {
  const ref = useRef<Channel | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setJoinError(null);
    const ch = socket.channel(`thread:${id}`, {});
    ref.current = ch;
    const { hydrate, apply } = useStore.getState();

    ch.on("event", (p: ThreadEvent | { batch: ThreadEvent[] }) => apply("batch" in p ? p.batch : [p]));
    ch.join()
      .receive("ok", (snap: Snapshot) => hydrate(snap))
      .receive("error", (e: { reason?: string }) => setJoinError(e?.reason ?? "join failed"));

    return () => {
      ch.leave();
      ref.current = null;
    };
  }, [id]);

  return { channel: ref, joinError };
}
