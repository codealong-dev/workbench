import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Elevated } from "@/lib/elevated";
import { useShape } from "@/lib/shape-context";
import { useSize, useTypeScale } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { removeNote, updateNote, useNotes, type Note } from "@/lib/notes";

/** The range covering characters [start, end) of `root`'s text, if it has that many. */
function rangeAt(root: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0;
  let started = false;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!started && start <= pos + n.length) {
      r.setStart(n, start - pos);
      started = true;
    }
    if (started && end <= pos + n.length) {
      r.setEnd(n, end - pos);
      return r;
    }
    pos += n.length;
  }
  return null;
}

/**
 * Where a note sits: its item's element, and the range of text it covers when
 * that's on screen (a collapsed reasoning block isn't). Offsets come first; if
 * the text there changed (the answer re-rendered), look for the text itself.
 */
function locate(column: HTMLElement, note: Note): { el: Element; range: Range | null } | null {
  const el = column.querySelector(`[data-item="${CSS.escape(note.item)}"]`);
  if (!el) return null;
  const text = el.matches("[data-quotable]") ? el : el.querySelector("[data-quotable]");
  if (!text) return { el, range: null };
  const content = text.textContent ?? "";
  let start = note.start;
  if (content.slice(note.start, note.end) !== note.raw) start = content.indexOf(note.raw);
  return { el, range: start < 0 ? null : rangeAt(text, start, start + note.raw.length) };
}

// One set of highlights for the page (CSS.highlights is global); each rail
// adds and removes its own ranges.
const highlights =
  typeof CSS !== "undefined" && "highlights" in CSS
    ? (() => {
        const make = (name: string, priority: number) => {
          const h = new Highlight();
          h.priority = priority;
          CSS.highlights.set(name, h);
          return h;
        };
        return { draft: make("wb-note", 0), sent: make("wb-note-sent", 0), active: make("wb-note-active", 1) };
      })()
    : null;

const GAP = 8;

/** A card as the rail sees it: its element, its offset down the rail, and where that's headed. */
type Card = { el: HTMLDivElement; y: MotionValue<number>; target?: number };

/**
 * Notes in the margin beside the timeline, each level with the text it's on
 * and pushed down when they'd overlap. They scroll with the answers. The
 * text a note covers is highlighted; clicking it opens the note.
 */
export function NoteRail({
  thread,
  column,
  editing,
  onEditing,
}: {
  thread: string;
  /** the element holding the timeline's items */
  column: RefObject<HTMLElement | null>;
  editing: string | null;
  onEditing: (id: string | null) => void;
}) {
  const notes = useNotes(thread);
  const rail = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, Card>());
  const ranges = useRef(new Map<string, Range>());
  const owned = useRef<[Highlight, Range][]>([]);
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);
  const focused = active ?? editing;

  const relayout = () => {
    const root = rail.current;
    const col = column.current;
    if (!root || !col) return;
    const base = root.getBoundingClientRect().top;
    ranges.current.clear();
    const placed = notes
      .map((note, i) => {
        const at = locate(col, note);
        if (at?.range) ranges.current.set(note.id, at.range);
        const top = at ? (at.range ?? at.el).getBoundingClientRect().top - base : Infinity;
        return { note, top, i };
      })
      .sort((a, b) => a.top - b.top || a.i - b.i);
    let floor = 0;
    for (const { note, top } of placed) {
      const card = cards.current.get(note.id);
      if (!card) continue;
      const y = Math.max(Number.isFinite(top) ? top : floor, floor);
      // a new card lands in place; one pushed by its neighbours slides there
      if (card.target === undefined || reduceMotion) card.y.set(y);
      else if (card.target !== y) animate(card.y, y, spring.moderate);
      card.target = y;
      floor = y + card.el.offsetHeight + GAP;
    }
    root.style.minHeight = `${floor}px`;

    if (!highlights) return;
    for (const [h, r] of owned.current) h.delete(r);
    owned.current = notes.flatMap((n) => {
      const r = ranges.current.get(n.id);
      if (!r) return [];
      const pairs: [Highlight, Range][] = [[n.sent ? highlights.sent : highlights.draft, r]];
      if (n.id === focused) pairs.push([highlights.active, r]);
      return pairs;
    });
    for (const [h, r] of owned.current) h.add(r);
  };
  const relayoutRef = useRef(relayout);
  relayoutRef.current = relayout;

  // every render: the timeline re-renders as answers stream in
  useLayoutEffect(() => relayoutRef.current());

  useEffect(() => {
    const col = column.current;
    const root = rail.current;
    if (!col || !root) return;
    const again = () => relayoutRef.current();
    // answers grow, reasoning opens, cards grow as you type, the pane resizes
    const ro = new ResizeObserver(again);
    ro.observe(col);
    for (const card of cards.current.values()) ro.observe(card.el);
    // click highlighted text to open its note
    const onClick = (e: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (!at) return;
      for (const [id, r] of ranges.current)
        if (r.isPointInRange(at.startContainer, at.startOffset)) {
          const note = notes.find((n) => n.id === id);
          if (note && !note.sent) onEditing(id);
          else setActive(id);
          return;
        }
      setActive(null);
    };
    col.addEventListener("click", onClick);
    return () => {
      ro.disconnect();
      col.removeEventListener("click", onClick);
    };
  }, [column, notes, onEditing]);

  // take this rail's highlights away with it
  useEffect(
    () => () => {
      for (const [h, r] of owned.current) h.delete(r);
      owned.current = [];
    },
    [],
  );

  return (
    <div ref={rail} className="relative w-60 shrink-0" aria-label="Notes">
      <AnimatePresence initial={false}>
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          register={(card) => {
            if (card) cards.current.set(note.id, card);
            else cards.current.delete(note.id);
          }}
          note={note}
          editing={editing === note.id && !note.sent}
          focused={focused === note.id}
          onEdit={() => onEditing(note.id)}
          onHover={(on) => setActive(on ? note.id : null)}
          onChange={(text) => updateNote(thread, note.id, text)}
          onDone={() => {
            onEditing(null);
            if (!note.text.trim() && !note.sent) removeNote(thread, note.id);
          }}
          onRemove={() => removeNote(thread, note.id)}
        />
      ))}
      </AnimatePresence>
    </div>
  );
}

function NoteCard({
  register,
  note,
  editing,
  focused,
  onEdit,
  onHover,
  onChange,
  onDone,
  onRemove,
}: {
  register: (card: Card | null) => void;
  note: Note;
  editing: boolean;
  focused: boolean;
  onEdit: () => void;
  onHover: (on: boolean) => void;
  onChange: (text: string) => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const shape = useShape();
  const size = useSize("compact");
  const type = useTypeScale("compact");
  const input = useRef<HTMLTextAreaElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  // the rail places the card; it runs its layout effects after ours
  const registerRef = useRef(register);
  registerRef.current = register;
  useLayoutEffect(() => {
    registerRef.current({ el: el.current!, y });
    return () => registerRef.current(null);
  }, [y]);
  // grow with the note
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, note.text]);
  useEffect(() => {
    if (!editing) return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  return (
    <motion.div
      ref={el}
      style={{ y }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: spring.fast.exit }}
      transition={spring.moderate}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={() => !editing && !note.sent && onEdit()}
      className="group absolute inset-x-0 top-0 origin-top-left"
    >
      <Elevated
        offset={1}
        shadowLevel={editing || focused ? 3 : 1}
        className={cn("relative px-2.5 py-2 transition-shadow duration-80", shape.container, !editing && !note.sent && "cursor-text")}
      >
        <div
          className={cn("mb-1 line-clamp-2 border-l-2 pr-6 pl-1.5 text-muted-foreground", note.sent ? "border-border" : "border-[#F5C451]")}
          style={{ fontSize: type.caption }}
        >
          {note.quote}
        </div>
        <Tooltip content="Delete note" side="top">
          <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            aria-label="Delete note"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute top-1 right-1 opacity-0 transition-opacity duration-80 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <X />
          </Button>
        </Tooltip>
        {editing ? (
          <textarea
            ref={input}
            value={note.text}
            rows={1}
            placeholder="Add a note…"
            onChange={(e) => onChange(e.target.value)}
            onBlur={onDone}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.blur();
              }
            }}
            className={cn("block w-full resize-none bg-transparent leading-[18px] text-foreground outline-none placeholder:text-muted-foreground", size.text)}
          />
        ) : (
          <div className={cn("leading-[18px] whitespace-pre-wrap", size.text, note.sent ? "text-muted-foreground" : "text-foreground")}>{note.text}</div>
        )}
      </Elevated>
    </motion.div>
  );
}
