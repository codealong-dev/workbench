import { useEffect, useRef, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { Plus, SquareTerminal, X } from "lucide-react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { Tooltip } from "@/components/ui/tooltip";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { useTerminals } from "@/hooks/use-terminals";
import { cn } from "@/lib/utils";
import type { TerminalInfo } from "@/contracts";
import { TerminalView } from "./terminal-view";

function TermTab(props: { t: TerminalInfo; index: number; active: boolean; exited: boolean; register: (i: number, el: HTMLElement | null) => void; onSelect: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(props.register, props.index, ref);
  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={props.active}
      tabIndex={0}
      onClick={props.onSelect}
      onAuxClick={(e) => e.button === 1 && props.onClose()}
      onKeyDown={(e) => e.key === "Enter" && props.onSelect()}
      title={props.t.cwd}
      className={cn(
        "group/tab relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2 text-[12px] outline-none select-none",
        props.active ? "bg-active text-foreground" : "text-muted-foreground",
      )}
    >
      <SquareTerminal size={14} strokeWidth={1.5} className={cn("shrink-0", props.exited && "opacity-50")} />
      <span className={cn("max-w-28 truncate", props.exited && "line-through opacity-60")}>{props.t.title}</span>
      <button
        type="button"
        aria-label={`Close ${props.t.title}`}
        onClick={(e) => {
          e.stopPropagation();
          props.onClose();
        }}
        className={cn("rounded p-0.5 hover:bg-hover hover:text-foreground", props.active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100")}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/**
 * Terminals in the thread's worktree. `cycle` bumps (Ctrl+`) focus the
 * current one, or move to the next when one already has focus; `spawn` bumps
 * (Ctrl+Shift+`) open a new one.
 */
export function TerminalTab({ channel, cycle, spawn }: { channel: RefObject<Channel | null>; cycle: number; spawn: number }) {
  const { terminals, error, create, close } = useTerminals(channel, true);
  const [active, setActive] = useState<string | null>(null);
  const [exited, setExited] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(strip, { axis: "x", gapClick: false });
  const creating = useRef(false);

  const add = async () => {
    if (creating.current) return;
    creating.current = true;
    const t = await create();
    creating.current = false;
    if (t) {
      setActive(t.id);
      setFocus((n) => n + 1);
    }
  };

  // first visit with none: open one
  useEffect(() => {
    if (terminals && terminals.length === 0 && !error) void add();
  }, [terminals === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep a valid selection as terminals come and go
  useEffect(() => {
    if (!terminals?.length) return;
    if (!active || !terminals.some((t) => t.id === active)) setActive(terminals[terminals.length - 1].id);
  }, [terminals, active]);

  useEffect(() => {
    if (!cycle || !terminals?.length) return;
    const focused = body.current?.contains(document.activeElement);
    if (focused && terminals.length > 1) {
      const i = terminals.findIndex((t) => t.id === active);
      setActive(terminals[(i + 1) % terminals.length].id);
    }
    setFocus((n) => n + 1);
  }, [cycle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (spawn) void add();
  }, [spawn]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 px-1.5">
        <div
          ref={strip}
          role="tablist"
          aria-label="Terminals"
          className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
          onMouseEnter={hover.handlers.onMouseEnter}
          onMouseMove={hover.handlers.onMouseMove}
          onMouseLeave={hover.handlers.onMouseLeave}
        >
          <FluidHoverHighlight hover={hover} className="rounded-md" />
          {(terminals ?? []).map((t, i) => (
            <TermTab
              key={t.id}
              t={t}
              index={i}
              active={t.id === active}
              exited={exited.has(t.id)}
              register={hover.registerItem}
              onSelect={() => {
                setActive(t.id);
                setFocus((n) => n + 1);
              }}
              onClose={() => void close(t.id)}
            />
          ))}
        </div>
        <Tooltip content="New terminal (⌃⇧`)" side="bottom">
          <button
            type="button"
            aria-label="New terminal"
            onClick={() => void add()}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
          >
            <Plus className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <div ref={body} className="relative min-h-0 flex-1 border-t border-border">
        {error && <div className="m-2 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{error}</div>}
        {terminals?.length === 0 && !error && (
          <div className="p-3 text-[12px] text-muted-foreground">
            No terminals.{" "}
            <button type="button" onClick={() => void add()} className="text-foreground underline underline-offset-2">
              Open one
            </button>
          </div>
        )}
        {(terminals ?? []).map((t) => (
          <div key={t.id} className={cn("absolute inset-0 py-1.5 pl-2.5", t.id === active ? "block" : "hidden")}>
            <TerminalView id={t.id} active={t.id === active} focusSignal={focus} onExit={() => setExited((s) => new Set(s).add(t.id))} />
          </div>
        ))}
      </div>
    </>
  );
}
