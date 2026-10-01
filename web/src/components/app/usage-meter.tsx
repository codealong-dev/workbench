import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useStore } from "@/store";
import type { UsageWindow } from "@/contracts";

const left = (w: UsageWindow) => Math.max(0, Math.round(100 - w.used_pct));

function resetsIn(iso: string | null) {
  const ms = iso ? Date.parse(iso) - Date.now() : NaN;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "resetting";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

const tone = (pct: number) => (pct <= 10 ? "text-destructive" : pct <= 25 ? "text-amber-500" : "text-muted-foreground");

/** The provider's plan usage, or null while unknown or when it has no limits (API key, Codex). */
function usePlanUsage(provider: string) {
  return useStore((s) => s.usage[provider]) ?? null;
}

const R = 6;
const C = 2 * Math.PI * R;

/** Left of the composer bar: a ring for the limit closest to running out; hover for every window. */
export function UsageMeter({ provider }: { provider: string }) {
  const usage = usePlanUsage(provider);
  if (!usage || usage.windows.length === 0) return <span />;

  const tightest = usage.windows.reduce((a, w) => (w.used_pct > a.used_pct ? w : a));
  const pct = left(tightest);

  return (
    <Tooltip
      side="top"
      content={
        <div className="flex flex-col gap-1 whitespace-nowrap tabular-nums">
          {usage.windows.map((w) => {
            const r = resetsIn(w.resets_at);
            return (
              <div key={w.id} className="flex justify-between gap-4">
                <span>{w.label}</span>
                <span className="opacity-70">
                  {left(w)}% left{r ? ` · resets in ${r}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      }
    >
      <span
        tabIndex={0}
        role="img"
        aria-label={`${tightest.label}: ${pct}% left`}
        className={cn("ml-1 flex size-6 items-center justify-center rounded-md outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]", tone(pct))}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="-rotate-90">
          <circle cx="8" cy="8" r={R} fill="none" strokeWidth="2" className="stroke-current opacity-25" />
          <circle
            cx="8"
            cy="8"
            r={R}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            className="stroke-current transition-[stroke-dashoffset] duration-300"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - tightest.used_pct / 100)}
          />
        </svg>
      </span>
    </Tooltip>
  );
}
