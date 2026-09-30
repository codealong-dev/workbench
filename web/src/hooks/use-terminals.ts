import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { push } from "@/hooks/use-channels";
import type { TerminalInfo } from "@/contracts";

/** The thread's terminals (shared with its sessions), kept in sync by the server's `terminals` pushes. */
export function useTerminals(channel: RefObject<Channel | null>, enabled: boolean) {
  const [terminals, setTerminals] = useState<TerminalInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ch = channel.current;
    if (!enabled || !ch) return;
    const ref = ch.on("terminals", ({ terminals }: { terminals: TerminalInfo[] }) => setTerminals(terminals));
    void push(ch, "terminals").then((r) => {
      if (r.ok) setTerminals((r.payload as { terminals: TerminalInfo[] }).terminals);
      else setError(r.reason);
    });
    return () => ch.off("terminals", ref);
  }, [channel, enabled]);

  const create = useCallback(
    async (cols?: number, rows?: number): Promise<TerminalInfo | null> => {
      const r = await push(channel.current, "terminal.create", { ...(cols ? { cols, rows } : {}) });
      if (!r.ok) {
        setError(r.reason);
        return null;
      }
      const t = r.payload as TerminalInfo;
      setTerminals((ts) => (ts?.some((x) => x.id === t.id) ? ts : [...(ts ?? []), t]));
      return t;
    },
    [channel],
  );

  const close = useCallback(
    async (id: string) => {
      setTerminals((ts) => ts?.filter((t) => t.id !== id) ?? null);
      await push(channel.current, "terminal.close", { id });
    },
    [channel],
  );

  return { terminals, error, create, close };
}
