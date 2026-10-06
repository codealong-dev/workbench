import { useEffect, type ReactNode } from "react";
import { useWorkerPool, WorkerPoolContextProvider } from "@pierre/diffs/react";
import { getCodePrefs, useCodePrefs } from "./code-prefs";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";

/**
 * Syntax highlighting for every diff, off the main thread: a large diff
 * otherwise freezes the app while Shiki tokenizes it. The options here are the
 * pool's, so they match the ones `DiffBlock` asks for (and follow the
 * word-highlight setting when it changes).
 */
export function DiffWorkers({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize: Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)) }}
      highlighterOptions={{ theme: { light: "light-plus", dark: "dark-plus" }, lineDiffType: getCodePrefs().diff.lineDiffType }}
    >
      <FollowPrefs />
      {children}
    </WorkerPoolContextProvider>
  );
}

function FollowPrefs() {
  const pool = useWorkerPool();
  const { lineDiffType } = useCodePrefs().diff;
  useEffect(() => void pool?.setRenderOptions({ lineDiffType }), [pool, lineDiffType]);
  return null;
}
