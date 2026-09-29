import { useState } from "react";
import { ChevronRight, CircleAlert, LoaderCircle, SquareTerminal, FileText, FilePen, Search, Globe, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolItem } from "@/contracts";

type Input = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

function icon(name: string) {
  if (name === "Bash") return SquareTerminal;
  if (name === "Read") return FileText;
  if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") return FilePen;
  if (name === "Grep" || name === "Glob") return Search;
  if (name === "WebFetch" || name === "WebSearch") return Globe;
  return Wrench;
}

/** One-line summary of a call, by tool name. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Input;
  switch (name) {
    case "Bash":
      return str(i.command);
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return str(i.file_path);
    case "Grep":
      return `${str(i.pattern)}${i.path ? `  in ${str(i.path)}` : ""}`;
    case "Glob":
      return str(i.pattern);
    case "WebFetch":
      return str(i.url);
    case "WebSearch":
      return str(i.query);
    case "Task":
    case "Agent":
      return str(i.description);
    default:
      return Object.values(i).map(str).join(" ").slice(0, 120);
  }
}

function Body({ item }: { item: ToolItem }) {
  const i = (item.input ?? {}) as Input;

  if ((item.name === "Edit" || item.name === "MultiEdit") && "old_string" in i) {
    return (
      <pre className="wb-tool-pre">
        {str(i.old_string)
          .split("\n")
          .map((l, n) => (
            <div key={`o${n}`} className="text-red-600 dark:text-red-400">- {l}</div>
          ))}
        {str(i.new_string)
          .split("\n")
          .map((l, n) => (
            <div key={`n${n}`} className="text-green-700 dark:text-green-400">+ {l}</div>
          ))}
      </pre>
    );
  }

  const input = item.name === "Bash" ? `$ ${str(i.command)}` : item.name === "Write" ? str(i.content) : JSON.stringify(item.input, null, 2);

  return (
    <>
      {item.name !== "Read" && item.name !== "Grep" && item.name !== "Glob" && <pre className="wb-tool-pre text-muted-foreground">{input}</pre>}
      {item.output != null && item.output !== "" && (
        <pre className={cn("wb-tool-pre", item.is_error && "text-destructive")}>
          {item.output}
          {item.truncated && <span className="text-muted-foreground">{"\n"}… truncated</span>}
        </pre>
      )}
    </>
  );
}

export function ToolCall({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const Icon = icon(item.name);
  const running = item.status === "running";

  return (
    <div className={cn("w-full rounded-lg text-[13px]", item.parent_id && "ml-5 w-[calc(100%-1.25rem)]")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-hover"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{item.name}</span>
        <span className="min-w-0 truncate font-mono text-[12px] text-muted-foreground">{toolSummary(item.name, item.input)}</span>
        <span className="ml-auto shrink-0">
          {running ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          ) : item.is_error ? (
            <CircleAlert className="size-3.5 text-destructive" />
          ) : null}
        </span>
      </button>
      {open && (
        <div className="mt-1 ml-7 flex flex-col gap-1">
          <Body item={item} />
        </div>
      )}
    </div>
  );
}
