import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { ExternalLink } from "lucide-react";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DiffFile, DiffResult } from "@/contracts";
import { fileIcon } from "@/lib/file-icons";
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

/** Top bar: which file the diff is scrolled to (so it stays visible however long the file is), and the layout toggle. */
function DiffHeader({ file, index, total, children }: { file: DiffFile | undefined; index: number; total: number; children: React.ReactNode }) {
  const slash = file ? file.path.lastIndexOf("/") : -1;
  const Icon = file ? fileIcon(file.path).icon : null;
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px]">
      {file && Icon ? (
        <div className="flex min-w-0 flex-1 items-center gap-2" title={file.old_path ? `${file.old_path} → ${file.path}` : file.path}>
          <Icon size={14} strokeWidth={1.5} className={cn("shrink-0", fileIcon(file.path).className)} />
          <div className="min-w-0 truncate font-mono">
            {slash >= 0 && <span className="text-muted-foreground">{file.path.slice(0, slash + 1)}</span>}
            <span className={cn("text-foreground", file.status === "deleted" && "line-through")}>{file.path.slice(slash + 1)}</span>
          </div>
          {!file.binary && <Counts additions={file.additions} deletions={file.deletions} compact className="shrink-0" />}
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {index} / {total}
          </span>
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {children}
    </div>
  );
}

/** Every changed file's diff, stacked. `focus` scrolls to one file (loading it first if the patch was cut); `onActive` reports the file being read. */
export function DiffView(props: {
  diff: DiffResult | null;
  error: string | null;
  focus: { path: string; n: number } | null;
  onActive?: (path: string | null) => void;
  onOpenFile: (path: string) => void;
  loadFile: (path: string) => Promise<string | null>;
}) {
  const { diff, error, focus, onActive, onOpenFile, loadFile } = props;
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">(() => (localStorage.getItem(LAYOUT_KEY) as "split") ?? "unified");
  const [lazy, setLazy] = useState<Record<string, FileDiffMetadata[]>>({});
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  // After jumping to a file, keep it as the active one until the user scrolls themselves
  // (the smooth scroll would otherwise flick through every file on the way).
  const jumping = useRef(false);

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

  const files = useMemo(() => diff?.files ?? [], [diff]);
  // The file being read: the last one whose top has scrolled past the top edge.
  const spy = useCallback(() => {
    const box = scroller.current;
    if (!box || jumping.current) return;
    const edge = box.getBoundingClientRect().top + 16;
    let current = files[0]?.path ?? null;
    for (const f of files) {
      const el = refs.current[f.path];
      if (!el) continue;
      if (el.getBoundingClientRect().top > edge) break;
      current = f.path;
    }
    // the last file may be too short to ever reach the top
    if (box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2 && files.length > 0) current = files[files.length - 1].path;
    setActive(current);
  }, [files]);

  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(spy);
  };
  const takeOver = () => void (jumping.current = false);

  useEffect(spy, [spy, diff, lazy]);
  useEffect(() => onActive?.(active), [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // jump to a file picked in the Changes tab
  useEffect(() => {
    if (!focus || !diff) return;
    let cancelled = false;
    jumping.current = true;
    setActive(focus.path);
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
      <DiffHeader file={files.find((f) => f.path === active) ?? files[0]} index={Math.max(0, files.findIndex((f) => f.path === active)) + 1} total={files.length}>
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
      </DiffHeader>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={onScroll}
        onWheel={takeOver}
        onTouchMove={takeOver}
        onPointerDown={takeOver}
        onKeyDown={takeOver}
      >
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
