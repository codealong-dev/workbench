import type { ReactNode } from "react";
import { FolderGit2, PanelRight, SquareTerminal } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { InsetTrigger } from "@/components/app/sidebar";
import { Counts } from "@/components/app/diff-view";
import { OpenMenu } from "@/components/app/open-menu";
import { cn } from "@/lib/utils";
import type { DiffResult, Editor, Thread } from "@/contracts";
import { UsageStatus } from "./usage-status";

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
  diff: DiffResult | null;
  terminals: number;
  connected: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onOpenChanges: () => void;
  onTerminals: () => void;
  onOpenIn: (editor: Editor) => Promise<string | null>;
}) {
  const { root, diff } = props;
  const totals = (diff?.files ?? []).reduce(
    (a, f) => ({
      additions: a.additions + f.additions,
      deletions: a.deletions + f.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  return (
    <footer className="relative flex h-7 shrink-0 items-center gap-0.5 px-0.5 text-[12px] text-muted-foreground">
      <InsetTrigger className="size-6" />
      <Item title={`${root.worktree_path} (click to copy)`} onClick={() => void navigator.clipboard?.writeText(root.worktree_path)} className="hidden lg:flex">
        <FolderGit2 className="size-3.5 shrink-0" />
        <span className="max-w-72 truncate font-mono">{home(root.worktree_path)}</span>
      </Item>
      <Item title="All changes against the base branch" onClick={props.onOpenChanges}>
        {diff && diff.files.length > 0 ? <Counts {...totals} /> : "No changes"}
      </Item>

      <div className="ml-auto flex h-full items-center gap-0.5">
        <UsageStatus connected={props.connected} />
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
