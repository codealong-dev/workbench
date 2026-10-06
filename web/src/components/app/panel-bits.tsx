import { Minus, MoveRight, Plus } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FileStatus } from "@/contracts";

export const STATUS: Record<FileStatus, { label: string; text: string; box: string; glyph: "dot" | "plus" | "minus" | "arrow" }> = {
  modified: { label: "Modified", text: "text-amber-600 dark:text-amber-400", box: "border-amber-500/70 text-amber-600 dark:text-amber-400", glyph: "dot" },
  added: { label: "Added", text: "text-green-600 dark:text-green-400", box: "border-green-500/70 text-green-600 dark:text-green-400", glyph: "plus" },
  untracked: { label: "Untracked", text: "text-green-600 dark:text-green-400", box: "border-green-500/70 text-green-600 dark:text-green-400", glyph: "plus" },
  deleted: { label: "Deleted", text: "text-red-600 dark:text-red-400 line-through", box: "border-red-500/70 text-red-600 dark:text-red-400", glyph: "minus" },
  renamed: { label: "Renamed", text: "text-blue-600 dark:text-blue-400", box: "border-blue-500/70 text-blue-600 dark:text-blue-400", glyph: "arrow" },
  copied: { label: "Copied", text: "text-blue-600 dark:text-blue-400", box: "border-blue-500/70 text-blue-600 dark:text-blue-400", glyph: "plus" },
};

export function StatusBox({ status }: { status: FileStatus }) {
  const s = STATUS[status];
  return (
    <span title={s.label} className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border", s.box)}>
      {s.glyph === "dot" && <span className="size-1.5 rounded-full bg-current" />}
      {s.glyph === "plus" && <Plus size={10} strokeWidth={2.5} />}
      {s.glyph === "minus" && <Minus size={10} strokeWidth={2.5} />}
      {s.glyph === "arrow" && <MoveRight size={10} strokeWidth={2.5} />}
    </span>
  );
}

export function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] [&_svg]:size-3.5",
          active && "bg-hover text-foreground",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex h-9 shrink-0 items-center gap-1 px-2">{children}</div>;
}

export const splitPath = (p: string) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
};
