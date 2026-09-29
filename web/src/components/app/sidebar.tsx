import { FolderPlus, GitBranch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { Project, Thread } from "@/contracts";
import { StatusDot } from "./status-dot";

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
  const host = useStore((s) => s.host);
  const loose = threads.filter((t) => !t.project_id || !projects.some((p) => p.id === t.project_id));
  const inProject = (p: Project) => threads.filter((t) => t.project_id === p.id);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface-1">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex min-w-0 items-baseline gap-2 text-[13px] font-semibold tracking-tight">
          Workbench
          {host && (
            <span className="truncate text-[11px] font-normal text-muted-foreground" title={`Running on ${host.name}`}>
              {host.name}
            </span>
          )}
          {!connected && <span className="text-[11px] font-normal text-destructive">offline</span>}
        </div>
        <div className="flex items-center">
          <Button size="icon-compact" variant="ghost" aria-label="Add project" title="Add project" onClick={onAddProject}>
            <FolderPlus />
          </Button>
          <Button size="icon-compact" variant="ghost" aria-label="New thread" title="New thread (N)" onClick={() => onNewThread()}>
            <Plus />
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
    </aside>
  );
}
