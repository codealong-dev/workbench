import { useEffect, useState } from "react";
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from "dockview-react";
import { FileSearch, Plus, Sparkle, SquareTerminal, X } from "lucide-react";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { StatusDot } from "@/components/app/status-dot";
import { cn } from "@/lib/utils";
import { useBufferTitle, useWorkspace, type Buffer } from "./buffers";

/** A tab in the top strip: icon, title, close. Middle-click closes too. */
export function BufferTab({ api, params }: IDockviewPanelHeaderProps<Buffer>) {
  const { title, icon: Icon, iconClass, thread, hint } = useBufferTitle(params);
  const [visible, setVisible] = useState(api.isVisible);
  const [groupActive, setGroupActive] = useState(api.isGroupActive);
  useEffect(() => {
    const a = api.onDidVisibilityChange((e) => setVisible(e.isVisible));
    const b = api.onDidGroupChange?.(() => setGroupActive(api.isGroupActive));
    const c = api.onDidActiveGroupChange?.(() => setGroupActive(api.isGroupActive));
    return () => {
      a.dispose();
      b?.dispose();
      c?.dispose();
    };
  }, [api]);
  const busy = thread && thread.status !== "idle";

  return (
    <div
      title={hint ? `${title}\n${hint}` : title}
      onAuxClick={(e) => e.button === 1 && api.close()}
      className={cn(
        "group/tab flex h-full items-center gap-1.5 rounded-md pr-1 pl-2.5 text-[12px] select-none",
        visible ? (groupActive ? "bg-active text-foreground" : "bg-hover text-foreground") : "text-muted-foreground hover:bg-hover hover:text-foreground",
      )}
    >
      <span className="relative inline-flex shrink-0">
        <Icon size={14} strokeWidth={1.5} className={cn(iconClass)} />
        {busy && <StatusDot status={thread.status} className="absolute -top-0.5 -right-0.5 size-1.5" />}
      </span>
      <span className="max-w-48 truncate">{title}</span>
      <button
        type="button"
        aria-label={`Close ${title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          api.close();
        }}
        className={cn("rounded p-0.5 hover:bg-hover hover:text-foreground", visible ? "opacity-70" : "opacity-0 group-hover/tab:opacity-70")}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/** "+" at the end of every tab strip: new chat, terminal, or open a file. */
export function NewBufferMenu({ group }: IDockviewHeaderActionsProps) {
  const ws = useWorkspace();
  const here = () => group.api.setActive();
  return (
    <div className="flex h-full items-center pr-1">
      <DropdownMenu>
        <DropdownTrigger
          render={
            <button
              type="button"
              aria-label="New tab"
              onPointerDown={here}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
            >
              <Plus className="size-3.5" />
            </button>
          }
        />
        <DropdownContent className="w-[220px] min-w-0" align="end" sideOffset={4}>
          <MenuItem index={0} icon={Sparkle} label="New Claude chat" onSelect={() => void ws.newChat("claude")} />
          <MenuItem index={1} icon={SquareTerminal} label="New Codex chat" onSelect={() => void ws.newChat("codex")} />
          <MenuItem index={2} icon={SquareTerminal} label="New terminal" onSelect={() => void ws.newTerminal()} />
          <DropdownSeparator />
          <MenuItem index={3} icon={FileSearch} label="Open file…  ⌘P" onSelect={ws.quickOpen} />
        </DropdownContent>
      </DropdownMenu>
    </div>
  );
}
