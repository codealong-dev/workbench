import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { push } from "@/hooks/use-channels";
import type { DiffResult, Status } from "@/contracts";

/**
 * The thread's changes against its base. Refetches when the thread settles
 * (a turn or setup finished) and when `full` flips on. With `full` off only
 * the file list is fetched, for the header badge.
 */
export function useDiff(channel: RefObject<Channel | null>, status: Status | undefined, full: boolean) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prev = useRef<Status | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!channel.current) return;
    setLoading(true);
    const r = await push(channel.current, "diff", full ? {} : { summary: true });
    setLoading(false);
    if (r.ok) {
      setDiff(r.payload as DiffResult);
      setError(null);
    } else setError(r.reason);
  }, [channel, full]);

  // Initial load (after join), and whenever full/summary mode changes.
  useEffect(() => {
    if (status === undefined) return;
    void refresh();
  }, [refresh, status === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when the thread goes back to idle: the agent (or setup) just finished.
  useEffect(() => {
    if (prev.current && prev.current !== "idle" && status === "idle") void refresh();
    prev.current = status;
  }, [status, refresh]);

  return { diff, error, loading, refresh };
}

/** Lazily fetch one file's patch (used when the full patch was too large). */
export async function fetchFilePatch(channel: Channel | null, path: string): Promise<string | null> {
  const r = await push(channel, "diff", { path });
  return r.ok ? ((r.payload as { patch: string }).patch ?? null) : null;
}
