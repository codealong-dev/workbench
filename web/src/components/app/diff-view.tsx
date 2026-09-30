import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { ExternalLink } from "lucide-react";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DiffResult } from "@/contracts";
import { useResolvedTheme } from "@/lib/theme";

const LAYOUT_KEY = "wb.diffStyle";

/** +a −d. `compact` drops a zero side, like `+5` for a new file. */
export function Counts({ additions, deletions, className, compact }: { additions: number; deletions: number; className?: string; compact?: boolean }) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {(!compact || additions > 0) && <span className="text-green-600 dark:text-green-400">+{additions}</span>}
      {!compact || (additions > 0 && deletions > 0) ? " " : null}
      {(!compact || deletions > 0) && <span className="text-red-600 dark:text-red-400">−{deletions}</span>}
    </span>
  );
}

const DiffBlock = memo(function DiffBlock(props: { file: FileDiffMetadata; diffStyle: "split" | "unified"; onOpenFile: (path: string) => void }) {
  const themeType = useResolvedTheme();
  return (
    <FileDiff
      fileDiff={props.file}
      options={{
        diffStyle: props.diffStyle,
        theme: { light: "light-plus", dark: "dark-plus" },
        themeType,
        overflow: "wrap",
        lineDiffType: "word",
        hunkSeparators: "line-info",
      }}
      renderHeaderMetadata={(f) =>
        f.type !== "deleted" ? (
          <button
            type="button"
            title="Open in editor"
            onClick={() => props.onOpenFile(f.name)}
            className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </button>
        ) : null
      }
    />
  );
});

/** Every changed file's diff, stacked. `focus` scrolls to one file (loading it first if the patch was cut). */
export function DiffView(props: {
  diff: DiffResult | null;
  error: string | null;
  focus: { path: string; n: number } | null;
  onOpenFile: (path: string) => void;
  loadFile: (path: string) => Promise<string | null>;
}) {
  const { diff, error, focus, onOpenFile, loadFile } = props;
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">(() => (localStorage.getItem(LAYOUT_KEY) as "split") ?? "unified");
  const [lazy, setLazy] = useState<Record<string, FileDiffMetadata[]>>({});
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  // Parse the whole patch once per fetch; key by new file name.
  const parsed = useMemo(() => {
    if (!diff?.patch) return new Map<string, FileDiffMetadata>();
    try {
      const files = parsePatchFiles(diff.patch, `wb-${diff.patch.length}`).flatMap((p) => p.files);
      return new Map(files.map((f) => [f.name, f]));
    } catch {
      return new Map<string, FileDiffMetadata>();
    }
  }, [diff?.patch]);

  useEffect(() => setLazy({}), [diff]);

  const files = diff?.files ?? [];
  const totals = useMemo(
    () => files.reduce((a, f) => ({ additions: a.additions + f.additions, deletions: a.deletions + f.deletions }), { additions: 0, deletions: 0 }),
    [files],
  );

  // jump to a file picked in the Changes tab
  useEffect(() => {
    if (!focus || !diff) return;
    let cancelled = false;
    void (async () => {
      if (diff.truncated && !lazy[focus.path]) {
        const patch = await loadFile(focus.path);
        if (patch && !cancelled) setLazy((l) => ({ ...l, [focus.path]: parsePatchFiles(patch).flatMap((p) => p.files) }));
      }
      requestAnimationFrame(() => refs.current[focus.path]?.scrollIntoView({ behavior: "smooth", block: "start" }));
    })();
    return () => {
      cancelled = true;
    };
  }, [focus, diff]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {diff ? (
            <>
              vs <span className="font-mono text-foreground">{diff.base}</span> · {files.length} {files.length === 1 ? "file" : "files"} · <Counts {...totals} />
            </>
          ) : (
            "Loading…"
          )}
        </div>
        <Tabs
          value={diffStyle}
          onValueChange={(v) => {
            setDiffStyle(v as "split");
            localStorage.setItem(LAYOUT_KEY, v);
          }}
          size="compact"
        >
          <TabsList>
            <TabItem value="unified" label="Unified" />
            <TabItem value="split" label="Split" />
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="m-4 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
        {diff && files.length === 0 && !error && <div className="py-20 text-center text-[13px] text-muted-foreground">No changes yet.</div>}
        {diff?.truncated && <div className="px-4 pt-3 text-[12px] text-muted-foreground">This diff is large. Pick a file in Changes to load it.</div>}

        <div className="flex flex-col gap-3 p-3">
          {files.map((f) => {
            const blocks = diff?.truncated ? lazy[f.path] : parsed.get(f.path) ? [parsed.get(f.path)!] : [];
            if (!blocks?.length) {
              return f.binary ? (
                <div key={f.path} ref={(el) => void (refs.current[f.path] = el)} className="rounded-lg px-3 py-2 text-[12px] text-muted-foreground shadow-surface-1">
                  <span className="font-mono">{f.path}</span>: binary file
                </div>
              ) : diff?.truncated ? (
                <div key={f.path} ref={(el) => void (refs.current[f.path] = el)} />
              ) : null;
            }
            return (
              <div key={f.path} ref={(el) => void (refs.current[f.path] = el)} className="wb-diff scroll-mt-3 overflow-hidden rounded-lg shadow-surface-1">
                {blocks.map((b, i) => (
                  <DiffBlock key={i} file={b} diffStyle={diffStyle} onOpenFile={onOpenFile} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
