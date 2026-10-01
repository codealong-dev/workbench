import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type GetTabContextMenuItemsParams,
  type SerializedDockview,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { lobbyChannel, push, useThreadChannel } from "@/hooks/use-channels";
import { fetchFilePatch, useDiff } from "@/hooks/use-diff";
import { useFiles } from "@/hooks/use-files";
import { useTerminals } from "@/hooks/use-terminals";
import { isRemote, remoteEditorUrl } from "@/lib/remote";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import type { Editor, PushResult, Thread } from "@/contracts";
import { SidePanel, type PanelTab } from "@/components/app/side-panel";
import { QuickOpen } from "@/components/app/quick-open";
import { isAppShortcut } from "@/components/app/terminal-view";
import { preferredEditor } from "@/components/app/open-menu";
import { PANEL_GAP } from "@/components/app/panel";
import { PANEL_COMPONENTS, WorkspaceContext, bufferId, type Buffer, type OpenOptions, type Workspace as Ws } from "./buffers";
import { BufferTab, NewBufferMenu } from "./tabs";
import { StatusBar } from "./status-bar";
import { applyLayout, fetchLayout, saveLayout } from "./layout";
import { editorKey, useEditors } from "@/lib/editor-state";
import { reviewMessage } from "@/lib/review";

const theme: DockviewTheme = {
  name: "workbench",
  className: "dockview-theme-workbench",
  gap: 5,
};

const PANEL_KEY = "wb.panel";
const readPanel = (): PanelTab | null => {
  const v = localStorage.getItem(PANEL_KEY);
  if (v === "files" || v === "changes") return v;
  return v === null && window.innerWidth >= 1280 ? "changes" : null;
};

/** Move a tab into a new group beside its own. */
function split(panel: DockviewApi["panels"][number], direction: "right" | "bottom") {
  panel.api.moveTo({ group: panel.group, position: direction });
}

const tabMenu = ({ panel }: GetTabContextMenuItemsParams) => [
  { label: "Split right  ⌘\\", action: () => split(panel, "right") },
  { label: "Split down", action: () => split(panel, "bottom") },
  "separator" as const,
  "maximize" as const,
  "separator" as const,
  "close" as const,
  "closeOthers" as const,
  "closeRight" as const,
  "closeAll" as const,
];

// Terminals keep their screen while hidden; the rest render only when shown.
const rendererOf = (b: Buffer) => (b.kind === "terminal" ? "always" : "onlyWhenVisible");

/**
 * One worktree: its chats, terminals, the changes and any files, as tabs in a
 * dockable layout, with the files/changes explorer on the right and a status
 * bar at the bottom.
 */
export function WorkspaceView({
  rootId,
  selectedId,
  connected,
  onSelect,
  hidden = false,
}: {
  rootId: string;
  selectedId: string;
  connected: boolean;
  onSelect: (id: string) => void;
  /** Kept mounted behind another page (settings): its keys are off. */
  hidden?: boolean;
}) {
  const { channel, joinError } = useThreadChannel(rootId);
  const allThreads = useStore((s) => s.threads);
  const threads = useMemo(() => allThreads.filter((t) => t.id === rootId || t.parent_id === rootId), [allThreads, rootId]);
  const root = threads.find((t) => t.id === rootId);
  const host = useStore((s) => s.host);
  const [api, setApi] = useState<DockviewApi | null>(null);
  // the saved layout; undefined while it loads (the dock waits for it)
  const [initial, setInitial] = useState<SerializedDockview | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void fetchLayout(channel, rootId).then((l) => !cancelled && setInitial(l));
    return () => {
      cancelled = true;
    };
  }, [channel, rootId]);
  const [focusedId, setFocusedId] = useState(selectedId);

  // -- right explorer ---------------------------------------------------------
  const [panel, setPanelState] = useState<PanelTab | null>(readPanel);
  const [panelTab, setPanelTab] = useState<PanelTab>(() => readPanel() ?? "changes");
  const setPanel = (tab: PanelTab | null) => {
    setPanelState(tab);
    if (tab) setPanelTab(tab);
    localStorage.setItem(PANEL_KEY, tab ?? "off");
  };

  // -- data shared by the buffers --------------------------------------------
  // any agent here finishing a turn refreshes the diff and open files
  const busy = threads.some((t) => t.status === "running" || t.status === "awaiting_approval");
  const [hasChanges, setHasChanges] = useState(false);
  const { diff, error: diffError, loading: diffLoading, refresh: refreshDiff } = useDiff(channel, root ? (busy ? "running" : "idle") : undefined, hasChanges);
  const [quickOpen, setQuickOpen] = useState(false);
  const files = useFiles(channel, root ? (busy ? "running" : "idle") : undefined, panel === "files" || quickOpen);
  const { terminals, create: createTerminal } = useTerminals(channel, true);
  const [version, setVersion] = useState(0);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) setVersion((v) => v + 1);
    wasBusy.current = busy;
  }, [busy]);
  // files changed on disk (the server watches the worktree): editors reload,
  // the diff and the file list refresh (debounced while an agent is busy writing)
  const listeners = useRef(new Set<(paths: string[]) => void>());
  const onFilesChanged = useCallback((cb: (paths: string[]) => void) => {
    listeners.current.add(cb);
    return () => void listeners.current.delete(cb);
  }, []);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const ch = channel.current;
    if (!ch) return;
    const ref = ch.on("files.changed", ({ paths }: { paths: string[] }) => {
      listeners.current.forEach((l) => l(paths));
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        void refreshDiff();
        if (files.list) void files.refresh();
      }, 700);
    });
    return () => ch.off("files.changed", ref);
  }, [channel, refreshDiff, files.list, files.refresh]);
  const [focus] = useState<{ path: string; n: number } | null>(null);
  const [activeChange, setActiveChange] = useState<string | null>(null);
  const [activeBuffer, setActiveBuffer] = useState<Buffer | null>(null);

  const openIn = useCallback(
    async (editor: Editor, path?: string): Promise<string | null> => {
      if (isRemote) {
        const url = host && root ? remoteEditorUrl(editor, host, root.worktree_path, path) : null;
        if (!url) return "Not available from another machine";
        window.location.href = url;
        return null;
      }
      const r = await push(channel.current, "open_editor", {
        editor,
        ...(path ? { path } : {}),
      });
      return r.ok ? null : r.reason;
    },
    [channel, host, root],
  );

  // -- opening buffers -------------------------------------------------------
  const open = useCallback(
    (b: Buffer, o: OpenOptions = {}) => {
      if (!api) return;
      const id = bufferId(b);
      const existing = api.getPanel(id);
      if (existing) {
        // opening it for keeps pins a preview
        if (!o.preview && (existing.params as { preview?: boolean }).preview) existing.api.updateParameters({ ...existing.params, preview: false });
        if (!o.background) existing.api.setActive();
        return;
      }
      const near = o.near ? api.getPanel(o.near) : undefined;
      const group = near?.group ?? api.activeGroup;
      const previewable = o.preview && (b.kind === "file" || b.kind === "diff");
      // a new preview takes the place of the old one (unless it has unsaved edits)
      let index: number | undefined;
      if (previewable && group) {
        const old = group.panels.find((p) => (p.params as { preview?: boolean }).preview);
        const oldBuf = old?.params as Buffer | undefined;
        const oldDirty = oldBuf && (oldBuf.kind === "file" || oldBuf.kind === "diff") && useEditors.getState().dirty[editorKey(rootId, oldBuf.path)];
        if (old && !oldDirty) {
          index = group.panels.indexOf(old);
          old.api.close();
        }
      }
      api.addPanel({
        id,
        component: b.kind,
        tabComponent: "buffer",
        params: previewable ? { ...b, preview: true } : b,
        renderer: rendererOf(b),
        inactive: o.background,
        ...(group ? { position: { referenceGroup: group, direction: o.direction ?? "within", ...(index !== undefined ? { index } : {}) } } : {}),
      });
    },
    [api, rootId],
  );

  const newChat = useCallback(
    async (provider: "claude" | "codex") => {
      const r = await push(lobbyChannel(), "thread.create", {
        parent_id: rootId,
        provider,
        mode: root?.mode,
      });
      if (r.ok)
        open({
          kind: "chat",
          threadId: (r.payload as { thread: Thread }).thread.id,
        });
    },
    [rootId, root?.mode, open],
  );

  // The review agent: a new session on this worktree, with the prompt from
  // Settings → Review, in a panel at the right of the changes (or beside the
  // review you already have open). Not set up yet: Settings first.
  const startReview = useCallback(async (): Promise<string | null> => {
    const cfg = useStore.getState().settings?.review;
    if (!cfg) {
      location.hash = "#/settings/review";
      return null;
    }
    const r = await push(lobbyChannel(), "thread.create", {
      parent_id: rootId,
      provider: cfg.provider,
      mode: cfg.mode,
      model: cfg.model,
      effort: cfg.effort,
      title: "Review",
      prompt: reviewMessage(cfg, diff),
    });
    if (!r.ok) return r.reason;
    const { thread, send_error } = r.payload as { thread: Thread; send_error?: string };
    // the reply beats the lobby's `thread.upserted`; selecting a thread the store doesn't know yet would unmount this workspace
    useStore.getState().upsertThread(thread);
    const earlier = api?.panels.find((p) => {
      const b = p.params as Buffer;
      return b.kind === "chat" && b.threadId !== thread.id && useStore.getState().threads.find((t) => t.id === b.threadId)?.title === "Review";
    });
    const chat: Buffer = { kind: "chat", threadId: thread.id };
    open(chat, earlier ? { near: earlier.id } : { direction: "right" });
    // selecting the new session may have opened its tab first, beside the changes
    const panel = api?.getPanel(bufferId(chat));
    if (panel && !earlier && panel.group.panels.length > 1) split(panel, "right");
    return send_error ?? null;
  }, [rootId, diff, api, open]);

  const newTerminal = useCallback(async () => {
    const t = await createTerminal();
    if (t) open({ kind: "terminal", terminalId: t.id });
  }, [createTerminal, open]);

  // -- dock lifecycle --------------------------------------------------------
  const onReady = (e: DockviewReadyEvent) => {
    const restored = applyLayout(e.api, initial ?? null);
    if (!restored || !e.api.getPanel(bufferId({ kind: "chat", threadId: selectedId }))) {
      e.api.addPanel({
        id: bufferId({ kind: "chat", threadId: selectedId }),
        component: "chat",
        tabComponent: "buffer",
        params: { kind: "chat", threadId: selectedId },
      });
    }
    setApi(e.api);
  };

  useEffect(() => {
    if (!api) return;
    const subs = [
      api.onDidLayoutChange(() => saveLayout(rootId, api, channel)),
      api.onDidActivePanelChange(({ panel }) => {
        const b = (panel?.params as Buffer | undefined) ?? null;
        setActiveBuffer(b);
        if (b?.kind === "chat") {
          setFocusedId(b.threadId);
          onSelect(b.threadId);
        }
        if (b?.kind !== "changes") setActiveChange(null);
      }),
    ];
    return () => subs.forEach((s) => s.dispose());
  }, [api, rootId, onSelect, channel]);

  // the sidebar picked a thread in this workspace
  useEffect(() => {
    if (api && selectedId) open({ kind: "chat", threadId: selectedId });
  }, [api, selectedId, open]);

  // the changes buffer wants the full patch
  useEffect(() => {
    if (!api) return;
    const check = () => setHasChanges(!!api.getPanel("changes"));
    check();
    const a = api.onDidAddPanel(check);
    const b = api.onDidRemovePanel(check);
    return () => {
      a.dispose();
      b.dispose();
    };
  }, [api]);

  // close tabs whose thread was archived or whose terminal ended
  useEffect(() => {
    if (!api) return;
    for (const p of [...api.panels]) {
      const b = p.params as Buffer;
      if (b.kind === "chat" && connected && allThreads.length && !allThreads.some((t) => t.id === b.threadId)) p.api.close();
      if (b.kind === "terminal" && terminals && !terminals.some((t) => t.id === b.terminalId)) p.api.close();
    }
  }, [api, allThreads, terminals, connected]);

  // -- keys --------------------------------------------------------------------
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (isAppShortcut(e)) {
        // Ctrl+`: next terminal tab (or a new one); Ctrl+Shift+`: new terminal
        e.preventDefault();
        if (e.shiftKey || e.key === "~" || !api) return void newTerminal();
        const tabs = api.panels.filter((p) => (p.params as Buffer).kind === "terminal");
        if (!tabs.length) return void newTerminal();
        const i = tabs.findIndex((p) => p.id === api.activePanel?.id);
        tabs[(i + 1) % tabs.length].api.setActive();
        return;
      }
      // ⌘\ split the active tab to the right; ⌃W close it
      if (api?.activePanel && e.metaKey && !e.ctrlKey && e.key === "\\") {
        e.preventDefault();
        return split(api.activePanel, "right");
      }
      if (api?.activePanel && e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        return api.activePanel.api.close();
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api, newTerminal, hidden]);

  const onPush = async () => {
    const r = await push(channel.current, "push");
    return r.ok ? ({ ok: true, result: r.payload as PushResult } as const) : ({ ok: false, error: r.reason } as const);
  };

  const ws: Ws = {
    rootId,
    channel,
    diff,
    diffError,
    diffLoading,
    refreshDiff: () => void refreshDiff(),
    files,
    terminals,
    version,
    focus,
    setActiveChange,
    open,
    openIn,
    loadPatch: (path) => fetchFilePatch(channel.current, path),
    newChat,
    startReview,
    newTerminal,
    quickOpen: () => setQuickOpen(true),
    onFilesChanged,
  };

  if (joinError) return <div className="grid flex-1 place-items-center text-[13px] text-destructive">Could not open thread: {joinError}</div>;

  const openFiles = (api?.panels ?? []).flatMap((p) => ((p.params as Buffer).kind === "file" ? [(p.params as Buffer & { kind: "file" }).path] : []));
  const focused = threads.find((t) => t.id === focusedId) ?? root ?? null;

  return (
    <WorkspaceContext.Provider value={ws}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className={cn("flex min-h-0 flex-1", PANEL_GAP)}>
          <div className="relative min-w-[340px] flex-1">
            {initial !== undefined && (
              <DockviewReact
                className="absolute inset-0"
                theme={theme}
                components={PANEL_COMPONENTS}
                tabComponents={{ buffer: BufferTab }}
                defaultTabComponent={BufferTab}
                rightHeaderActionsComponent={NewBufferMenu}
                onReady={onReady}
                getTabContextMenuItems={tabMenu}
                disableFloatingGroups
              />
            )}
          </div>
          {panel && (
            <SidePanel
              tab={panel}
              onTab={setPanel}
              files={files}
              diff={diff}
              diffError={diffError}
              diffLoading={diffLoading}
              onRefreshDiff={() => void refreshDiff()}
              openFile={activeBuffer?.kind === "file" ? activeBuffer.path : null}
              focusedChange={activeBuffer?.kind === "diff" ? activeBuffer.path : activeBuffer?.kind === "changes" ? (activeChange ?? focus?.path ?? null) : null}
              onOpenFile={(path, pin) => open({ kind: "file", path }, { preview: !pin })}
              onOpenChange={(path, pin) => {
                const from = diff?.files.find((f) => f.path === path)?.old_path ?? undefined;
                open({ kind: "diff", path, ...(from ? { from } : {}) }, { preview: !pin });
              }}
              onOpenInEditor={(path) => void openIn(preferredEditor(), path)}
              onPush={onPush}
            />
          )}
        </div>
        {root && (
          <StatusBar
            root={root}
            focused={focused}
            threads={threads}
            diff={diff}
            terminals={terminals?.length ?? 0}
            connected={connected}
            panelOpen={!!panel}
            onTogglePanel={() => setPanel(panel ? null : panelTab)}
            onOpenChanges={() => open({ kind: "changes" })}
            onTerminals={() => {
              const t = api?.panels.find((p) => (p.params as Buffer).kind === "terminal");
              if (t) t.api.setActive();
              else void newTerminal();
            }}
            onPush={onPush}
            onOpenIn={(editor) => openIn(editor)}
          />
        )}
        <QuickOpen open={quickOpen} onOpenChange={setQuickOpen} files={files} recent={openFiles} onPick={(path) => open({ kind: "file", path })} />
      </div>
    </WorkspaceContext.Provider>
  );
}
