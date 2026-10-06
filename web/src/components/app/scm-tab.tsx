import { useMemo, useState, type ReactNode, type RefObject } from "react";
import type { Channel } from "phoenix";
import { motion } from "framer-motion";
import { ArrowUpFromLine, Check, ChevronDown, ChevronRight, ExternalLink, GitCommitHorizontal, GitPullRequest, Minus, Plus, Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Tooltip } from "@/components/ui/tooltip";
import { push } from "@/hooks/use-channels";
import { useScm } from "@/hooks/use-scm";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import type { DiffResult, PushResult, ScmFile, Thread } from "@/contracts";
import { useCommitModel } from "./commit-dialog";
import { TreeRows, type Row } from "./file-tree";
import { IconButton, splitPath, STATUS, StatusBox } from "./panel-bits";

export type PushOutcome = { ok: true; result: PushResult } | { ok: false; error: string };

type Outcome = { kind: "done"; text: string; pr?: string | null } | { kind: "error"; text: string };

/**
 * Source control at the top of the Changes tab: write a message, stage files one
 * by one or all together, commit. `toolbar` goes above it; `children` follow the
 * file lists, in the same scroll.
 */
export function ScmTab(props: {
  toolbar: ReactNode;
  children?: ReactNode;
  thread: Thread | undefined;
  channel: RefObject<Channel | null>;
  /** refetches when this changes: the diff refetches as files change on disk */
  trigger: DiffResult | null;
  message: string;
  onMessage: (m: string) => void;
  selected: string | null;
  onOpen: (path: string, pin?: boolean) => void;
  onOpenInEditor: (path: string) => void;
  onPush: () => Promise<PushOutcome>;
  /** the index or the files changed: refresh what depends on them */
  onChanged: (files?: boolean) => void;
}) {
  const { thread, channel, message, onMessage, selected, onOpen, onOpenInEditor, onPush, onChanged } = props;
  const scm = useScm(channel, props.trigger);
  const model = useCommitModel(thread);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const staged = scm.changes?.staged ?? [];
  const unstaged = scm.changes?.unstaged ?? [];
  const title = message.trim();

  const change = async (op: (paths?: string[]) => Promise<boolean>, paths?: string[], files = false) => {
    setOutcome(null);
    if (await op(paths)) onChanged(files);
  };

  const discard = (paths?: string[]) => {
    const files = paths ? unstaged.filter((f) => paths.includes(f.path)) : unstaged;
    if (files.length === 0) return;
    const gone = files.filter((f) => f.status === "untracked").length;
    const what = files.length === 1 ? files[0].path : `all ${files.length} changed files`;
    const warn = gone > 0 ? ` ${gone === 1 ? "An untracked file" : `${gone} untracked files`} will be deleted for good.` : "";
    if (window.confirm(`Discard the changes in ${what}? This can't be undone.${warn}`)) void change(scm.discard, paths, true);
  };

  const suggest = async () => {
    setSuggesting(true);
    setOutcome(null);
    // a model is asked: give it time
    const r = await push(channel.current, "commit.suggest", { staged: true }, 90_000);
    setSuggesting(false);
    if (r.ok) onMessage((r.payload as { title: string }).title);
    else setOutcome({ kind: "error", text: r.reason });
  };

  const commit = async (andPush: boolean) => {
    if (committing || !title) return;
    setCommitting(true);
    setOutcome(null);
    const r = await push(channel.current, "commit", { title, staged: true });
    if (!r.ok) {
      setCommitting(false);
      return setOutcome({ kind: "error", text: r.reason });
    }
    const sha = (r.payload as { sha: string }).sha.slice(0, 7);
    onMessage("");
    onChanged(false);
    void scm.refresh();
    if (andPush) {
      const p = await onPush();
      setOutcome(p.ok ? { kind: "done", text: `Committed ${sha} and pushed ${p.result.branch}`, pr: p.result.pr_url } : { kind: "error", text: `Committed ${sha}. ${p.error}` });
    } else setOutcome({ kind: "done", text: `Committed ${sha}` });
    setCommitting(false);
  };

  const rows = (files: ScmFile[], key: string): Row[] =>
    files.map((f) => {
      const { dir, name } = splitPath(f.path);
      return {
        key: `${key}:${f.path}`,
        depth: 0,
        kind: "file",
        path: f.path,
        name: (
          <>
            {name}
            {dir && <span className="ml-1.5 text-[11px] text-muted-foreground">{dir}</span>}
          </>
        ),
        nameClass: STATUS[f.status].text,
        title: f.old_path ? `${f.old_path} → ${f.path}` : f.path,
        actions: (
          <>
            {f.status !== "deleted" && (
              <IconButton label="Open in editor" onClick={() => onOpenInEditor(f.path)}>
                <ExternalLink />
              </IconButton>
            )}
            {key === "u" ? (
              <>
                <IconButton label="Discard changes" onClick={() => discard([f.path])}>
                  <Undo2 />
                </IconButton>
                <IconButton label="Stage" onClick={() => void change(scm.stage, [f.path])}>
                  <Plus />
                </IconButton>
              </>
            ) : (
              <IconButton label="Unstage" onClick={() => void change(scm.unstage, [f.path])}>
                <Minus />
              </IconButton>
            )}
          </>
        ),
        meta: <StatusBox status={f.status} />,
      };
    });
  const stagedRows = useMemo(() => rows(staged, "s"), [scm.changes]); // eslint-disable-line react-hooks/exhaustive-deps
  const unstagedRows = useMemo(() => rows(unstaged, "u"), [scm.changes]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = staged.length + unstaged.length;
  const open = (row: Row) => row.kind === "file" && onOpen(row.path);
  const openKept = (row: Row) => row.kind === "file" && onOpen(row.path, true);
  const label = staged.length > 0 ? `Commit ${staged.length}` : "Commit all";

  return (
    <>
      {props.toolbar}

      <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-2">
        <div className="relative">
          <textarea
            value={message}
            onChange={(e) => onMessage(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void commit(false);
              }
            }}
            rows={2}
            spellCheck={false}
            placeholder="Commit message"
            aria-label="Commit message"
            className="block w-full resize-none rounded-lg bg-surface-3 py-2 pr-9 pl-2.5 text-[13px] shadow-surface-2 outline-none placeholder:text-muted-foreground focus-visible:shadow-surface-3"
          />
          <div className="absolute top-1 right-1">
            <Tooltip content={model ? `Write the message with ${model}` : "Write the message with a model"} side="top">
              <Button size="icon-compact" variant="ghost" aria-label="Write the message with AI" disabled={suggesting || total === 0} onClick={() => void suggest()}>
                <Sparkles className={cn(suggesting && "animate-pulse")} />
              </Button>
            </Tooltip>
          </div>
        </div>
        {suggesting && <p className="px-1 text-[12px] text-muted-foreground">Reading the changes{model ? ` with ${model}` : ""}…</p>}
        <div className="flex items-center">
          <Button size="compact" leadingIcon={GitCommitHorizontal} loading={committing} disabled={!title || total === 0} onClick={() => void commit(false)} className="min-w-0 flex-1 rounded-r-none">
            {label}
          </Button>
          <DropdownMenu>
            <DropdownTrigger
              render={
                <Button size="icon-compact" aria-label="Commit options" disabled={committing || !title || total === 0} className="rounded-l-none border-l border-background/20">
                  <ChevronDown />
                </Button>
              }
            />
            <DropdownContent>
              <MenuItem index={0} icon={GitCommitHorizontal} label="Commit" onSelect={() => void commit(false)} />
              <MenuItem index={1} icon={ArrowUpFromLine} label="Commit and push" onSelect={() => void commit(true)} />
            </DropdownContent>
          </DropdownMenu>
        </div>
        {staged.length === 0 && total > 0 && <p className="px-1 text-[11px] text-muted-foreground">Nothing is staged, so everything will be committed.</p>}
        {outcome && (
          <div className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]", outcome.kind === "done" ? "bg-muted text-muted-foreground" : "bg-destructive-light text-destructive")}>
            {outcome.kind === "done" && <Check className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />}
            <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{outcome.text}</span>
            {outcome.kind === "done" && outcome.pr && (
              <a href={outcome.pr} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline">
                <GitPullRequest className="size-3.5" /> Open PR
              </a>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => setOutcome(null)} className="rounded p-0.5 hover:bg-hover">
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {scm.error && <div className="m-2 rounded-lg bg-destructive-light px-3 py-2 text-[12px] whitespace-pre-wrap text-destructive">{scm.error}</div>}
        {!scm.changes && !scm.error && <div className="px-2 py-3 text-[12px] text-muted-foreground">Loading…</div>}
        {scm.changes && total === 0 && <div className="px-2 py-3 text-[12px] text-muted-foreground">No changes to commit.</div>}

        {staged.length > 0 && (
          <>
            <Section title="Staged Changes" count={staged.length} open={stagedOpen} onToggle={() => setStagedOpen(!stagedOpen)}>
              <IconButton label="Unstage all" onClick={() => void change(scm.unstage)}>
                <Minus />
              </IconButton>
            </Section>
            {stagedOpen && <TreeRows label="Staged changes" rows={stagedRows} selected={selected} onActivate={open} onDoubleActivate={openKept} />}
          </>
        )}
        {unstaged.length > 0 && (
          <>
            <Section title="Changes" count={unstaged.length} open={unstagedOpen} onToggle={() => setUnstagedOpen(!unstagedOpen)}>
              <IconButton label="Discard all changes" onClick={() => discard()}>
                <Undo2 />
              </IconButton>
              <IconButton label="Stage all" onClick={() => void change(scm.stage)}>
                <Plus />
              </IconButton>
            </Section>
            {unstagedOpen && <TreeRows label="Changes" rows={unstagedRows} selected={selected} onActivate={open} onDoubleActivate={openKept} />}
          </>
        )}
        {props.children}
      </div>
    </>
  );
}

function Section(props: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="group/section flex h-7 items-center rounded-md pr-1 hover:bg-hover">
      <button type="button" onClick={props.onToggle} aria-expanded={props.open} className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left text-[12px] font-medium outline-none">
        <motion.span className="inline-flex text-muted-foreground" animate={{ rotate: props.open ? 90 : 0 }} transition={spring.fast}>
          <ChevronRight size={14} strokeWidth={1.5} />
        </motion.span>
        <span className="truncate">{props.title}</span>
        <span className="rounded-full bg-muted px-1.5 text-[11px] font-normal text-muted-foreground tabular-nums">{props.count}</span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/section:opacity-100 group-hover/section:opacity-100">{props.children}</span>
    </div>
  );
}
