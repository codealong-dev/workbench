import { useEffect, useState } from "react";
import type { Channel } from "phoenix";
import { File as CodeFile } from "@pierre/diffs/react";
import { ExternalLink } from "lucide-react";
import { fetchFile } from "@/hooks/use-files";
import { useResolvedTheme } from "@/lib/theme";
import type { FileContent } from "@/contracts";

export function FileView({ channel, path, version, onOpenInEditor }: { channel: Channel | null; path: string; version: number; onOpenInEditor: (path: string) => void }) {
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

