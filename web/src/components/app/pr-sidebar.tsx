import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowLeft,
  CircleUserRound,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LayoutGrid,
  ListFilter,
  Loader2,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { SidebarSearchField } from "@/components/sidebar-app/search-field";
import { Elevated } from "@/lib/elevated";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { DEFAULT_FILTERS, prThread, reviewPullRequest, usePrStore, usePullRequests, type PrReview, type PrState } from "@/hooks/use-pull-requests";
import { useEnabledLabs } from "@/lib/labs";
import type { PullRequest, Thread } from "@/contracts";
import { StatusDot } from "./status-dot";

// ── helpers ─────────────────────────────────────────────────────────────────

export function prLook(pr: Pick<PullRequest, "state" | "draft">): { icon: IconComponent; className: string; label: string } {
  if (pr.state === "merged") return { icon: GitMerge, className: "text-violet-500", label: "Merged" };
  if (pr.state === "closed") return { icon: GitPullRequestClosed, className: "text-red-500", label: "Closed" };
  if (pr.draft) return { icon: GitPullRequestDraft, className: "text-muted-foreground", label: "Draft" };
  return { icon: GitPullRequest, className: "text-emerald-500", label: "Open" };
}

/** "3m", "5h", "2d", "Mar 4" */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const prKey = (projectId: string, number: number) => `${projectId}#${number}`;

// ── filters ─────────────────────────────────────────────────────────────────

const ANY = "any"; // Radix Select has no empty value

const REVIEWS: { id: PrReview; label: string }[] = [
  { id: "", label: "All reviews" },
  { id: "requested", label: "Review requested" },
  { id: "reviewed", label: "Reviewed by me" },
  { id: "approved", label: "Approved" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "none", label: "No reviews" },
];

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 pl-2.5">
      <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FiltersPopover() {
  const { filters, setFilters, repos, prs } = usePrStore();
  const projects = useStore((s) => s.projects);
  const active = filters.projectId !== "" || filters.author !== "" || filters.review !== "";
  // GitHub projects first; any other project only once it has been picked
  const repoOptions = projects.filter((p) => repos[p.id] || p.id === filters.projectId);
  const authors = useMemo(() => {
    const seen = new Set((prs ?? []).map((p) => p.author).filter((a): a is string => !!a));
    if (filters.author && filters.author !== "me") seen.add(filters.author);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [prs, filters.author]);

  return (
    <Popover.Root>
      <Tooltip content="Filter" side="top">
        <Popover.Trigger
          aria-label="Filter pull requests"
          className={cn(
            "relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] data-[state=open]:bg-hover data-[state=open]:text-foreground",
            active && "text-foreground",
          )}
        >
          <ListFilter size={16} strokeWidth={1.5} />
          {active && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-[color:var(--focus-ring,#6B97FF)]" />}
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-50">
          <Elevated offset={2} shadowLevel={3} className="flex w-[300px] flex-col gap-0.5 rounded-xl border border-border/60 p-1.5">
            <FilterRow label="Repository">
              <Select value={filters.projectId || ANY} onValueChange={(v) => setFilters({ projectId: v === ANY ? "" : v })} size="compact">
                <SelectTrigger variant="borderless" icon={LayoutGrid} className="min-w-0 max-w-[190px]" />
                <SelectContent>
                  <SelectItem index={0} value={ANY}>
                    All repositories
                  </SelectItem>
                  {repoOptions.map((p, i) => (
                    <SelectItem key={p.id} index={i + 1} value={p.id}>
                      {repos[p.id] ?? p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterRow>
            <FilterRow label="Author">
              <Select value={filters.author || ANY} onValueChange={(v) => setFilters({ author: v === ANY ? "" : v })} size="compact">
                <SelectTrigger variant="borderless" icon={CircleUserRound} className="min-w-0 max-w-[190px]" />
                <SelectContent>
                  <SelectItem index={0} value={ANY}>
                    All authors
                  </SelectItem>
                  <SelectItem index={1} value="me">
                    Me
                  </SelectItem>
                  {authors.map((a, i) => (
                    <SelectItem key={a} index={i + 2} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterRow>
            <FilterRow label="Reviews">
              <Select value={filters.review || ANY} onValueChange={(v) => setFilters({ review: (v === ANY ? "" : v) as PrReview })} size="compact">
                <SelectTrigger variant="borderless" icon={MessageSquareText} className="min-w-0 max-w-[190px]" />
                <SelectContent>
                  {REVIEWS.map((r, i) => (
                    <SelectItem key={r.id || ANY} index={i} value={r.id || ANY}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterRow>
            {active && (
              <button
                type="button"
                className="mt-1 self-end rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors duration-80 hover:bg-hover hover:text-foreground"
                onClick={() => setFilters({ projectId: DEFAULT_FILTERS.projectId, author: DEFAULT_FILTERS.author, review: DEFAULT_FILTERS.review })}
              >
                Clear filters
              </button>
            )}
          </Elevated>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── rows ────────────────────────────────────────────────────────────────────

function PrRow({ pr, active, opening, onOpen }: { pr: PullRequest; active: boolean; opening: boolean; onOpen: () => void }) {
  const look = prLook(pr);
  const thread = useStore((s) => prThread(s.threads, pr.project_id, pr.number));
  const name = pr.repo.slice(pr.repo.indexOf("/") + 1);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-busy={opening || undefined}
      title={`${pr.title}\n${pr.repo}#${pr.number} · ${pr.head} → ${pr.base}`}
      aria-current={active || undefined}
      className={cn(
        "flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors duration-80 hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
        active && "bg-hover",
      )}
    >
      <look.icon size={16} strokeWidth={1.5} className={cn("mt-px shrink-0", look.className)} aria-label={look.label} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate text-[13px] leading-[18px]", active ? "text-foreground" : "text-foreground/90")}>{pr.title}</span>
        <span className="flex min-w-0 items-center gap-1 text-[11.5px] leading-4 text-muted-foreground">
          <span className="truncate">
            #{pr.number} · {name}
            {pr.author && ` · ${pr.author}`}
          </span>
          {pr.review_decision === "APPROVED" && <span className="shrink-0 text-emerald-600 dark:text-emerald-400">· approved</span>}
          {pr.review_decision === "CHANGES_REQUESTED" && <span className="shrink-0 text-amber-600 dark:text-amber-400">· changes</span>}
          <span className="ml-auto shrink-0 pl-1 tabular-nums">{ago(pr.updated_at)}</span>
        </span>
      </span>
      {/* being checked out; then, once it has a workspace, its status like a thread row */}
      {opening ? (
        <Loader2 size={12} strokeWidth={2} className="mt-[3px] shrink-0 animate-spin text-muted-foreground" aria-label="Checking out" />
      ) : thread && (
        <Tooltip content="Has a review workspace" side="top">
          <span className="mt-[5px] flex size-2 shrink-0 items-center justify-center">
            <StatusDot status={thread.status} />
          </span>
        </Tooltip>
      )}
    </button>
  );
}

// ── sidebar ─────────────────────────────────────────────────────────────────

/**
 * Takes the app sidebar's place while browsing pull requests. Clicking one
 * opens its workspace, checking the PR out on a new branch of its project
 * the first time (Workbench.PullRequests).
 */
export function PrSidebar({ connected, active, onOpenThread, onBack }: { connected: boolean; active: string | null; onOpenThread: (t: Thread) => void; onBack: () => void }) {
  const { filters, setFilters, prs, errors, loading, error, load } = usePullRequests(connected);
  const projects = useStore((s) => s.projects);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const { isMobile, setOpenMobile, setOpen } = useSidebar();

  // ⌘K searches pull requests here, as it searches threads in the app sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !(e.target as HTMLElement | null)?.closest?.(".monaco-editor")) {
        e.preventDefault();
        if (isMobile) setOpenMobile(true);
        else setOpen(true);
        search.current?.select();
        requestAnimationFrame(() => document.activeElement !== search.current && search.current?.select());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, setOpen, setOpenMobile]);

  const q = query.trim().toLowerCase().replace(/^#/, "");
  const shown = (prs ?? []).filter(
    (pr) => !q || String(pr.number).startsWith(q) || [pr.title, pr.author, pr.head, pr.repo].some((s) => s?.toLowerCase().includes(q)),
  );
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "A project";

  // the workspace's chats start with the first enabled agent
  const provider = useEnabledLabs().find((l) => l.id !== "fake")?.id ?? "claude";
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const open = async (pr: PullRequest) => {
    const key = prKey(pr.project_id, pr.number);
    if (opening) return;
    setOpenError(null);
    let t = prThread(useStore.getState().threads, pr.project_id, pr.number);
    if (!t) {
      setOpening(key);
      const r = await reviewPullRequest(pr.project_id, pr.number, provider);
      setOpening(null);
      if ("error" in r) return setOpenError(`#${pr.number}: ${r.error}`);
      t = r.thread;
    }
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
        <Tabs value={filters.state} onValueChange={(v) => setFilters({ state: v as PrState })} size="compact">
          <TabsList>
            <TabItem value="all" label="All" />
            <TabItem value="open" label="Open" />
            <TabItem value="merged" label="Merged" />
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <SidebarSearchField
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  e.currentTarget.blur();
                } else if (e.key === "Enter" && shown[0]) {
                  void open(shown[0]);
                }
              }}
              placeholder="Search pull requests…"
              shortcut={null}
            />
          </div>
          <FiltersPopover />
        </div>
        <div className="-mx-2 mt-1 flex items-center justify-between border-y border-border/60 py-1 pr-2 pl-4 text-[12.5px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <GitPullRequest size={14} strokeWidth={1.5} />
            {prs === null ? (loading ? "Loading…" : "Pull requests") : `${shown.length} pull request${shown.length === 1 ? "" : "s"}`}
          </span>
          <Tooltip content="Refresh" side="top">
            <button
              type="button"
              aria-label="Refresh pull requests"
              disabled={loading}
              onClick={() => void load()}
              className="flex size-7 items-center justify-center rounded-md outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
            >
              <RefreshCw size={14} strokeWidth={1.5} className={cn(loading && "animate-spin")} />
            </button>
          </Tooltip>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <div className="flex flex-col gap-px px-2 pb-2">
          {error && <p role="alert" className="px-2 py-1 text-[12px] text-destructive">{error}</p>}
          {openError && <p role="alert" className="px-2 py-1 text-[12px] text-destructive">{openError}</p>}
          {errors.map((e) => (
            <p key={e.project_id} role="alert" className="px-2 py-1 text-[12px] text-destructive">
              {projectName(e.project_id)}: {e.reason}
            </p>
          ))}
          {shown.map((pr) => (
            <PrRow
              key={prKey(pr.project_id, pr.number)}
              pr={pr}
              active={active === prKey(pr.project_id, pr.number)}
              opening={opening === prKey(pr.project_id, pr.number)}
              onOpen={() => void open(pr)}
            />
          ))}
          {prs !== null && shown.length === 0 && !error && (
            <div className="px-2 py-2 text-[12px] text-muted-foreground">
              {q
                ? `No pull requests match “${query.trim()}”.`
                : projects.length === 0
                  ? "Add a project whose origin is on GitHub to see its pull requests."
                  : "No pull requests here."}
            </div>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
