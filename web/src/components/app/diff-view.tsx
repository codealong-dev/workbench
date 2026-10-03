import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { ArrowUpFromLine, BookOpenText, Columns2, ExternalLink, FileDiff as FileDiffIcon, Loader2, Rows2, ScanSearch, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DiffFile, DiffResult, GuideData } from "@/contracts";
import { fileIcon } from "@/lib/file-icons";
import { useResolvedTheme } from "@/lib/theme";
import { GuideView } from "./guide-view";

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

/** The line a double click landed on: its number in the new file (none for removed lines). */
function clickedLine(e: React.MouseEvent): number | undefined {
  for (const el of e.nativeEvent.composedPath()) {
    if (!(el instanceof HTMLElement) || !el.hasAttribute("data-line")) continue;
    if (el.getAttribute("data-line-type") === "change-deletion") return undefined;
    const n = Number(el.getAttribute("data-line"));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

export const DiffBlock = memo(function DiffBlock(props: {
  file: FileDiffMetadata;
  diffStyle: "split" | "unified";
  onOpenFile: (path: string) => void;
  /** Double click: the file, at the line clicked, in a panel. */
  onOpenLine?: (path: string, line?: number) => void;
}) {
  const themeType = useResolvedTheme();
  const { onOpenLine } = props;
  return (
    <div onDoubleClick={onOpenLine && props.file.type !== "deleted" ? (e) => onOpenLine(props.file.name, clickedLine(e)) : undefined}>
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
    </div>
  );
});

/** The parsed patch of every file: the whole patch parsed once, or (when it was too large to send) each file's, loaded on demand. */
export function usePatches(diff: DiffResult | null, loadFile: (path: string) => Promise<string | null>) {
  const [lazy, setLazy] = useState<Record<string, FileDiffMetadata[]>>({});

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

  /** undefined until there is something to show for the file. */
  const blocks = useCallback(
    (path: string): FileDiffMetadata[] | undefined => (diff?.truncated ? lazy[path] : parsed.get(path) ? [parsed.get(path)!] : undefined),
    [diff?.truncated, lazy, parsed],
  );

  const load = useCallback(
    async (path: string) => {
      if (!diff?.truncated || lazy[path]) return;
      const patch = await loadFile(path);
      if (patch) setLazy((l) => ({ ...l, [path]: parsePatchFiles(patch).flatMap((p) => p.files) }));
    },
    [diff?.truncated, lazy, loadFile],
  );

  return { blocks, load, lazy };
}

export type Patches = ReturnType<typeof usePatches>;

/** How long a guide has been in the making. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

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
  onOpenLine?: (path: string, line?: number) => void;
  loadFile: (path: string) => Promise<string | null>;
  /** Shows a Review button; resolves with an error message, or null. */
  onReview?: () => Promise<string | null>;
  /** Shows a Push button, which opens the commit and push dialog. */
  onPush?: () => void;
  /** Shows the Guide tab: the changes grouped by a model. */
  guide?: { data: GuideData | null; generate: () => Promise<string | null>; cancel: () => void };
  /** Which tab shows first (a pull request's workspace opens on its guide). */
  initialView?: "changes" | "guide";
}) {
  const { diff, error, focus, onActive, onOpenFile, onOpenLine, loadFile, onReview, onPush, guide } = props;
  const [view, setView] = useState<"changes" | "guide">(guide ? (props.initialView ?? "changes") : "changes");
  const [guideError, setGuideError] = useState<string | null>(null);
  const generating = guide?.data?.state.status === "generating";
  const generate = async () => {
    if (!guide) return;
    setView("guide");
    setGuideError(await guide.generate());
  };
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const review = async () => {
    if (!onReview || reviewing) return;
    setReviewing(true);
    setReviewError(null);
    setReviewError(await onReview());
    setReviewing(false);
  };
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">(() => (localStorage.getItem(LAYOUT_KEY) as "split") ?? "unified");
  const patches = usePatches(diff, loadFile);
  const { lazy } = patches;
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  // After jumping to a file, keep it as the active one until the user scrolls themselves
  // (the smooth scroll would otherwise flick through every file on the way).
  const jumping = useRef(false);

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
      await patches.load(focus.path);
      if (!cancelled) requestAnimationFrame(() => refs.current[focus.path]?.scrollIntoView({ behavior: "smooth", block: "start" }));
    })();
    return () => {
      cancelled = true;
    };
  }, [focus, diff]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DiffHeader
        file={view === "changes" ? (files.find((f) => f.path === active) ?? files[0]) : undefined}
        index={Math.max(0, files.findIndex((f) => f.path === active)) + 1}
        total={files.length}
      >
        {guide && (
          <Tabs value={view} onValueChange={(v) => setView(v as "changes" | "guide")} size="compact">
            <TabsList>
              <TabItem value="changes" label="Changes" icon={FileDiffIcon} iconOnly />
              <TabItem value="guide" label="Guide" icon={BookOpenText} iconOnly />
            </TabsList>
          </Tabs>
        )}
        {view === "changes" && (
          <Tabs
            value={diffStyle}
            onValueChange={(v) => {
              setDiffStyle(v as "split");
              localStorage.setItem(LAYOUT_KEY, v);
            }}
            size="compact"
          >
            <TabsList>
              <TabItem value="unified" label="Unified diff" icon={Rows2} iconOnly />
              <TabItem value="split" label="Split diff" icon={Columns2} iconOnly />
            </TabsList>
          </Tabs>
        )}
        {guide &&
          (generating ? (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <Elapsed since={guide.data!.state.started_at ?? Date.now()} />
              <Button size="compact" variant="ghost" onClick={guide.cancel}>
                Cancel
              </Button>
            </div>
          ) : (
            // a first guide is generated from the Guide tab's own button; Regenerate only shows there
            view === "guide" && guide.data?.guide && (
              <Button size="compact" variant="ghost" leadingIcon={Sparkles} disabled={files.length === 0} onClick={() => void generate()} title="Have a model group these changes into a new guide">
                Regenerate
              </Button>
            )
          ))}
        {onReview && (
          <Button size="icon-compact" variant="ghost" aria-label="Review" disabled={reviewing || files.length === 0} onClick={() => void review()} title="Have a second agent review these changes">
            {reviewing ? <Loader2 className="animate-spin" /> : <ScanSearch />}
          </Button>
        )}
        {onPush && (
          <Button size="icon-compact" variant="ghost" aria-label="Commit and push" onClick={onPush} title="Commit these changes and push the branch">
            <ArrowUpFromLine />
          </Button>
        )}
      </DiffHeader>

      <div
        ref={scroller}
        className={cn("min-h-0 flex-1 overflow-y-auto", view === "guide" && "hidden")}
        onScroll={onScroll}
        onWheel={takeOver}
        onTouchMove={takeOver}
        onPointerDown={takeOver}
        onKeyDown={takeOver}
      >
        {error && <div className="m-4 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
        {reviewError && <div className="m-4 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">Couldn't start the review: {reviewError}</div>}
        {diff && files.length === 0 && !error && <div className="py-20 text-center text-[13px] text-muted-foreground">No changes yet.</div>}
        {diff?.truncated && <div className="px-4 pt-3 text-[12px] text-muted-foreground">This diff is large. Pick a file in Changes to load it.</div>}

        <div className="flex flex-col gap-3 p-3">
          {files.map((f) => {
            const blocks = patches.blocks(f.path);
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
                  <DiffBlock key={i} file={b} diffStyle={diffStyle} onOpenFile={onOpenFile} onOpenLine={onOpenLine} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {view === "guide" && guide && (
        <GuideView
          diff={diff}
          data={guide.data}
          error={guideError}
          patches={patches}
          diffStyle={diffStyle}
          onOpenFile={onOpenFile}
          onOpenLine={onOpenLine}
          onGenerate={() => void generate()}
        />
      )}
    </div>
  );
}
