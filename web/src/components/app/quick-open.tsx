import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { fileIcon } from "@/lib/file-icons";
import { searchPaths } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";
import type { FileList } from "@/contracts";

const SHOWN = 50;

/** Highlight the matched characters of `text`, whose first character sits at `offset` in the full path. */
function Marked({ text, offset, hits }: { text: string; offset: number; hits: Set<number> }) {
  const parts: ReactNode[] = [];
  let run = "";
  let marked = false;
  const flush = () => {
    if (!run) return;
    parts.push(marked ? <mark key={parts.length} className="bg-transparent font-semibold text-foreground">{run}</mark> : run);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(offset + i);
    if (hit !== marked) flush();
    marked = hit;
    run += text[i];
  }
  flush();
  return <>{parts}</>;
}

interface Props {
  files: { list: FileList | null; error: string | null; loading: boolean };
  /** files already open as tabs, most useful first when nothing is typed yet */
  recent: string[];
  onPick: (path: string) => void;
}

/** ⌘P: jump to any file in the worktree by typing part of its path. */
export function QuickOpen(props: Props & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange, ...rest } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" position="top" showCloseButton={false} className="p-0">
        <DialogTitle className="sr-only">Go to file</DialogTitle>
        <DialogDescription className="sr-only">Type part of a file path, then press Enter to open it.</DialogDescription>
        <QuickOpenBody {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// DialogContent unmounts on close, so this starts with an empty query every time.
function QuickOpenBody({ files, recent, onPick, onClose }: Props & { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const all = files.list?.files;
  const rows = useMemo(() => {
    if (!all) return [];
    if (query.trim()) return searchPaths(all, query, SHOWN);
    const known = new Set(all);
    const first = recent.filter((p) => known.has(p));
    const seen = new Set(first);
    return [...first, ...all.filter((p) => !seen.has(p)).slice(0, SHOWN)].slice(0, SHOWN).map((path) => ({ path, score: 0, hits: [] as number[] }));
  }, [all, query, recent]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (path: string | undefined) => {
    if (!path) return;
    onClose();
    onPick(path);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      pick(rows[cursor]?.path);
    }
  };

  const status = files.error ?? (!files.list ? "Loading files…" : rows.length === 0 ? "No matching files" : null);

  return (
    <>
    <input
      autoFocus
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        setCursor(0);
      }}
      onKeyDown={onKeyDown}
      placeholder="Go to file…"
      spellCheck={false}
      autoComplete="off"
      role="combobox"
      aria-expanded
      aria-controls="quick-open-list"
      aria-activedescendant={rows[cursor] ? `quick-open-${cursor}` : undefined}
      className="h-11 w-full bg-transparent px-4 text-[14px] outline-none placeholder:text-muted-foreground"
    />
    <div ref={listRef} id="quick-open-list" role="listbox" className="max-h-[50dvh] overflow-y-auto border-t border-border p-1.5">
      {status ? (
        <div className={cn("px-2.5 py-3 text-[13px]", files.error ? "text-destructive" : "text-muted-foreground")}>{status}</div>
      ) : (
        rows.map((m, i) => {
          const cut = m.path.lastIndexOf("/") + 1;
          const hits = new Set(m.hits);
          const { icon: Icon, className } = fileIcon(m.path);
          return (
            <div
              key={m.path}
              id={`quick-open-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === cursor}
              onMouseMove={() => setCursor(i)}
              onClick={() => pick(m.path)}
              className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px]", i === cursor && "bg-active")}
            >
              <Icon size={14} strokeWidth={1.5} className={cn("shrink-0", className)} />
              <span className="shrink-0 whitespace-pre text-foreground/90">
                <Marked text={m.path.slice(cut)} offset={cut} hits={hits} />
              </span>
              {cut > 0 && (
                <span className="min-w-0 truncate text-[12px] text-muted-foreground" title={m.path}>
                  <Marked text={m.path.slice(0, cut - 1)} offset={0} hits={hits} />
                </span>
              )}
            </div>
          );
        })
      )}
      {files.list?.truncated && !status && <div className="px-2.5 py-1.5 text-[11px] text-muted-foreground">Large repo: only the first 20,000 files are searchable.</div>}
    </div>
    </>
  );
}
