import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStore } from "@/store";
import type { Thread } from "@/contracts";

/** Confirms an archive; what it deletes depends on the kind of thread. */
export function ArchiveDialog(props: { thread: Thread; open: boolean; onOpenChange: (open: boolean) => void; onArchive: () => Promise<void> }) {
  const { thread, open, onOpenChange, onArchive } = props;
  const [busy, setBusy] = useState(false);
  const sessions = useStore((s) => s.threads.filter((t) => t.parent_id === thread.id).length);
  // Worktree threads always record the ref they branched from; in-repo threads don't.
  const isolated = thread.base_ref != null;
  const others = sessions > 0 ? ` Its ${sessions === 1 ? "other session stops" : `${sessions} other sessions stop`} too.` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{thread.parent_id ? "Archive this session?" : "Archive this thread?"}</DialogTitle>
          <DialogDescription>
            {thread.parent_id ? (
              <>The agent stops and the session is hidden. The worktree stays for the other sessions.</>
            ) : isolated ? (
              <>
                The agent stops, teardown runs and the worktree is deleted, including uncommitted changes. The branch{" "}
                <code className="wb-inline-code">{thread.branch}</code> is kept.{others}
              </>
            ) : (
              <>The agent stops and the thread is hidden. Your repo is not touched.{others}</>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="compact" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="compact"
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onArchive();
              setBusy(false);
              onOpenChange(false);
            }}
          >
            Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
