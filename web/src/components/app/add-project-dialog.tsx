import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { lobbyChannel, push } from "@/hooks/use-channels";
import type { Project } from "@/contracts";
import { Field, TextInput } from "./field";

export function AddProjectDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onAdded: (p: Project) => void }) {
  const { open, onOpenChange, onAdded } = props;
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const add = async () => {
    setBusy(true);
    const r = await push(lobbyChannel(), "project.add", { path: path.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setPath("");
    onOpenChange(false);
    onAdded((r.payload as { project: Project }).project);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>Any local git repository. Threads branch off it into their own worktrees.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label="Path" hint="Optional .workbench.json in the repo: { setup: [...], teardown: [...] }">
            <TextInput value={path} onChange={setPath} placeholder="~/dev/projects/codealong" mono autoFocus />
          </Field>
          {error && <div className="text-[12px] text-destructive">{error}</div>}
          <DialogFooter>
            <Button type="button" size="compact" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="compact" variant="primary" loading={busy} disabled={!path.trim()}>
              Add project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
