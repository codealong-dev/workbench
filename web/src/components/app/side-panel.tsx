import { useEffect, useMemo, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { ChevronRight, ChevronsDownUp, ExternalLink, Files, GitCompareArrows, RefreshCw, ListFilter, Search, TextSearch } from "lucide-react";
import { motion } from "framer-motion";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import type { DiffFile, DiffResult, FileList, SearchOptions, Thread } from "@/contracts";
import { useContentSearch } from "@/hooks/use-search";
import { fileIcon } from "@/lib/file-icons";
import { searchPaths } from "@/lib/fuzzy";
import { GlobFields, MatchText, SearchField, summarize } from "./search-ui";
import { Marked } from "./quick-open";
import { ancestors, buildTree, flattenTree, TreeRows, type Row } from "./file-tree";
import { Counts } from "./diff-view";
import { ScmTab, type PushOutcome } from "./scm-tab";
import { PANEL } from "./panel";
import { IconButton, splitPath, STATUS, StatusBox, Toolbar } from "./panel-bits";

export type PanelTab = "files" | "changes";

// ── Files tab ───────────────────────────────────────────────────────────────

/** The Files tab's filter, or (⌥⌘F) find in files. Kept by the workspace so it outlives the tab. */
export interface FileSearch {
  mode: "filter" | "search";
  query: string;
  options: SearchOptions;
  /** the include/exclude fields are shown */
  globs: boolean;
}

const NAME_MATCHES = 8;

function FilesTab(props: {
  list: FileList | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  changes: Map<string, DiffFile>;
  selected: string | null;
  onOpen: (path: string, pin?: boolean) => void;
  onOpenAt: (path: string, line: number, pin?: boolean) => void;
  onOpenInEditor: (path: string) => void;
  search: FileSearch;
  onSearch: (s: FileSearch) => void;
  channel: RefObject<Channel | null>;
}) {
  const { list, error, loading, onRefresh, changes, selected, onOpen, onOpenAt, onOpenInEditor, search, onSearch } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // result files folded away (find in files)
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [again, setAgain] = useState(0);
  const query = search.query;
  const setQuery = (q: string) => onSearch({ ...search, query: q });
  const searching = search.mode === "search";
  const paths = useMemo(() => list?.files ?? [], [list]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  // searches again when files change on disk (the list is refetched then) or on refresh
  const refreshKey = useMemo(() => ({}), [again, list]); // eslint-disable-line react-hooks/exhaustive-deps
  const found = useContentSearch(props.channel, searching ? query : "", search.options, refreshKey);

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
    if (searching) {
      if (!query.trim()) return [];
      const out: Row[] = [];
      // file names first, fuzzily, as ⌘P does
      const named = search.options.regex ? [] : searchPaths(paths, query, NAME_MATCHES);
      if (named.length) {
        out.push({ key: "h:files", depth: 0, kind: "label", path: "", name: <span className="text-[11px] font-medium tracking-wide uppercase">Files</span> });
        for (const m of named) {
          const cut = m.path.lastIndexOf("/") + 1;
          const hits = new Set(m.hits);
          out.push(
            decorate({
              key: "n:" + m.path,
              depth: 0,
              kind: "file",
              path: m.path,
              name: (
                <>
                  <Marked text={m.path.slice(cut)} offset={cut} hits={hits} />
                  {cut > 0 && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      <Marked text={m.path.slice(0, cut - 1)} offset={0} hits={hits} />
                    </span>
                  )}
                </>
              ),
            }),
          );
        }
      }
      const r = found.result;
      if (r) {
        out.push({
          key: "h:results",
          depth: 0,
          kind: "label",
          path: "",
          name: <span className="text-[11px]">{r.total ? summarize(r.total, r.files.length, r.truncated) : "No results in file contents"}</span>,
        });
        for (const f of r.files) {
          const { dir, name } = splitPath(f.path);
          const fi = fileIcon(f.path);
          const open = !folded.has(f.path);
          out.push({
            key: "r:" + f.path,
            depth: 0,
            kind: "dir",
            open,
            path: f.path,
            icon: fi.icon,
            iconClass: fi.className,
            title: f.path,
            nameClass: changes.has(f.path) ? STATUS[changes.get(f.path)!.status].text : undefined,
            name: (
              <>
                {name}
                {dir && <span className="ml-1.5 text-[11px] text-muted-foreground">{dir}</span>}
              </>
            ),
            meta: <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">{f.matches.length}</span>,
          });
          if (open)
            f.matches.forEach((m, i) =>
              out.push({ key: `m:${f.path}:${m.line}:${i}`, depth: 1, kind: "match", path: f.path, line: m.line, title: `${f.path}:${m.line}`, name: <MatchText match={m} /> }),
            );
        }
      }
      return out;
    }
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
  }, [q, query, searching, search.options.regex, found.result, folded, tree, expanded, paths, changes]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else if (searching) onSearch({ ...search, mode: "filter" });
    }
    // Enter: the first result
    if (e.key === "Enter" && searching) {
      const first = rows.find((r) => r.kind === "match" || r.kind === "file");
      if (first?.kind === "match") onOpenAt(first.path, first.line!);
      else if (first) onOpen(first.path);
    }
  };

  return (
    <>
      <Toolbar>
        {searching ? (
          <SearchField
            className="flex-1"
            value={query}
            onChange={setQuery}
            options={search.options}
            onOptions={(options) => onSearch({ ...search, options })}
            placeholder="Search files and contents…"
            onKeyDown={fieldKey}
            error={!!found.error}
            inputRef={(el) => el?.setAttribute("data-file-search", "")}
            icon={<TextSearch className="ml-2 size-3.5 shrink-0 text-muted-foreground" />}
          />
        ) : (
          <div className="group/search relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={fieldKey}
              placeholder="Filter files…"
              aria-label="Filter files"
              className="h-7 w-full rounded-md bg-transparent pr-2 pl-7 text-[12px] ring-1 ring-transparent outline-none placeholder:text-muted-foreground hover:bg-muted/50 hover:ring-border focus:bg-card focus:ring-border"
            />
          </div>
        )}
        <IconButton label={searching ? "Filter file names (⌥⌘F)" : "Search in file contents (⌥⌘F)"} active={searching} onClick={() => onSearch({ ...search, mode: searching ? "filter" : "search" })}>
          <TextSearch />
        </IconButton>
        {searching ? (
          <>
            <IconButton label="Files to include or exclude" active={search.globs} onClick={() => onSearch({ ...search, globs: !search.globs })}>
              <ListFilter />
            </IconButton>
            <IconButton label="Collapse results" onClick={() => setFolded(new Set(found.result?.files.map((f) => f.path) ?? []))}>
              <ChevronsDownUp />
            </IconButton>
            <IconButton label="Search again" onClick={() => setAgain((n) => n + 1)}>
              <RefreshCw className={cn(found.loading && "animate-spin")} />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton label="Collapse folders" onClick={() => setExpanded(new Set())}>
              <ChevronsDownUp />
            </IconButton>
            <IconButton label="Refresh" onClick={onRefresh}>
              <RefreshCw className={cn(loading && "animate-spin")} />
            </IconButton>
          </>
        )}
      </Toolbar>
      {searching && search.globs && <GlobFields className="px-2 pb-2" options={search.options} onOptions={(options) => onSearch({ ...search, options })} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {error && <div className="m-2 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
        {searching && found.error && <div className="m-2 rounded-lg bg-destructive-light px-3 py-2 text-[12px] whitespace-pre-wrap text-destructive">{found.error}</div>}
        {!list && !error && <div className="px-2 py-3 text-[12px] text-muted-foreground">Loading…</div>}
        {searching && !query.trim() && (
          <div className="px-2 py-3 text-[12px] leading-relaxed text-muted-foreground">
            Searches file names and what's in them. ⌥⌘C match case, ⌥⌘W whole word, ⌥⌘R regular expression; ⌘⇧F opens it with a preview.
          </div>
        )}
        {list && !searching && rows.length === 0 && <div className="px-2 py-3 text-[12px] text-muted-foreground">{q ? "No matching files" : "No files"}</div>}
        <TreeRows
          label={searching ? "Search results" : "Files"}
          rows={rows}
          selected={selected}
          onActivate={(row) => {
            if (row.kind === "match") return onOpenAt(row.path, row.line!);
            if (row.kind === "dir" && searching)
              return setFolded((f) => {
                const n = new Set(f);
                if (n.has(row.path)) n.delete(row.path);
                else n.add(row.path);
                return n;
              });
            if (row.kind === "dir")
              setExpanded((e) => {
                const n = new Set(e);
                if (n.has(row.path)) n.delete(row.path);
                else n.add(row.path);
                return n;
              });
            else if (row.kind === "file") onOpen(row.path);
          }}
          onDoubleActivate={(row) => (row.kind === "file" ? onOpen(row.path, true) : row.kind === "match" ? onOpenAt(row.path, row.line!, true) : undefined)}
        />
        {list?.truncated && !searching && <div className="px-2 py-2 text-[11px] text-muted-foreground">Showing the first {list.files.length.toLocaleString()} files.</div>}
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
  thread: Thread | undefined;
  channel: RefObject<Channel | null>;
  message: string;
  onMessage: (m: string) => void;
  onScmChanged: (files?: boolean) => void;
}) {
  const { diff, error, loading, onRefresh, selected, onOpen, onOpenInEditor, onPush } = props;
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
    const dirs = new Set(files.flatMap((f) => ancestors(f.path)));
    const expanded = new Set([...dirs].filter((d) => !collapsed.has(d)));
    return flattenTree(buildTree(files.map((f) => f.path)), expanded, (row) => (row.kind === "file" ? fileRow(byPath.get(row.path)!, row.depth, row.name) : row));
  }, [files, open, collapsed, byPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScmTab
      thread={props.thread}
      channel={props.channel}
      trigger={diff}
      message={props.message}
      onMessage={props.onMessage}
      selected={selected}
      onOpen={onOpen}
      onOpenInEditor={onOpenInEditor}
      onPush={onPush}
      onChanged={props.onScmChanged}
      toolbar={
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
            <IconButton label="Refresh" onClick={onRefresh}>
              <RefreshCw className={cn(loading && "animate-spin")} />
            </IconButton>
          </Toolbar>
        </>
      }
    >
      {error && <div className="m-2 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
      {diff && files.length === 0 && !error && <div className="px-2 py-3 text-[12px] text-muted-foreground">Nothing differs from the base yet.</div>}
      {files.length > 0 && (
        <button type="button" onClick={() => setOpen(!open)} className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium hover:bg-hover" aria-expanded={open}>
          <motion.span className="inline-flex text-muted-foreground" animate={{ rotate: open ? 90 : 0 }} transition={spring.fast}>
            <ChevronRight size={14} strokeWidth={1.5} />
          </motion.span>
          Branch changes
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
    </ScmTab>
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
  /** a search result: the file, at that line */
  onOpenFileAt: (path: string, line: number, pin?: boolean) => void;
  onOpenChange: (path: string, pin?: boolean) => void;
  search: FileSearch;
  onSearch: (s: FileSearch) => void;
  channel: RefObject<Channel | null>;
  onOpenInEditor: (path: string) => void;
  onPush: () => Promise<PushOutcome>;
  thread: Thread | undefined;
  /** the index or the files changed: refresh the diff, and the file list when `files` */
  onScmChanged: (files?: boolean) => void;
}) {
  const { tab, onTab, files, diff } = props;
  // the commit message outlives the tab
  const [message, setMessage] = useState("");
  const { width, dragging, onMouseDown } = useResizableWidth("wb.panelWidth", 300, 220, 560, "left");
  const changes = useMemo(() => new Map((diff?.files ?? []).map((f) => [f.path, f])), [diff]);
  const count = diff?.files.length ?? 0;
  // the tabs fill the bar; below this their labels no longer fit beside the icons
  const iconOnly = width < 280;

  return (
    <aside className={cn("relative flex min-h-0 shrink-0 flex-col", PANEL, "overflow-visible")} style={{ width }} aria-label="Files and changes">
      <ResizeHandle onMouseDown={onMouseDown} dragging={dragging} side="left" />
      <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
        <Tabs value={tab} onValueChange={(v) => onTab(v as PanelTab)} size="compact" className="w-full">
          <TabsList className="flex w-full">
            <TabItem value="files" icon={Files} label="Files" iconOnly={iconOnly} className="min-w-0 flex-1 justify-center" />
            <TabItem
              value="changes"
              icon={GitCompareArrows}
              label={iconOnly && count ? `Changes, ${count} file${count === 1 ? "" : "s"}` : "Changes"}
              badge={count || undefined}
              iconOnly={iconOnly}
              className="min-w-0 flex-1 justify-center"
            />
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
          onOpenAt={props.onOpenFileAt}
          onOpenInEditor={props.onOpenInEditor}
          search={props.search}
          onSearch={props.onSearch}
          channel={props.channel}
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
          thread={props.thread}
          channel={props.channel}
          message={message}
          onMessage={setMessage}
          onScmChanged={props.onScmChanged}
        />
      )}
    </aside>
  );
}
