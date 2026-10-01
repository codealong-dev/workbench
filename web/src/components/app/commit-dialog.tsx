import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { ArrowUpFromLine, Check, ChevronDown, GitCommitHorizontal, GitPullRequest, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tooltip } from "@/components/ui/tooltip";
import { CommitGraph } from "@/components/app/commit-graph";
import { push } from "@/hooks/use-channels";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import { COMMIT_DEFAULT_MODELS, type CommitGraph as Graph, type CommitStatus, type PushResult, type Thread } from "@/contracts";

const ACTION_KEY = "wb.pushAction";
type PushAction = "push" | "push-pr";

const PENDING = "pending";

/** The model that will write the title, as Settings → Commit has it. */
function useCommitModel(thread: Thread) {
  const saved = useStore((s) => s.settings?.commit?.models[thread.provider]);
  return saved ?? COMMIT_DEFAULT_MODELS[thread.provider] ?? null;
}

/**
 * Commit what the agent changed and push the branch. The title can be
 * written by a small model; once committed, the git tree below shows where
 * the commit sits and what the push will send.
 */
export function CommitDialog(props: {
  thread: Thread;
  channel: RefObject<Channel | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the commit or push changed the repo: refresh what depends on it */
  onChanged: () => void;
}) {
  const { thread, channel, open, onOpenChange, onChanged } = props;
  const model = useCommitModel(thread);
  const [status, setStatus] = useState<CommitStatus | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [title, setTitle] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<{ sha: string; title: string } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState<PushResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now() / 1000);
  const [action, setAction] = useState<PushAction>(() => (localStorage.getItem(ACTION_KEY) === "push-pr" ? "push-pr" : "push"));

  const load = useCallback(async () => {
    const r = await push(channel.current, "commit.status");
    if (r.ok) {
      const p = r.payload as { status: CommitStatus; graph: Graph };
      setStatus(p.status);
      setGraph(p.graph);
      setLoadError(null);
    } else setLoadError(r.reason);
  }, [channel]);

  // a fresh start each time it opens
  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setGraph(null);
    setTitle("");
    setCommitted(null);
    setPushed(null);
    setError(null);
    void load();
  }, [open, load]);

  const pending = status?.uncommitted.length ?? 0;

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    // a model is asked: give it time
    const r = await push(channel.current, "commit.suggest", {}, 90_000);
    setSuggesting(false);
    if (r.ok) setTitle((r.payload as { title: string }).title);
    else setError(r.reason);
  };

  const commit = async () => {
    if (committing || !title.trim()) return;
    setCommitting(true);
    setError(null);
    const r = await push(channel.current, "commit", { title });
    setCommitting(false);
    if (r.ok) {
      setCommitted(r.payload as { sha: string; title: string });
      onChanged();
      void load();
    } else setError(r.reason);
  };

  const doPush = async (how: PushAction) => {
    if (pushing) return;
    setPushing(true);
    setError(null);
    const r = await push(channel.current, "push", {}, 120_000);
    setPushing(false);
    if (!r.ok) return setError(r.reason);
    const result = r.payload as PushResult;
    setPushed(result);
    onChanged();
    void load();
    if (how === "push-pr" && result.pr_url) window.open(result.pr_url, "_blank", "noopener");
  };

  // Before committing, the graph shows the commit that is about to be made.
  const preview = useMemo<Graph | null>(() => {
    if (!graph) return null;
    if (committed || pending === 0) return graph;
    const next = { sha: PENDING, parents: [graph.head], author: "", at: now, refs: [], subject: title.trim() || "New commit", unpushed: true };
    return { head: PENDING, commits: [next, ...graph.commits] };
  }, [graph, committed, pending, title, now]);

  const unpushed = status?.unpushed ?? 0;
  const canPush = !!status?.remote && !!status.branch && !committing && pending === 0 && !pushed && (committed != null || unpushed > 0);
  const choose = (a: PushAction) => {
    setAction(a);
    localStorage.setItem(ACTION_KEY, a);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Commit and push</DialogTitle>
          <DialogDescription>
            {status ? (
              <>
                {pending === 0 ? "Nothing waiting to be committed" : `${pending} changed file${pending === 1 ? "" : "s"} to commit`}
                {status.branch && (
                  <>
                    {" on "}
                    <code className="wb-inline-code">{status.branch}</code>
                  </>
                )}
              </>
            ) : (
              "Loading…"
            )}
          </DialogDescription>
        </DialogHeader>

        {loadError && <div className="rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{loadError}</div>}

        {status && (pending > 0 || committed) && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void commit()}
                disabled={committed != null}
                placeholder="Commit title"
                aria-label="Commit title"
                spellCheck={false}
                autoFocus
                className="h-8 min-w-0 flex-1 rounded-lg bg-surface-3 px-2.5 text-[13px] shadow-surface-2 outline-none placeholder:text-muted-foreground focus-visible:shadow-surface-3 disabled:opacity-60"
              />
              <Tooltip content={model ? `Write the title with ${model}` : "Write the title with a model"} side="top">
                <Button size="icon-compact" variant="ghost" aria-label="Write the title with AI" disabled={suggesting || committed != null} onClick={() => void suggest()}>
                  <Sparkles className={cn(suggesting && "animate-pulse")} />
                </Button>
              </Tooltip>
              {committed ? (
                <span className="flex h-7 items-center gap-1 px-2 text-[12px] text-muted-foreground">
                  <Check className="size-3.5 text-green-600 dark:text-green-400" />
                  <span className="font-mono">{committed.sha.slice(0, 7)}</span>
                </span>
              ) : (
                <Button size="compact" leadingIcon={GitCommitHorizontal} loading={committing} disabled={!title.trim()} onClick={() => void commit()}>
                  Commit
                </Button>
              )}
            </div>
            {suggesting && <p className="px-1 text-[12px] text-muted-foreground">Reading the changes{model ? ` with ${model}` : ""}…</p>}
          </div>
        )}

        {error && <div className="rounded-lg bg-destructive-light px-3 py-2 text-[12px] break-words text-destructive">{error}</div>}

        {status && (pending === 0 || committed) && (
          <div className="flex items-center gap-2">
            {pushed ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">
                <Check className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
                <span className="min-w-0 truncate">
                  Pushed <code className="wb-inline-code">{pushed.branch}</code>
                </span>
                {pushed.pr_url && (
                  <a href={pushed.pr_url} target="_blank" rel="noreferrer" className="ml-auto flex shrink-0 items-center gap-1 hover:underline">
                    <GitPullRequest className="size-3.5" /> Open pull request
                  </a>
                )}
              </div>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                  {!status.remote
                    ? "This repo has no origin remote to push to."
                    : unpushed > 0
                      ? `${unpushed} commit${unpushed === 1 ? "" : "s"} not on ${status.upstream ?? "origin"} yet`
                      : "Everything is pushed."}
                </span>
                <div className="flex items-center">
                  <Button
                    size="compact"
                    leadingIcon={action === "push-pr" ? GitPullRequest : ArrowUpFromLine}
                    loading={pushing}
                    disabled={!canPush}
                    onClick={() => void doPush(action)}
                    className="rounded-r-none"
                  >
                    {action === "push-pr" ? "Push and open PR" : "Push"}
                  </Button>
                  <DropdownMenu>
                    <DropdownTrigger
                      render={
                        <Button size="icon-compact" aria-label="Push options" disabled={pushing} className="rounded-l-none border-l border-background/20">
                          <ChevronDown />
                        </Button>
                      }
                    />
                    <DropdownContent>
                      <MenuItem index={0} icon={ArrowUpFromLine} label="Push" checked={action === "push"} onSelect={() => choose("push")} />
                      <MenuItem index={1} icon={GitPullRequest} label="Push and open pull request" checked={action === "push-pr"} onSelect={() => choose("push-pr")} />
                    </DropdownContent>
                  </DropdownMenu>
                </div>
              </>
            )}
          </div>
        )}

        {preview && preview.commits.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 text-[12px] font-medium">Git tree</div>
            <div className="max-h-72 overflow-y-auto rounded-xl bg-surface-3 px-2 py-1 shadow-surface-2">
              <CommitGraph graph={preview} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
