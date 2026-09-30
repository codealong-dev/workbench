import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";

type Limits = NonNullable<SDKControlGetUsageResponse["rate_limits"]>;

// Fixed windows in display order; per-model weekly windows follow.
const WINDOWS: [keyof Limits & string, string, string][] = [
  ["five_hour", "five_hour", "Session (5h)"],
  ["seven_day", "seven_day", "Weekly"],
  ["seven_day_opus", "seven_day_opus", "Weekly · Opus"],
  ["seven_day_sonnet", "seven_day_sonnet", "Weekly · Sonnet"],
];

// Claude plan limits in Workbench's provider-neutral shape (see
// Workbench.Usage). null when the plan has no limits to show (API key,
// Bedrock, Vertex).
export function toUsage(r: SDKControlGetUsageResponse) {
  const limits = r.rate_limits;
  if (!r.rate_limits_available || !limits) return null;

  const rows: { id: string; label: string; utilization: number | null; resets_at: string | null }[] = [];
  for (const [key, id, label] of WINDOWS) {
    const w = limits[key] as { utilization: number | null; resets_at: string | null } | null | undefined;
    if (w) rows.push({ id, label, ...w });
  }
  for (const m of limits.model_scoped ?? []) {
    rows.push({ id: `model:${m.display_name}`, label: `Weekly · ${m.display_name}`, utilization: m.utilization, resets_at: m.resets_at });
  }

  return {
    plan: r.subscription_type,
    windows: rows
      .filter((w) => w.utilization != null)
      .map((w) => ({ id: w.id, label: w.label, used_pct: Math.min(100, Math.max(0, w.utilization!)), resets_at: w.resets_at })),
  };
}
