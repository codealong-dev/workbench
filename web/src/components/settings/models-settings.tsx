import { useEffect, useState } from "react";
import { AnimatePresence, Reorder, motion } from "framer-motion";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { LABS, type Lab } from "@/lib/labs";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { MAX_LOADOUT, type LabSettings, type ModelOption, type Provider, type Settings } from "@/contracts";
import { SettingsList, SettingsPage, SettingsRow, SettingsSection } from "./settings-ui";

const iconBtn =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-80 hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] disabled:pointer-events-none";

/** Save one lab's change; shown right away, rolled back if the server says no. */
async function saveLab(provider: Provider, change: Partial<LabSettings>): Promise<string | null> {
  const { settings, setSettings } = useStore.getState();
  if (settings) setSettings({ ...settings, labs: { ...settings.labs, [provider]: { ...settings.labs[provider], ...change } } });
  const r = await push(lobbyChannel(), "settings.put", { key: "labs", value: { [provider]: change } });
  if (r.ok) {
    setSettings((r.payload as { settings: Settings }).settings);
    return null;
  }
  if (settings) setSettings(settings);
  return r.reason;
}

export function ModelsSettings() {
  const labs = useStore((s) => s.settings?.labs);
  const [error, setError] = useState<string | null>(null);
  const save = async (provider: Provider, change: Partial<LabSettings>) => setError(await saveLab(provider, change));

  if (!labs) return <SettingsPage title="Models">{null}</SettingsPage>;
  const on = LABS.filter((l) => labs[l.id]?.enabled);

  return (
    <SettingsPage
      title="Models"
      description={`Pick the labs you work with, then up to ${MAX_LOADOUT} models from each. Your loadout is what the model picker under the chat offers.`}
    >
      <SettingsSection title="Labs" description="A lab that's off is hidden when you start a thread or a chat. Threads you already have keep working.">
        <SettingsList aria-label="Labs">
          {LABS.map((lab, i) => {
            const enabled = !!labs[lab.id]?.enabled;
            const toggle = () => void save(lab.id, { enabled: !enabled });
            return (
              <SettingsRow
                key={lab.id}
                index={i}
                icon={lab.icon}
                title={
                  <>
                    {lab.lab}
                    <span className="text-muted-foreground"> · {lab.agent}</span>
                  </>
                }
                description={lab.blurb}
                onClick={toggle}
                trailing={
                  // the row toggles too; don't let the switch's click toggle twice
                  <span onClick={(e) => e.stopPropagation()}>
                    <Switch label={`${lab.lab} on`} checked={enabled} onToggle={toggle} size="compact" className="px-0 [&>span:last-child]:sr-only" />
                  </span>
                }
              />
            );
          })}
        </SettingsList>
        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring.fast}
              className="px-1 text-[12px] text-destructive"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </SettingsSection>

      <AnimatePresence initial={false}>
        {on.map((lab) => (
          <motion.div
            key={lab.id}
            layout="position"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={spring.moderate}
          >
            <Loadout lab={lab} picked={labs[lab.id].models} onChange={(models) => save(lab.id, { models })} />
          </motion.div>
        ))}
      </AnimatePresence>
    </SettingsPage>
  );
}

// ── one lab's loadout ───────────────────────────────────────────────────────

function useLabModels(provider: Provider) {
  const models = useStore((s) => s.models[provider]) ?? null;
  const [loading, setLoading] = useState(!models);
  const [error, setError] = useState<string | null>(null);

  const fetch = async (refresh: boolean) => {
    if (refresh) {
      setLoading(true);
      setError(null);
    }
    // may start the agent just to ask: give it time
    const r = await push(lobbyChannel(), "models.list", { provider, refresh }, 30_000);
    setLoading(false);
    if (r.ok) useStore.getState().setModels(provider, (r.payload as { models: ModelOption[] }).models);
    else setError(r.reason);
  };

  useEffect(() => {
    if (!models) void fetch(false);
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  return { models, loading, error, refresh: () => fetch(true) };
}

function Loadout({ lab, picked, onChange }: { lab: Lab; picked: string[]; onChange: (models: string[]) => void }) {
  const { models, loading, error, refresh } = useLabModels(lab.id);
  const full = picked.length >= MAX_LOADOUT;
  const nameOf = (id: string) => models?.find((m) => m.id === id)?.name ?? id;
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-2">
          <lab.icon size={14} strokeWidth={1.5} className="text-muted-foreground" />
          {lab.lab}
          <span className="font-normal text-muted-foreground">{lab.agent}</span>
        </span>
      }
      description={
        picked.length === 0
          ? "No loadout yet: the picker shows every model. Pick up to three."
          : full
            ? "Loadout full. Remove one to swap it for another."
            : `${picked.length} of ${MAX_LOADOUT} picked. Drag to set their order in the picker.`
      }
      aside={
        <>
          {picked.length > 0 && (
            <Button size="compact" variant="ghost" onClick={() => onChange([])}>
              Clear
            </Button>
          )}
          <Tooltip content="List the models again" side="top">
            <button type="button" aria-label="Refresh models" className={iconBtn} disabled={loading} onClick={() => void refresh()}>
              <RefreshCw size={14} strokeWidth={1.5} className={cn(loading && "animate-spin")} />
            </button>
          </Tooltip>
        </>
      }
    >
      <Slots picked={picked} nameOf={nameOf} onChange={onChange} />

      {models && models.length > 0 ? (
        <SettingsList role="group" aria-label={`${lab.lab} models`}>
          {models.map((m, i) => {
            const slot = picked.indexOf(m.id);
            const blocked = slot === -1 && full;
            return (
              <SettingsRow
                key={m.id}
                index={i}
                role="checkbox"
                checked={slot !== -1}
                disabled={blocked}
                tooltip={blocked ? `Your ${lab.lab} loadout is full` : undefined}
                title={m.name}
                description={m.description || undefined}
                onClick={() => toggle(m.id)}
                trailing={<SlotMark n={slot} />}
              />
            );
          })}
        </SettingsList>
      ) : (
        <ModelsPlaceholder loading={loading} error={error} empty={models?.length === 0} onRetry={() => void refresh()} />
      )}
    </SettingsSection>
  );
}

/** The loadout as three slots, in picker order; drag a chip to reorder. */
function Slots({ picked, nameOf, onChange }: { picked: string[]; nameOf: (id: string) => string; onChange: (models: string[]) => void }) {
  // local while dragging (Reorder reports every step); saved on drop
  const [order, setOrder] = useState(picked);
  const key = picked.join("\u0000");
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    // the saved loadout changed (here or in another window)
    setSeen(key);
    setOrder(picked);
  }
  const commit = () => order.join("\u0000") !== key && onChange(order);

  return (
    <div className="flex gap-1.5">
      {/* every slot the same width: the group takes one share per chip */}
      <Reorder.Group as="div" axis="x" values={order} onReorder={setOrder} className="flex min-w-0 gap-1.5" style={{ flex: `${order.length} 1 0%` }}>
        {order.map((id, i) => (
          <Reorder.Item
            key={id}
            as="div"
            value={id}
            onDragEnd={commit}
            layout="position"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            whileDrag={{ scale: 1.04, zIndex: 1 }}
            transition={spring.fast}
            className="flex h-8 min-w-0 flex-1 cursor-grab items-center gap-1.5 rounded-lg bg-surface-3 pr-1 pl-2 text-[12px] shadow-surface-2 active:cursor-grabbing"
          >
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#6B97FF] text-[10px] font-medium text-white tabular-nums">{i + 1}</span>
            <span className="truncate">{nameOf(id)}</span>
            <button
              type="button"
              aria-label={`Remove ${nameOf(id)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onChange(picked.filter((x) => x !== id))}
              className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
            >
              <X size={12} strokeWidth={1.75} />
            </button>
          </Reorder.Item>
        ))}
      </Reorder.Group>
      {Array.from({ length: MAX_LOADOUT - order.length }, (_, i) => (
        <motion.div
          key={`empty-${order.length + i}`}
          layout="position"
          transition={spring.fast}
          className="flex h-8 min-w-0 flex-[1_1_0%] items-center gap-1.5 rounded-lg border border-dashed border-border px-2 text-[12px] text-muted-foreground"
        >
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-[10px] tabular-nums">{order.length + i + 1}</span>
          <span className="truncate">Empty slot</span>
        </motion.div>
      ))}
    </div>
  );
}

/** A picked row's slot number; an empty ring otherwise. */
function SlotMark({ n }: { n: number }) {
  return (
    <span className="relative flex size-5 shrink-0 items-center justify-center rounded-full border border-border">
      <AnimatePresence initial={false}>
        {n !== -1 && (
          <motion.span
            key={n}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={spring.fast}
            className="absolute -inset-px flex items-center justify-center rounded-full bg-[#6B97FF] text-[11px] font-medium text-white tabular-nums"
          >
            {n + 1}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function ModelsPlaceholder({ loading, error, empty, onRetry }: { loading: boolean; error: string | null; empty: boolean; onRetry: () => void }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-1 rounded-xl bg-surface-3 p-1 shadow-surface-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex min-h-11 items-center gap-3 px-3 py-2">
            <span className="flex-1 space-y-1.5">
              <span className="block h-2.5 w-28 animate-pulse rounded bg-hover" style={{ animationDelay: `${i * 120}ms` }} />
              <span className="block h-2 w-52 animate-pulse rounded bg-hover" style={{ animationDelay: `${i * 120 + 60}ms` }} />
            </span>
            <span className="size-5 rounded-full border border-border" />
          </div>
        ))}
        <p className="px-3 pb-1.5 text-[11px] text-muted-foreground">Asking the agent for its models…</p>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-3 px-4 py-3 text-[12px] shadow-surface-2">
      <span className={cn("min-w-0", error ? "text-destructive" : "text-muted-foreground")}>
        {error ? `Couldn't list the models: ${error}` : empty ? "The agent didn't offer any models." : "No models yet."}
      </span>
      <Button size="compact" variant="ghost" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
