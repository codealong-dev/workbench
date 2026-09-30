import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Cpu, FolderGit2, GitBranch, GitCompareArrows, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { push, useThreadChannel } from "@/hooks/use-channels";
import { fetchFilePatch, useDiff } from "@/hooks/use-diff";
import { useFiles } from "@/hooks/use-files";
import { Tooltip } from "@/components/ui/tooltip";
import { useStore } from "@/store";
import type { Decision, Editor, PushResult, Thread } from "@/contracts";
import { isRemote, remoteEditorUrl } from "@/lib/remote";
import { Timeline } from "./timeline";
import { StatusDot } from "./status-dot";
import { MODES } from "./modes";
import { Counts } from "./diff-view";
import { SidePanel, type PanelTab } from "./side-panel";
import { Viewer, tabKey, type ViewerTab } from "./viewer";
import { OpenMenu, preferredEditor } from "./open-menu";
import { ArchiveDialog } from "./archive-dialog";
import { InsetTrigger, threadLabel } from "./sidebar";

const PANEL_KEY = "wb.panel";

const readPanel = (): PanelTab | null => {
  const v = localStorage.getItem(PANEL_KEY);
  if (v === "files" || v === "changes") return v;
  // first run: open on wide screens
  return v === null && window.innerWidth >= 1280 ? "changes" : null;
};
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
  // right panel: which tab, or null when hidden
  const [panel, setPanelState] = useState<PanelTab | null>(readPanel);
  const [panelTab, setPanelTab] = useState<PanelTab>(() => readPanel() ?? "changes");
  const setPanel = (tab: PanelTab | null) => {
    setPanelState(tab);
    if (tab) setPanelTab(tab);
    localStorage.setItem(PANEL_KEY, tab ?? "off");
  };

  // middle pane: the diff and opened files, as tabs
  const [tabs, setTabs] = useState<ViewerTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>("diff");
  const [focus, setFocus] = useState<{ path: string; n: number } | null>(null);
  const openTab = (tab: ViewerTab) => {
    const key = tabKey(tab);
    setTabs((ts) => (ts.some((t) => tabKey(t) === key) ? ts : tab.kind === "diff" ? [tab, ...ts] : [...ts, tab]));
    setActiveTab(key);
  };
  const closeTab = (key: string) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => tabKey(t) === key);
      const next = ts.filter((t) => tabKey(t) !== key);
      if (key === activeTab && next.length) setActiveTab(tabKey(next[Math.max(0, i - 1)]));
      return next;
    });
  };
  const viewerOpen = tabs.length > 0;
  const diffShown = viewerOpen && activeTab === "diff";

  const threadStatus = useStore((s) => s.byId[id]?.status);
  const { diff, error: diffError, loading: diffLoading, refresh: refreshDiff } = useDiff(channel, threadStatus, diffShown);
  const files = useFiles(channel, threadStatus, panel === "files");

  // open files re-read when the agent finishes a turn
  const [version, setVersion] = useState(0);
  const prevStatus = useRef(threadStatus);
  useEffect(() => {
    if (prevStatus.current && prevStatus.current !== "idle" && threadStatus === "idle") setVersion((v) => v + 1);
    prevStatus.current = threadStatus;
  }, [threadStatus]);

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
          <Tooltip content={diffShown ? "Hide changes" : "Show changes against the base branch"} side="bottom">
            <Button
              size="compact"
              variant={diffShown ? "secondary" : "ghost"}
              leadingIcon={GitCompareArrows}
              aria-label="Changes"
              onClick={() => (diffShown ? closeTab("diff") : openTab({ kind: "diff" }))}
            >
              {diff && diff.files.length > 0 ? (
                <Counts additions={diff.files.reduce((a, f) => a + f.additions, 0)} deletions={diff.files.reduce((a, f) => a + f.deletions, 0)} />
              ) : (
                <span className="text-muted-foreground">No changes</span>
              )}
            </Button>
          </Tooltip>
          <OpenMenu path={thread.worktree_path} onOpen={(editor) => openIn(editor)} />
          <ArchiveButton thread={thread} onArchive={async () => void (await push(channel.current, "archive"))} />
          <Tooltip content={panel ? "Hide files and changes" : "Show files and changes"} side="bottom">
            <Button
              size="icon-compact"
              variant={panel ? "secondary" : "ghost"}
              aria-label="Toggle files panel"
              aria-pressed={!!panel}
              onClick={() => setPanel(panel ? null : panelTab)}
            >
              <PanelRight />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-[340px] flex-1 flex-col">
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

        {viewerOpen && (
          <Viewer
            tabs={tabs}
            active={activeTab}
            onActivate={setActiveTab}
            onClose={closeTab}
            channel={channel.current}
            version={version}
            diff={diff}
            diffError={diffError}
            focus={focus}
            loadPatch={(path) => fetchFilePatch(channel.current, path)}
            onOpenInEditor={(path) => void openIn(preferredEditor(), path)}
          />
        )}

        {panel && (
          <SidePanel
            tab={panel}
            onTab={setPanel}
            files={files}
            diff={diff}
            diffError={diffError}
            diffLoading={diffLoading}
            onRefreshDiff={() => void refreshDiff()}
            openFile={viewerOpen && activeTab.startsWith("f:") ? activeTab.slice(2) : null}
            focusedChange={diffShown ? (focus?.path ?? null) : null}
            onOpenFile={(path) => openTab({ kind: "file", path })}
            onOpenChange={(path) => {
              openTab({ kind: "diff" });
              setFocus((f) => ({ path, n: (f?.n ?? 0) + 1 }));
            }}
            onOpenInEditor={(path) => void openIn(preferredEditor(), path)}
            onPush={async () => {
              const r = await push(channel.current, "push");
              return r.ok ? { ok: true, result: r.payload as PushResult } : { ok: false, error: r.reason };
            }}
          />
        )}
      </div>
    </div>
  );
}
