import { useEffect, useState, type RefObject } from "react";
import { TextQuote } from "lucide-react";

/**
 * Select text in an answer (anything marked `data-quotable`) and a "Reply"
 * button appears by the selection; it hands the text to the composer.
 * `frame` is the positioned element the button is placed in; `scroller`
 * hides it when the timeline scrolls.
 */
export function QuoteSelection({
  frame,
  scroller,
  onQuote,
}: {
  frame: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection();
      const root = frame.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) return setAt(null);
      const range = sel.getRangeAt(0);
      const within = (n: Node | null) => {
        const el = n instanceof Element ? n : n?.parentElement;
        return !!el && root.contains(el) && !!el.closest("[data-quotable]");
      };
      const text = sel.toString().trim();
      if (!text || !within(range.startContainer) || !within(range.endContainer)) return setAt(null);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      setAt({ x: Math.min(last.right - box.left, box.width - 90), y: last.bottom - box.top + 6, text });
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

  if (!at) return null;
  return (
    <button
      type="button"
      // keep the selection alive through the click
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onQuote(at.text);
        window.getSelection()?.removeAllRanges();
        setAt(null);
      }}
      className="absolute z-20 flex h-7 items-center gap-1.5 rounded-lg bg-surface-4 px-2.5 text-[12px] font-medium text-foreground shadow-surface-4 hover:bg-surface-5"
      style={{ left: Math.max(at.x - 40, 8), top: at.y }}
    >
      <TextQuote className="size-3.5" />
      Reply
    </button>
  );
}
