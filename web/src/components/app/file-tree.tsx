import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Folder, FolderOpen, type LucideIcon } from "lucide-react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { fileIcon } from "@/lib/file-icons";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

// ── rows ────────────────────────────────────────────────────────────────────

export interface Row {
  key: string;
  depth: number;
  kind: "dir" | "file" | "label";
  name: ReactNode;
  /** dir: its path (the expand key); file: its path */
  path: string;
  open?: boolean;
  icon?: LucideIcon;
  iconClass?: string;
  nameClass?: string;
  /** right-aligned, always visible (counts, status) */
  meta?: ReactNode;
  /** right-aligned, on hover only */
  actions?: ReactNode;
  title?: string;
}

const INDENT = 12;

const RowView = memo(function RowView(props: {
  row: Row;
  index: number;
  selected: boolean;
  register: (index: number, el: HTMLElement | null) => void;
  onActivate: (row: Row) => void;
}) {
  const { row, index, selected, register, onActivate } = props;
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(register, index, ref);
  const Icon = row.icon ?? (row.kind === "dir" ? (row.open ? FolderOpen : Folder) : fileIcon(row.path).icon);
  const iconClass = row.iconClass ?? (row.kind === "dir" ? "text-muted-foreground" : fileIcon(row.path).className);

  return (
    <div
      ref={ref}
      role="treeitem"
      aria-expanded={row.kind === "dir" ? !!row.open : undefined}
      aria-selected={selected}
      tabIndex={-1}
      title={row.title ?? (row.kind === "label" ? undefined : row.path)}
      onClick={() => onActivate(row)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onActivate(row))}
      className={cn(
        "group/row relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1.5 text-[13px] outline-none select-none",
        selected && "bg-active before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground",
        row.kind === "label" && "text-muted-foreground",
      )}
      style={{ paddingLeft: 6 + row.depth * INDENT }}
    >
      {/* indent guides */}
      {Array.from({ length: row.depth }, (_, d) => (
        <span key={d} aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: 13 + d * INDENT }} />
      ))}
      {row.kind === "dir" ? (
        <motion.span className="inline-flex shrink-0 text-muted-foreground" animate={{ rotate: row.open ? 90 : 0 }} transition={spring.fast}>
          <ChevronRight size={14} strokeWidth={1.5} />
        </motion.span>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      {row.kind !== "label" && <Icon size={15} strokeWidth={1.5} className={cn("shrink-0", iconClass)} />}
      <span className={cn("min-w-0 flex-1 truncate", row.nameClass)}>{row.name}</span>
      {row.actions && <span className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex">{row.actions}</span>}
      {row.meta && <span className="flex shrink-0 items-center gap-1.5">{row.meta}</span>}
    </div>
  );
});

/** A flat list of tree rows with FF's gliding hover highlight. */
export function TreeRows({ rows, selected, onActivate, label }: { rows: Row[]; selected?: string | null; onActivate: (row: Row) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(ref, { gapClick: false });
  // keep the selected row in view, e.g. as the diff scrolls through files
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div
      ref={ref}
      role="tree"
      aria-label={label}
      className="relative flex flex-col"
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseMove={hover.handlers.onMouseMove}
      onMouseLeave={hover.handlers.onMouseLeave}
    >
      <FluidHoverHighlight hover={hover} className="rounded-md" />
      {rows.map((row, i) => (
        <RowView key={row.key} row={row} index={i} selected={row.kind === "file" && row.path === selected} register={hover.registerItem} onActivate={onActivate} />
      ))}
    </div>
  );
}

// ── building a tree from paths ──────────────────────────────────────────────

interface Node {
  name: string;
  path: string;
  dirs: Map<string, Node>;
  files: string[];
}

export function buildTree(paths: string[]): Node {
  const root: Node = { name: "", path: "", dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = node.dirs.get(parts[i]);
      if (!next) node.dirs.set(parts[i], (next = { name: parts[i], path, dirs: new Map(), files: [] }));
      node = next;
    }
    node.files.push(p);
  }
  return root;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/**
 * Visible rows for the expanded set. Chains of single-folder directories are
 * compacted into one row ("src/components"), like VS Code.
 */
export function flattenTree(root: Node, expanded: Set<string>, decorate?: (row: Row) => Row): Row[] {
  const rows: Row[] = [];
  const walk = (node: Node, depth: number) => {
    for (const dir of [...node.dirs.values()].sort((a, b) => byName(a.name, b.name))) {
      let d = dir;
      let name = d.name;
      while (d.files.length === 0 && d.dirs.size === 1) {
        d = [...d.dirs.values()][0];
        name += "/" + d.name;
      }
      const open = expanded.has(d.path);
      const row: Row = { key: "d:" + d.path, depth, kind: "dir", name, path: d.path, open };
      rows.push(decorate ? decorate(row) : row);
      if (open) walk(d, depth + 1);
    }
    for (const f of [...node.files].sort((a, b) => byName(a.slice(a.lastIndexOf("/") + 1), b.slice(b.lastIndexOf("/") + 1)))) {
      const row: Row = { key: "f:" + f, depth, kind: "file", name: f.slice(f.lastIndexOf("/") + 1), path: f };
      rows.push(decorate ? decorate(row) : row);
    }
  };
  walk(root, 0);
  return rows;
}

/** Every directory path on the way to `path` (to reveal a file). */
export const ancestors = (path: string) => {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
};

export function useTree(paths: string[]) {
  return useMemo(() => buildTree(paths), [paths]);
}
