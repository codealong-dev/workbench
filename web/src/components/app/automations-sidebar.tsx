import { useState } from "react";
import { ArrowLeft, CalendarClock, ChevronRight, Loader2, Play, Plus } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { LABS } from "@/lib/labs";
import { describeSchedule, when } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { Automation, AutomationRun, Thread } from "@/contracts";
import { AutomationDialog } from "./automation-dialog";
import { StatusDot } from "./status-dot";

// ── rows ────────────────────────────────────────────────────────────────────

/** A run: its thread's status while the thread is around, else what became of it. */
function RunRow({ run, active, onOpen }: { run: AutomationRun; active: boolean; onOpen: (t: Thread) => void }) {
  const thread = useStore((s) => (run.thread_id ? s.threads.find((t) => t.id === run.thread_id) : undefined));
  const label = run.scheduled_for ? when(run.scheduled_for) : `${when(run.inserted_at)} · by hand`;
  const note =
    run.status === "failed" ? "failed" : run.status === "missed" ? "missed" : !thread ? "archived" : null;

  return (
    <button
      type="button"
      disabled={!thread}
      onClick={() => thread && onOpen(thread)}
      title={run.status === "failed" ? (run.error ?? "Failed") : run.status === "missed" ? "Workbench wasn't running, and it was too late to catch up" : thread?.activity ?? undefined}
      aria-current={active || undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md py-1 pr-2 pl-8 text-left text-[12px] text-muted-foreground outline-none transition-colors duration-80 focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] enabled:hover:bg-hover enabled:hover:text-foreground",
        active && "bg-hover text-foreground",
      )}
    >
      <span className="flex size-2 shrink-0 items-center justify-center">
        {thread ? (
          <StatusDot status={thread.status} />
        ) : (
          <span className={cn("size-1.5 rounded-full", run.status === "failed" ? "bg-red-500" : "bg-muted-foreground/40")} />
        )}
      </span>
      <span className="truncate tabular-nums">{label}</span>
      {note && <span className={cn("ml-auto shrink-0", run.status === "failed" && "text-red-600 dark:text-red-400")}>{note}</span>}
    </button>
  );
}

function AutomationRow(props: { automation: Automation; selectedRoot: string | null; onEdit: () => void; onOpenThread: (t: Thread) => void }) {
  const { automation: a, onEdit, onOpenThread } = props;
  const projectName = useStore((s) => s.projects.find((p) => p.id === a.project_id)?.name ?? "A project");
  const agent = LABS.find((l) => l.id === a.provider)?.agent ?? a.provider;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // runs are folded away until you ask, unless the one you're in is among them
  const [expanded, setExpanded] = useState(() => a.runs.some((r) => !!r.thread_id && r.thread_id === props.selectedRoot));
  const unseen = useStore((s) => s.unseen);
  const threads = useStore((s) => s.threads);
  const needYou = a.runs.filter((r) => {
    const t = r.thread_id ? threads.find((x) => x.id === r.thread_id) : undefined;
    return r.status === "failed" || (!!t && (t.status === "awaiting_approval" || t.status === "error" || (t.status === "idle" && !!unseen[t.id])));
  }).length;

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    // makes the worktree and runs the project's setup first
    const r = await push(lobbyChannel(), "automation.run", { id: a.id }, 180_000);
    setRunning(false);
    if (!r.ok) return setError(r.reason);
    const { run } = r.payload as { run: AutomationRun };
    if (run.status === "failed") return setError(run.error ?? "Failed");
    const thread = useStore.getState().threads.find((t) => t.id === run.thread_id);
    if (thread) onOpenThread(thread);
  };

  return (
    <div className="flex flex-col gap-px">
      <div className="group/automation relative">
        <button
          type="button"
          onClick={onEdit}
          title={`${a.name}\n${a.schedule} · ${projectName} · ${agent}`}
          className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors duration-80 hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
        >
          <CalendarClock size={16} strokeWidth={1.5} className={cn("mt-px shrink-0", a.enabled ? "text-foreground/80" : "text-muted-foreground/50")} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn("truncate pr-6 text-[13px] leading-[18px]", a.enabled ? "text-foreground/90" : "text-muted-foreground")}>{a.name}</span>
            <span className="truncate text-[11.5px] leading-4 text-muted-foreground">
              {describeSchedule(a.schedule)} · {projectName} · {agent}
            </span>
            <span className="truncate text-[11.5px] leading-4 text-muted-foreground">
              {a.enabled ? (a.next_run_at ? `Next: ${when(a.next_run_at)}` : "Not scheduled") : "Off"}
            </span>
          </span>
        </button>
        <Tooltip content="Run now" side="top">
          <button
            type="button"
            aria-label={`Run ${a.name} now`}
            onClick={() => void runNow()}
            disabled={running}
            className={cn(
              "absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
              running ? "flex" : "opacity-0 group-hover/automation:opacity-100 focus-visible:opacity-100",
            )}
          >
            {running ? <Loader2 size={13} strokeWidth={2} className="animate-spin" /> : <Play size={13} strokeWidth={1.75} />}
          </button>
        </Tooltip>
      </div>
      {error && <p role="alert" className="px-2 pl-8 text-[12px] text-destructive">{error}</p>}
      {a.runs.length > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 rounded-md py-0.5 pr-2 pl-7 text-left text-[11.5px] text-muted-foreground outline-none transition-colors duration-80 hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
        >
          <ChevronRight size={12} strokeWidth={1.75} className={cn("shrink-0 transition-transform duration-80", expanded && "rotate-90")} />
          {expanded ? "Hide runs" : `Runs (${a.runs.length})`}
          {!expanded && needYou > 0 && <span className="ml-auto grid h-4 min-w-4 place-items-center rounded-full bg-[#6B97FF] px-1 text-[10px] leading-none font-medium text-white tabular-nums">{needYou}</span>}
        </button>
      )}
      {expanded &&
        a.runs.map((run) => <RunRow key={run.id} run={run} active={!!run.thread_id && run.thread_id === props.selectedRoot} onOpen={onOpenThread} />)}
    </div>
  );
}

// ── sidebar ─────────────────────────────────────────────────────────────────

/**
 * Takes the app sidebar's place while browsing automations: each with its
 * latest runs, which open as workspaces. Click one to edit it.
 */
export function AutomationsSidebar({ selectedRoot, onOpenThread, onBack }: { selectedRoot: string | null; onOpenThread: (t: Thread) => void; onBack: () => void }) {
  const automations = useStore((s) => s.automations);
  const [editing, setEditing] = useState<{ open: boolean; automation: Automation | null }>({ open: false, automation: null });
  const { isMobile, setOpenMobile } = useSidebar();

  const open = (t: Thread) => {
    onOpenThread(t);
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton icon={ArrowLeft} onClick={onBack}>
              Back to threads
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="-mx-2 mt-1 flex items-center justify-between border-y border-border/60 py-1 pr-2 pl-4 text-[12.5px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <CalendarClock size={14} strokeWidth={1.5} />
            {automations.length === 0 ? "Automations" : `${automations.length} automation${automations.length === 1 ? "" : "s"}`}
          </span>
          <Tooltip content="New automation" side="top">
            <button
              type="button"
              aria-label="New automation"
              onClick={() => setEditing({ open: true, automation: null })}
              className="flex size-7 items-center justify-center rounded-md outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <div className="flex flex-col gap-1 px-2 pb-2">
          {automations.map((a) => (
            <AutomationRow
              key={a.id}
              automation={a}
              selectedRoot={selectedRoot}
              onEdit={() => setEditing({ open: true, automation: a })}
              onOpenThread={open}
            />
          ))}
          {automations.length === 0 && (
            <div className="flex flex-col items-start gap-2 px-2 py-2 text-[12px] text-muted-foreground">
              Run an agent on a schedule, like a dependency audit every night. Each run gets its own worktree and thread for you to review.
              <button type="button" onClick={() => setEditing({ open: true, automation: null })} className="text-foreground underline underline-offset-2">
                New automation
              </button>
            </div>
          )}
          <p className="px-2 pt-2 text-[11.5px] leading-4 text-muted-foreground/80">
            Runs while Workbench is running. A run it slept through still happens on wake if it's less than 12 hours late.
          </p>
        </div>
      </SidebarContent>

      <AutomationDialog open={editing.open} automation={editing.automation} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))} />
    </Sidebar>
  );
}
