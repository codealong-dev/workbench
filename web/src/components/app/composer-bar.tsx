import { forwardRef, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { ChevronDown } from "lucide-react";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { push } from "@/hooks/use-channels";
import { cn } from "@/lib/utils";
import type { ModelOption, Thread } from "@/contracts";
import { MODES } from "./modes";
import { UsageList, UsageMeter } from "./usage-meter";

// Model lists per provider, shared by every thread in this tab.
const cache = new Map<string, ModelOption[]>();

const EFFORT_LABEL: Record<string, string> = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", none: "None" };
const effortLabel = (e: string) => EFFORT_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);
const prettyId = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

const Trigger = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { muted?: boolean }>(function Trigger(
  { children, muted, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={cn(
        "flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[12px] outline-none transition-colors duration-80 hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] data-[state=open]:bg-hover",
        muted ? "text-muted-foreground hover:text-foreground" : "text-foreground",
        className,
      )}
    >
      {children}
      <ChevronDown className="size-3 opacity-50" />
    </button>
  );
});

/**
 * Under the composer: model, effort and permission mode, for any provider.
 * The model list is fetched the first time a picker opens (that may start the
 * agent process, but never a turn) and cached per provider.
 */
export function ComposerBar({ thread, channel }: { thread: Thread; channel: RefObject<Channel | null> }) {
  const [models, setModels] = useState<ModelOption[] | null>(() => cache.get(thread.provider) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (models || loading) return;
    setLoading(true);
    const r = await push(channel.current, "models");
    setLoading(false);
    if (r.ok) {
      const list = (r.payload as { models: ModelOption[] }).models;
      cache.set(thread.provider, list);
      setModels(list);
      setError(null);
    } else setError(r.reason);
  };

  const current = models?.find((m) => m.id === (thread.model ?? "default")) ?? (thread.model ? undefined : models?.find((m) => m.id === "default"));
  const modelName = current?.name ?? (thread.model ? prettyId(thread.model) : "Default model");
  const efforts = current?.efforts ?? [];
  const effort = thread.effort ?? current?.default_effort ?? null;
  const setModel = (model: string | null, eff: string | null) => void push(channel.current, "set_model", { model, effort: eff });
  const modeIndex = MODES.findIndex((m) => m.value === thread.mode);

  return (
    <div className="mt-1.5 flex items-center justify-between gap-2">
      <UsageMeter provider={thread.provider} />
      <div className="flex items-center gap-0.5">
        <DropdownMenu
          onOpenChange={(o) => {
            if (!o) return;
            void load();
            void push(channel.current, "usage", { refresh: true }); // the fresh numbers arrive as a `usage` push
          }}
        >
          <DropdownTrigger render={<Trigger title={current?.description}>{modelName}</Trigger>} />
          <DropdownContent className="w-[260px] min-w-0" align="end" sideOffset={4} checkedIndex={models?.findIndex((m) => m === current) ?? -1}>
            {models?.map((m, i) => (
              <MenuItem
                key={m.id}
                index={i}
                label={m.description ? `${m.name} · ${m.description}` : m.name}
                checked={m === current}
                onSelect={() => {
                  // keep the effort if the new model has it
                  const keep = thread.effort && m.efforts.some((e) => e.value === thread.effort) ? thread.effort : null;
                  setModel(m.id === "default" ? null : m.id, keep);
                }}
              />
            ))}
            {!models && <MenuItem index={0} label={error ? `Couldn't list models: ${error}` : "Loading models…"} disabled />}
            <UsageList provider={thread.provider} />
          </DropdownContent>
        </DropdownMenu>

        {(efforts.length > 0 || !models) && (
          <DropdownMenu onOpenChange={(o) => o && void load()}>
            <DropdownTrigger render={<Trigger muted title="Effort: how hard the model thinks">{effort ? effortLabel(effort) : "Effort"}</Trigger>} />
            <DropdownContent
              className="w-[200px] min-w-0"
              align="end"
              sideOffset={4}
              checkedIndex={thread.effort ? efforts.findIndex((e) => e.value === thread.effort) + 1 : 0}
            >
              <MenuItem index={0} label={current?.default_effort ? `Default (${effortLabel(current.default_effort)})` : "Default"} checked={!thread.effort} onSelect={() => setModel(thread.model ?? null, null)} />
              {efforts.map((e, i) => (
                <MenuItem key={e.value} index={i + 1} label={effortLabel(e.value)} checked={thread.effort === e.value} onSelect={() => setModel(thread.model ?? null, e.value)} />
              ))}
              {!models && <MenuItem index={1} label="Loading…" disabled />}
            </DropdownContent>
          </DropdownMenu>
        )}

        <span className="mx-1 h-3 w-px bg-border" aria-hidden />

        <DropdownMenu>
          <DropdownTrigger render={<Trigger muted title="Permissions">{MODES[modeIndex]?.label ?? thread.mode}</Trigger>} />
          <DropdownContent className="w-[200px] min-w-0" align="end" sideOffset={4} checkedIndex={modeIndex}>
            {MODES.map((m, i) => (
              <MenuItem key={m.value} index={i} label={m.label} checked={m.value === thread.mode} onSelect={() => void push(channel.current, "set_mode", { mode: m.value })} />
            ))}
          </DropdownContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
