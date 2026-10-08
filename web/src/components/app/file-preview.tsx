import { createContext, useContext, useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const TEXT_EXTS = new Set(
  "txt md markdown json jsonc json5 yaml yml toml ini env conf cfg csv tsv log xml html htm css scss sass less js jsx mjs cjs ts tsx py rb go rs java kt swift c h cpp hpp cs php sh bash zsh fish sql graphql gql ex exs erl heex eex lock gitignore dockerfile makefile diff patch".split(
    " ",
  ),
);
const TEXT_MIMES =
  /^(text\/|application\/(json|xml|x-yaml|yaml|toml|javascript|x-sh|sql))/;

// Past this a preview isn't worth the download.
const MAX_PREVIEW_BYTES = 1024 * 1024;
export const PREVIEW_LINES = 20;

/** Something we can show as text: by its type, else by its extension. */
export function isTextFile(name: string, mime?: string, size?: number) {
  if (size != null && size > MAX_PREVIEW_BYTES) return false;
  if (mime && TEXT_MIMES.test(mime)) return true;
  const ext = name.includes(".")
    ? name.split(".").pop()!.toLowerCase()
    : name.toLowerCase();
  return TEXT_EXTS.has(ext);
}

/** Where the text of a file comes from. */
export type TextSource =
  { file: File } | { url: string } | { worktree: string };

/** How the chat reads a file in the worktree; set by the chat view. */
export const WorktreeReader = createContext<(path: string) => Promise<string>>(
  () => Promise.reject(new Error("no chat")),
);

export async function loadText(
  src: TextSource,
  readWorktree: (path: string) => Promise<string>,
): Promise<string> {
  if ("file" in src) return src.file.text();
  if ("worktree" in src) return readWorktree(src.worktree);
  const r = await fetch(src.url);
  if (!r.ok) throw new Error(`could not load (${r.status})`);
  return r.text();
}

const cache = new Map<string, Promise<string>>();

/** The text of a source, once loaded (null while loading or if it can't be). */
export function useText(src: TextSource | null, key: string): string | null {
  const read = useContext(WorktreeReader);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (!src) return;
    let live = true;
    // sent files never change; a worktree file might, so it is read each time
    const keep = !("worktree" in src) && !("file" in src);
    let p = keep ? cache.get(key) : undefined;
    if (!p) {
      p = loadText(src, read);
      if (keep) cache.set(key, p);
    }
    p.then((t) => live && setText(t)).catch(() => {
      cache.delete(key);
    });
    return () => {
      live = false;
    };
    // `src` is rebuilt every render; `key` is its identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, read]);
  return text;
}

export const head = (text: string, lines = PREVIEW_LINES) =>
  text.split("\n").slice(0, lines).join("\n");

/** A file you sent or the agent wrote: its first lines, click to read all of it. */
export function FileCard({
  name,
  size,
  src,
  srcKey,
  mime,
  className,
}: {
  name: string;
  size?: number;
  src: TextSource;
  srcKey: string;
  mime?: string;
  className?: string;
}) {
  const readable = isTextFile(name, mime, size);
  const text = useText(readable ? src : null, srcKey);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={name}
        className={cn(
          "flex w-56 flex-col overflow-hidden rounded-lg bg-accent text-left outline-1 -outline-offset-1 outline-black/10 transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] dark:outline-white/10",
          className,
        )}
      >
        {text != null && (
          <pre className="max-h-28 overflow-hidden px-2 pt-1.5 font-mono text-[10px] leading-[14px] whitespace-pre text-muted-foreground [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
            {head(text) || " "}
          </pre>
        )}
        <span className="flex items-center gap-1.5 px-2 py-1 text-[12px]">
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate">{name}</span>
          {size != null && (
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {formatSize(size)}
            </span>
          )}
        </span>
      </button>
      <PreviewDialog
        open={open}
        onOpenChange={setOpen}
        name={name}
        src={readable ? src : null}
        srcKey={srcKey}
      />
    </>
  );
}

/** The whole file, as text. */
export function PreviewDialog({
  open,
  onOpenChange,
  name,
  src,
  srcKey,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  name: string;
  src: TextSource | null;
  srcKey: string;
}) {
  const text = useText(open ? src : null, srcKey);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(48rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-background shadow-2xl outline-none"
        >
          <DialogPrimitive.Title className="truncate border-b border-border px-4 py-2.5 text-[13px] font-medium">
            {name}
          </DialogPrimitive.Title>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {!src ? (
              <p className="text-[13px] text-muted-foreground">
                No preview for this kind of file.
              </p>
            ) : text == null ? (
              <p className="text-[13px] text-muted-foreground">Loading…</p>
            ) : (
              <pre className="font-mono text-[12px] leading-[18px] whitespace-pre-wrap break-words">
                {text}
              </pre>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
