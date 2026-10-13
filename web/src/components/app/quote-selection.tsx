import { useEffect, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Elevated } from "@/lib/elevated";
import { useShape } from "@/lib/shape-context";
import { spring } from "@/lib/springs";
import { textOffset, type NoteAnchor } from "@/lib/notes";

/**
 * Select text in an answer (anything marked `data-quotable` inside a
 * `data-item`) and an "Add note" button appears by the selection; it hands an
 * anchor for the selection to `onNote`. A selection running past the answer
 * it starts in is cut at the end of that answer. `frame` is the positioned
 * element the button is placed in; `scroller` hides it when the timeline scrolls.
 */
export function QuoteSelection({
  frame,
  scroller,
  onNote,
}: {
  frame: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
  onNote: (anchor: NoteAnchor) => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number; anchor: NoteAnchor } | null>(null);
  const shape = useShape();

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection();
      const root = frame.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) return setAt(null);
      const range = sel.getRangeAt(0);
      const quotable = (n: Node | null) => {
        const el = n instanceof Element ? n : n?.parentElement;
        return el && root.contains(el) ? el.closest("[data-quotable]") : null;
      };
      const from = quotable(range.startContainer);
      const item = from?.closest<HTMLElement>("[data-item]");
      if (!from || !item || !quotable(range.endContainer)) return setAt(null);
      // offsets count from the start of the quotable text (not a reasoning block's label)
      const within = from.contains(range.endContainer);
      const start = textOffset(from, range.startContainer, range.startOffset);
      const end = within ? textOffset(from, range.endContainer, range.endOffset) : (from.textContent ?? "").length;
      const raw = (from.textContent ?? "").slice(start, end);
      const quote = within ? sel.toString().trim() : raw.trim();
      if (!quote) return setAt(null);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      setAt({
        x: Math.min(last.right - box.left, box.width - 90),
        y: last.bottom - box.top + 6,
        anchor: { item: item.dataset.item!, start, end, raw, quote },
      });
    };
    // after the mouse is released (not mid-drag), and for keyboard selection
    const onUp = () => setTimeout(read, 0);
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setAt(null);
    };
    const hide = () => setAt(null);
    const el = frame.current;
    const sc = scroller.current;
    el?.addEventListener("mouseup", onUp);
    el?.addEventListener("keyup", onUp);
    sc?.addEventListener("scroll", hide);
    document.addEventListener("selectionchange", onChange);
    return () => {
      el?.removeEventListener("mouseup", onUp);
      el?.removeEventListener("keyup", onUp);
      sc?.removeEventListener("scroll", hide);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [frame, scroller]);

  return (
    <AnimatePresence>
      {at && (
        <motion.div
          key={`${at.x},${at.y}`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: spring.fast.exit }}
          transition={spring.fast}
          className="absolute z-20 origin-top-left"
          style={{ left: Math.max(at.x - 14, 8), top: at.y }}
        >
          <Elevated offset={2} shadowLevel={3} className={shape.container}>
            <Tooltip content="Add a note" side="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-compact"
                aria-label="Add a note"
                // keep the selection alive through the click
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onNote(at.anchor);
                  window.getSelection()?.removeAllRanges();
                  setAt(null);
                }}
              >
                <MessageSquarePlus />
              </Button>
            </Tooltip>
          </Elevated>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
