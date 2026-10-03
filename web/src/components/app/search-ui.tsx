import type { KeyboardEvent, ReactNode, Ref } from "react";
import { CaseSensitive, Regex, WholeWord, type LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SearchMatch, SearchOptions } from "@/contracts";

// The pieces find in files shares between the side panel and the ⌘⇧F dialog.

const TOGGLES: { key: "case_sensitive" | "whole_word" | "regex"; label: string; keys: string; code: string; icon: LucideIcon }[] = [
  { key: "case_sensitive", label: "Match case", keys: "⌥⌘C", code: "KeyC", icon: CaseSensitive },
  { key: "whole_word", label: "Match whole word", keys: "⌥⌘W", code: "KeyW", icon: WholeWord },
  { key: "regex", label: "Use regular expression", keys: "⌥⌘R", code: "KeyR", icon: Regex },
];

/** ⌥⌘C / ⌥⌘W / ⌥⌘R flip the toggles, as in VS Code. True when the key was one of them. */
export function toggleKey(e: KeyboardEvent, options: SearchOptions, onOptions: (o: SearchOptions) => void): boolean {
  if (!e.altKey || !(e.metaKey || e.ctrlKey)) return false;
  const t = TOGGLES.find((t) => t.code === e.nativeEvent.code);
  if (!t) return false;
  e.preventDefault();
  onOptions({ ...options, [t.key]: !options[t.key] });
  return true;
}

/** The query, with match case / whole word / regex toggles at its end. */
export function SearchField(props: {
  value: string;
  onChange: (v: string) => void;
  options: SearchOptions;
  onOptions: (o: SearchOptions) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  /** compact for the side panel, large for the dialog */
  size?: "sm" | "lg";
  icon?: ReactNode;
  className?: string;
  error?: boolean;
}) {
  const { value, onChange, options, onOptions, size = "sm" } = props;
  const lg = size === "lg";
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-0.5",
        lg ? "h-11 px-4" : "h-7 rounded-md pr-1 ring-1 ring-border focus-within:bg-card",
        props.error && !lg && "ring-destructive/60",
        props.className,
      )}
    >
      {props.icon}
      <input
        ref={props.inputRef}
        autoFocus={props.autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (toggleKey(e, options, onOptions)) return;
          props.onKeyDown?.(e);
        }}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        spellCheck={false}
        autoComplete="off"
        className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground", lg ? "text-[14px]" : "pl-2 text-[12px]")}
      />
      {TOGGLES.map((t) => (
        <Tooltip key={t.key} content={`${t.label} (${t.keys})`} side="bottom">
          <button
            type="button"
            aria-label={t.label}
            aria-pressed={options[t.key]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onOptions({ ...options, [t.key]: !options[t.key] })}
            className={cn(
              "flex shrink-0 items-center justify-center rounded text-muted-foreground transition-colors duration-80 hover:bg-hover hover:text-foreground",
              lg ? "size-7 [&_svg]:size-4" : "size-5 [&_svg]:size-3.5",
              options[t.key] && "bg-[#6B97FF]/20 text-foreground ring-1 ring-[#6B97FF]/60 hover:bg-[#6B97FF]/25",
            )}
          >
            <t.icon />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** "files to include" / "files to exclude". */
export function GlobFields({ options, onOptions, className, onKeyDown }: { options: SearchOptions; onOptions: (o: SearchOptions) => void; className?: string; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void }) {
  const field = (key: "include" | "exclude", label: string, hint: string) => (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        value={options[key]}
        onChange={(e) => onOptions({ ...options, [key]: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder={hint}
        spellCheck={false}
        autoComplete="off"
        className="h-7 w-full rounded-md bg-transparent px-2 font-mono text-[12px] ring-1 ring-border outline-none placeholder:font-sans placeholder:text-muted-foreground focus:bg-card"
      />
    </label>
  );
  return (
    <div className={cn("flex gap-2", className)}>
      {field("include", "Files to include", "e.g. src, *.ts")}
      {field("exclude", "Files to exclude", "e.g. **/test/**")}
    </div>
  );
}

/** A match line with its matches marked, and … where it was cut. */
export function MatchText({ match, className }: { match: SearchMatch; className?: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  // leading indentation says nothing in a result list
  const lead = match.cut_left ? 0 : match.text.length - match.text.trimStart().length;
  const firstStart = match.ranges[0]?.[0] ?? 0;
  const from = Math.min(lead, firstStart);
  at = from;
  for (const [s, e] of match.ranges) {
    if (s > at) parts.push(match.text.slice(at, s));
    parts.push(
      <mark key={s} className="rounded-[2px] bg-amber-300/50 text-foreground dark:bg-amber-400/30">
        {match.text.slice(Math.max(s, at), e)}
      </mark>,
    );
    at = Math.max(at, e);
  }
  parts.push(match.text.slice(at));
  return (
    <span className={cn("whitespace-pre", className)}>
      {match.cut_left && "…"}
      {parts}
      {match.cut_right && "…"}
    </span>
  );
}

export const summarize = (total: number, files: number, truncated: boolean) =>
  `${total.toLocaleString()} result${total === 1 ? "" : "s"} in ${files.toLocaleString()} file${files === 1 ? "" : "s"}${truncated ? " (stopped early: narrow the search)" : ""}`;
