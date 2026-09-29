import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/app/sidebar";
import { ThreadView } from "@/components/app/thread-view";
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

  const select = (id: string | null) => {
    location.hash = id ? `/t/${id}` : "";
    setSelected(id);
  };

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
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          selected={selected}
          connected={connected}
          onSelect={select}
          onNewThread={(projectId) => setNewThread({ open: true, projectId })}
          onAddProject={() => setAddProject(true)}
        />
        <main className="flex min-w-0 flex-1">
          {selected ? (
            <ThreadView key={selected} id={selected} />
          ) : (
            <div className="grid flex-1 place-items-center text-[13px] text-muted-foreground">
              {hasToken ? (
                <span>
                  Pick a thread, or press <kbd className="wb-inline-code">N</kbd> for a new one.
                </span>
              ) : (
                "No socket token. Start Phoenix first, then reload."
              )}
            </div>
          )}
        </main>
      </div>

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
