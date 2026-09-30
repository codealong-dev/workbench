import { useCallback, useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, InsetTrigger } from "@/components/app/sidebar";
import { PANEL } from "@/components/app/panel";
import { cn } from "@/lib/utils";
import { WorkspaceView } from "@/components/workspace/workspace";
import { NewThreadDialog } from "@/components/app/new-thread-dialog";
import { AddProjectDialog } from "@/components/app/add-project-dialog";
import { useLobby } from "@/hooks/use-channels";
import { useStore } from "@/store";
import { hasToken } from "@/socket";

const fromHash = () => location.hash.match(/^#\/t\/(.+)$/)?.[1] ?? null;

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

export default function App() {
  const { connected } = useLobby();
  const [selected, setSelected] = useState<string | null>(fromHash);
  const [newThread, setNewThread] = useState<{ open: boolean; projectId?: string | null }>({ open: false });
  const [addProject, setAddProject] = useState(false);
  const threads = useStore((s) => s.threads);

  const select = useCallback((id: string | null) => {
    const hash = id ? `#/t/${id}` : "";
    if (location.hash !== hash) location.hash = hash;
    setSelected(id);
  }, []);
  const current = threads.find((t) => t.id === selected);
  // a worktree is one workspace, whichever of its sessions is picked
  const rootId = current ? (current.parent_id ?? current.id) : null;

  useEffect(() => {
    const onHash = () => setSelected(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keyboard: N new thread. (Cmd+N and Cmd+1..9 belong to the browser.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n") {
        e.preventDefault();
        setNewThread({ open: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The selected thread was archived (here or elsewhere): drop the selection.
  useEffect(() => {
    if (connected && selected && !threads.some((t) => t.id === selected)) select(null);
  }, [threads, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TooltipProvider>
      {/* No icon rail: collapsed means gone; hover the left edge to peek, "[" toggles. */}
      <SidebarProvider peek="hover" className="h-svh overflow-hidden">
        <AppSidebar
          selected={selected}
          connected={connected}
          onSelect={select}
          onNewThread={(projectId) => setNewThread({ open: true, projectId })}
          onAddProject={() => setAddProject(true)}
        />
        {/* no card of its own: the thread's panes are the cards (see panel.ts) */}
        <SidebarInset className="overflow-hidden peer-data-[variant=inset]:m-1 peer-data-[variant=inset]:peer-data-[side=left]:ml-0 peer-data-[variant=inset]:peer-data-[state=collapsed]:peer-data-[side=left]:ml-1 peer-data-[variant=inset]:rounded-none peer-data-[variant=inset]:bg-transparent peer-data-[variant=inset]:shadow-none">
          {selected && rootId ? (
            <WorkspaceView key={rootId} rootId={rootId} selectedId={selected} connected={connected} onSelect={select} />
          ) : selected && !connected ? (
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

      <NewThreadDialog
        open={newThread.open}
        projectId={newThread.projectId}
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
