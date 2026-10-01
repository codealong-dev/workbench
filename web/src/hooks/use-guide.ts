import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { push } from "@/hooks/use-channels";
import type { DiffResult, GuideData } from "@/contracts";

/**
 * The workspace's review guide, its state (idle, generating, error) and
 * whether it is stale. The server pushes every change; it is re-read when
 * the diff changes, which is when a guide can go stale.
 */
export function useGuide(channel: RefObject<Channel | null>, ready: boolean, diff: DiffResult | null) {
  const [data, setData] = useState<GuideData | null>(null);

  const load = useCallback(async () => {
    const r = await push(channel.current, "guide");
    if (r.ok) setData(r.payload as GuideData);
  }, [channel]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load, diff]);

  useEffect(() => {
    const ch = channel.current;
    if (!ch || !ready) return;
    const ref = ch.on("guide", (d: GuideData) => setData(d));
    return () => ch.off("guide", ref);
  }, [channel, ready]);

  /** Resolves with an error message, or null. */
  const generate = useCallback(async (): Promise<string | null> => {
    const r = await push(channel.current, "guide.generate");
    return r.ok ? null : r.reason;
  }, [channel]);

  const cancel = useCallback(async () => void (await push(channel.current, "guide.cancel")), [channel]);

  return { data, generate, cancel };
}
