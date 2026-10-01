import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Field } from "@/components/app/field";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { LABS, useEnabledLabs } from "@/lib/labs";
import { DEFAULT_GUIDE_PROMPT, DEFAULT_GUIDE_SETTINGS } from "@/lib/guide";
import { useStore } from "@/store";
import type { GuideSettings, Provider, Settings } from "@/contracts";
import { useLabModels } from "./use-lab-models";
import { SettingsPage, SettingsSection } from "./settings-ui";

const DEFAULT = "__default";
const EFFORT_LABEL: Record<string, string> = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", none: "None" };
const effortLabel = (e: string) => EFFORT_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

const same = (a: GuideSettings, b: GuideSettings) => a.provider === b.provider && a.model === b.model && a.effort === b.effort && a.prompt === b.prompt;

export function GuideSettingsPage() {
  const settings = useStore((s) => s.settings);
  const labs = useEnabledLabs();
  const saved = settings?.guide ?? null;
  // until something is saved the guide runs on the defaults, so that is what the page starts from
  const [draft, setDraft] = useState<GuideSettings>(() => saved ?? DEFAULT_GUIDE_SETTINGS);
  const [state, setState] = useState<{ saving: boolean; error: string | null; savedAt: number | null }>({ saving: false, error: null, savedAt: null });
  const { models, loading } = useLabModels(draft.provider);

  if (!settings) return <SettingsPage title="Guide">{null}</SettingsPage>;

  const set = (change: Partial<GuideSettings>) => {
    setDraft((d) => ({ ...d, ...change }));
    setState((s) => ({ ...s, savedAt: null }));
  };
  const model = models?.find((m) => m.id === (draft.model ?? "default"));
  const efforts = model?.efforts ?? [];
  const dirty = !same(draft, saved ?? DEFAULT_GUIDE_SETTINGS);
  const valid = draft.prompt.trim() !== "" && labs.some((l) => l.id === draft.provider);

  const save = async () => {
    setState({ saving: true, error: null, savedAt: null });
    const r = await push(lobbyChannel(), "settings.put", { key: "guide", value: { ...draft, prompt: draft.prompt.trim() } });
    if (r.ok) {
      const next = (r.payload as { settings: Settings }).settings;
      useStore.getState().setSettings(next);
      if (next.guide) setDraft(next.guide);
      setState({ saving: false, error: null, savedAt: Date.now() });
    } else setState({ saving: false, error: r.reason, savedAt: null });
  };

  // forget what was saved: the guide goes back to the defaults
  const resetToDefaults = async () => {
    setState({ saving: true, error: null, savedAt: null });
    const r = await push(lobbyChannel(), "settings.put", { key: "guide", value: null });
    if (r.ok) {
      useStore.getState().setSettings((r.payload as { settings: Settings }).settings);
      setDraft(DEFAULT_GUIDE_SETTINGS);
      setState({ saving: false, error: null, savedAt: Date.now() });
    } else setState({ saving: false, error: r.reason, savedAt: null });
  };

  return (
    <SettingsPage
      title="Guide"
      description="The Guide tab in a thread's Changes has this agent group the diff into chunks, each with a short explanation. A small, fast model is plenty."
    >
      <SettingsSection title="Guide writer" description="Runs once per guide, read-only, on the thread's worktree. Nothing is added to your chats.">
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
        <p className="px-1 text-[12px] text-pretty text-muted-foreground">Turn off agents you don't use in Models. Until you save something here, guides are written by Claude's Sonnet.</p>
      </SettingsSection>

      <SettingsSection
        title="Instructions"
        description="How to group and describe the changes. Workbench adds the reply format, the changed files and as much of the diff as fits."
        aside={
          draft.prompt !== DEFAULT_GUIDE_PROMPT && (
            <Button size="compact" variant="ghost" onClick={() => set({ prompt: DEFAULT_GUIDE_PROMPT })}>
              Reset to default
            </Button>
          )
        }
      >
        <textarea
          value={draft.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          aria-label="Guide instructions"
          spellCheck={false}
          rows={10}
          className="w-full resize-y rounded-xl bg-surface-3 px-3 py-2.5 text-[13px] leading-relaxed shadow-surface-2 outline-none placeholder:text-muted-foreground focus-visible:shadow-surface-3"
        />
      </SettingsSection>

      <div className="flex items-center justify-end gap-3 px-1">
        {saved && (
          <Button size="compact" variant="ghost" disabled={state.saving} onClick={() => void resetToDefaults()} className="mr-auto">
            Use defaults
          </Button>
        )}
        {state.error && <span className="min-w-0 flex-1 text-[12px] text-destructive">{state.error}</span>}
        {!state.error && state.savedAt && <span className="text-[12px] text-muted-foreground">Saved</span>}
        <Button size="compact" disabled={!dirty || !valid || state.saving} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </SettingsPage>
  );
}
