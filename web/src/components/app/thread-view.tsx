import { useCallback, useState } from "react";
import { FolderGit2 } from "lucide-react";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { push, useThreadChannel } from "@/hooks/use-channels";
import { useStore } from "@/store";
import type { Decision, Mode } from "@/contracts";
import { Timeline } from "./timeline";
import { StatusDot } from "./status-dot";

const MODES: { value: Mode; label: string }[] = [
  { value: "default", label: "Ask before edits" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "plan", label: "Plan only" },
  { value: "bypassPermissions", label: "Bypass permissions" },
];

export function ThreadView({ id }: { id: string }) {
  const { channel, joinError } = useThreadChannel(id);
  const ts = useStore((s) => s.byId[id]);
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
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-5 py-2.5">
        <StatusDot status={status} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">{thread.title || "Untitled thread"}</div>
          <div className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
            <FolderGit2 className="size-3" />
            <span className="truncate font-mono">{thread.worktree_path}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge color="gray">{ts.model ?? thread.provider}</Badge>
          <div className="w-48">
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
        </div>
      </header>

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
          placeholder={busy ? "Queue a follow-up…" : "Ask Claude to do something…"}
          maxRows={12}
        />
      </div>
    </div>
  );
}
