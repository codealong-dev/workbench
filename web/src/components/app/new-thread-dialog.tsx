import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { useEnabledLabs } from "@/lib/labs";
import { useStore } from "@/store";
import type { Mode, Provider, Thread } from "@/contracts";
import { MODES } from "./modes";
import { Field, TextInput } from "./field";

const LAST_PROJECT = "wb.lastProject";

export function NewThreadDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  /** Preselect this agent (⌘T); otherwise the last one picked. */
  provider?: Provider;
  onCreated: (t: Thread) => void;
  onAddProject: () => void;
}) {
  const { open, onOpenChange, onCreated, onAddProject } = props;
  const projects = useStore((s) => s.projects);
  const labs = useEnabledLabs();
  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [initialContext, setInitialContext] = useState("");
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
    setStep(1);
    setInitialContext("");
    const last = localStorage.getItem(LAST_PROJECT);
    const pick = props.projectId ?? (projects.some((p) => p.id === last) ? last : projects[0]?.id) ?? "";
    setProjectId(pick);
    // the agent picked last time may have been turned off in settings
    setProvider((p) => {
      const want = props.provider ?? p;
      return labs.some((l) => l.id === want) ? want : (labs[0]?.id ?? "claude");
    });
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
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    const r = await push(lobbyChannel(), "thread.create", {
      project_id: projectId,
      title: title.trim() || null,
      initial_context: initialContext.trim() || null,
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
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{step === 1 ? "New thread" : "Add context"}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Choose a project and agent to get started."
              : "Give every agent in this thread the same starting context."}
          </DialogDescription>
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
              if (step === 1) setStep(2);
              else void create();
            }}
          >
            <ol aria-label="Thread creation steps" className="flex gap-4 text-[12px]">
              <li aria-current={step === 1 ? "step" : undefined} className={step === 1 ? "font-medium text-foreground" : "text-muted-foreground"}>1. Setup</li>
              <li aria-current={step === 2 ? "step" : undefined} className={step === 2 ? "font-medium text-foreground" : "text-muted-foreground"}>2. Context</li>
            </ol>

            {step === 1 ? (
              <>
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
                        {labs.map((l, i) => (
                          <SelectItem key={l.id} index={i} value={l.id}>
                            {l.id === "fake" ? "Fake (no agent)" : l.agent}
                          </SelectItem>
                        ))}
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
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Field label="Initial context" hint="Optional">
                  <textarea
                    value={initialContext}
                    onChange={(e) => setInitialContext(e.target.value)}
                    placeholder={"Paste task details, a Linear ticket, a Notion page link, or any notes the agents should know."}
                    autoFocus
                    disabled={busy}
                    rows={9}
                    className="min-h-40 w-full resize-y rounded-lg bg-surface-3 px-2.5 py-2 text-[13px] shadow-surface-2 outline-none placeholder:text-muted-foreground focus-visible:shadow-surface-3"
                  />
                </Field>
              </div>
            )}

            {error && <div className="text-[12px] text-destructive">{error}</div>}

            <DialogFooter>
              <Button type="button" size="compact" variant="ghost" disabled={busy} onClick={() => step === 1 ? onOpenChange(false) : setStep(1)}>
                {step === 1 ? "Cancel" : "Back"}
              </Button>
              <Button type="submit" size="compact" variant="primary" loading={busy} disabled={!projectId}>
                {step === 1 ? "Next" : "Create thread"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
