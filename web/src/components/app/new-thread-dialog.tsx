import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { useStore } from "@/store";
import type { Mode, Provider, Thread } from "@/contracts";
import { MODES } from "./modes";
import { Field, TextInput } from "./field";

const LAST_PROJECT = "wb.lastProject";

export function NewThreadDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  onCreated: (t: Thread) => void;
  onAddProject: () => void;
}) {
  const { open, onOpenChange, onCreated, onAddProject } = props;
  const projects = useStore((s) => s.projects);
  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState<Provider>("claude");
  const [mode, setMode] = useState<Mode>("default");
  const [isolate, setIsolate] = useState(true);
  const [branches, setBranches] = useState<string[]>([]);
  const [baseRef, setBaseRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick the project on open: the one asked for, else the last used, else the first.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle("");
    const last = localStorage.getItem(LAST_PROJECT);
    const pick = props.projectId ?? (projects.some((p) => p.id === last) ? last : projects[0]?.id) ?? "";
    setProjectId(pick);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Branches for the base-branch picker.
  useEffect(() => {
    if (!open || !projectId) return;
    const project = projects.find((p) => p.id === projectId);
    setBaseRef(project?.default_branch ?? "");
    push(lobbyChannel(), "project.branches", { project_id: projectId }).then((r) => {
      if (r.ok) setBranches((r.payload as { branches: string[] }).branches);
    });
  }, [open, projectId, projects]);

  const create = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    const r = await push(lobbyChannel(), "thread.create", {
      project_id: projectId,
      title: title.trim() || null,
      provider,
      mode,
      base_ref: isolate ? baseRef || null : null,
      isolate,
    });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    localStorage.setItem(LAST_PROJECT, projectId);
    onOpenChange(false);
    onCreated((r.payload as { thread: Thread }).thread);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New thread</DialogTitle>
          <DialogDescription>Each thread gets its own branch and worktree, so agents never step on each other.</DialogDescription>
        </DialogHeader>

        {projects.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-2 text-[13px] text-muted-foreground">
            Add a git repository first.
            <Button size="compact" variant="primary" onClick={onAddProject}>
              Add project
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <Field label="Project">
              <Select value={projectId} onValueChange={setProjectId} size="compact">
                <SelectTrigger />
                <SelectContent>
                  {projects.map((p, i) => (
                    <SelectItem key={p.id} index={i} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="What are you working on?" hint="Also names the branch">
              <TextInput value={title} onChange={setTitle} placeholder="Fix the flaky auth test" autoFocus />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Agent">
                <Select value={provider} onValueChange={(v) => setProvider(v as Provider)} size="compact">
                  <SelectTrigger />
                  <SelectContent>
                    <SelectItem index={0} value="claude">Claude Code</SelectItem>
                    <SelectItem index={1} value="codex">Codex</SelectItem>
                    <SelectItem index={2} value="fake">Fake (no agent)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Permissions">
                <Select value={mode} onValueChange={(v) => setMode(v as Mode)} size="compact">
                  <SelectTrigger />
                  <SelectContent>
                    {MODES.map((m, i) => (
                      <SelectItem key={m.value} index={i} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Switch
              label="Isolated worktree"
              checked={isolate}
              onToggle={() => setIsolate((v) => !v)}
              size="compact"
            />

            {isolate ? (
              <Field label="Branch from">
                <Combobox items={branches} value={baseRef} onValueChange={(v) => setBaseRef(v ?? "")} size="compact">
                  <ComboboxInput icon={GitBranch} placeholder="Base branch" />
                  <ComboboxContent>
                    <ComboboxEmpty>No branch matches.</ComboboxEmpty>
                    <ComboboxList>
                      {(b) => {
                        const name = typeof b === "string" ? b : b.value;
                        return (
                          <ComboboxItem key={name} value={name}>
                            {name}
                          </ComboboxItem>
                        );
                      }}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Field>
            ) : (
              <div className="text-[12px] text-muted-foreground">The agent works directly in the repo, on whatever is checked out.</div>
            )}

            {error && <div className="text-[12px] text-destructive">{error}</div>}

            <DialogFooter>
              <Button type="button" size="compact" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="compact" variant="primary" loading={busy}>
                Create thread
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
