import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Field } from "@/components/app/field";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { LABS, useEnabledLabs, type Lab } from "@/lib/labs";
import { useStore } from "@/store";
import { COMMIT_DEFAULT_MODELS, type Provider, type Settings } from "@/contracts";
import { useLabModels } from "./use-lab-models";
import { SettingsPage, SettingsSection } from "./settings-ui";

const DEFAULT = "__default";

/** The agents that write commit titles; the fake one has no model to pick. */
const WRITERS = LABS.filter((l) => COMMIT_DEFAULT_MODELS[l.id]);

function ModelPicker({ lab, onError }: { lab: Lab; onError: (error: string | null) => void }) {
  const chosen = useStore((s) => s.settings?.commit?.models[lab.id]);
  const { models, loading } = useLabModels(lab.id);
  const fallback = COMMIT_DEFAULT_MODELS[lab.id]!;
  const name = (id: string) => models?.find((m) => m.id === id)?.name ?? id;

  const save = async (provider: Provider, model: string | null) => {
    const kept = Object.fromEntries(Object.entries(useStore.getState().settings?.commit?.models ?? {}).filter(([p]) => p !== provider));
    const next = model ? { ...kept, [provider]: model } : kept;
    const r = await push(lobbyChannel(), "settings.put", { key: "commit", value: Object.keys(next).length ? { models: next } : null });
    if (r.ok) {
      useStore.getState().setSettings((r.payload as { settings: Settings }).settings);
      onError(null);
    } else onError(r.reason);
  };

  return (
    <Field label={`${lab.agent} · ${lab.lab}`} hint={loading ? "Loading…" : undefined}>
      <Select value={chosen ?? DEFAULT} onValueChange={(v) => void save(lab.id, v === DEFAULT ? null : v)} size="compact">
        <SelectTrigger />
        <SelectContent>
          <SelectItem index={0} value={DEFAULT}>
            Default ({name(fallback)})
          </SelectItem>
          {(models ?? [])
            .filter((m) => m.id !== "default")
            .map((m, i) => (
              <SelectItem key={m.id} index={i + 1} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          {chosen && models && !models.some((m) => m.id === chosen) && (
            <SelectItem index={models.length + 1} value={chosen}>
              {chosen}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function CommitSettingsPage() {
  const ready = useStore((s) => s.settings != null);
  const on = useEnabledLabs();
  const [error, setError] = useState<string | null>(null);
  if (!ready) return <SettingsPage title="Commit">{null}</SettingsPage>;

  return (
    <SettingsPage
      title="Commit"
      description="The sparkle button in the commit dialog has a model write the commit title from your changes. You can always edit it before committing."
    >
      <SettingsSection title="Title writer" description="The thread's own agent writes the title, with the small model you pick for it here.">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-3 p-3 shadow-surface-2">
          {WRITERS.filter((l) => on.some((o) => o.id === l.id)).map((lab) => (
            <ModelPicker key={lab.id} lab={lab} onError={setError} />
          ))}
        </div>
        {error && <p className="px-1 text-[12px] text-destructive">{error}</p>}
        <p className="px-1 text-[12px] text-pretty text-muted-foreground">
          Small, quick models are plenty for a one-line title. Turn off agents you don't use in Models.
        </p>
      </SettingsSection>
    </SettingsPage>
  );
}
