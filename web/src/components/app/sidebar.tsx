import { useState } from "react";
import { FolderPlus, GitBranch, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { Project, Thread } from "@/contracts";
import { StatusDot } from "./status-dot";

const COLLAPSED_KEY = "wb.sidebarCollapsed";

function ThreadRow({ t, selected, onSelect }: { t: Thread; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-hover",
        selected && "bg-active",
      )}
    >
      <StatusDot status={t.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{t.title || "Untitled thread"}</div>
        {t.branch && (
          <div className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{t.branch}</span>
          </div>
        )}
      </div>
    </button>
  );
}

function Group(props: { title: string; subtitle?: string; threads: Thread[]; selected: string | null; onSelect: (id: string) => void; onNew?: () => void }) {
  const { title, subtitle, threads, selected, onSelect, onNew } = props;
  const attention = threads.filter((t) => t.status === "awaiting_approval").length;
  return (
    <section className="flex flex-col gap-0.5">
      <div className="group flex items-center justify-between px-2.5 pt-3 pb-1">
        <div className="min-w-0" title={subtitle}>
          <span className="truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</span>
          {attention > 0 && <span className="ml-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">{attention} needs you</span>}
        </div>
        {onNew && (
          <button
            type="button"
            aria-label={`New thread in ${title}`}
            onClick={onNew}
            className="rounded-md p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      {threads.map((t) => (
        <ThreadRow key={t.id} t={t} selected={selected === t.id} onSelect={() => onSelect(t.id)} />
      ))}
      {threads.length === 0 && <div className="px-2.5 py-1 text-[12px] text-muted-foreground">No threads</div>}
    </section>
  );
}

export function Sidebar(props: {
  selected: string | null;
  connected: boolean;
  onSelect: (id: string) => void;
  onNewThread: (projectId?: string) => void;
  onAddProject: () => void;
}) {
  const { selected, connected, onSelect, onNewThread, onAddProject } = props;
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const loose = threads.filter((t) => !t.project_id || !projects.some((p) => p.id === t.project_id));
  const inProject = (p: Project) => threads.filter((t) => t.project_id === p.id);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  };
  const { width, dragging, onMouseDown } = useResizableWidth("wb.sidebarWidth", 256, 200, 420, "right");

  if (collapsed) {
    return (
      <aside className="relative flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-1 pt-3">
        <Button size="icon-compact" variant="ghost" aria-label="Expand sidebar" title="Expand sidebar" onClick={() => toggleCollapsed(false)}>
          <PanelLeftOpen />
        </Button>
        <Button size="icon-compact" variant="ghost" aria-label="New thread" title="New thread (N)" onClick={() => onNewThread()}>
          <Plus />
        </Button>
      </aside>
    );
  }

  return (
    <aside
      className={cn("relative flex shrink-0 flex-col border-r border-border bg-surface-1", !dragging && "transition-[width] duration-150")}
      style={{ width }}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
          Workbench
          {!connected && <span className="text-[11px] font-normal text-muted-foreground">offline</span>}
        </div>
        <div className="flex items-center">
          <Button size="icon-compact" variant="ghost" aria-label="Add project" title="Add project" onClick={onAddProject}>
            <FolderPlus />
          </Button>
          <Button size="icon-compact" variant="ghost" aria-label="New thread" title="New thread (N)" onClick={() => onNewThread()}>
            <Plus />
          </Button>
          <Button size="icon-compact" variant="ghost" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={() => toggleCollapsed(true)}>
            <PanelLeftClose />
          </Button>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
        {projects.map((p) => (
          <Group key={p.id} title={p.name} subtitle={p.repo_path} threads={inProject(p)} selected={selected} onSelect={onSelect} onNew={() => onNewThread(p.id)} />
        ))}
        {loose.length > 0 && <Group title="Other" threads={loose} selected={selected} onSelect={onSelect} />}
        {projects.length === 0 && loose.length === 0 && (
          <div className="flex flex-col items-start gap-2 px-2.5 py-3 text-[12px] text-muted-foreground">
            Add a git repo to start.
            <Button size="compact" variant="secondary" onClick={onAddProject}>
              Add project
            </Button>
          </div>
        )}
      </nav>

      <ResizeHandle onMouseDown={onMouseDown} dragging={dragging} side="right" />
    </aside>
  );
}
