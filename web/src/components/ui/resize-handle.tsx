import type { MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/utils";

export function ResizeHandle(props: {
  onMouseDown: (e: ReactMouseEvent) => void;
  dragging?: boolean;
  side: "left" | "right";
}) {
  const { onMouseDown, dragging, side } = props;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className={cn(
        "group absolute inset-y-0 z-10 w-2.5 cursor-col-resize touch-none select-none",
        side === "right" ? "-right-1.5" : "-left-1.5",
      )}
    >
      <div
        className={cn(
          "mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-foreground/25",
          dragging && "bg-foreground/25",
        )}
      />
    </div>
  );
}
