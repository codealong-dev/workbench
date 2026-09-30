import { useCallback, useState } from "react";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import { push, useThreadChannel } from "@/hooks/use-channels";
import { useStore } from "@/store";
import type { Answers, Decision } from "@/contracts";
import { Timeline } from "@/components/app/timeline";
import { ComposerBar } from "@/components/app/composer-bar";

export const AGENT_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  fake: "the fake agent",
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Drafts outlive the tab being hidden (hidden chat tabs unmount).
const drafts = new Map<string, string>();
const histories = new Map<string, string[]>();

/** One agent conversation: the timeline and the composer. */
export function ChatView({ threadId }: { threadId: string }) {
  const { channel, joinError } = useThreadChannel(threadId);
  const ts = useStore((s) => s.byId[threadId]);
  const [draft, setDraftState] = useState(() => drafts.get(threadId) ?? "");
  const setDraft = (v: string) => {
    drafts.set(threadId, v);
    setDraftState(v);
  };
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [history, setHistory] = useState<string[]>(() => histories.get(threadId) ?? []);
  const [sendError, setSendError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setSendError(null);
      const r = await push(channel.current, "send", { text });
      if (r.ok) {
        drafts.delete(threadId);
        setDraftState("");
        setHistory((h) => {
          const next = [...h, text];
          histories.set(threadId, next);
          return next;
        });
      } else setSendError(r.reason === "busy" ? "Still working; your message was not sent." : r.reason);
    },
    [channel, threadId],
  );

  const decide = useCallback(
    async (request_id: string, decision: Decision, answers?: Answers) => {
      await push(channel.current, "approve", {
        request_id,
        decision,
        ...(answers ? { answers } : {}),
      });
    },
    [channel],
  );

  if (joinError) return <div className="grid h-full place-items-center text-[13px] text-destructive">Could not open this chat: {joinError}</div>;
  if (!ts) return <div className="h-full" />;

  const { thread, status } = ts;
  const busy = status === "running" || status === "awaiting_approval";
  const agent = AGENT_NAMES[thread.provider] ?? "the agent";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Timeline items={ts.items} live={ts.live} pending={ts.pending} status={status} onDecide={decide} agent={capitalize(agent)} />
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">
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
          placeholder={busy ? "Queue a follow-up…" : `Ask ${agent} to do something…`}
          maxRows={12}
        />
        <ComposerBar thread={thread} channel={channel} />
      </div>
    </div>
  );
}
