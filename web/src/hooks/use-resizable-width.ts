import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * A panel width in px, persisted to localStorage and dragged from one edge.
 * `grow` is the pointer direction that widens the panel: "right" for a panel
 * anchored to the left edge of the screen, "left" for one anchored to the right.
 */
export function useResizableWidth(key: string, defaultWidth: number, min: number, max: number, grow: "left" | "right") {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved > 0 ? clamp(saved, min, max) : defaultWidth;
  });
  const [dragging, setDragging] = useState(false);
  const latest = useRef(width);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = latest.current;
      const sign = grow === "right" ? 1 : -1;
      setDragging(true);
      const onMove = (ev: MouseEvent) => {
        const next = clamp(startWidth + sign * (ev.clientX - startX), min, max);
        latest.current = next;
        setWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setDragging(false);
        localStorage.setItem(key, String(latest.current));
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [grow, min, max, key],
  );

  return { width, dragging, onMouseDown };
}
