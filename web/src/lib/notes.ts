import { useSyncExternalStore } from "react";

// Notes on an answer: select text, add a note in the margin, and send them all
// together. Each note is anchored to a timeline item by character offsets into
// its text, with the text it covered kept to re-find it if those drift. Notes
// stay after they're sent (marked `sent`), so a thread keeps its annotations.
// They live in localStorage, one key per thread.

export type Note = {
  id: string;
  /** the timeline item it's anchored to */
  item: string;
  /** character offsets into the item's text content */
  start: number;
  end: number;
  /** the anchored text as it is in the DOM, to re-find it */
  raw: string;
  /** the selected text as the user saw it, sent with the note */
  quote: string;
  text: string;
  sent?: number;
};

export type NoteAnchor = Pick<Note, "item" | "start" | "end" | "raw" | "quote">;

const KEY = "wb.notes.";
const EMPTY: Note[] = [];
const cache = new Map<string, Note[]>();
const listeners = new Set<() => void>();

export function getNotes(thread: string): Note[] {
  let notes = cache.get(thread);
  if (!notes) {
    try {
      notes = JSON.parse(localStorage.getItem(KEY + thread) ?? "[]") as Note[];
    } catch {
      notes = [];
    }
    if (!notes.length) notes = EMPTY;
    cache.set(thread, notes);
  }
  return notes;
}

function setNotes(thread: string, next: Note[]) {
  cache.set(thread, next.length ? next : EMPTY);
  if (next.length) localStorage.setItem(KEY + thread, JSON.stringify(next));
  else localStorage.removeItem(KEY + thread);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useNotes(thread: string): Note[] {
  return useSyncExternalStore(subscribe, () => getNotes(thread));
}

/** Notes written but not yet sent. */
export const draftNotes = (notes: Note[]) => notes.filter((n) => !n.sent && n.text.trim());

export function addNote(thread: string, anchor: NoteAnchor): string {
  const id = crypto.randomUUID();
  setNotes(thread, [...getNotes(thread), { ...anchor, id, text: "" }]);
  return id;
}

export function updateNote(thread: string, id: string, text: string) {
  setNotes(thread, getNotes(thread).map((n) => (n.id === id ? { ...n, text } : n)));
}

export function removeNote(thread: string, id: string) {
  setNotes(thread, getNotes(thread).filter((n) => n.id !== id));
}

export function markSent(thread: string, ids: string[]) {
  const sent = new Set(ids);
  const at = Date.now();
  setNotes(thread, getNotes(thread).map((n) => (sent.has(n.id) ? { ...n, sent: at } : n)));
}

/** Characters of text in `root` before (`node`, `offset`). */
export function textOffset(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

// ── Sending ────────────────────────────────────────────────────────────
// Notes travel in the message itself: what you typed first, then each quote
// as a markdown block quote followed by its note, like an inline email reply.
// Every agent understands that, so it works the same for any provider.

const blockQuote = (q: string) =>
  q
    .trim()
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

export function withNotes(notes: Pick<Note, "quote" | "text">[], text: string): string {
  const parts = [text.trim(), ...notes.map((n) => `${blockQuote(n.quote)}\n\n${n.text.trim()}`)];
  return parts.filter(Boolean).join("\n\n");
}

export type Segment = { quote: boolean; text: string };

/** Split a sent message into its quotes and the text around them, for display. */
export function splitQuotes(message: string): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let fenced = false;
  for (const line of message.split("\n")) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    const quoted = !fenced && (line === ">" || line.startsWith("> "));
    if (!current || current.quote !== quoted) segments.push((current = { quote: quoted, text: "" }));
    current.text += (current.text ? "\n" : "") + (quoted ? line.slice(2) : line);
  }
  return segments
    .map((s) => ({ ...s, text: s.quote ? s.text : s.text.replace(/^\s*\n|\n\s*$/g, "") }))
    .filter((s) => s.quote || s.text.trim());
}
