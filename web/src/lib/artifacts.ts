import type { Item } from "@/contracts";
import type { TextSource } from "@/components/app/file-preview";

/**
 * What a conversation has produced or been given, whichever agent it is:
 * things you attached, pictures the agent made, and files it wrote in the
 * worktree. Read from the normalized timeline, so nothing is per provider.
 */
export type Artifact = {
  key: string;
  name: string;
  from: "you" | "agent";
  size?: number;
  mime?: string;
  /** a picture; shown as itself */
  imageUrl?: string;
  /** how to read it as text */
  src: TextSource | null;
  /** how a message refers to it (the `files` entries of `send`) */
  ref: { upload: string } | { worktree: string };
};

// the edit tools of Claude, and Codex's Patch
const WRITES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Patch"]);
// these only look at pictures; they don't make them
const LOOKS = new Set(["Read", "ViewImage"]);

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

function writtenPaths(input: unknown): string[] {
  const i = record(input);
  const one = i.file_path ?? i.notebook_path ?? i.path;
  if (typeof one === "string") return [one];
  if (Array.isArray(i.changes))
    return i.changes
      .map((c) => record(c).path)
      .filter((p): p is string => typeof p === "string");
  return [];
}

// worktree-relative, or null for something outside it
function relative(path: string, root: string) {
  const base = root.endsWith("/") ? root : root + "/";
  if (path.startsWith(base)) return path.slice(base.length);
  return path.startsWith("/") ? null : path.replace(/^\.\//, "");
}

/** Newest first; a file the agent wrote more than once is listed once. */
export function artifactsOf(items: Item[], worktree: string): Artifact[] {
  const out = new Map<string, Artifact>();
  const add = (a: Artifact) => {
    out.delete(a.key); // moves it to the end: it is the newest
    out.set(a.key, a);
  };

  for (const item of items) {
    if (item.kind === "user_message") {
      for (const f of item.files ?? []) {
        if (f.worktree)
          add({
            key: `w:${f.worktree}`,
            name: f.name,
            from: "you",
            size: f.size,
            src: { worktree: f.worktree },
            ref: { worktree: f.worktree },
          });
        else
          add({
            key: `u:${f.id}`,
            name: f.name,
            from: "you",
            size: f.size,
            src: f.url ? { url: f.url } : null,
            ref: { upload: f.id },
          });
      }
      for (const img of item.images ?? [])
        add({
          key: `u:${img.id}`,
          name: img.name,
          from: "you",
          mime: img.mime,
          imageUrl: img.url,
          src: null,
          ref: { upload: img.id },
        });
    } else if (item.kind === "tool") {
      if (item.is_error) continue;
      if (WRITES.has(item.name)) {
        for (const p of writtenPaths(item.input)) {
          const rel = relative(p, worktree);
          if (rel)
            add({
              key: `w:${rel}`,
              name: rel.split("/").pop() ?? rel,
              from: "agent",
              src: { worktree: rel },
              ref: { worktree: rel },
            });
        }
      } else if (!LOOKS.has(item.name)) {
        for (const img of item.images ?? [])
          add({
            key: `u:${img.id}`,
            name: img.name,
            from: "agent",
            mime: img.mime,
            imageUrl: img.url,
            src: null,
            ref: { upload: img.id },
          });
      }
    }
  }
  return [...out.values()].reverse();
}

/** What a drag carries, so a drop on the chat knows it is one of these. */
export const ARTIFACT_DRAG = "application/x-workbench-artifact";
