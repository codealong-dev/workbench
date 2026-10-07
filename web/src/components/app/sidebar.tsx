import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  CalendarClock,
  ChevronRight,
  CornerDownRight,
  FolderPlus,
  FileText,
  GitPullRequest,
  Link2,
  Monitor,
  MoreVertical,
  Plus,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupActions,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuActions,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tooltip } from "@/components/ui/tooltip";
import { SidebarWorkspaceHeader, WorkspaceTile } from "@/components/sidebar-app/workspace-header";
import { SidebarSearchField } from "@/components/sidebar-app/search-field";
import { SidebarUserFooter } from "@/components/sidebar-app/user-footer";
import type { IconComponent, IconComponentProps } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { useEnabledLabs } from "@/lib/labs";
import { useStore } from "@/store";
import { ClaudeIcon, PROVIDER_ICON } from "@/lib/provider-icons";
import type { Provider, Status, Thread } from "@/contracts";
import { StatusDot } from "./status-dot";
import { ArchiveDialog } from "./archive-dialog";

// ── icons ───────────────────────────────────────────────────────────────────

const PROVIDER_NAME: Record<Provider, string> = { claude: "Claude", codex: "Codex", fake: "Fake" };

// A thread's row leads with its status: a slow green pulse while any agent in it works,
// orange when one needs you, red on error, green once something finished.
const statusIcons = new Map<string, IconComponent>();
function statusIcon(status: Status, done: boolean): IconComponent {
  const key = `${status}:${done}`;
  let icon = statusIcons.get(key);
  if (!icon) {
    icon = ({ size = 16 }: IconComponentProps) => (
      <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
        {status === "running" ? (
          <span title="Working" className="inline-block size-2 shrink-0 rounded-full bg-green-500 animate-[pulse_2.4s_ease-in-out_infinite]" />
        ) : (
          <StatusDot status={status} done={done} />
        )}
      </span>
    );
    statusIcons.set(key, icon);
  }
  return icon;
}

// An agent's row leads with its own status, then who it is.
const agentIcons = new Map<string, IconComponent>();
function agentIcon(provider: Provider, status: Status, done: boolean): IconComponent {
  const key = `${provider}:${status}:${done}`;
  let icon = agentIcons.get(key);
  if (!icon) {
    const Glyph = PROVIDER_ICON[provider] ?? ClaudeIcon;
    icon = ({ size = 16, className }: IconComponentProps) => (
      <span className={cn("flex shrink-0 items-center gap-2", className)}>
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          <StatusDot status={status} done={done} className={status === "running" ? "size-3.5" : "size-2"} />
        </span>
        {/* the glyph is drawn smaller than its slot, so labels stay aligned */}
        <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
          <Glyph size={Math.round(size * 0.8)} />
        </span>
      </span>
    );
    agentIcons.set(key, icon);
  }
  return icon;
}

// green: it finished while you were elsewhere, until you open it
const isDone = (t: Thread, unseen: Record<string, true>) => t.status === "idle" && !!unseen[t.id];

/** The state of a thread and the agents in it, at a glance. */
function rollup(threads: Thread[], unseen: Record<string, true>): { status: Status; done: boolean } {
  const has = (s: Status) => threads.some((t) => t.status === s);
  const status: Status = has("awaiting_approval") ? "awaiting_approval" : has("running") ? "running" : has("error") ? "error" : "idle";
  return { status, done: threads.some((t) => isDone(t, unseen)) };
}


// ── helpers ─────────────────────────────────────────────────────────────────

const threadUrl = (id: string) => `${location.origin}${location.pathname}#/t/${id}`;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // plain http from another machine has no async clipboard
    const el = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(el);
    el.select();
    document.execCommand("copy");
    el.remove();
  }
}

export const threadLabel = (t: Thread) => t.title || (t.parent_id ? `${PROVIDER_NAME[t.provider]} session` : "Untitled thread");

type Filter = "all" | "running" | "attention";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All threads" },
  { id: "running", label: "Working" },
  { id: "attention", label: "Needs you" },
];
const passes = (f: Filter, t: Thread) =>
  f === "all" || (f === "running" ? t.status === "running" : t.status === "awaiting_approval" || t.status === "error");

const actionBtn =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]";

// ── the trigger that lives in the main area ─────────────────────────────────

/** Sidebar toggle for the inset's header: click to open or close. Hidden while the sidebar peeks. */
export function InsetTrigger({ className }: { className?: string }) {
  const { isPeeking } = useSidebar();
  return (
    <SidebarTrigger
      className={cn("transition-opacity delay-200 duration-160", isPeeking ? "opacity-0" : "opacity-100", className)}
      // FF's collapsed trigger also peeks on hover, which slides the overlay
      // over the button before it can be clicked. Here it only toggles; the
      // left-edge strip still peeks.
      onPointerEnter={() => {}}
      onPointerLeave={() => {}}
    />
  );
}

// ── rows ────────────────────────────────────────────────────────────────────

interface RowHandlers {
  selected: string | null;
  contextRoot: string | null;
  onSelect: (id: string) => void;
  onOpenContext: (id: string) => void;
  onNewSession: (parent: Thread, provider: Provider) => Promise<void>;
  onArchive: (t: Thread) => void;
}


function RootRow({ t, sessions, open, onToggle, h }: { t: Thread; sessions: Thread[]; open: boolean; onToggle: () => void; h: RowHandlers }) {
  const hasSessions = sessions.length > 0;
  const agents = useEnabledLabs().filter((l) => l.id !== "fake");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newSession = async (provider: Provider) => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await h.onNewSession(t, provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create session");
    } finally {
      setCreating(false);
    }
  };
  const unseen = useStore((s) => s.unseen);
  const glance = rollup([t, ...sessions], unseen);
  // every agent in the thread, the root's own first; a lone agent shows only while it is busy
  const busy = t.status === "running" || t.status === "awaiting_approval";
  const lines = hasSessions ? [t, ...sessions] : [t];
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        icon={statusIcon(glance.status, glance.done)}
        isActive={h.selected === t.id}
        onClick={() => h.onSelect(t.id)}
        title={t.branch ? `${threadLabel(t)}\n${t.branch}` : threadLabel(t)}
        className={cn("group/parent-row", t.branch && "h-auto min-h-10 py-1.5")}
        aria-expanded={hasSessions ? open : undefined}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{threadLabel(t)}</span>
          {t.branch && <span className="truncate text-[10px] font-normal leading-tight text-muted-foreground/70">{t.branch}</span>}
        </span>
        {t.automation_id && <CalendarClock size={12} strokeWidth={1.5} aria-label="Run by an automation" className="shrink-0 text-muted-foreground" />}
        {hasSessions && <span
          role="button"
          tabIndex={-1}
          aria-label={open ? "Hide sessions" : "Show sessions"}
          onClick={toggle}
          // closed: always shown, so hidden sessions are discoverable; open: only on hover
          className={cn(
            "ml-auto -mr-0.5 size-6 shrink-0 items-center justify-center rounded-md hover:bg-hover",
            open ? "hidden group-hover/parent-row:flex group-focus-visible/parent-row:flex" : "flex",
          )}
        >
          <motion.span className="inline-flex" animate={{ rotate: open ? 90 : 0 }} transition={spring.fast}>
            <ChevronRight
              size={16}
              strokeWidth={1.5}
              className="text-muted-foreground"
            />
          </motion.span>
        </span>}
      </SidebarMenuButton>
      <SidebarMenuActions showOnHover>
        <DropdownMenu>
          <Tooltip content={agents.length === 0 ? "Enable an agent in Settings to branch" : "Branch thread"} side="top">
            <DropdownTrigger
              render={
                <SidebarMenuAction aria-label="Branch thread" disabled={creating || agents.length === 0}>
                  <CornerDownRight />
                </SidebarMenuAction>
              }
            />
          </Tooltip>
          <DropdownContent className="w-[200px] min-w-0" align="start" sideOffset={4}>
            {agents.map((l, i) => (
              <MenuItem key={l.id} index={i} icon={l.icon} label={l.agent} onSelect={() => void newSession(l.id)} />
            ))}
          </DropdownContent>
        </DropdownMenu>
        <Tooltip content="Initial context" side="top">
          <SidebarMenuAction aria-label="Initial context" className={h.contextRoot === t.id ? "text-foreground" : undefined} onClick={() => h.onOpenContext(t.id)}>
            <FileText />
          </SidebarMenuAction>
        </Tooltip>
        <DropdownMenu>
          <DropdownTrigger
            render={
              <SidebarMenuAction aria-label="More options">
                <MoreVertical />
              </SidebarMenuAction>
            }
          />
          <DropdownContent className="w-[240px] min-w-0" align="start" sideOffset={4}>
            <MenuItem index={0} icon={Link2} label="Copy link" onSelect={() => void copy(threadUrl(t.id))} />
            <MenuItem index={1} icon={Archive} label={hasSessions ? "Archive thread and sessions…" : "Archive…"} onSelect={() => h.onArchive(t)} />
          </DropdownContent>
        </DropdownMenu>
      </SidebarMenuActions>
      {error && <p role="alert" className="px-2 py-1 text-[12px] text-destructive">{error}</p>}

      {(hasSessions || busy) && (
        <SidebarMenuSub open={hasSessions ? open : busy}>
          {lines.map((a) => (
            <AgentRow key={a.id} t={a} isRoot={a.id === t.id} h={h} />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

/** One agent in a thread: its status, who it is, and what it is doing or asking for. */
function AgentRow({ t, isRoot, h }: { t: Thread; isRoot: boolean; h: RowHandlers }) {
  const unseen = useStore((s) => s.unseen);
  const asking = t.status === "awaiting_approval";
  const working = t.status === "running";
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        href={`#/t/${t.id}`}
        icon={agentIcon(t.provider, t.status, isDone(t, unseen))}
        isActive={!isRoot && h.selected === t.id}
        title={t.activity ? `${t.activity}\n${threadLabel(t)} · ${PROVIDER_NAME[t.provider]}` : `${threadLabel(t)} · ${PROVIDER_NAME[t.provider]}`}
        onClick={(e) => {
          e.preventDefault();
          h.onSelect(t.id);
        }}
      >
        {working && !t.activity ? (
          <span aria-label="Working" className="block h-2.5 w-full animate-pulse rounded-full bg-muted" />
        ) : (
          <span className={cn("block truncate text-[12px]", asking ? "font-medium text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>
            {t.activity || (isRoot ? "Waiting for a message" : threadLabel(t))}
          </span>
        )}
      </SidebarMenuSubButton>
      {!isRoot && (
        <DropdownMenu>
          <DropdownTrigger
            render={
              <SidebarMenuAction showOnHover aria-label="More options">
                <MoreVertical />
              </SidebarMenuAction>
            }
          />
          <DropdownContent className="w-[240px] min-w-0" align="start" sideOffset={4}>
            <MenuItem index={0} icon={Link2} label="Copy link" onSelect={() => void copy(threadUrl(t.id))} />
            <MenuItem index={1} icon={Archive} label="Archive session…" onSelect={() => h.onArchive(t)} />
          </DropdownContent>
        </DropdownMenu>
      )}
    </SidebarMenuSubItem>
  );
}

// ── groups ──────────────────────────────────────────────────────────────────

interface Tree {
  root: Thread;
  sessions: Thread[];
}

function Group(props: {
  title: string;
  subtitle?: string;
  trees: Tree[];
  searching: boolean;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onNew?: () => void;
  h: RowHandlers;
}) {
  const { title, subtitle, trees, searching, filter, onFilter, onNew, h } = props;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const attention = trees.reduce((n, { root, sessions }) => n + [root, ...sessions].filter((t) => t.status === "awaiting_approval").length, 0);
  const shown = trees.filter(({ root, sessions }) => [root, ...sessions].some((t) => passes(filter, t)));

  return (
    <SidebarGroup collapsible>
      <SidebarGroupLabel title={subtitle} className="text-muted-foreground hover:text-foreground">
        {title}
        {attention > 0 && <span className="ml-1.5 shrink-0 text-[11px] font-medium text-amber-600 dark:text-amber-400">{attention} needs you</span>}
      </SidebarGroupLabel>
      <SidebarGroupActions>
        {onNew && (
          <Tooltip content="New thread" side="top">
            <SidebarGroupAction aria-label={`New thread in ${title}`} onClick={onNew}>
              <Plus />
            </SidebarGroupAction>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownTrigger
            render={
              <SidebarGroupAction aria-label="Filter threads" className={filter !== "all" ? "text-foreground" : undefined}>
                <SlidersHorizontal />
              </SidebarGroupAction>
            }
          />
          <DropdownContent className="w-[200px] min-w-0" align="start" sideOffset={4} checkedIndex={FILTERS.findIndex((f) => f.id === filter)}>
            {FILTERS.map((f, i) => (
              <MenuItem key={f.id} index={i} label={f.label} checked={f.id === filter} onSelect={() => onFilter(f.id)} />
            ))}
          </DropdownContent>
        </DropdownMenu>
      </SidebarGroupActions>
      <SidebarMenu>
        {shown.map(({ root, sessions }) => (
          <RootRow
            key={root.id}
            t={root}
            sessions={sessions}
            open={searching || !closed.has(root.id)}
            onToggle={() =>
              setClosed((c) => {
                const n = new Set(c);
                if (n.has(root.id)) n.delete(root.id);
                else n.add(root.id);
                return n;
              })
            }
            h={h}
          />
        ))}
        {shown.length === 0 && (
          <li className="px-2 py-1 text-[12px] text-muted-foreground">
            {searching ? "No matches" : filter !== "all" ? "Nothing here" : "No threads"}
          </li>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}

// ── sidebar ─────────────────────────────────────────────────────────────────

export function AppSidebar(props: {
  selected: string | null;
  contextRoot: string | null;
  connected: boolean;
  onSelect: (id: string) => void;
  onOpenContext: (id: string) => void;
  onNewThread: (projectId?: string) => void;
  onAddProject: () => void;
  onSettings: () => void;
  onPullRequests: () => void;
  onAutomations: () => void;
}) {
  const { selected, connected, onSelect, onNewThread, onAddProject, onSettings } = props;
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const host = useStore((s) => s.host);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, Filter>>({});
  const [archiving, setArchiving] = useState<Thread | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const { setOpen, isMobile, setOpenMobile } = useSidebar();

  // ⌘K / Ctrl+K: open the sidebar if needed and focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Monaco uses ⌘K chords
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !(e.target as HTMLElement | null)?.closest?.(".monaco-editor")) {
        e.preventDefault();
        if (isMobile) setOpenMobile(true);
        else setOpen(true);
        // focus now so the next keystrokes land; again once a closed sidebar has mounted
        search.current?.select();
        requestAnimationFrame(() => document.activeElement !== search.current && search.current?.select());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, setOpen, setOpenMobile]);

  const q = query.trim().toLowerCase();
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const matches = (t: Thread) =>
    !q ||
    [threadLabel(t), t.branch, PROVIDER_NAME[t.provider], t.project_id && projectName.get(t.project_id)].some((s) => s?.toLowerCase().includes(q));

  // roots with their sessions (oldest first); a session whose root is gone is shown as a root
  const trees = useMemo(() => {
    const ids = new Set(threads.map((t) => t.id));
    const byParent = new Map<string, Thread[]>();
    for (const t of threads) {
      if (t.parent_id && ids.has(t.parent_id)) byParent.set(t.parent_id, [...(byParent.get(t.parent_id) ?? []), t]);
    }
    return threads
      .filter((t) => !t.parent_id || !ids.has(t.parent_id))
      .map((root) => ({ root, sessions: (byParent.get(root.id) ?? []).sort((a, b) => a.inserted_at.localeCompare(b.inserted_at)) }));
  }, [threads]);

  const visible = q ? trees.filter(({ root, sessions }) => [root, ...sessions].some(matches)) : trees;
  const known = new Set(projects.map((p) => p.id));
  const loose = visible.filter(({ root }) => !root.project_id || !known.has(root.project_id));

  const h: RowHandlers = {
    selected,
    contextRoot: props.contextRoot,
    onOpenContext: (id) => {
      props.onOpenContext(id);
      if (isMobile) setOpenMobile(false);
    },
    onSelect: (id) => {
      onSelect(id);
      if (isMobile) setOpenMobile(false);
    },
    onArchive: setArchiving,
    onNewSession: async (parent, provider) => {
      const r = await push(lobbyChannel(), "thread.create", { parent_id: parent.id, provider, mode: parent.mode });
      if (!r.ok) throw new Error(r.reason);
      h.onSelect((r.payload as { thread: Thread }).thread.id);
    },
  };

  return (
    <>
      <Sidebar variant="inset">
        <SidebarHeader>
          <SidebarWorkspaceHeader
            name="Workbench"
            tile={<WorkspaceTile>W</WorkspaceTile>}
            menu={
              <>
                <MenuItem index={0} icon={Monitor} label={host ? `Running on ${host.name}` : "Connecting…"} disabled />
                <MenuItem index={1} icon={Plus} label="New thread" onSelect={() => onNewThread()} />
                <MenuItem index={2} icon={FolderPlus} label="Add project" onSelect={onAddProject} />
                <MenuItem index={3} icon={Settings} label="Settings" onSelect={onSettings} />
              </>
            }
          />
          <div className="flex flex-col gap-0.5">
            <SidebarSearchField
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search threads…"
            />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton icon={Plus} onClick={() => onNewThread()}>
                  New thread
                  <span className="ml-auto inline-flex opacity-0 transition-opacity duration-80 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100">
                    <kbd className="font-sans text-[11px] text-muted-foreground">N</kbd>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton icon={GitPullRequest} onClick={props.onPullRequests}>
                  Pull requests
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton icon={CalendarClock} onClick={props.onAutomations}>
                  Automations
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {projects.map((p) => {
            const mine = visible.filter(({ root }) => root.project_id === p.id);
            if (q && mine.length === 0) return null;
            return (
              <Group
                key={p.id}
                title={p.name}
                subtitle={p.repo_path}
                trees={mine}
                searching={!!q}
                filter={filters[p.id] ?? "all"}
                onFilter={(f) => setFilters((s) => ({ ...s, [p.id]: f }))}
                onNew={() => onNewThread(p.id)}
                h={h}
              />
            );
          })}
          {loose.length > 0 && (
            <Group
              title="Other"
              trees={loose}
              searching={!!q}
              filter={filters.other ?? "all"}
              onFilter={(f) => setFilters((s) => ({ ...s, other: f }))}
              h={h}
            />
          )}
          {q && visible.length === 0 && <div className="px-4 py-2 text-[12px] text-muted-foreground">No threads match “{query.trim()}”.</div>}
          {projects.length === 0 && threads.length === 0 && (
            <div className="flex flex-col items-start gap-2 px-4 py-3 text-[12px] text-muted-foreground">
              Add a git repo to start.
              <button type="button" onClick={onAddProject} className="text-foreground underline underline-offset-2">
                Add project
              </button>
            </div>
          )}
        </SidebarContent>

        {/* centred on the inset's status bar: the rail's py-2 + this pb would
            sit the h-8 row 14px higher than the h-7 bar under the m-1 inset */}
        <SidebarFooter className="-mb-1.5 pb-0">
          <div className="flex items-center gap-1 pr-1.5">
            <SidebarUserFooter
              name={
                <span className="flex items-center gap-1.5">
                  {host?.name ?? "Workbench"}
                  {!connected && <span className="text-[11px] text-destructive">offline</span>}
                </span>
              }
              avatar={
                <span className="relative flex size-5 items-center justify-center rounded-full bg-muted-foreground text-[10px] text-background uppercase">
                  {(host?.name ?? "W").slice(0, 1)}
                  <span
                    className={cn(
                      "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-[var(--sidebar,var(--background))]",
                      connected ? "bg-emerald-500" : "bg-red-500",
                    )}
                  />
                </span>
              }
              className="min-w-0 flex-1"
              menu={
                <>
                  <MenuItem index={0} icon={Monitor} label={connected ? "Connected" : "Offline, reconnecting…"} disabled />
                  <MenuItem index={1} icon={FolderPlus} label="Add project" onSelect={onAddProject} />
                  <MenuItem index={2} icon={Settings} label="Settings  ⌘," onSelect={onSettings} />
                </>
              }
            />
            <Tooltip content="Settings  ⌘," side="top">
              <button type="button" aria-label="Settings" className={actionBtn} onClick={onSettings}>
                <Settings size={16} strokeWidth={1.5} />
              </button>
            </Tooltip>
          </div>
        </SidebarFooter>
      </Sidebar>

      {archiving && (
        <ArchiveDialog
          thread={archiving}
          open
          onOpenChange={(open) => !open && setArchiving(null)}
          onArchive={async () => {
            await push(lobbyChannel(), "thread.archive", { id: archiving.id });
          }}
        />
      )}
    </>
  );
}
