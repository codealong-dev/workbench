import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Field } from "@/components/app/field";
import { MODES } from "@/components/app/modes";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { LABS, useEnabledLabs } from "@/lib/labs";
import { DEFAULT_REVIEW_PROMPT } from "@/lib/review";
import { useStore } from "@/store";
import type { Mode, Provider, ReviewSettings, Settings } from "@/contracts";
import { useLabModels } from "./use-lab-models";
import { SettingsPage, SettingsSection } from "./settings-ui";

const DEFAULT = "__default";
const EFFORT_LABEL: Record<string, string> = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", none: "None" };
const effortLabel = (e: string) => EFFORT_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

const same = (a: ReviewSettings, b: ReviewSettings) => a.provider === b.provider && a.model === b.model && a.effort === b.effort && a.mode === b.mode && a.prompt === b.prompt;

export function ReviewSettingsPage() {
  const settings = useStore((s) => s.settings);
  const labs = useEnabledLabs();
  const saved = settings?.review ?? null;
  const [draft, setDraft] = useState<ReviewSettings>(() => saved ?? { provider: labs[0]?.id ?? "claude", model: null, effort: null, mode: "bypassPermissions", prompt: DEFAULT_REVIEW_PROMPT });
  const [state, setState] = useState<{ saving: boolean; error: string | null; savedAt: number | null }>({ saving: false, error: null, savedAt: null });
  const { models, loading } = useLabModels(draft.provider);

  if (!settings) return <SettingsPage title="Review">{null}</SettingsPage>;

  const set = (change: Partial<ReviewSettings>) => {
    setDraft((d) => ({ ...d, ...change }));
    setState((s) => ({ ...s, savedAt: null }));
  };
  const model = models?.find((m) => m.id === (draft.model ?? "default"));
  const efforts = model?.efforts ?? [];
  const dirty = !saved || !same(draft, saved);
  const valid = draft.prompt.trim() !== "" && labs.some((l) => l.id === draft.provider);

  const save = async () => {
    setState({ saving: true, error: null, savedAt: null });
    const r = await push(lobbyChannel(), "settings.put", { key: "review", value: { ...draft, prompt: draft.prompt.trim() } });
    if (r.ok) {
      const next = (r.payload as { settings: Settings }).settings;
      useStore.getState().setSettings(next);
      if (next.review) setDraft(next.review);
      setState({ saving: false, error: null, savedAt: Date.now() });
    } else setState({ saving: false, error: r.reason, savedAt: null });
  };

  return (
    <SettingsPage
      title="Review"
      description={
        saved
          ? "The Review button in a thread's Changes starts this agent in a panel beside it, on the same worktree."
          : "Set up the agent that reviews your changes. Do it once: the Review button in a thread's Changes uses it from then on."
      }
    >
      <SettingsSection title="Reviewer" description="A second agent on the thread's worktree and branch, so a different model can check the first one's work.">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-3 p-3 shadow-surface-2">
          <Field label="Agent">
            <Select
              value={draft.provider}
              onValueChange={(v) => {
                // models, efforts and loadouts belong to an agent
                if (v !== draft.provider) set({ provider: v as Provider, model: null, effort: null });
              }}
              size="compact"
            >
              <SelectTrigger />
              <SelectContent>
                {(labs.some((l) => l.id === draft.provider) ? labs : [...labs, ...LABS.filter((l) => l.id === draft.provider)]).map((l, i) => (
                  <SelectItem key={l.id} index={i} value={l.id}>
                    {l.id === "fake" ? "Fake (no agent)" : `${l.agent} · ${l.lab}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Permissions">
            <Select value={draft.mode} onValueChange={(v) => set({ mode: v as Mode })} size="compact">
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

          <Field label="Model" hint={loading ? "Loading…" : undefined}>
            <Select
              value={draft.model ?? DEFAULT}
              onValueChange={(v) => {
                const next = v === DEFAULT ? null : v;
                const keep = draft.effort && models?.find((m) => m.id === (next ?? "default"))?.efforts.some((e) => e.value === draft.effort);
                set({ model: next, effort: keep ? draft.effort : null });
              }}
              size="compact"
            >
              <SelectTrigger />
              <SelectContent>
                <SelectItem index={0} value={DEFAULT}>
                  Agent's default
                </SelectItem>
                {(models ?? [])
                  .filter((m) => m.id !== "default")
                  .map((m, i) => (
                    <SelectItem key={m.id} index={i + 1} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                {draft.model && models && !models.some((m) => m.id === draft.model) && (
                  <SelectItem index={models.length + 1} value={draft.model}>
                    {draft.model}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Effort">
            <Select value={draft.effort ?? DEFAULT} onValueChange={(v) => set({ effort: v === DEFAULT ? null : v })} size="compact">
              <SelectTrigger />
              <SelectContent>
                <SelectItem index={0} value={DEFAULT}>
                  {model?.default_effort ? `Default (${effortLabel(model.default_effort)})` : "Default"}
                </SelectItem>
                {efforts.map((e, i) => (
                  <SelectItem key={e.value} index={i + 1} value={e.value}>
                    {effortLabel(e.value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="px-1 text-[12px] text-pretty text-muted-foreground">
          The reviewer reads the diff with git, so it needs to run commands: "Ask before edits" lets it look around and asks before changing anything. Turn off agents you don't use in Models.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Prompt"
        description="Sent as the reviewer's first message. Workbench adds which changes to look at (the base and the changed files)."
        aside={
          draft.prompt !== DEFAULT_REVIEW_PROMPT && (
            <Button size="compact" variant="ghost" onClick={() => set({ prompt: DEFAULT_REVIEW_PROMPT })}>
              Reset to default
            </Button>
          )
        }
      >
        <textarea
          value={draft.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          aria-label="Review prompt"
          spellCheck={false}
          rows={14}
          className="w-full resize-y rounded-xl bg-surface-3 px-3 py-2.5 text-[13px] leading-relaxed shadow-surface-2 outline-none placeholder:text-muted-foreground focus-visible:shadow-surface-3"
        />
      </SettingsSection>

      <div className="flex items-center justify-end gap-3 px-1">
        {state.error && <span className="min-w-0 flex-1 text-[12px] text-destructive">{state.error}</span>}
        {!state.error && state.savedAt && <span className="text-[12px] text-muted-foreground">Saved</span>}
        <Button size="compact" disabled={!dirty || !valid || state.saving} onClick={() => void save()}>
          {saved ? "Save changes" : "Save reviewer"}
        </Button>
      </div>
    </SettingsPage>
  );
}
