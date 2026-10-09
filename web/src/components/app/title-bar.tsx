import type { ReactNode } from "react";
import { SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { titlebarMouseDown } from "@/lib/mac-app";

/**
 * The macOS app's title bar. The window has no native one: its controls float over the left end of this
 * row, and desktop/main.swift sets --wb-titlebar-h (the row's height) and --wb-traffic-w (how far the
 * controls reach; 0 in full screen). Anything that isn't a control moves the window.
 */
export function TitleBar({ title, onNewThread }: { title?: ReactNode; onNewThread: () => void }) {
  return (
    <header
      onMouseDown={(e) => !(e.target as Element).closest("button, a, input") && titlebarMouseDown(e)}
      className="flex h-[var(--wb-titlebar-h)] shrink-0 select-none items-center gap-0.5 pr-2 pl-[max(var(--wb-traffic-w),0.5rem)] text-[13px]"
    >
      {/* click only: hovering the collapsed trigger would peek the sidebar over the row's other buttons */}
      <SidebarTrigger size="icon-compact" onPointerEnter={() => {}} onPointerLeave={() => {}} />
      <Tooltip content="New thread  N" side="bottom">
        <Button variant="ghost" size="icon-compact" aria-label="New thread" onClick={onNewThread}>
          <SquarePen />
        </Button>
      </Tooltip>
      {title && (
        <span className="ml-2 min-w-0 truncate" style={{ fontVariationSettings: fontWeights.semibold }}>
          {title}
        </span>
      )}
    </header>
  );
}
