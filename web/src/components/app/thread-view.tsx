import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, GitBranch, GitCompareArrows, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import { push, useThreadChannel } from "@/hooks/use-channels";
import { fetchFilePatch, useDiff } from "@/hooks/use-diff";
import { useFiles } from "@/hooks/use-files";
import { Tooltip } from "@/components/ui/tooltip";
import { useStore } from "@/store";
import type { Answers, Decision, Editor, PushResult, Thread } from "@/contracts";
import { isRemote, remoteEditorUrl } from "@/lib/remote";
import { Timeline } from "./timeline";
import { StatusDot } from "./status-dot";
import { ComposerBar } from "./composer-bar";
import { PANEL, PANEL_GAP } from "./panel";
import { cn } from "@/lib/utils";
import { Counts } from "./diff-view";
import { SidePanel, type PanelTab } from "./side-panel";
import { Viewer, tabKey, type ViewerTab } from "./viewer";
import { isAppShortcut } from "./terminal-view";
import { OpenMenu, preferredEditor } from "./open-menu";
import { ArchiveDialog } from "./archive-dialog";
import { InsetTrigger, threadLabel } from "./sidebar";

const PANEL_KEY = "wb.panel";
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const readPanel = (): PanelTab | null => {
  const v = localStorage.getItem(PANEL_KEY);
  if (v === "files" || v === "changes" || v === "terminal") return v;
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

  // Ctrl+` opens the terminal (again: next terminal), Ctrl+Shift+` a new one
  const [termCycle, setTermCycle] = useState(0);
  const [termSpawn, setTermSpawn] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isAppShortcut(e)) return;
      e.preventDefault();
      setPanel("terminal");
      if (e.shiftKey || e.key === "~") setTermSpawn((n) => n + 1);
      else setTermCycle((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // middle pane: the diff and opened files, as tabs
  const [tabs, setTabs] = useState<ViewerTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>("diff");
  const [focus, setFocus] = useState<{ path: string; n: number } | null>(null);
  const [activeChange, setActiveChange] = useState<string | null>(null); // the file the diff is scrolled to
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
    async (request_id: string, decision: Decision, answers?: Answers) => {
      await push(channel.current, "approve", { request_id, decision, ...(answers ? { answers } : {}) });
    },
    [channel],
  );

  if (joinError) return <div className="grid flex-1 place-items-center text-[13px] text-destructive">Could not open thread: {joinError}</div>;
  if (!ts) return <div className="flex-1" />;

  const { thread, status } = ts;
  const busy = status === "running" || status === "awaiting_approval";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-9 items-center gap-2 pr-1.5 pl-1">
        <InsetTrigger />
        <StatusDot status={status} />
        <span className="truncate text-[13px] font-medium" title={thread.worktree_path}>
          {threadLabel(thread)}
        </span>
        {root && <span className="hidden truncate text-[12px] text-muted-foreground md:inline">in {threadLabel(root)}</span>}
        {thread.branch && (
          <span className="flex min-w-0 items-center gap-1 truncate font-mono text-[12px] text-muted-foreground" title={thread.base_ref ? `${thread.branch} from ${thread.base_ref}` : thread.branch}>
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{thread.branch}</span>
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
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

      <div className={cn("flex min-h-0 flex-1", PANEL_GAP)}>
        <div className={cn("flex min-w-[340px] flex-1 flex-col", PANEL)}>
          <Timeline items={ts.items} live={ts.live} pending={ts.pending} status={status} onDecide={decide} agent={capitalize(AGENT_NAMES[thread.provider] ?? "the agent")} />

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
            <ComposerBar thread={thread} channel={channel} />
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
            onActiveChange={setActiveChange}
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
            focusedChange={diffShown ? (activeChange ?? focus?.path ?? null) : null}
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
            channel={channel}
            terminalCycle={termCycle}
            terminalSpawn={termSpawn}
          />
        )}
      </div>
    </div>
  );
}
