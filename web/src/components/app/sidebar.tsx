import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { push } from "@/hooks/use-channels";
import { useStore } from "@/store";
import type { Channel } from "phoenix";
import type { Provider, Thread } from "@/contracts";
import { StatusDot } from "./status-dot";

const LAST_CWD = "wb.lastCwd";

function NewThread({ lobby, onCreated, onCancel }: { lobby: () => Channel | null; onCreated: (t: Thread) => void; onCancel: () => void }) {
  const [cwd, setCwd] = useState(() => localStorage.getItem(LAST_CWD) ?? "");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState<Provider>("claude");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const r = await push(lobby(), "thread.create", { cwd, title: title || null, provider });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    localStorage.setItem(LAST_CWD, cwd);
    onCreated((r.payload as { thread: Thread }).thread);
  };

  const input = "w-full rounded-lg bg-surface-3 px-2.5 py-1.5 text-[13px] shadow-surface-2 outline-none placeholder:text-muted-foreground";

  return (
    <form
      className="mx-2 mb-2 flex flex-col gap-2 rounded-xl bg-surface-2 p-2.5 shadow-surface-2"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <input className={cn(input, "font-mono")} placeholder="/path/to/repo" value={cwd} onChange={(e) => setCwd(e.target.value)} autoFocus />
      <input className={input} placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Select value={provider} onValueChange={(v) => setProvider(v as Provider)} size="compact">
        <SelectTrigger />
        <SelectContent>
          <SelectItem index={0} value="claude">Claude Code</SelectItem>
          <SelectItem index={1} value="fake">Fake (no agent)</SelectItem>
        </SelectContent>
      </Select>
      {error && <div className="text-[12px] text-destructive">{error}</div>}
      <div className="flex justify-end gap-1.5">
        <Button type="button" size="compact" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="compact" variant="primary" loading={busy} disabled={!cwd}>
          Create
        </Button>
      </div>
    </form>
  );
}

export function Sidebar({ selected, onSelect, lobby, connected }: { selected: string | null; onSelect: (id: string) => void; lobby: () => Channel | null; connected: boolean }) {
  const threads = useStore((s) => s.threads);
  const [creating, setCreating] = useState(false);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface-1">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
          Workbench
          {!connected && <span className="text-[11px] font-normal text-muted-foreground">offline</span>}
        </div>
        <Button size="icon-compact" variant="ghost" aria-label="New thread" onClick={() => setCreating((c) => !c)}>
          <Plus />
        </Button>
      </div>
      {creating && (
        <NewThread
          lobby={lobby}
          onCancel={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            onSelect(t.id);
          }}
        />
      )}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-hover",
              selected === t.id && "bg-active",
            )}
          >
            <StatusDot status={t.status} />
            <div className="min-w-0">
              <div className="truncate">{t.title || "Untitled thread"}</div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">{t.worktree_path.split("/").slice(-2).join("/")}</div>
            </div>
          </button>
        ))}
        {threads.length === 0 && !creating && (
          <div className="px-2.5 py-2 text-[12px] text-muted-foreground">No threads yet. Press + to start one.</div>
        )}
      </nav>
    </aside>
  );
}
