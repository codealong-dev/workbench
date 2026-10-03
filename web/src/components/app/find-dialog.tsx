import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { Channel } from "phoenix";
import { ListFilter, LoaderCircle, TextSearch } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { fetchFile } from "@/hooks/use-files";
import { NO_OPTIONS, useContentSearch } from "@/hooks/use-search";
import { fileIcon } from "@/lib/file-icons";
import { searchPaths } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";
import type { FileContent, FileList, SearchMatch, SearchOptions } from "@/contracts";
import { GlobFields, MatchText, SearchField, summarize } from "./search-ui";
import { Marked } from "./quick-open";

const SearchPreview = lazy(() => import("@/components/editor/search-preview"));

const NAME_MATCHES = 5;

// what you searched last comes back the next time, as in VS Code
let lastQuery = "";
let lastOptions: SearchOptions = NO_OPTIONS;
let lastGlobs = false;

type Hit = { kind: "file"; path: string; hits: number[] } | { kind: "match"; path: string; match: SearchMatch };

interface Props {
  channel: RefObject<Channel | null>;
  files: { list: FileList | null };
  /** text selected when it was opened: searched instead of the last query */
  seed: string;
  onPick: (path: string, line?: number) => void;
}

/** ⌘⇧F: find in files, with the file around the selected result shown beside the results. */
export function FindDialog(props: Props & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange, ...rest } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" position="top" showCloseButton={false} className="top-[8dvh] max-w-[min(1240px,calc(100vw-3rem))] overflow-hidden p-0">
        <DialogTitle className="sr-only">Find in files</DialogTitle>
        <DialogDescription className="sr-only">Search file names and contents; arrow keys move through the results, Enter opens one.</DialogDescription>
        <FindBody {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function FindBody({ channel, files, seed, onPick, onClose }: Props & { onClose: () => void }) {
  const [query, setQueryState] = useState(() => seed || lastQuery);
  const [options, setOptionsState] = useState(lastOptions);
  const [globs, setGlobsState] = useState(lastGlobs);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setQuery = (q: string) => {
    lastQuery = q;
    setQueryState(q);
    setCursor(0);
  };
  const setOptions = (o: SearchOptions) => {
    lastOptions = o;
    setOptionsState(o);
    setCursor(0);
  };
  const setGlobs = (g: boolean) => {
    lastGlobs = g;
    setGlobsState(g);
  };

  // the remembered query comes back selected, so typing replaces it
  useEffect(() => inputRef.current?.select(), []);

  const found = useContentSearch(channel, query, options, files.list);
  const result = found.result;
  const all = files.list?.files;

  const picks: Hit[] = useMemo(() => {
    const named = all && query.trim() && !options.regex ? searchPaths(all, query, NAME_MATCHES).map((m): Hit => ({ kind: "file", path: m.path, hits: m.hits })) : [];
    const lines = (result?.files ?? []).flatMap((f) => f.matches.map((match): Hit => ({ kind: "match", path: f.path, match })));
    return [...named, ...lines];
  }, [all, query, options.regex, result]);

  const current = picks[Math.min(cursor, picks.length - 1)];
  const matchesOf = useMemo(() => new Map((result?.files ?? []).map((f) => [f.path, f.matches])), [result]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (p: Hit | undefined) => {
    if (!p) return;
    onClose();
    onPick(p.path, p.kind === "match" ? p.match.line : undefined);
  };

  const move = (by: number) => setCursor((c) => Math.max(0, Math.min(c + by, picks.length - 1)));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      move(-1);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      move(e.key === "PageDown" ? 12 : -12);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      pick(current);
    }
  };

  // the list: the file name matches, then each file's lines under a header
  let index = 0;
  let lastPath: string | null = null;
  const nameCount = picks.findIndex((p) => p.kind === "match");
  const rows = picks.map((p) => {
    const i = index++;
    const header =
      p.kind === "match" && p.path !== lastPath ? (
        <FileHeader key={`h:${p.path}`} path={p.path} count={matchesOf.get(p.path)?.length ?? 0} />
      ) : i === 0 && p.kind === "file" ? (
        <div key="h:names" className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Files
        </div>
      ) : null;
    if (p.kind === "match") lastPath = p.path;
    const selected = i === cursor;
    const row =
      p.kind === "file" ? (
        <FileNameRow key={`n:${p.path}`} path={p.path} hits={p.hits} index={i} selected={selected} onHover={setCursor} onPick={() => pick(p)} />
      ) : (
        <div
          key={`m:${p.path}:${p.match.line}:${i}`}
          data-index={i}
          role="option"
          aria-selected={selected}
          onMouseMove={() => setCursor(i)}
          onClick={() => pick(p)}
          className={cn("flex h-6 cursor-pointer items-center gap-2 rounded-md pr-2 pl-7 font-mono text-[12px] text-muted-foreground", selected && "bg-active text-foreground")}
        >
          <MatchText match={p.match} className="min-w-0 flex-1 truncate" />
          <span className="shrink-0 text-[11px] tabular-nums opacity-70">{p.match.line}</span>
        </div>
      );
    return header ? [header, row] : [row];
  });
  const status = found.error
    ? found.error
    : !query.trim()
      ? "Type to search file names and contents."
      : result && picks.length === 0
        ? "No results."
        : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center pr-2">
        <SearchField
          size="lg"
          className="flex-1"
          value={query}
          onChange={setQuery}
          options={options}
          onOptions={setOptions}
          placeholder="Search in files…"
          onKeyDown={onKeyDown}
          inputRef={inputRef}
          autoFocus
          icon={found.loading ? <LoaderCircle className="mr-1 size-4 shrink-0 animate-spin text-muted-foreground" /> : <TextSearch className="mr-1 size-4 shrink-0 text-muted-foreground" />}
        />
        <Tooltip content="Files to include or exclude" side="bottom">
          <button
            type="button"
            aria-label="Files to include or exclude"
            aria-pressed={globs}
            onClick={() => setGlobs(!globs)}
            className={cn("flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground [&_svg]:size-4", globs && "bg-hover text-foreground")}
          >
            <ListFilter />
          </button>
        </Tooltip>
      </div>
      {globs && <GlobFields className="px-4 pb-3" options={options} onOptions={setOptions} onKeyDown={onKeyDown} />}
      <div className="grid h-[min(64dvh,680px)] grid-cols-[minmax(0,2fr)_minmax(0,3fr)] border-t border-border">
        <div className="flex min-h-0 flex-col border-r border-border">
          <div ref={listRef} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {status ? <div className={cn("px-2.5 py-3 text-[13px] whitespace-pre-wrap", found.error ? "text-destructive" : "text-muted-foreground")}>{status}</div> : rows}
          </div>
          <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border px-3 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{result ? summarize(result.total, result.files.length, result.truncated) : nameCount > 0 ? "Searching contents…" : ""}</span>
            <span className="shrink-0">↑↓ move · ↵ open</span>
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          {current ? <Preview key="preview" channel={channel} path={current.path} line={current.kind === "match" ? current.match.line : undefined} matches={matchesOf.get(current.path) ?? []} /> : <div className="grid flex-1 place-items-center text-[12px] text-muted-foreground">No file selected</div>}
        </div>
      </div>
    </div>
  );
}

function FileHeader({ path, count }: { path: string; count: number }) {
  const cut = path.lastIndexOf("/") + 1;
  const { icon: Icon, className } = fileIcon(path);
  return (
    <div className="mt-1 flex h-7 items-center gap-2 px-2.5 text-[13px]" title={path}>
      <Icon size={14} strokeWidth={1.5} className={cn("shrink-0", className)} />
      <span className="shrink-0">{path.slice(cut)}</span>
      {cut > 0 && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{path.slice(0, cut - 1)}</span>}
      <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">{count}</span>
    </div>
  );
}

function FileNameRow({ path, hits, index, selected, onHover, onPick }: { path: string; hits: number[]; index: number; selected: boolean; onHover: (i: number) => void; onPick: () => void }) {
  const cut = path.lastIndexOf("/") + 1;
  const marked = new Set(hits);
  const { icon: Icon, className } = fileIcon(path);
  return (
    <div
      data-index={index}
      role="option"
      aria-selected={selected}
      onMouseMove={() => onHover(index)}
      onClick={onPick}
      className={cn("flex h-7 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px]", selected && "bg-active")}
    >
      <Icon size={14} strokeWidth={1.5} className={cn("shrink-0", className)} />
      <span className="shrink-0 whitespace-pre">
        <Marked text={path.slice(cut)} offset={cut} hits={marked} />
      </span>
      {cut > 0 && (
        <span className="min-w-0 truncate text-[12px] text-muted-foreground">
          <Marked text={path.slice(0, cut - 1)} offset={0} hits={marked} />
        </span>
      )}
    </div>
  );
}

// Files read for the preview, kept while the dialog is open.
type Loaded = { ok: true; file: FileContent } | { ok: false; error: string };

function Preview({ channel, path, line, matches }: { channel: RefObject<Channel | null>; path: string; line?: number; matches: SearchMatch[] }) {
  const cache = useRef(new Map<string, Loaded>());
  const [loaded, setLoaded] = useState<{ path: string; value: Loaded } | null>(null);
  // the last text file shown: the editor keeps it while the next one loads, instead of flashing empty
  const [shown, setShown] = useState<{ path: string; text: string } | null>(null);

  useEffect(() => {
    const show = (value: Loaded) => {
      setLoaded({ path, value });
      setShown(value.ok && value.file.content != null ? { path, text: value.file.content } : null);
    };
    const hit = cache.current.get(path);
    if (hit) return show(hit);
    let alive = true;
    // holding an arrow key skims past files: only read the one it stops on
    const t = setTimeout(async () => {
      const r = await fetchFile(channel.current, path);
      cache.current.set(path, r);
      if (alive) show(r);
    }, 60);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [channel, path]);

  const value = loaded?.path === path ? loaded.value : null;
  const file = value?.ok ? value.file : null;
  const note = !value ? null : !value.ok ? value.error : file?.content == null ? "Binary file: nothing to preview." : null;

  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-[12px]">
        <span className="min-w-0 truncate font-mono text-muted-foreground" title={path}>
          {path}
          {line ? `:${line}` : ""}
        </span>
        {file?.truncated && <span className="shrink-0 text-[11px] text-muted-foreground">first 1 MB</span>}
      </div>
      <div className="relative min-h-0 flex-1">
        {note && <div className="p-4 text-[12px] text-muted-foreground">{note}</div>}
        {shown && (
          <Suspense fallback={<div className="p-4 text-[12px] text-muted-foreground">Loading preview…</div>}>
            <div className="absolute inset-0">
              <SearchPreview path={shown.path} text={shown.text} line={shown.path === path ? line : undefined} matches={shown.path === path ? matches : []} />
            </div>
          </Suspense>
        )}
      </div>
    </>
  );
}
