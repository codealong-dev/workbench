import { useCallback, useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, InsetTrigger } from "@/components/app/sidebar";
import { PANEL } from "@/components/app/panel";
import { cn } from "@/lib/utils";
import { WorkspaceView } from "@/components/workspace/workspace";
import { NewThreadDialog } from "@/components/app/new-thread-dialog";
import { AgentMenu } from "@/components/app/agent-menu";
import { AddProjectDialog } from "@/components/app/add-project-dialog";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { PrSidebar, prKey } from "@/components/app/pr-sidebar";
import { SettingsView } from "@/components/settings/settings-view";
import { DEFAULT_SECTION, isSection, type SectionId } from "@/components/settings/sections";
import { useLobby } from "@/hooks/use-channels";
import { useStore } from "@/store";
import { hasToken } from "@/socket";
import type { Provider, Thread } from "@/contracts";

const fromHash = () => location.hash.match(/^#\/t\/([^/]+)(?:\/context)?$/)?.[1] ?? null;
const contextFromHash = () => /^#\/t\/[^/]+\/context$/.test(location.hash);
// #/settings or #/settings/<section>; null when settings aren't open
const settingsFromHash = (): SectionId | null => {
  const m = location.hash.match(/^#\/settings(?:\/([\w-]+))?$/);
  if (!m) return null;
  return isSection(m[1]) ? m[1] : DEFAULT_SECTION;
};

// what the sidebar lists, kept per browser
type SidebarView = "threads" | "prs";
const SIDEBAR_VIEW_KEY = "wb.sidebar";
const readSidebarView = (): SidebarView => (localStorage.getItem(SIDEBAR_VIEW_KEY) === "prs" ? "prs" : "threads");

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  // Monaco types into an EditContext div, xterm into its own textarea
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest?.(".monaco-editor, .xterm"));
};

const prKeyOf = (t: Thread | undefined) => (t?.pr_number && t.project_id ? prKey(t.project_id, t.pr_number) : null);

export default function App() {
  const { connected } = useLobby();
  const [selected, setSelected] = useState<string | null>(fromHash);
  const [selectedContext, setSelectedContext] = useState(contextFromHash);
  const [contextRequest, setContextRequest] = useState(0);
  // Settings take over the sidebar and the main area; the thread stays
  // selected (and its workspace mounted, hidden) for when you come back.
  const [settings, setSettings] = useState<SectionId | null>(settingsFromHash);
  const [sidebarView, setSidebarViewState] = useState<SidebarView>(readSidebarView);
  const setSidebarView = useCallback((v: SidebarView) => {
    localStorage.setItem(SIDEBAR_VIEW_KEY, v);
    setSidebarViewState(v);
  }, []);
  const [newThread, setNewThread] = useState<{ open: boolean; projectId?: string | null; provider?: Provider }>({ open: false });
  const [addProject, setAddProject] = useState(false);
  const threads = useStore((s) => s.threads);

  const select = useCallback((id: string | null) => {
    const hash = id ? `#/t/${id}` : "";
    if (location.hash !== hash) location.hash = hash;
    setSelected(id);
    setSelectedContext(false);
  }, []);
  const selectContext = useCallback((id: string) => {
    const hash = `#/t/${id}/context`;
    if (location.hash !== hash) location.hash = hash;
    setSelected(id);
    setSelectedContext(true);
  }, []);
  const current = threads.find((t) => t.id === selected);
  // a worktree is one workspace, whichever of its sessions is picked
  const rootId = current ? (current.parent_id ?? current.id) : null;

  const openSettings = useCallback((section?: SectionId) => {
    location.hash = section ? `#/settings/${section}` : "#/settings";
  }, []);
  const closeSettings = useCallback(() => {
    location.hash = selected ? `#/t/${selected}${selectedContext ? "/context" : ""}` : "";
  }, [selected, selectedContext]);

  useEffect(() => {
    const onHash = () => {
      const section = settingsFromHash();
      setSettings(section);
      if (!section) {
        setSelected(fromHash());
        setSelectedContext(contextFromHash());
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keyboard: N new thread, ⌘, settings. (Cmd+N and Cmd+1..9 belong to the browser.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        if (settingsFromHash()) closeSettings();
        else openSettings();
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n") {
        e.preventDefault();
        setNewThread({ open: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings, closeSettings]);

  // The selected thread was archived (here or elsewhere): drop the selection.
  useEffect(() => {
    if (!connected || !selected || threads.some((t) => t.id === selected)) return;
    if (settingsFromHash()) setSelected(null); // stay in settings
    else select(null);
  }, [threads, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TooltipProvider>
      {/* No icon rail: collapsed means gone; hover the left edge to peek, "[" toggles. */}
      <SidebarProvider peek="hover" className="h-svh overflow-hidden">
        {settings ? (
          <SettingsSidebar section={settings} onSection={openSettings} onBack={closeSettings} />
        ) : sidebarView === "prs" ? (
          <PrSidebar
            connected={connected}
            // the PR whose workspace is open
            active={prKeyOf(threads.find((t) => t.id === rootId))}
            onOpenThread={(t) => select(t.id)}
            onBack={() => setSidebarView("threads")}
          />
        ) : (
          <AppSidebar
            selected={selected}
            contextRoot={selectedContext ? rootId : null}
            connected={connected}
            onSelect={select}
            onOpenContext={(id) => { selectContext(id); setContextRequest((n) => n + 1); }}
            onNewThread={(projectId) => setNewThread({ open: true, projectId })}
            onAddProject={() => setAddProject(true)}
            onSettings={() => openSettings()}
            onPullRequests={() => setSidebarView("prs")}
          />
        )}
        {/* no card of its own: the thread's panes are the cards (see panel.ts) */}
        <SidebarInset className="overflow-hidden peer-data-[variant=inset]:m-1 peer-data-[variant=inset]:peer-data-[side=left]:ml-0 peer-data-[variant=inset]:peer-data-[state=collapsed]:peer-data-[side=left]:ml-1 peer-data-[variant=inset]:rounded-none peer-data-[variant=inset]:bg-transparent peer-data-[variant=inset]:shadow-none">
          {settings && <SettingsView section={settings} />}
          {selected && rootId ? (
            <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", settings && "hidden")}>
              <WorkspaceView key={rootId} rootId={rootId} selectedId={selected} selectedContext={selectedContext} contextRequest={contextRequest} connected={connected} onSelect={select} onSelectContext={selectContext} hidden={!!settings} />
            </div>
          ) : settings ? null : selected && !connected ? (
            <div className="flex-1" />
          ) : (
            <div className="flex flex-1 flex-col">
              <header className="flex h-10 shrink-0 items-center px-1">
                <InsetTrigger />
              </header>
              <div className={cn("grid flex-1 place-items-center pb-12 text-[13px] text-muted-foreground", PANEL)}>
                {hasToken ? (
                  <span>
                    Pick a thread, or press <kbd className="wb-inline-code">N</kbd> for a new one.
                  </span>
                ) : (
                  "No socket token. Start Phoenix first, then reload."
                )}
              </div>
            </div>
          )}
        </SidebarInset>
      </SidebarProvider>

      {/* ⌘T: a new thread in the open thread's project, with the agent picked here */}
      <AgentMenu onPick={(provider) => setNewThread({ open: true, projectId: threads.find((t) => t.id === selected)?.project_id ?? null, provider })} />
      <NewThreadDialog
        open={newThread.open}
        projectId={newThread.projectId}
        provider={newThread.provider}
        onOpenChange={(open) => setNewThread((s) => ({ ...s, open }))}
        onCreated={(t) => select(t.id)}
        onAddProject={() => {
          setNewThread({ open: false });
          setAddProject(true);
        }}
      />
      <AddProjectDialog
        open={addProject}
        onOpenChange={setAddProject}
        onAdded={(p) => setNewThread({ open: true, projectId: p.id })}
      />
    </TooltipProvider>
  );
}
