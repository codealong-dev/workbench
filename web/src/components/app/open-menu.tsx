import { useState } from "react";
import { ChevronDown, Code, Copy, FolderOpen, SquareTerminal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import type { Editor } from "@/contracts";

const EDITOR_KEY = "wb.editor";

export const EDITORS: { id: Editor; label: string; icon: LucideIcon }[] = [
  { id: "zed", label: "Zed", icon: SquareTerminal },
  { id: "code", label: "VS Code", icon: Code },
  { id: "cursor", label: "Cursor", icon: Code },
  { id: "finder", label: "Finder", icon: FolderOpen },
];

export function preferredEditor(): Editor {
  const saved = localStorage.getItem(EDITOR_KEY) as Editor | null;
  return EDITORS.some((e) => e.id === saved) && saved !== "finder" ? saved! : "zed";
}

/** "Open in Zed" plus a menu for the other editors; remembers the last editor used. */
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
      <Button size="compact" variant="secondary" leadingIcon={current.icon} onClick={() => void open(editor)} className="rounded-r-none">
        Open in {current.label}
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
          {EDITORS.map((e, i) => (
            <MenuItem key={e.id} index={i} icon={e.icon} label={e.id === "finder" ? "Show in Finder" : e.label} onSelect={() => void open(e.id)} />
          ))}
          <DropdownSeparator />
          <MenuItem index={EDITORS.length} icon={Copy} label="Copy path" onSelect={() => void navigator.clipboard?.writeText(path)} />
        </DropdownContent>
      </DropdownMenu>
      {note && <div className="absolute top-full right-0 z-10 mt-1 w-72 rounded-lg bg-surface-4 px-3 py-2 text-[12px] text-destructive shadow-surface-4">{note}</div>}
    </div>
  );
}
