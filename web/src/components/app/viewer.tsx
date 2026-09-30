import { useEffect, useRef, useState } from "react";
import type { Channel } from "phoenix";
import { File as CodeFile } from "@pierre/diffs/react";
import { ExternalLink, FileDiff as FileDiffIcon, X } from "lucide-react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { fetchFile } from "@/hooks/use-files";
import { fileIcon } from "@/lib/file-icons";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/lib/theme";
import type { DiffResult, FileContent } from "@/contracts";
import { DiffView } from "./diff-view";
import { PANEL } from "./panel";

export type ViewerTab = { kind: "diff" } | { kind: "file"; path: string };
export const tabKey = (t: ViewerTab) => (t.kind === "diff" ? "diff" : "f:" + t.path);

// ── tab strip ───────────────────────────────────────────────────────────────

function Tab(props: { tab: ViewerTab; index: number; active: boolean; register: (i: number, el: HTMLElement | null) => void; onActivate: () => void; onClose: () => void; count?: number }) {
  const { tab, index, active, register, onActivate, onClose, count } = props;
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(register, index, ref);
  const name = tab.kind === "diff" ? "Changes" : tab.path.slice(tab.path.lastIndexOf("/") + 1);
  const { icon: Icon, className } = tab.kind === "diff" ? { icon: FileDiffIcon, className: "text-muted-foreground" } : fileIcon(tab.path);
  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={tab.kind === "file" ? tab.path : "All changes against the base branch"}
      onClick={onActivate}
      onAuxClick={(e) => e.button === 1 && onClose()}
      onKeyDown={(e) => e.key === "Enter" && onActivate()}
      className={cn(
        "group/tab relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2 text-[12px] outline-none select-none",
        active ? "bg-active text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon size={14} strokeWidth={1.5} className={cn("shrink-0", className)} />
      <span className="max-w-40 truncate">{name}</span>
      {!!count && <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>}
      <button
        type="button"
        aria-label={`Close ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn("rounded p-0.5 hover:bg-hover hover:text-foreground", active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100")}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function TabStrip(props: { tabs: ViewerTab[]; active: string; onActivate: (key: string) => void; onClose: (key: string) => void; changeCount: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(ref, { axis: "x", gapClick: false });
  return (
    <div
      ref={ref}
      role="tablist"
      className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseMove={hover.handlers.onMouseMove}
      onMouseLeave={hover.handlers.onMouseLeave}
    >
      <FluidHoverHighlight hover={hover} className="rounded-md" />
      {props.tabs.map((t, i) => {
        const key = tabKey(t);
        return (
          <Tab
            key={key}
            tab={t}
            index={i}
            active={key === props.active}
            register={hover.registerItem}
            onActivate={() => props.onActivate(key)}
            onClose={() => props.onClose(key)}
            count={t.kind === "diff" ? props.changeCount : undefined}
          />
        );
      })}
    </div>
  );
}

// ── file view ───────────────────────────────────────────────────────────────

function FileView({ channel, path, version, onOpenInEditor }: { channel: Channel | null; path: string; version: number; onOpenInEditor: (path: string) => void }) {
  const themeType = useResolvedTheme();
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchFile(channel, path).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setFile(r.file);
        setError(null);
      } else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [channel, path, version]);

  const slash = path.lastIndexOf("/");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="min-w-0 flex-1 truncate font-mono text-[12px]" title={path}>
          {slash >= 0 && <span className="text-muted-foreground">{path.slice(0, slash + 1)}</span>}
          {path.slice(slash + 1)}
        </div>
        {file && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatSize(file.size)}</span>}
        <button
          type="button"
          title="Open in editor"
          aria-label="Open in editor"
          onClick={() => onOpenInEditor(path)}
          className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
        {!file && !error && <div className="p-4 text-[12px] text-muted-foreground">Loading…</div>}
        {file?.binary && <div className="py-20 text-center text-[13px] text-muted-foreground">Binary file, {formatSize(file.size)}.</div>}
        {file && !file.binary && (
          <>
            {file.truncated && <div className="px-4 pt-3 text-[12px] text-muted-foreground">Showing the first 1 MB.</div>}
            <div className="wb-diff">
              <CodeFile
                file={{ name: path, contents: file.content ?? "" }}
                options={{ theme: { light: "light-plus", dark: "dark-plus" }, themeType, overflow: "scroll", disableFileHeader: true }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ── viewer ──────────────────────────────────────────────────────────────────

/** The middle pane: the combined diff and any files opened from the tree, as tabs. */
export function Viewer(props: {
  tabs: ViewerTab[];
  active: string;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  channel: Channel | null;
  /** bumps when the agent finishes a turn, so open files re-read */
  version: number;
  diff: DiffResult | null;
  diffError: string | null;
  focus: { path: string; n: number } | null;
  loadPatch: (path: string) => Promise<string | null>;
  onOpenInEditor: (path: string) => void;
}) {
  const { tabs, active, channel } = props;
  const { width, dragging, onMouseDown } = useResizableWidth("wb.viewerWidth", Math.round(window.innerWidth * 0.4), 360, 1400, "left");
  const current = tabs.find((t) => tabKey(t) === active) ?? tabs[0];

  return (
    <section className={cn("relative flex min-h-0 min-w-[320px] shrink flex-col", PANEL, "overflow-visible")} style={{ width }}>
      <ResizeHandle onMouseDown={onMouseDown} dragging={dragging} side="left" />
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1">
        <TabStrip tabs={tabs} active={active} onActivate={props.onActivate} onClose={props.onClose} changeCount={props.diff?.files.length ?? 0} />
      </div>
      {current?.kind === "diff" && (
        <DiffView diff={props.diff} error={props.diffError} focus={props.focus} onOpenFile={props.onOpenInEditor} loadFile={props.loadPatch} />
      )}
      {current?.kind === "file" && <FileView key={current.path} channel={channel} path={current.path} version={props.version} onOpenInEditor={props.onOpenInEditor} />}
    </section>
  );
}
