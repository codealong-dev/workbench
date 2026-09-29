import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DiffFile, DiffResult, FileStatus } from "@/contracts";

const LAYOUT_KEY = "wb.diffStyle";

const STATUS: Record<FileStatus, { letter: string; className: string }> = {
  added: { letter: "A", className: "text-green-600 dark:text-green-400" },
  untracked: { letter: "U", className: "text-green-600 dark:text-green-400" },
  modified: { letter: "M", className: "text-amber-600 dark:text-amber-400" },
  deleted: { letter: "D", className: "text-red-600 dark:text-red-400" },
  renamed: { letter: "R", className: "text-blue-600 dark:text-blue-400" },
  copied: { letter: "C", className: "text-blue-600 dark:text-blue-400" },
};

export function Counts({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      <span className="text-green-600 dark:text-green-400">+{additions}</span>{" "}
      <span className="text-red-600 dark:text-red-400">−{deletions}</span>
    </span>
  );
}

function FileRow({ f, onClick }: { f: DiffFile; onClick: () => void }) {
  const slash = f.path.lastIndexOf("/");
  const dir = slash >= 0 ? f.path.slice(0, slash + 1) : "";
  const name = f.path.slice(slash + 1);
  const s = STATUS[f.status];
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-hover">
      <span className={cn("w-3 shrink-0 text-center font-mono text-[11px] font-semibold", s.className)} title={f.status}>
        {s.letter}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono" title={f.old_path ? `${f.old_path} → ${f.path}` : f.path}>
        <span className="text-muted-foreground">{dir}</span>
        {name}
      </span>
      {f.binary ? <span className="text-[11px] text-muted-foreground">binary</span> : <Counts additions={f.additions} deletions={f.deletions} className="text-[11px]" />}
    </button>
  );
}

const DiffBlock = memo(function DiffBlock(props: { file: FileDiffMetadata; diffStyle: "split" | "unified"; onOpenFile: (path: string) => void }) {
  return (
    <FileDiff
      fileDiff={props.file}
      options={{
        diffStyle: props.diffStyle,
        theme: { light: "github-light", dark: "github-dark" },
        themeType: "system",
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

export function ChangesPanel(props: {
  diff: DiffResult | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  loadFile: (path: string) => Promise<string | null>;
}) {
  const { diff, error, loading, onRefresh, onClose, onOpenFile, loadFile } = props;
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

  const totals = useMemo(
    () => (diff?.files ?? []).reduce((a, f) => ({ additions: a.additions + f.additions, deletions: a.deletions + f.deletions }), { additions: 0, deletions: 0 }),
    [diff?.files],
  );

  const jump = async (f: DiffFile) => {
    if (diff?.truncated && !lazy[f.path]) {
      const patch = await loadFile(f.path);
      if (patch) setLazy((l) => ({ ...l, [f.path]: parsePatchFiles(patch).flatMap((p) => p.files) }));
    }
    requestAnimationFrame(() => refs.current[f.path]?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const files = diff?.files ?? [];

  return (
    <section className="flex min-h-0 w-[52%] min-w-[420px] flex-col border-l border-border bg-surface-1">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Changes</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {diff ? (
              <>
                vs <span className="font-mono">{diff.base}</span> · {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
                <Counts {...totals} />
              </>
            ) : (
              "Loading…"
            )}
          </div>
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
        <Button size="icon-compact" variant="ghost" aria-label="Refresh" title="Refresh" onClick={onRefresh}>
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
        <Button size="icon-compact" variant="ghost" aria-label="Close changes" title="Close" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="m-4 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
        {diff && files.length === 0 && !error && <div className="py-20 text-center text-[13px] text-muted-foreground">No changes yet.</div>}

        {files.length > 0 && (
          <div className="border-b border-border px-2 py-2">
            {files.map((f) => (
              <FileRow key={f.path} f={f} onClick={() => void jump(f)} />
            ))}
          </div>
        )}

        {diff?.truncated && (
          <div className="px-4 pt-3 text-[12px] text-muted-foreground">This diff is large. Click a file above to load it.</div>
        )}

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
              <div key={f.path} ref={(el) => void (refs.current[f.path] = el)} className="wb-diff overflow-hidden rounded-lg shadow-surface-1">
                {blocks.map((b, i) => (
                  <DiffBlock key={i} file={b} diffStyle={diffStyle} onOpenFile={onOpenFile} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
