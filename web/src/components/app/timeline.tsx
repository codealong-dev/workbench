import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Brain, ChevronRight, CircleAlert } from "lucide-react";
import { ChatMessage } from "@/components/ui/chat-message";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { cn } from "@/lib/utils";
import type { Approval, Decision, Item, LiveItem, Status, TurnItem, Answers } from "@/contracts";
import { Markdown } from "./markdown";
import { ToolCall } from "./tool-call";
import { ApprovalCard } from "./approval-card";
import { QuestionCard } from "./question-card";
import { QuoteSelection } from "./quote-selection";
import { splitQuotes } from "@/lib/quotes";

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const show = open || live;
  return (
    <div className="w-full text-[13px] text-muted-foreground">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-hover">
        <ChevronRight className={cn("size-3.5 transition-transform", show && "rotate-90")} />
        <Brain className="size-3.5" />
        <span className={cn(live && "shimmer-text")}>{live ? "Thinking" : "Thought"}</span>
      </button>
      {show && (
        <div data-quotable className="mt-1 ml-7 border-l border-border pl-3 whitespace-pre-wrap italic">
          {text}
        </div>
      )}
    </div>
  );
}

function TurnFooter({ item }: { item: TurnItem }) {
  const u = item.usage;
  const tokens = u ? u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0;
  const parts = [
    item.status !== "ok" && item.status,
    u && `${fmt(tokens)} in · ${fmt(u.output_tokens)} out`,
    item.cost_usd != null && item.cost_usd > 0 && `$${item.cost_usd.toFixed(3)}`,
  ].filter(Boolean);
  if (parts.length === 0) return <div className="my-1 h-px w-full bg-border" />;
  return (
    <div className={cn("flex w-full items-center gap-3 py-1 text-[11px] text-muted-foreground", item.status === "error" && "text-destructive")}>
      <div className="h-px flex-1 bg-border" />
      {parts.join("  ·  ")}
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Row({ item, live }: { item: Item | LiveItem; live: boolean }) {
  switch (item.kind) {
    case "user_message": {
      const { quotes, body } = splitQuotes(item.text);
      return (
        <ChatMessage from="user">
          {quotes.map((q, i) => (
            <div key={i} className="mb-1.5 line-clamp-4 border-l-2 border-foreground/20 pl-2 text-[13px] whitespace-pre-wrap text-muted-foreground">
              {q}
            </div>
          ))}
          <div className="whitespace-pre-wrap">{body}</div>
        </ChatMessage>
      );
    }
    case "assistant_message":
      return (
        <ChatMessage from="assistant" className="max-w-full" data-quotable>
          <Markdown text={item.text} streaming={live} />
        </ChatMessage>
      );
    case "reasoning":
      return <Reasoning text={item.text} live={live} />;
    case "tool":
      return <ToolCall item={item} />;
    case "turn":
      return <TurnFooter item={item} />;
    case "error":
      return (
        <div className="flex w-full items-start gap-2 rounded-lg bg-destructive-light px-3 py-2 text-[13px] text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="whitespace-pre-wrap">{item.message}</span>
        </div>
      );
  }
}

export function Timeline(props: {
  items: Item[];
  live: LiveItem[];
  pending: Approval[];
  status: Status;
  onDecide: (requestId: string, d: Decision, answers?: Answers) => Promise<void>;
  agent: string;
  /** reply to a selected part of an answer */
  onQuote?: (text: string) => void;
}) {
  const { items, live, pending, status, onDecide, agent, onQuote } = props;
  const frame = useRef<HTMLDivElement>(null);
  // a question's own tool row would repeat the card while it is open
  const asking = new Set(pending.filter((a) => a.tool === "AskUserQuestion").map((a) => a.request_id));
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Stick to the bottom while the user hasn't scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => (pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const waiting = status === "running" && live.length === 0;

  return (
    <div ref={frame} className="relative flex min-h-0 flex-1 flex-col">
      {onQuote && <QuoteSelection frame={frame} scroller={scroller} onQuote={onQuote} />}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-6">
          {items.length === 0 && live.length === 0 && status === "idle" && (
            <div className="py-24 text-center text-[13px] text-muted-foreground">Send a message to start.</div>
          )}
          {items
            .filter((it) => !asking.has(it.id))
            .map((it) => (
              <Row key={it.id} item={it} live={false} />
            ))}
          {live.map((it) => (
            <Row key={it.id} item={it} live />
          ))}
          {pending.map((a) =>
            a.tool === "AskUserQuestion" ? (
              <QuestionCard
                key={a.request_id}
                approval={a}
                agent={agent}
                onAnswer={(answers) => (answers ? onDecide(a.request_id, "answer", answers) : onDecide(a.request_id, "deny"))}
              />
            ) : (
              <ApprovalCard key={a.request_id} approval={a} onDecide={(d) => onDecide(a.request_id, d)} />
            ),
          )}
          {waiting && <ThinkingIndicator className="self-start px-0" />}
        </div>
      </div>
    </div>
  );
}
