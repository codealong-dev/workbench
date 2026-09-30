import { useState, type ReactNode } from "react";
import { ArrowUpFromLine, FolderGit2, GitBranch, GitPullRequest, PanelRight, SquareTerminal } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { InsetTrigger, threadLabel } from "@/components/app/sidebar";
import { StatusDot } from "@/components/app/status-dot";
import { Counts } from "@/components/app/diff-view";
import { OpenMenu } from "@/components/app/open-menu";
import { cn } from "@/lib/utils";
import type { DiffResult, Editor, PushResult, Thread } from "@/contracts";

type PushOutcome = { ok: true; result: PushResult } | { ok: false; error: string };

function Item(props: { children: ReactNode; title?: string; onClick?: () => void; className?: string }) {
  const cls = cn(
    "flex h-full min-w-0 items-center gap-1 rounded px-1.5 whitespace-nowrap",
    props.onClick && "cursor-pointer hover:bg-hover hover:text-foreground",
    props.className,
  );
  const body = props.onClick ? (
    <button type="button" onClick={props.onClick} className={cls}>
      {props.children}
    </button>
  ) : (
    <span className={cls}>{props.children}</span>
  );
  return props.title ? (
    <Tooltip content={props.title} side="top">
      {body}
    </Tooltip>
  ) : (
    body
  );
}

const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

/** VS Code-style bar under the workspace: where you are on the left, what's running on the right. */
export function StatusBar(props: {
  root: Thread;
  focused: Thread | null;
  threads: Thread[];
  diff: DiffResult | null;
  terminals: number;
  connected: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onOpenChanges: () => void;
  onTerminals: () => void;
  onPush: () => Promise<PushOutcome>;
  onOpenIn: (editor: Editor) => Promise<string | null>;
}) {
  const { root, focused, threads, diff } = props;
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState<PushOutcome | null>(null);
  const running = threads.filter((t) => t.status === "running").length;
  const waiting = threads.filter((t) => t.status === "awaiting_approval").length;
  const totals = (diff?.files ?? []).reduce(
    (a, f) => ({
      additions: a.additions + f.additions,
      deletions: a.deletions + f.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const doPush = async () => {
    setPushing(true);
    const r = await props.onPush();
    setPushing(false);
    setPushed(r);
    setTimeout(() => setPushed(null), r.ok && !r.result.pr_url ? 4000 : 12000);
  };

  return (
    <footer className="relative flex h-7 shrink-0 items-center gap-0.5 px-0.5 text-[12px] text-muted-foreground">
      <InsetTrigger className="size-6" />
      {focused && (
        <Item title={focused.parent_id ? `Session in ${threadLabel(root)}` : "This thread"}>
          <StatusDot status={focused.status} />
          <span className="max-w-56 truncate text-foreground">{threadLabel(focused)}</span>
        </Item>
      )}
      {root.branch && (
        <Item
          title={root.base_ref ? `Branch ${root.branch}, cut from ${root.base_ref} (click to copy)` : `Branch ${root.branch} (click to copy)`}
          onClick={() => void navigator.clipboard?.writeText(root.branch!)}
        >
          <GitBranch className="size-3.5 shrink-0" />
          <span className="max-w-64 truncate font-mono">{root.branch}</span>
          {root.base_ref && <span className="font-mono opacity-60">← {root.base_ref}</span>}
        </Item>
      )}
      <Item title={`${root.worktree_path} (click to copy)`} onClick={() => void navigator.clipboard?.writeText(root.worktree_path)} className="hidden lg:flex">
        <FolderGit2 className="size-3.5 shrink-0" />
        <span className="max-w-72 truncate font-mono">{home(root.worktree_path)}</span>
      </Item>
      <Item title="All changes against the base branch" onClick={props.onOpenChanges}>
        {diff && diff.files.length > 0 ? <Counts {...totals} /> : "No changes"}
      </Item>
      <Item title="git push -u origin <branch>" onClick={pushing ? undefined : () => void doPush()}>
        <ArrowUpFromLine className={cn("size-3.5", pushing && "animate-pulse")} />
        {pushing ? "Pushing…" : "Push"}
      </Item>
      {pushed && (
        <span className={cn("flex items-center gap-1 px-1.5", pushed.ok ? "text-foreground" : "text-destructive")}>
          {pushed.ok ? (
            pushed.result.pr_url ? (
              <a href={pushed.result.pr_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
                <GitPullRequest className="size-3.5" /> Open PR
              </a>
            ) : (
              "Pushed"
            )
          ) : (
            <span className="max-w-80 truncate" title={pushed.error}>
              Push failed: {pushed.error}
            </span>
          )}
        </span>
      )}

      <div className="ml-auto flex h-full items-center gap-0.5">
        {(running > 0 || waiting > 0) && (
          <Item title="Agents in this workspace">
            {running > 0 && (
              <>
                <StatusDot status="running" /> {running} working
              </>
            )}
            {waiting > 0 && (
              <span className="ml-1.5 flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <StatusDot status="awaiting_approval" /> {waiting} need
                {waiting === 1 ? "s" : ""} you
              </span>
            )}
          </Item>
        )}
        <Item title="Terminals (⌃`)" onClick={props.onTerminals}>
          <SquareTerminal className="size-3.5" />
          {props.terminals || ""}
        </Item>
        <div className="scale-90">
          <OpenMenu path={root.worktree_path} onOpen={props.onOpenIn} />
        </div>
        <Item title={props.connected ? "Connected" : "Offline, reconnecting…"}>
          <span className={cn("size-1.5 rounded-full", props.connected ? "bg-emerald-500" : "bg-red-500")} />
        </Item>
        <Item
          title={props.panelOpen ? "Hide files and changes" : "Show files and changes"}
          onClick={props.onTogglePanel}
          className={cn(props.panelOpen && "text-foreground")}
        >
          <PanelRight className="size-3.5" />
        </Item>
      </div>
    </footer>
  );
}
