import { useEffect, useState } from "react";
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from "dockview-react";
import { FileSearch, Plus, SquareTerminal, X } from "lucide-react";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { StatusDot } from "@/components/app/status-dot";
import { cn } from "@/lib/utils";
import { useEnabledLabs, type Lab } from "@/lib/labs";
import { useBufferTitle, useWorkspace, type Buffer } from "./buffers";
import { contextEditorKey, editorKey, useEditors } from "@/lib/editor-state";

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
  const ws = useWorkspace();
  const path = params.kind === "file" || params.kind === "diff" ? params.path : null;
  const key = params.kind === "context" ? contextEditorKey(ws.rootId) : path ? editorKey(ws.rootId, path) : null;
  const dirty = useEditors((s) => (key ? !!s.dirty[key] : false));
  const preview = (params.kind === "file" || params.kind === "diff") && !!params.preview;
  const pin = () => preview && api.updateParameters({ ...params, preview: false });
  // editing a preview keeps it
  useEffect(() => {
    if (dirty && preview) api.updateParameters({ ...params, preview: false });
  }, [dirty, preview]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    // unsaved edits stay in the editor's model; reopening the file shows them
    if (dirty && !window.confirm(`${title} has unsaved changes. Close the tab anyway? (Your edits are kept until you reload.)`)) return;
    api.close();
  };

  return (
    <div
      title={hint ? `${title}\n${hint}` : title}
      onAuxClick={(e) => e.button === 1 && close()}
      onDoubleClick={pin}
      className={cn(
        "group/tab flex h-full items-center gap-1.5 rounded-md pr-1 pl-2.5 text-[12px] select-none",
        visible ? (groupActive ? "bg-active text-foreground" : "bg-hover text-foreground") : "text-muted-foreground hover:bg-hover hover:text-foreground",
      )}
    >
      <span className="relative inline-flex shrink-0">
        <Icon size={14} strokeWidth={1.5} className={cn(iconClass)} />
        {busy && <StatusDot status={thread.status} className="absolute -top-0.5 -right-0.5 size-1.5" />}
      </span>
      <span className={cn("max-w-48 truncate", preview && "italic")}>{title}</span>
      <button
        type="button"
        aria-label={`Close ${title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        className={cn("rounded p-0.5 hover:bg-hover hover:text-foreground", visible || dirty ? "opacity-70" : "opacity-0 group-hover/tab:opacity-70")}
      >
        {dirty ? <span className="block size-3 p-[3px] group-hover/tab:hidden"><span className="block size-1.5 rounded-full bg-foreground" /></span> : null}
        <X className={cn("size-3", dirty && "hidden group-hover/tab:block")} />
      </button>
    </div>
  );
}

/** "+" right after the last tab of every strip: new chat, terminal, or open a file. */
export function NewBufferMenu({ group }: IDockviewHeaderActionsProps) {
  const ws = useWorkspace();
  const agents = useEnabledLabs().filter((l): l is Lab & { id: "claude" | "codex" } => l.id !== "fake");
  const here = () => group.api.setActive();
  return (
    <div className="flex h-full items-center">
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
        <DropdownContent className="w-[180px] min-w-0" align="start" sideOffset={4}>
          {agents.map((l, i) => (
            <MenuItem key={l.id} index={i} icon={l.icon} label={l.agent} onSelect={() => void ws.newChat(l.id)} />
          ))}
          <MenuItem index={agents.length} icon={SquareTerminal} label="Terminal" onSelect={() => void ws.newTerminal()} />
          <DropdownSeparator />
          <MenuItem index={agents.length + 1} icon={FileSearch} label="Open file…  ⌘P" onSelect={ws.quickOpen} />
        </DropdownContent>
      </DropdownMenu>
    </div>
  );
}
