import { useMemo, useRef, useState } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { cn } from "@/lib/utils";
import type { Answers, Approval, Question } from "@/contracts";

/** Claude's raw input or our normalized one: always Question[]. */
export function questionsOf(input: unknown): Question[] {
  const qs = ((input as { questions?: Partial<Question>[] })?.questions ?? []) as Partial<Question>[];
  return qs.map((q) => ({
    id: q.id ?? q.question ?? "",
    header: q.header ?? "",
    question: q.question ?? "",
    options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? "" })),
    multiSelect: !!q.multiSelect,
    allowOther: q.allowOther ?? true,
    secret: !!q.secret,
  }));
}

interface Pick {
  labels: string[];
  other: string;
  otherOn: boolean;
}

const OTHER = "\u0000other";

function Option(props: { index: number; register: (i: number, el: HTMLElement | null) => void; selected: boolean; multi: boolean; label: string; description?: string; onClick: () => void; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(props.register, props.index, ref);
  return (
    <div
      ref={ref}
      role={props.multi ? "checkbox" : "radio"}
      aria-checked={props.selected}
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          props.onClick();
        }
      }}
      className="relative flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors duration-80",
          props.multi ? "rounded-[4px]" : "rounded-full",
          props.selected ? "border-foreground bg-foreground text-background" : "border-border bg-card",
        )}
      >
        {props.selected && (props.multi ? <Check size={11} strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-background" />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13px]", props.selected && "font-medium")}>{props.label}</span>
        {props.description && <span className="block text-[12px] text-muted-foreground">{props.description}</span>}
        {props.children}
      </span>
    </div>
  );
}

function QuestionBlock({ q, n, total, pick, onChange }: { q: Question; n: number; total: number; pick: Pick; onChange: (p: Pick) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(ref, { gapClick: false });
  const input = useRef<HTMLInputElement>(null);
  const freeOnly = q.options.length === 0;

  const toggle = (label: string) => {
    if (q.multiSelect) {
      const has = pick.labels.includes(label);
      onChange({ ...pick, labels: has ? pick.labels.filter((l) => l !== label) : [...pick.labels, label] });
    } else onChange({ labels: [label], other: pick.other, otherOn: false });
  };
  const toggleOther = () => {
    const on = q.multiSelect ? !pick.otherOn : true;
    onChange({ labels: q.multiSelect ? pick.labels : [], other: pick.other, otherOn: on });
  };

  const otherInput = (
    <input
      ref={input}
      // mounts when "Other" is picked: take the keystrokes that follow
      autoFocus={!freeOnly}
      type={q.secret ? "password" : "text"}
      value={pick.other}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => !pick.otherOn && !freeOnly && onChange({ labels: q.multiSelect ? pick.labels : [], other: pick.other, otherOn: true })}
      onChange={(e) => onChange({ ...pick, other: e.target.value, otherOn: true })}
      placeholder={freeOnly ? "Type your answer…" : "Something else…"}
      className="mt-1.5 h-8 w-full rounded-md bg-card px-2.5 text-[13px] ring-1 ring-border outline-none placeholder:text-muted-foreground focus:ring-[color:var(--focus-ring,#6B97FF)]"
    />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {q.header && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{q.header}</span>}
        {total > 1 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {n} of {total}
          </span>
        )}
        {q.multiSelect && <span className="text-[11px] text-muted-foreground">Pick any</span>}
      </div>
      <div className="text-[14px] font-medium">{q.question}</div>
      {freeOnly ? (
        otherInput
      ) : (
        <div
          ref={ref}
          role={q.multiSelect ? "group" : "radiogroup"}
          aria-label={q.question}
          className="relative -mx-1 flex flex-col"
          onMouseEnter={hover.handlers.onMouseEnter}
          onMouseMove={hover.handlers.onMouseMove}
          onMouseLeave={hover.handlers.onMouseLeave}
        >
          <FluidHoverHighlight hover={hover} className="rounded-lg" />
          {q.options.map((o, i) => (
            <Option
              key={o.label}
              index={i}
              register={hover.registerItem}
              multi={q.multiSelect}
              selected={pick.labels.includes(o.label)}
              label={o.label}
              description={o.description}
              onClick={() => toggle(o.label)}
            />
          ))}
          {q.allowOther && (
            <Option index={q.options.length} register={hover.registerItem} multi={q.multiSelect} selected={pick.otherOn} label="Other" onClick={toggleOther}>
              {pick.otherOn && otherInput}
            </Option>
          )}
        </div>
      )}
    </div>
  );
}

const answerOf = (q: Question, p: Pick): string[] => {
  const typed = p.other.trim();
  if (q.options.length === 0) return typed ? [typed] : [];
  return [...p.labels, ...(p.otherOn && typed ? [typed] : [])];
};

/** An agent's questions (Claude's AskUserQuestion, Codex's request_user_input). */
export function QuestionCard({ approval, agent, onAnswer }: { approval: Approval; agent: string; onAnswer: (answers: Answers | null) => Promise<void> }) {
  const questions = useMemo(() => questionsOf(approval.input), [approval.input]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState<"answer" | "skip" | null>(null);
  const pickOf = (q: Question) => picks[q.id] ?? { labels: [], other: "", otherOn: false };
  const complete = questions.every((q) => answerOf(q, pickOf(q)).length > 0);

  const finish = async (kind: "answer" | "skip") => {
    setBusy(kind);
    await onAnswer(kind === "skip" ? null : Object.fromEntries(questions.map((q) => [q.id, answerOf(q, pickOf(q))])));
    setBusy(null);
  };

  return (
    <div
      className="w-full rounded-xl bg-surface-3 p-4 shadow-surface-3"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && complete) void finish("answer");
      }}
    >
      <div className="mb-3 flex items-center gap-2 text-[12px] text-muted-foreground">
        <MessageCircleQuestion className="size-4 text-blue-500" />
        {agent} {questions.length === 1 ? "has a question" : `has ${questions.length} questions`}
      </div>
      <div className="flex flex-col gap-5">
        {questions.map((q, i) => (
          <QuestionBlock key={q.id || i} q={q} n={i + 1} total={questions.length} pick={pickOf(q)} onChange={(p) => setPicks((s) => ({ ...s, [q.id]: p }))} />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button size="compact" variant="primary" disabled={!complete} loading={busy === "answer"} onClick={() => void finish("answer")}>
          {questions.length === 1 ? "Answer" : "Send answers"}
        </Button>
        <Button size="compact" variant="ghost" loading={busy === "skip"} onClick={() => void finish("skip")}>
          Skip
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">⌘↵ to send</span>
      </div>
    </div>
  );
}

/** A finished question in the timeline: what was asked and what you picked. */
export function AnsweredQuestions({ input, answers }: { input: unknown; answers?: Answers }) {
  const questions = questionsOf(input);
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] shadow-surface-1">
      {questions.map((q) => {
        const picked = answers?.[q.id] ?? [];
        return (
          <div key={q.id} className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">{q.question}</span>
            <span className={cn(picked.length ? "font-medium" : "text-muted-foreground italic")}>
              {picked.length ? (q.secret ? "••••••" : picked.join(", ")) : answers ? "Skipped" : "No answer"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
