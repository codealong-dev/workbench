import type { UsageWindow } from "@/contracts";

export const remainingPct = (w: UsageWindow) => Math.min(100, Math.max(0, Math.round(100 - w.used_pct)));
export const usageTone = (pct: number) => pct <= 10 ? "text-destructive" : pct <= 25 ? "text-amber-500" : "text-muted-foreground";

export function resetsIn(iso: string | null, now = Date.now()) {
  const ms = iso ? Date.parse(iso) - now : NaN;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "resetting";
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function tightestWindow(windows: UsageWindow[]) {
  return windows.reduce<UsageWindow | null>((a, w) => !a || w.used_pct > a.used_pct ? w : a, null);
}
