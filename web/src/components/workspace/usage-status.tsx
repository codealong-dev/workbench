import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useStore } from "@/store";
import { useEnabledLabs } from "@/lib/labs";
import { Elevated } from "@/lib/elevated";
import { cn } from "@/lib/utils";
import { remainingPct, resetsIn, tightestWindow, usageTone } from "@/lib/usage";
import { refreshPlanUsage } from "@/hooks/use-channels";
import type { UsageWindow } from "@/contracts";

function money(amount: number | null, currency: string) {
  if (amount === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function CreditMeter({ used, limit, currency }: { used: number | null; limit: number | null; currency: string }) {
  if (used === null || limit === null || limit <= 0) return null;
  const spent = Math.min(100, Math.max(0, (used / limit) * 100));
  const left = Math.round(100 - spent);
  return (
    <div className="space-y-1.5 tabular-nums">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Usage credits</span>
        <span className={usageTone(left)}>{money(used, currency)} / {money(limit, currency)}</span>
      </div>
      <span aria-hidden className={cn("block h-1 w-full overflow-hidden rounded-full bg-current/15", usageTone(left))}>
        <span className="block h-full rounded-full bg-current transition-[width] duration-300" style={{ width: `${left}%` }} />
      </span>
      <div className={cn("text-right text-[10px] tabular-nums", usageTone(left))}>{left}% left</div>
    </div>
  );
}

function Meter({ window, className }: { window: UsageWindow; className?: string }) {
  const pct = remainingPct(window);
  return (
    <span aria-hidden className={cn("h-1 w-7 overflow-hidden rounded-full bg-current/15", usageTone(pct), className)}>
      <span className="block h-full rounded-full bg-current transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** One small account meter per harness; click anywhere for every limit. */
export function UsageStatus({ connected }: { connected: boolean }) {
  const labs = useEnabledLabs().filter((l) => l.id !== "fake");
  const usage = useStore((s) => s.usage);
  const status = useStore((s) => s.usageStatus);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [open]);
  if (!labs.length) return null;

  const loading = labs.some((l) => status[l.id]?.loading);
  const label = labs.map((l) => {
    const reading = usage[l.id];
    const window = tightestWindow(reading?.windows ?? []);
    const creditsLeft = reading?.credits && reading.credits.used !== null && reading.credits.limit && reading.credits.limit > 0
      ? Math.round(100 - Math.min(100, Math.max(0, reading.credits.used / reading.credits.limit * 100)))
      : null;
    const left = window ? remainingPct(window) : creditsLeft;
    return `${l.agent}: ${left !== null ? `${left}% left` : status[l.id]?.error ? "usage unavailable" : "no usage data"}`;
  }).join(", ");

  return (
    <Popover.Root open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) setNow(Date.now());
    }}>
      <Popover.Trigger
        aria-label={`Account usage. ${label}`}
        title="Account usage"
        className="flex h-full shrink-0 items-center gap-3 rounded px-1.5 tabular-nums outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] data-[state=open]:bg-hover"
      >
        {labs.map((l) => {
          const reading = usage[l.id];
          const window = tightestWindow(reading?.windows ?? []);
          const credits = reading?.credits;
          const creditsLeft = credits && credits.used !== null && credits.limit !== null && credits.limit > 0
            ? Math.round(100 - Math.min(100, Math.max(0, credits.used / credits.limit * 100)))
            : null;
          const left = window ? remainingPct(window) : creditsLeft;
          return (
            <span key={l.id} className="flex items-center gap-1.5">
              <l.icon size={13} />
              {left !== null ? <>
                {window
                  ? <Meter window={window} className="hidden sm:block" />
                  : <span aria-hidden className={cn("hidden h-1 w-7 overflow-hidden rounded-full bg-current/15 sm:block", usageTone(left))}>
                      <span className="block h-full rounded-full bg-current transition-[width] duration-300" style={{ width: `${left}%` }} />
                    </span>}
                <span className={cn("text-[11px]", usageTone(left))}>{left}%</span>
              </> : status[l.id]?.error ? <AlertCircle aria-hidden className="size-3 text-amber-500" /> : <span className="text-[11px] opacity-50">—</span>}
            </span>
          );
        })}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={8} collisionPadding={8} aria-label="Account usage" className="z-50 outline-none">
          <Elevated offset={2} shadowLevel={3} className="w-80 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-border/60 text-[12px]">
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="font-medium text-foreground">Usage <span className="ml-1 font-normal text-muted-foreground">· all harnesses</span></span>
              <button
                type="button"
                aria-label="Refresh account usage"
                title={connected ? "Refresh account usage" : "Offline, reconnecting…"}
                disabled={!connected || loading}
                onClick={() => labs.forEach((l) => void refreshPlanUsage(l.id, true))}
                className="flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] disabled:opacity-40"
              >
                <RefreshCw aria-hidden className={cn("size-3.5", loading && "animate-spin")} />
              </button>
            </div>
            <div className="max-h-[min(420px,70vh)] overflow-y-auto">
              {labs.map((l) => {
                const reading = usage[l.id];
                const info = status[l.id];
                const minutes = info?.fetched_at ? Math.max(0, Math.floor((now - info.fetched_at) / 60_000)) : null;
                const stale = minutes !== null && minutes >= 5;
                return (
                  <section key={l.id} aria-label={`${l.agent} usage`} className="space-y-2.5 border-t border-border/50 px-3 py-3">
                    <div className="flex items-center gap-2">
                      <l.icon size={15} />
                      <span className="font-medium text-foreground">{l.agent}</span>
                      {reading?.plan && <span className="capitalize text-muted-foreground">{reading.plan}</span>}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {info?.loading ? "Updating…" : minutes !== null ? `${stale ? "Last read" : "Updated"} ${minutes < 1 ? "just now" : `${minutes}m ago`}` : ""}
                      </span>
                    </div>
                    {reading?.windows.map((w) => {
                      const reset = resetsIn(w.resets_at, now);
                      return (
                        <div key={w.id} className="space-y-1.5 tabular-nums">
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">{w.label}</span>
                            <span className={usageTone(remainingPct(w))}>{remainingPct(w)}% left</span>
                          </div>
                          <Meter window={w} className="w-full" />
                          {reset && <div title={w.resets_at ? new Date(w.resets_at).toLocaleString() : undefined} className="text-[10px] text-muted-foreground">{reset === "resetting" ? "Awaiting reset" : `Resets in ${reset}`}</div>}
                        </div>
                      );
                    })}
                    {reading?.credits && <CreditMeter {...reading.credits} />}
                    {info?.error && <p role="status" className="text-[11px] text-muted-foreground">{reading ? "Showing last known usage. " : "Usage unavailable. "}{info.error}</p>}
                    {!reading?.windows.length && !reading?.credits && !info?.error && <p className="text-[11px] text-muted-foreground">{info?.loading ? "Reading account usage…" : info?.fetched_at ? "No plan limits reported for this account." : "No usage data yet."}</p>}
                  </section>
                );
              })}
            </div>
            {!connected && <p role="status" className="border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">Offline · showing last known usage</p>}
          </Elevated>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
