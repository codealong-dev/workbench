import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/app/sidebar";
import { ThreadView } from "@/components/app/thread-view";
import { useLobby } from "@/hooks/use-channels";
import { hasToken } from "@/socket";

const fromHash = () => location.hash.match(/^#\/t\/(.+)$/)?.[1] ?? null;

export default function App() {
  const { connected, lobby } = useLobby();
  const [selected, setSelected] = useState<string | null>(fromHash);

  useEffect(() => {
    const onHash = () => setSelected(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (id: string) => {
    location.hash = `/t/${id}`;
    setSelected(id);
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar selected={selected} onSelect={select} lobby={lobby} connected={connected} />
        <main className="flex min-w-0 flex-1">
          {selected ? (
            <ThreadView key={selected} id={selected} />
          ) : (
            <div className="grid flex-1 place-items-center text-[13px] text-muted-foreground">
              {hasToken ? "Pick a thread or create one with +" : "No socket token. Start Phoenix first, then reload."}
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
