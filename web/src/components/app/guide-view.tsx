import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { fileIcon } from "@/lib/file-icons";
import { cn } from "@/lib/utils";
import type { DiffFile, DiffResult, GuideData, GuideGroup } from "@/contracts";
import { VirtualizerContext } from "@pierre/diffs/react";
import { Counts, DiffBlock, useVirtualScroller, type Patches } from "./diff-view";

const VIEWED_KEY = "wb.guideViewed.";

/** The files ticked as read, kept per guide so a new one starts clean. */
function useViewed(guideId: string | undefined) {
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setViewed(new Set(guideId ? (JSON.parse(localStorage.getItem(VIEWED_KEY + guideId) ?? "[]") as string[]) : []));
    } catch {
      setViewed(new Set());
    }
  }, [guideId]);
  const toggle = useCallback(
    (path: string) =>
      setViewed((v) => {
        const next = new Set(v);
        if (!next.delete(path)) next.add(path);
        if (guideId) localStorage.setItem(VIEWED_KEY + guideId, JSON.stringify([...next]));
        return next;
      }),
    [guideId],
  );
  return { viewed, toggle };
}

const pad = (n: number) => String(n).padStart(2, "0");

function FileChip({ file, viewed, onOpen, onToggle }: { file: DiffFile; viewed: boolean; onOpen: () => void; onToggle: () => void }) {
  const slash = file.path.lastIndexOf("/");
  const { icon: Icon, className } = fileIcon(file.path);
  return (
    <div className="group/chip flex items-center gap-2 rounded-lg bg-surface-3 px-2.5 py-1.5 text-[12px] shadow-surface-1">
      <button type="button" onClick={onOpen} title={file.path} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none">
        <Icon size={14} strokeWidth={1.5} className={cn("shrink-0", className)} />
        <span className={cn("shrink-0 font-mono", file.status === "deleted" && "line-through")}>{file.path.slice(slash + 1)}</span>
        {slash >= 0 && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{file.path.slice(0, slash)}</span>}
      </button>
      {!file.binary && <Counts additions={file.additions} deletions={file.deletions} compact className="shrink-0" />}
      <button
        type="button"
        onClick={onToggle}
        aria-label={viewed ? "Mark as not viewed" : "Mark as viewed"}
        aria-pressed={viewed}
        title={viewed ? "Viewed" : "Mark as viewed"}
        className={cn(
          "shrink-0 rounded p-0.5 outline-none transition-colors",
          viewed ? "text-[color:var(--focus-ring,#6B97FF)]" : "text-muted-foreground/40 hover:text-foreground",
        )}
      >
        <Check size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

function Chunk(props: {
  index: number;
  total: number;
  group: GuideGroup;
  files: DiffFile[];
  patches: Patches;
  diffStyle: "split" | "unified";
  viewed: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenLine?: (path: string, line?: number) => void;
  setRef: (el: HTMLElement | null) => void;
}) {
  const { index, total, group, files, patches, diffStyle, viewed, onToggle, onOpenFile, onOpenLine } = props;
  const cards = useRef<Record<string, HTMLDivElement | null>>({});
  const reveal = (path: string) => cards.current[path]?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <section ref={props.setRef} className="grid scroll-mt-2 grid-cols-1 gap-4 py-7 @3xl:grid-cols-[minmax(240px,340px)_minmax(0,1fr)] @3xl:gap-8">
      <div className="flex min-w-0 flex-col gap-3 @3xl:sticky @3xl:top-3 @3xl:self-start">
        <div>
          <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {pad(index)} / {pad(total)}
          </div>
          <h2 className="mt-1 text-[17px] leading-snug font-medium tracking-[-0.01em] text-balance">{group.title}</h2>
        </div>
        {group.summary && <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{group.summary}</p>}
        <div className="flex flex-col gap-1.5">
          {files.map((f) => (
            <FileChip key={f.path} file={f} viewed={viewed.has(f.path)} onOpen={() => reveal(f.path)} onToggle={() => onToggle(f.path)} />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {files.map((f) => {
          const blocks = patches.blocks(f.path);
          return (
            <div
              key={f.path}
              ref={(el) => void (cards.current[f.path] = el)}
              className={cn(
                "wb-diff scroll-mt-3 overflow-x-auto rounded-lg shadow-surface-1",
                viewed.has(f.path) && "opacity-60",
              )}
            >
              {blocks?.length ? (
                blocks.map((b, i) => <DiffBlock key={i} file={b} diffStyle={diffStyle} onOpenFile={onOpenFile} onOpenLine={onOpenLine} />)
              ) : (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">
                  <span className="font-mono">{f.path}</span>: {f.binary ? "binary file" : "loading…"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A thin tick per chunk at the edge, the one being read lit; click to jump. */
function Rail({ titles, active, onJump }: { titles: string[]; active: number; onJump: (i: number) => void }) {
  return (
    <nav aria-label="Guide chunks" className="absolute top-1/2 left-1.5 z-10 flex -translate-y-1/2 flex-col gap-1">
      {titles.map((t, i) => (
        <button key={i} type="button" title={t} aria-label={`${pad(i + 1)} ${t}`} onClick={() => onJump(i)} className="group/tick flex h-3 w-4 items-center outline-none">
          <span className={cn("h-px transition-all duration-150", i === active ? "w-4 bg-foreground" : "w-2 bg-muted-foreground/40 group-hover/tick:w-3 group-hover/tick:bg-muted-foreground")} />
        </button>
      ))}
    </nav>
  );
}

/**
 * The review guide: the changes in the order a model suggests reading them.
 * Each chunk is a row, its story on the left and its files' diffs stacked
 * on the right.
 */
export function GuideView(props: {
  diff: DiffResult | null;
  data: GuideData | null;
  error: string | null;
  patches: Patches;
  diffStyle: "split" | "unified";
  onOpenFile: (path: string) => void;
  onOpenLine?: (path: string, line?: number) => void;
  onGenerate: () => void;
}) {
  const { diff, data, error, patches, diffStyle, onOpenFile, onOpenLine, onGenerate } = props;
  const guide = data?.guide ?? null;
  const generating = data?.state.status === "generating";
  const failure = error ?? (data?.state.status === "error" ? data.state.message : null);
  const { viewed, toggle } = useViewed(guide?.generated_at);

  // the guide's chunks over the files that are still changed, then (when the
  // changes moved on) the files it has never seen
  const chunks = useMemo(() => {
    if (!guide || !diff) return [];
    const byPath = new Map(diff.files.map((f) => [f.path, f]));
    const placed = new Set(guide.groups.flatMap((g) => g.files));
    const out = guide.groups
      .map((g) => ({ group: g, files: g.files.flatMap((p) => byPath.get(p) ?? []) }))
      .filter((c) => c.files.length > 0);
    const unseen = diff.files.filter((f) => !placed.has(f.path));
    if (unseen.length) out.push({ group: { title: "Not in the guide", summary: "Changed after this guide was written.", files: unseen.map((f) => f.path) }, files: unseen });
    return out;
  }, [guide, diff]);

  // truncated diffs hand out patches on request: ask for the guide's files
  const { load } = patches;
  useEffect(() => {
    if (!diff?.truncated) return;
    for (const c of chunks) for (const f of c.files) if (!f.binary) void load(f.path);
  }, [chunks, diff?.truncated, load]);

  const scroller = useRef<HTMLDivElement>(null);
  const { virtualizer, ref: scrollerRef } = useVirtualScroller(scroller);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const spy = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const edge = box.getBoundingClientRect().top + 24;
    let current = 0;
    sections.current.forEach((el, i) => {
      if (el && el.getBoundingClientRect().top <= edge) current = i;
    });
    if (box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) current = Math.max(0, chunks.length - 1);
    setActive(current);
  }, [chunks.length]);
  useEffect(spy, [spy, chunks]);
  const jump = (i: number) => sections.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (!guide) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-12">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          {generating ? (
            <>
              <ThinkingIndicator />
              <p className="text-[12px] text-muted-foreground">A model is reading the changes and grouping them. This takes a minute or so.</p>
            </>
          ) : (
            <>
              <p className="text-[13px] text-pretty text-muted-foreground">A guide groups these changes into the order a reviewer would read them, each with a short explanation of why.</p>
              <Button size="compact" onClick={onGenerate} disabled={!diff || diff.files.length === 0}>
                Generate guide
              </Button>
            </>
          )}
          {failure && <div className="w-full rounded-lg bg-destructive-light px-3 py-2 text-left text-[12px] text-destructive">Couldn't write the guide: {failure}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      <VirtualizerContext.Provider value={virtualizer}>
        <div ref={scrollerRef} onScroll={spy} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-8 pb-10">
            {failure && <div className="mt-4 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">Couldn't write the guide: {failure}</div>}
            {generating && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface-3 px-3 py-2 text-[12px] text-muted-foreground shadow-surface-1">
                <ThinkingIndicator showIcon={false} /> Writing a new guide. This one stays until it is ready.
              </div>
            )}
            {data?.stale && !generating && (
              <div className="mt-4 flex items-center gap-3 rounded-lg bg-surface-3 px-3 py-2 text-[12px] text-muted-foreground shadow-surface-1">
                <span className="min-w-0 flex-1">The changes moved on since this guide was written.</span>
                <Button size="compact" variant="ghost" onClick={onGenerate}>
                  Regenerate
                </Button>
              </div>
            )}
            <header className="pt-6">
              {guide.summary && <p className="max-w-[70ch] text-[14px] leading-relaxed text-pretty">{guide.summary}</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {guide.model ?? guide.provider} · {new Date(guide.generated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </header>
            <div className="divide-y divide-border">
              {chunks.map((c, i) => (
                <Chunk
                  key={c.group.title + i}
                  index={i + 1}
                  total={chunks.length}
                  group={c.group}
                  files={c.files}
                  patches={patches}
                  diffStyle={diffStyle}
                  viewed={viewed}
                  onToggle={toggle}
                  onOpenFile={onOpenFile}
                  onOpenLine={onOpenLine}
                  setRef={(el) => void (sections.current[i] = el)}
                />
              ))}
            </div>
          </div>
        </div>
      </VirtualizerContext.Provider>
      {chunks.length > 1 && <Rail titles={chunks.map((c) => c.group.title)} active={active} onJump={jump} />}
    </div>
  );
}
