import { useState, type DragEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ChevronsDownUp,
  FileText,
  GripVertical,
  Layers,
  Plus,
} from "lucide-react";
import { PreviewDialog, formatSize } from "@/components/app/file-preview";
import { Tooltip } from "@/components/ui/tooltip";
import { ARTIFACT_DRAG, type Artifact } from "@/lib/artifacts";
import { cn } from "@/lib/utils";

function Row({
  a,
  onAttach,
}: {
  a: Artifact;
  onAttach: (a: Artifact) => void;
}) {
  const [open, setOpen] = useState(false);

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(
      ARTIFACT_DRAG,
      JSON.stringify({ key: a.key, name: a.name, size: a.size, ref: a.ref }),
    );
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <li
      draggable
      onDragStart={onDragStart}
      className="group/artifact flex items-center gap-1.5 rounded-md pr-1 hover:bg-hover"
    >
      <GripVertical
        className="ml-0.5 size-3 shrink-0 cursor-grab text-muted-foreground/50"
        aria-hidden
      />
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={a.name}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
      >
        {a.imageUrl ? (
          <img
            src={a.imageUrl}
            alt=""
            draggable={false}
            className="size-6 shrink-0 rounded object-cover"
          />
        ) : (
          <span className="grid size-6 shrink-0 place-items-center rounded bg-accent text-muted-foreground">
            <FileText className="size-3.5" />
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12.5px] leading-4">{a.name}</span>
          <span className="truncate text-[11px] leading-3.5 text-muted-foreground">
            {a.from === "you" ? "You attached" : "Agent"}
            {a.size != null && ` · ${formatSize(a.size)}`}
          </span>
        </span>
      </button>
      <Tooltip content="Attach to the message" side="left">
        <button
          type="button"
          aria-label={`Attach ${a.name} to the message`}
          onClick={() => onAttach(a)}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/artifact:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      </Tooltip>

      {a.imageUrl ? (
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-2 p-8 outline-none"
            >
              <DialogPrimitive.Title className="text-[12px] text-white/70">
                {a.name}
              </DialogPrimitive.Title>
              <img
                src={a.imageUrl}
                alt={a.name}
                className="min-h-0 max-w-full rounded-lg object-contain shadow-2xl"
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      ) : (
        <PreviewDialog
          open={open}
          onOpenChange={setOpen}
          name={a.name}
          src={a.src}
          srcKey={a.key}
        />
      )}
    </li>
  );
}

/**
 * Floats over the right edge of a chat: what you attached and what the agent
 * made or wrote. Folded to a small button until you open it; drag a row into
 * the composer (or press +) to refer to it in a message.
 */
export function ArtifactsPanel({
  artifacts,
  open,
  onOpenChange,
  onAttach,
}: {
  artifacts: Artifact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttach: (a: Artifact) => void;
}) {
  if (artifacts.length === 0) return null;

  if (!open)
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label={`Show ${artifacts.length} artifacts`}
        className="absolute top-2 right-3 z-20 flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-[12px] text-muted-foreground shadow-surface-1 outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
      >
        <Layers className="size-3.5" />
        Artifacts
        <span className="tabular-nums">{artifacts.length}</span>
      </button>
    );

  return (
    <aside
      aria-label="Artifacts"
      className={cn(
        "absolute top-2 right-3 z-20 flex max-h-[60%] w-64 flex-col overflow-hidden rounded-xl bg-surface-3 shadow-surface-1",
      )}
    >
      <div className="flex items-center justify-between py-1 pr-1 pl-3 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Layers className="size-3.5" />
          Artifacts <span className="tabular-nums">{artifacts.length}</span>
        </span>
        <Tooltip content="Collapse" side="left">
          <button
            type="button"
            aria-label="Collapse artifacts"
            onClick={() => onOpenChange(false)}
            className="flex size-6 items-center justify-center rounded-md outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
          >
            <ChevronsDownUp className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {artifacts.map((a) => (
          <Row key={a.key} a={a} onAttach={onAttach} />
        ))}
      </ul>
    </aside>
  );
}
