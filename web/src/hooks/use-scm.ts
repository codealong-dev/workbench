import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { push } from "@/hooks/use-channels";
import type { ScmChanges } from "@/contracts";

/**
 * What is staged and what is not. Refetches when `trigger` changes (the diff
 * refetches when files change on disk) and after each operation, which
 * answers with the new state.
 */
export function useScm(channel: RefObject<Channel | null>, trigger: unknown) {
  const [changes, setChanges] = useState<ScmChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // the newest request wins
  const seq = useRef(0);

  const run = useCallback(
    async (event: string, paths?: string[]) => {
      const n = ++seq.current;
      const r = await push(channel.current, event, paths ? { paths } : {});
      if (n !== seq.current) return r.ok;
      if (r.ok) {
        setChanges(r.payload as ScmChanges);
        setError(null);
      } else setError(r.reason);
      return r.ok;
    },
    [channel],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    await run("scm.status");
    setLoading(false);
  }, [run]);

  useEffect(() => {
    if (channel.current) void refresh();
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const op = (event: string) => async (paths?: string[]) => {
    setBusy(true);
    const ok = await run(event, paths);
    setBusy(false);
    return ok;
  };

  return { changes, error, loading, busy, refresh, stage: op("scm.stage"), unstage: op("scm.unstage"), discard: op("scm.discard") };
}
