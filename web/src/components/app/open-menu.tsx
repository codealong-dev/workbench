import { useState } from "react";
import { ChevronDown, Code, Copy, FolderOpen, SquareTerminal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import type { Editor } from "@/contracts";
import { isRemote } from "@/lib/remote";

const EDITOR_KEY = "wb.editor";

export const EDITORS: { id: Editor; label: string; icon: LucideIcon }[] = [
  { id: "zed", label: "Zed", icon: SquareTerminal },
  { id: "code", label: "VS Code", icon: Code },
  { id: "cursor", label: "Cursor", icon: Code },
  { id: "finder", label: "Finder", icon: FolderOpen },
];

const MENU = EDITORS.filter((e) => !(isRemote && e.id === "finder"));

export function preferredEditor(): Editor {
  const saved = localStorage.getItem(EDITOR_KEY) as Editor | null;
  return EDITORS.some((e) => e.id === saved) && saved !== "finder" ? saved! : "code";
}

// The app's own icon, served from the Workbench machine (macOS); a generic
// glyph when it isn't installed there.
const missing = new Set<Editor>();

export function EditorIcon({ id, size = 16 }: { id: Editor; size?: number }) {
  const [failed, setFailed] = useState(missing.has(id));
  const Fallback = EDITORS.find((e) => e.id === id)?.icon ?? Code;
  if (failed) return <Fallback size={size} strokeWidth={1.5} className="shrink-0" />;
  return (
    <img
      src={`/api/editor-icon/${id}`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="shrink-0"
      onError={() => {
        missing.add(id);
        setFailed(true);
      }}
    />
  );
}

const ICONS = Object.fromEntries(
  EDITORS.map((e) => [e.id, (p: { size?: number }) => <EditorIcon id={e.id} size={p.size ?? 16} />]),
) as Record<Editor, (p: { size?: number }) => React.JSX.Element>;

/** The last-used editor's icon (VS Code by default) plus a menu for the others. */
export function OpenMenu({ path, onOpen }: { path: string; onOpen: (editor: Editor) => Promise<string | null> }) {
  const [editor, setEditor] = useState<Editor>(preferredEditor);
  const [note, setNote] = useState<string | null>(null);
  const current = EDITORS.find((e) => e.id === editor)!;

  const open = async (id: Editor) => {
    if (id !== "finder") {
      localStorage.setItem(EDITOR_KEY, id);
      setEditor(id);
    }
    const err = await onOpen(id);
    setNote(err);
    if (err) setTimeout(() => setNote(null), 4000);
  };

  return (
    <div className="relative flex items-center">
      <Button
        size="compact"
        variant="secondary"
        onClick={() => void open(editor)}
        className="gap-1.5 rounded-r-none px-2"
        aria-label={`Open in ${current.label}`}
        title={isRemote ? `Open in ${current.label} over SSH` : `Open in ${current.label}`}
      >
        <EditorIcon id={editor} />
        {isRemote && <span className="text-[11px] text-muted-foreground">SSH</span>}
      </Button>
      <DropdownMenu>
        <DropdownTrigger
          render={
            <Button size="icon-compact" variant="secondary" aria-label="Open in…" className="rounded-l-none border-l border-border">
              <ChevronDown />
            </Button>
          }
        />
        <DropdownContent>
          {MENU.map((e, i) => (
            <MenuItem key={e.id} index={i} icon={ICONS[e.id]} label={e.id === "finder" ? "Show in Finder" : e.label} checked={e.id === editor} onSelect={() => void open(e.id)} />
          ))}
          <DropdownSeparator />
          <MenuItem index={MENU.length} icon={Copy} label="Copy path" onSelect={() => void navigator.clipboard?.writeText(path)} />
        </DropdownContent>
      </DropdownMenu>
      {note && <div className="absolute top-full right-0 z-10 mt-1 w-72 rounded-lg bg-surface-4 px-3 py-2 text-[12px] text-destructive shadow-surface-4">{note}</div>}
    </div>
  );
}
