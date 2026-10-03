import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpFromLine,
  ChevronRight,
  ChevronsDownUp,
  ExternalLink,
  Files,
  GitCompareArrows,
  GitPullRequest,
  List,
  ListTree,
  Minus,
  MoveRight,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import type { DiffFile, DiffResult, FileList, FileStatus, PushResult } from "@/contracts";
import { ancestors, buildTree, flattenTree, TreeRows, type Row } from "./file-tree";
import { Counts } from "./diff-view";
import { PANEL } from "./panel";

export type PanelTab = "files" | "changes";
type PushOutcome = { ok: true; result: PushResult } | { ok: false; error: string };

// ── bits ────────────────────────────────────────────────────────────────────

const STATUS: Record<FileStatus, { label: string; text: string; box: string; glyph: "dot" | "plus" | "minus" | "arrow" }> = {
  modified: { label: "Modified", text: "text-amber-600 dark:text-amber-400", box: "border-amber-500/70 text-amber-600 dark:text-amber-400", glyph: "dot" },
  added: { label: "Added", text: "text-green-600 dark:text-green-400", box: "border-green-500/70 text-green-600 dark:text-green-400", glyph: "plus" },
  untracked: { label: "Untracked", text: "text-green-600 dark:text-green-400", box: "border-green-500/70 text-green-600 dark:text-green-400", glyph: "plus" },
  deleted: { label: "Deleted", text: "text-red-600 dark:text-red-400 line-through", box: "border-red-500/70 text-red-600 dark:text-red-400", glyph: "minus" },
  renamed: { label: "Renamed", text: "text-blue-600 dark:text-blue-400", box: "border-blue-500/70 text-blue-600 dark:text-blue-400", glyph: "arrow" },
  copied: { label: "Copied", text: "text-blue-600 dark:text-blue-400", box: "border-blue-500/70 text-blue-600 dark:text-blue-400", glyph: "plus" },
};

function StatusBox({ status }: { status: FileStatus }) {
  const s = STATUS[status];
  return (
    <span title={s.label} className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border", s.box)}>
      {s.glyph === "dot" && <span className="size-1.5 rounded-full bg-current" />}
      {s.glyph === "plus" && <Plus size={10} strokeWidth={2.5} />}
      {s.glyph === "minus" && <Minus size={10} strokeWidth={2.5} />}
      {s.glyph === "arrow" && <MoveRight size={10} strokeWidth={2.5} />}
    </span>
  );
}

function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] [&_svg]:size-3.5",
          active && "bg-hover text-foreground",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex h-9 shrink-0 items-center gap-1 px-2">{children}</div>;
}

const splitPath = (p: string) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
};

// ── Files tab ───────────────────────────────────────────────────────────────

function FilesTab(props: {
  list: FileList | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  changes: Map<string, DiffFile>;
  selected: string | null;
  onOpen: (path: string, pin?: boolean) => void;
  onOpenInEditor: (path: string) => void;
}) {
  const { list, error, loading, onRefresh, changes, selected, onOpen, onOpenInEditor } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const paths = useMemo(() => list?.files ?? [], [list]);
  const tree = useMemo(() => buildTree(paths), [paths]);

  // reveal the file open in the viewer
  useEffect(() => {
    if (selected) setExpanded((e) => (ancestors(selected).every((a) => e.has(a)) ? e : new Set([...e, ...ancestors(selected)])));
  }, [selected]);

  // folders holding changes get a dot
  const changedDirs = useMemo(() => new Set([...changes.keys()].flatMap(ancestors)), [changes]);

  const decorate = (row: Row): Row => {
    if (row.kind === "dir") {
      return changedDirs.has(row.path) ? { ...row, meta: <span className="size-1.5 rounded-full bg-amber-500/80" title="Has changes" /> } : row;
    }
    const c = changes.get(row.path);
    return {
      ...row,
      nameClass: c ? STATUS[c.status].text : undefined,
      meta: c ? <StatusBox status={c.status} /> : undefined,
      actions: (
        <button
          type="button"
          aria-label="Open in editor"
          title="Open in editor"
          onClick={(e) => {
            e.stopPropagation();
            onOpenInEditor(row.path);
          }}
          className="rounded p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </button>
      ),
    };
  };

  const q = query.trim().toLowerCase();
  const rows: Row[] = useMemo(() => {
    if (!q) return flattenTree(tree, expanded, decorate);
    return paths
      .filter((p) => p.toLowerCase().includes(q))
      .slice(0, 300)
      .map((p) => {
        const { dir, name } = splitPath(p);
        return decorate({
          key: "f:" + p,
          depth: 0,
          kind: "file",
          path: p,
          name: (
            <>
              {name}
              {dir && <span className="ml-1.5 text-[11px] text-muted-foreground">{dir}</span>}
            </>
          ),
        });
      });
  }, [q, tree, expanded, paths, changes]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Toolbar>
        <div className="group/search relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Filter files…"
            aria-label="Filter files"
            className="h-7 w-full rounded-md bg-transparent pr-2 pl-7 text-[12px] ring-1 ring-transparent outline-none placeholder:text-muted-foreground hover:bg-muted/50 hover:ring-border focus:bg-card focus:ring-border"
          />
        </div>
        <IconButton label="Collapse folders" onClick={() => setExpanded(new Set())}>
          <ChevronsDownUp />
        </IconButton>
        <IconButton label="Refresh" onClick={onRefresh}>
          <RefreshCw className={cn(loading && "animate-spin")} />
        </IconButton>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {error && <div className="m-2 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
        {!list && !error && <div className="px-2 py-3 text-[12px] text-muted-foreground">Loading…</div>}
        {list && rows.length === 0 && <div className="px-2 py-3 text-[12px] text-muted-foreground">{q ? "No matching files" : "No files"}</div>}
        <TreeRows
          label="Files"
          rows={rows}
          selected={selected}
          onActivate={(row) => {
            if (row.kind === "dir")
              setExpanded((e) => {
                const n = new Set(e);
                if (n.has(row.path)) n.delete(row.path);
                else n.add(row.path);
                return n;
              });
            else onOpen(row.path);
          }}
          onDoubleActivate={(row) => row.kind === "file" && onOpen(row.path, true)}
        />
        {list?.truncated && <div className="px-2 py-2 text-[11px] text-muted-foreground">Showing the first {list.files.length.toLocaleString()} files.</div>}
      </div>
    </>
  );
}

// ── Changes tab ─────────────────────────────────────────────────────────────

function ChangesTab(props: {
  diff: DiffResult | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  selected: string | null;
  onOpen: (path: string, pin?: boolean) => void;
  onOpenInEditor: (path: string) => void;
  onPush: () => Promise<PushOutcome>;
}) {
  const { diff, error, loading, onRefresh, selected, onOpen, onOpenInEditor, onPush } = props;
  const [asTree, setAsTree] = useState(() => localStorage.getItem("wb.changesTree") === "1");
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState<PushOutcome | null>(null);
  const files = diff?.files ?? [];
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const totals = files.reduce((a, f) => ({ additions: a.additions + f.additions, deletions: a.deletions + f.deletions }), { additions: 0, deletions: 0 });

  const fileRow = (f: DiffFile, depth: number, name: React.ReactNode): Row => ({
    key: "f:" + f.path,
    depth,
    kind: "file",
    path: f.path,
    name,
    nameClass: f.status === "deleted" ? "line-through text-muted-foreground" : undefined,
    title: f.old_path ? `${f.old_path} → ${f.path}` : f.path,
    actions:
      f.status !== "deleted" ? (
        <button
          type="button"
          aria-label="Open in editor"
          title="Open in editor"
          onClick={(e) => {
            e.stopPropagation();
            onOpenInEditor(f.path);
          }}
          className="rounded p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </button>
      ) : undefined,
    meta: (
      <>
        {f.binary ? <span className="text-[11px] text-muted-foreground">bin</span> : <Counts additions={f.additions} deletions={f.deletions} className="text-[11px]" compact />}
        <StatusBox status={f.status} />
      </>
    ),
  });

  const rows = useMemo(() => {
    if (!open) return [];
    if (asTree) {
      const dirs = new Set(files.flatMap((f) => ancestors(f.path)));
      const expanded = new Set([...dirs].filter((d) => !collapsed.has(d)));
      return flattenTree(buildTree(files.map((f) => f.path)), expanded, (row) =>
        row.kind === "file" ? fileRow(byPath.get(row.path)!, row.depth, row.name) : row,
      );
    }
    // grouped by folder, like `git status`
    const groups = new Map<string, DiffFile[]>();
    for (const f of files) {
      const { dir } = splitPath(f.path);
      groups.set(dir, [...(groups.get(dir) ?? []), f]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([dir, fs]): Row[] => [
        {
          key: "g:" + dir,
          depth: 0,
          kind: "label",
          path: dir,
          name: <span className="font-mono text-[12px]">{dir || "/"}</span>,
          meta: <span className="text-[11px] text-muted-foreground tabular-nums">{fs.length}</span>,
        },
        ...fs.map((f) => fileRow(f, 0, splitPath(f.path).name)),
      ]);
  }, [files, asTree, open, collapsed, byPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Toolbar>
        <div className="min-w-0 flex-1 truncate pl-1 text-[12px] text-muted-foreground" title={diff ? `Changes against ${diff.base}` : undefined}>
          {diff ? (
            <>
              vs <span className="font-mono text-foreground">{diff.base}</span>
            </>
          ) : (
            "Loading…"
          )}
        </div>
        <IconButton
          label={asTree ? "Group by folder" : "Show as tree"}
          onClick={() => {
            setAsTree(!asTree);
            localStorage.setItem("wb.changesTree", asTree ? "0" : "1");
          }}
        >
          {asTree ? <List /> : <ListTree />}
        </IconButton>
        <IconButton label={pushing ? "Pushing…" : "Push branch (git push -u origin)"} onClick={async () => {
          if (pushing) return;
          setPushing(true);
          setPushed(await onPush());
          setPushing(false);
        }}>
          <ArrowUpFromLine className={cn(pushing && "animate-pulse")} />
        </IconButton>
        <IconButton label="Refresh" onClick={onRefresh}>
          <RefreshCw className={cn(loading && "animate-spin")} />
        </IconButton>
      </Toolbar>

      {pushed && (
        <div className={cn("mx-2 mb-1 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]", pushed.ok ? "bg-muted text-muted-foreground" : "bg-destructive-light text-destructive")}>
          {pushed.ok ? (
            <>
              <span className="min-w-0 flex-1 truncate">
                Pushed <span className="font-mono text-foreground">{pushed.result.branch}</span>
              </span>
              {pushed.result.pr_url && (
                <a href={pushed.result.pr_url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline">
                  <GitPullRequest className="size-3.5" /> Open PR
                </a>
              )}
            </>
          ) : (
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{pushed.error}</span>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => setPushed(null)} className="rounded p-0.5 hover:bg-hover">
            <X className="size-3" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {error && <div className="m-2 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
        {diff && files.length === 0 && !error && <div className="px-2 py-10 text-center text-[12px] text-muted-foreground">No changes yet.</div>}
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium hover:bg-hover"
            aria-expanded={open}
          >
            <motion.span className="inline-flex text-muted-foreground" animate={{ rotate: open ? 90 : 0 }} transition={spring.fast}>
              <ChevronRight size={14} strokeWidth={1.5} />
            </motion.span>
            Changes
            <span className="text-[12px] font-normal text-muted-foreground tabular-nums">{files.length}</span>
            <Counts {...totals} className="ml-auto text-[11px] font-normal" />
          </button>
        )}
        <TreeRows
          label="Changed files"
          rows={rows}
          selected={selected}
          onActivate={(row) => {
            if (row.kind === "file") onOpen(row.path);
            else if (row.kind === "dir")
              setCollapsed((c) => {
                const n = new Set(c);
                if (n.has(row.path)) n.delete(row.path);
                else n.add(row.path);
                return n;
              });
          }}
          onDoubleActivate={(row) => row.kind === "file" && onOpen(row.path, true)}
        />
      </div>
    </>
  );
}

// ── panel ───────────────────────────────────────────────────────────────────

export function SidePanel(props: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  files: { list: FileList | null; error: string | null; loading: boolean; refresh: () => void };
  diff: DiffResult | null;
  diffError: string | null;
  diffLoading: boolean;
  onRefreshDiff: () => void;
  openFile: string | null;
  focusedChange: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onOpenChange: (path: string, pin?: boolean) => void;
  onOpenInEditor: (path: string) => void;
  onPush: () => Promise<PushOutcome>;
}) {
  const { tab, onTab, files, diff } = props;
  const { width, dragging, onMouseDown } = useResizableWidth("wb.panelWidth", 300, 220, 560, "left");
  const changes = useMemo(() => new Map((diff?.files ?? []).map((f) => [f.path, f])), [diff]);
  const count = diff?.files.length ?? 0;
  const iconOnly = width < 340;

  return (
    <aside className={cn("relative flex min-h-0 shrink-0 flex-col", PANEL, "overflow-visible")} style={{ width }} aria-label="Files and changes">
      <ResizeHandle onMouseDown={onMouseDown} dragging={dragging} side="left" />
      <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
        <Tabs value={tab} onValueChange={(v) => onTab(v as PanelTab)} size="compact">
          <TabsList>
            <TabItem value="files" icon={Files} label="Files" iconOnly={iconOnly} />
            <TabItem value="changes" icon={GitCompareArrows} label={iconOnly && count ? `Changes, ${count} file${count === 1 ? "" : "s"}` : "Changes"} badge={count || undefined} iconOnly={iconOnly} />
          </TabsList>
        </Tabs>
      </div>
      {tab === "files" ? (
        <FilesTab
          list={files.list}
          error={files.error}
          loading={files.loading}
          onRefresh={files.refresh}
          changes={changes}
          selected={props.openFile}
          onOpen={props.onOpenFile}
          onOpenInEditor={props.onOpenInEditor}
        />
      ) : (
        <ChangesTab
          diff={diff}
          error={props.diffError}
          loading={props.diffLoading}
          onRefresh={props.onRefreshDiff}
          selected={props.focusedChange}
          onOpen={props.onOpenChange}
          onOpenInEditor={props.onOpenInEditor}
          onPush={props.onPush}
        />
      )}
    </aside>
  );
}
