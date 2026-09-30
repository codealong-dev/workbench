import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { push } from "@/hooks/use-channels";
import type { FileContent, FileList, Status } from "@/contracts";

/** The worktree's files, fetched while `enabled` and again whenever the thread settles. */
export function useFiles(channel: RefObject<Channel | null>, status: Status | undefined, enabled: boolean) {
  const [list, setList] = useState<FileList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prev = useRef<Status | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!channel.current) return;
    setLoading(true);
    const r = await push(channel.current, "files");
    setLoading(false);
    if (r.ok) {
      setList(r.payload as FileList);
      setError(null);
    } else setError(r.reason);
  }, [channel]);

  useEffect(() => {
    if (enabled && status !== undefined) void refresh();
  }, [enabled, refresh, status === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (enabled && prev.current && prev.current !== "idle" && status === "idle") void refresh();
    prev.current = status;
  }, [status, enabled, refresh]);

  return { list, error, loading, refresh };
}

export async function fetchFile(channel: Channel | null, path: string): Promise<{ ok: true; file: FileContent } | { ok: false; error: string }> {
  const r = await push(channel, "file", { path });
  return r.ok ? { ok: true, file: r.payload as FileContent } : { ok: false, error: r.reason };
}
