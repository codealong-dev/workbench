import { useCallback, useRef, useState } from "react";
import { TextQuote, X } from "lucide-react";
import { withQuotes } from "@/lib/quotes";
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
const pendingQuotes = new Map<string, string[]>();

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
  // parts of answers you're replying to; they go out with the next message
  const [quotes, setQuotesState] = useState<string[]>(() => pendingQuotes.get(threadId) ?? []);
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const setQuotes = (q: string[]) => {
    pendingQuotes.set(threadId, q);
    setQuotesState(q);
  };
  const composer = useRef<HTMLDivElement>(null);
  const quote = (text: string) => {
    setQuotes([...quotesRef.current, text]);
    requestAnimationFrame(() => composer.current?.querySelector("textarea")?.focus());
  };

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setSendError(null);
      const sentQuotes = quotesRef.current;
      const r = await push(channel.current, "send", { text: withQuotes(sentQuotes, text) });
      if (r.ok) {
        drafts.delete(threadId);
        setDraftState("");
        if (sentQuotes.length) {
          pendingQuotes.delete(threadId);
          setQuotesState([]);
        }
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
      <Timeline items={ts.items} live={ts.live} pending={ts.pending} status={status} onDecide={decide} agent={capitalize(agent)} onQuote={quote} />
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">
        {sendError && <div className="mb-2 text-[12px] text-destructive">{sendError}</div>}
        {quotes.length > 0 && (
          <div className="mb-1.5 flex flex-col gap-1">
            {quotes.map((q, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-surface-3 px-2.5 py-1.5 text-[12px] text-muted-foreground shadow-surface-1">
                <TextQuote className="mt-0.5 size-3.5 shrink-0" />
                <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap">{q}</span>
                <button
                  type="button"
                  aria-label="Remove quote"
                  onClick={() => setQuotes(quotes.filter((_, j) => j !== i))}
                  className="rounded p-0.5 hover:bg-hover hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <InputMessage
          ref={composer}
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
