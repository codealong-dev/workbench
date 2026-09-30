import { useCallback, useState } from "react";
import { Archive, Cpu, FileDiff as FileDiffIcon, FolderGit2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { push, useThreadChannel } from "@/hooks/use-channels";
import { fetchFilePatch, useDiff } from "@/hooks/use-diff";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { Decision, Editor, PushResult, Thread } from "@/contracts";
import { isRemote, remoteEditorUrl } from "@/lib/remote";
import { Timeline } from "./timeline";
import { StatusDot } from "./status-dot";
import { MODES } from "./modes";
import { ChangesPanel, Counts } from "./changes-panel";
import { OpenMenu, preferredEditor } from "./open-menu";
import { ArchiveDialog } from "./archive-dialog";
import { InsetTrigger, threadLabel } from "./sidebar";

const CHANGES_KEY = "wb.changesOpen";
const AGENT_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", fake: "the fake agent" };

function ArchiveButton({ thread, onArchive }: { thread: Thread; onArchive: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="icon-compact" variant="ghost" aria-label="Archive thread" title="Archive thread" onClick={() => setOpen(true)}>
        <Archive />
      </Button>
      <ArchiveDialog thread={thread} open={open} onOpenChange={setOpen} onArchive={onArchive} />
    </>
  );
}

export function ThreadView({ id }: { id: string }) {
  const { channel, joinError } = useThreadChannel(id);
  const [changesOpen, setChangesOpen] = useState(() => localStorage.getItem(CHANGES_KEY) === "1");
  const toggleChanges = (open: boolean) => {
    setChangesOpen(open);
    localStorage.setItem(CHANGES_KEY, open ? "1" : "0");
  };
  const threadStatus = useStore((s) => s.byId[id]?.status);
  const { diff, error: diffError, loading: diffLoading, refresh: refreshDiff } = useDiff(channel, threadStatus, changesOpen);

  const host = useStore((s) => s.host);
  const worktree = useStore((s) => s.byId[id]?.thread.worktree_path);

  // On the Workbench machine the server launches the editor; from another
  // machine the browser hands the editor here an SSH deep link instead.
  const openIn = useCallback(
    async (editor: Editor, path?: string): Promise<string | null> => {
      if (isRemote) {
        const url = host && worktree ? remoteEditorUrl(editor, host, worktree, path) : null;
        if (!url) return "Not available from another machine";
        window.location.href = url;
        return null;
      }
      const r = await push(channel.current, "open_editor", { editor, ...(path ? { path } : {}) });
      return r.ok ? null : r.reason;
    },
    [channel, host, worktree],
  );
  const ts = useStore((s) => s.byId[id]);
  const parentId = ts?.thread.parent_id;
  const root = useStore((s) => (parentId ? s.threads.find((t) => t.id === parentId) : undefined));
  const [draft, setDraft] = useState("");
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setSendError(null);
      const r = await push(channel.current, "send", { text });
      if (r.ok) {
        setDraft("");
        setHistory((h) => [...h, text]);
      } else setSendError(r.reason === "busy" ? "Still working; your message was not sent." : r.reason);
    },
    [channel],
  );

  const decide = useCallback(
    async (request_id: string, decision: Decision) => {
      await push(channel.current, "approve", { request_id, decision });
    },
    [channel],
  );

  if (joinError) return <div className="grid flex-1 place-items-center text-[13px] text-destructive">Could not open thread: {joinError}</div>;
  if (!ts) return <div className="flex-1" />;

  const { thread, status } = ts;
  const busy = status === "running" || status === "awaiting_approval";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border py-2.5 pr-5 pl-2">
        <InsetTrigger />
        <StatusDot status={status} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[14px] font-medium">{threadLabel(thread)}</span>
            {root && <span className="truncate text-[12px] text-muted-foreground">in {threadLabel(root)}</span>}
          </div>
          <div className="flex items-center gap-3 truncate text-[12px] text-muted-foreground">
            {thread.branch && (
              <span className="flex items-center gap-1 font-mono" title={thread.base_ref ? `from ${thread.base_ref}` : undefined}>
                <GitBranch className="size-3" />
                {thread.branch}
                {thread.base_ref && <span className="opacity-60">← {thread.base_ref}</span>}
              </span>
            )}
            <span className="flex min-w-0 items-center gap-1" title={thread.worktree_path}>
              <FolderGit2 className="size-3 shrink-0" />
              <span className="truncate font-mono">{thread.worktree_path.replace(/^\/(Users|home)\/[^/]+/, "~")}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Cpu className="size-3" />
              {ts.model ?? thread.provider}
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="w-44">
            <Select
              value={thread.mode}
              onValueChange={(mode) => void push(channel.current, "set_mode", { mode })}
              size="compact"
            >
              <SelectTrigger variant="borderless" />
              <SelectContent>
                {MODES.map((m, i) => (
                  <SelectItem key={m.value} index={i} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="compact"
            variant={changesOpen ? "secondary" : "ghost"}
            leadingIcon={FileDiffIcon}
            onClick={() => toggleChanges(!changesOpen)}
            title="Changes against the base branch"
          >
            {diff && diff.files.length > 0 ? (
              <Counts
                additions={diff.files.reduce((a, f) => a + f.additions, 0)}
                deletions={diff.files.reduce((a, f) => a + f.deletions, 0)}
              />
            ) : (
              "Changes"
            )}
          </Button>
          <OpenMenu path={thread.worktree_path} onOpen={(editor) => openIn(editor)} />
          <ArchiveButton thread={thread} onArchive={async () => void (await push(channel.current, "archive"))} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className={cn("flex min-w-0 flex-1 flex-col")}>
          <Timeline items={ts.items} live={ts.live} pending={ts.pending} status={status} onDecide={decide} />

          <div className="mx-auto w-full max-w-3xl px-6 pb-5">
            {sendError && <div className="mb-2 text-[12px] text-destructive">{sendError}</div>}
            <InputMessage
              value={draft}
              onValueChange={setDraft}
              onSend={(text) => void send(text)}
              status={busy ? "streaming" : "idle"}
              onStop={() => void push(channel.current, "interrupt")}
              queue={queue}
              onQueueChange={setQueue}
              history={history}
              placeholder={busy ? "Queue a follow-up…" : `Ask ${AGENT_NAMES[thread.provider] ?? "the agent"} to do something…`}
              maxRows={12}
            />
          </div>
        </div>

        {changesOpen && (
          <ChangesPanel
            diff={diff}
            error={diffError}
            loading={diffLoading}
            onRefresh={() => void refreshDiff()}
            onClose={() => toggleChanges(false)}
            onOpenFile={(path) => void openIn(preferredEditor(), path)}
            onPush={async () => {
              const r = await push(channel.current, "push");
              return r.ok ? { ok: true, result: r.payload as PushResult } : { ok: false, error: r.reason };
            }}
            loadFile={(path) => fetchFilePatch(channel.current, path)}
          />
        )}
      </div>
    </div>
  );
}
