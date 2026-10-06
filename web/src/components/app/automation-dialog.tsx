import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { useEnabledLabs } from "@/lib/labs";
import { DEFAULT_SCHEDULE, SCHEDULE_KINDS, WEEKDAYS, fromCron, toCron, type ScheduleForm, type ScheduleKind } from "@/lib/schedule";
import { useStore } from "@/store";
import type { Automation, Provider } from "@/contracts";
import { Field, TextInput } from "./field";

const AUDIT_PROMPT = `Audit this repository's dependencies.

1. List outdated packages and any with known vulnerabilities.
2. Apply minor and patch updates only; leave major versions alone.
3. Run the tests. Revert any update that breaks them.
4. Write what you changed, what you reverted, and what needs a human decision to AUDIT.md.

Check git log first: if an earlier run already did this work, say so and stop.`;

/**
 * Create an automation, or edit one (`automation`). Saving reschedules it
 * from now (Workbench.Automations).
 */
export function AutomationDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; automation: Automation | null }) {
  const { open, onOpenChange, automation } = props;
  const projects = useStore((s) => s.projects);
  const labs = useEnabledLabs();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [provider, setProvider] = useState<Provider>("claude");
  const [schedule, setSchedule] = useState<ScheduleForm>(DEFAULT_SCHEDULE);
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmDelete(false);
    const a = automation;
    setName(a?.name ?? "Nightly audit");
    setProjectId(a?.project_id ?? projects[0]?.id ?? "");
    setProvider(a?.provider ?? labs.find((l) => l.id !== "fake")?.id ?? labs[0]?.id ?? "claude");
    setSchedule(a ? fromCron(a.schedule) : DEFAULT_SCHEDULE);
    setPrompt(a?.prompt ?? AUDIT_PROMPT);
    setEnabled(a?.enabled ?? true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setKind = (kind: ScheduleKind) =>
    // switching to custom starts from what the other shape meant
    setSchedule((s) => ({ ...s, kind, cron: kind === "custom" && s.kind !== "custom" ? toCron(s) : s.cron }));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await push(lobbyChannel(), "automation.save", {
      ...(automation ? { id: automation.id } : {}),
      name,
      project_id: projectId,
      provider,
      prompt,
      schedule: toCron(schedule),
      enabled,
    });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    useStore.getState().upsertAutomation((r.payload as { automation: Automation }).automation);
    onOpenChange(false);
  };

  const remove = async () => {
    if (!automation || busy) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const r = await push(lobbyChannel(), "automation.delete", { id: automation.id });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    useStore.getState().removeAutomation(automation.id);
    onOpenChange(false);
  };

  const timed = schedule.kind === "daily" || schedule.kind === "weekdays" || schedule.kind === "weekly";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{automation ? "Edit automation" : "New automation"}</DialogTitle>
          <DialogDescription>Each run gets its own worktree and thread, with permissions bypassed. Review it when you're back.</DialogDescription>
        </DialogHeader>

        {projects.length === 0 ? (
          <div className="py-2 text-[13px] text-muted-foreground">Add a project first.</div>
        ) : (
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="Name" hint="Also names each run's branch">
              <TextInput value={name} onChange={setName} placeholder="Nightly audit" autoFocus />
            </Field>

            <div className="grid grid-cols-2 gap-3">
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Runs">
                <Select value={schedule.kind} onValueChange={(v) => setKind(v as ScheduleKind)} size="compact">
                  <SelectTrigger />
                  <SelectContent>
                    {SCHEDULE_KINDS.map((k, i) => (
                      <SelectItem key={k.id} index={i} value={k.id}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {schedule.kind === "custom" ? (
                <Field label="Cron" hint="min hour day month weekday">
                  <TextInput value={schedule.cron} onChange={(cron) => setSchedule((s) => ({ ...s, cron }))} placeholder="0 3 * * 1-5" mono />
                </Field>
              ) : timed ? (
                <div className={schedule.kind === "weekly" ? "grid grid-cols-2 gap-2" : "grid"}>
                  {schedule.kind === "weekly" && (
                    <Field label="On">
                      <Select value={String(schedule.weekday)} onValueChange={(v) => setSchedule((s) => ({ ...s, weekday: Number(v) }))} size="compact">
                        <SelectTrigger />
                        <SelectContent>
                          {WEEKDAYS.map((d, i) => (
                            <SelectItem key={d} index={i} value={String(i)}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  <Field label="At">
                    <input
                      type="time"
                      value={schedule.time}
                      onChange={(e) => setSchedule((s) => ({ ...s, time: e.target.value || s.time }))}
                      className="h-7 w-full rounded-lg bg-surface-3 px-2.5 text-[13px] tabular-nums shadow-surface-2 outline-none focus-visible:shadow-surface-3"
                    />
                  </Field>
                </div>
              ) : null}
            </div>

            <Field label="Prompt" hint="The first message of every run">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
                rows={9}
                spellCheck={false}
                className="min-h-40 w-full resize-y rounded-lg bg-surface-3 px-2.5 py-2 text-[13px] shadow-surface-2 outline-none placeholder:text-muted-foreground focus-visible:shadow-surface-3"
              />
            </Field>
            <div className="-mt-1.5 text-[12px] text-muted-foreground">
              A run can come twice, or pick up after a missed one, so say how to tell work is already done.
            </div>

            <Switch label="On" checked={enabled} onToggle={() => setEnabled((v) => !v)} size="compact" />

            {error && <div className="text-[12px] text-destructive">{error}</div>}

            <DialogFooter>
              {automation && (
                <Button type="button" size="compact" variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => void remove()}>
                  {confirmDelete ? "Click again to delete" : "Delete"}
                </Button>
              )}
              <Button type="button" size="compact" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="compact" variant="primary" loading={busy} disabled={!projectId || !name.trim() || !prompt.trim()}>
                {automation ? "Save" : "Create automation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
