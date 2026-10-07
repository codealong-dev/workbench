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
  const extra = limits?.extra_usage as (NonNullable<Limits["extra_usage"]> & { decimal_places?: number | null }) | null | undefined;
  const extraCurrency = extra?.currency ?? "USD";
  const reportedDecimals = extra?.decimal_places;
  const hasReportedDecimals = typeof reportedDecimals === "number" && Number.isInteger(reportedDecimals) && reportedDecimals >= 0 && reportedDecimals <= 6;
  let decimalPlaces = hasReportedDecimals ? reportedDecimals : 2;
  try {
    if (!hasReportedDecimals)
      decimalPlaces = new Intl.NumberFormat("en", { style: "currency", currency: extraCurrency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown provider currencies default to the common 2-digit minor unit.
  }
  const minorUnit = 10 ** decimalPlaces;
  const credits = extra?.is_enabled
    ? {
        used: extra.used_credits === null ? null : extra.used_credits / minorUnit,
        limit: extra.monthly_limit === null ? null : extra.monthly_limit / minorUnit,
        currency: extraCurrency,
      }
    : null;
  if ((!r.rate_limits_available || !limits) && !credits) return null;

  const rows: { id: string; label: string; utilization: number | null; resets_at: string | null }[] = [];
  for (const [key, id, label] of WINDOWS) {
    const w = limits?.[key] as { utilization: number | null; resets_at: string | null } | null | undefined;
    if (r.rate_limits_available && w) rows.push({ id, label, ...w });
  }
  for (const m of limits?.model_scoped ?? []) {
    rows.push({ id: `model:${m.display_name}`, label: `Weekly · ${m.display_name}`, utilization: m.utilization, resets_at: m.resets_at });
  }

  return {
    plan: r.subscription_type,
    windows: rows
        .filter((w) => w.utilization != null)
        .map((w) => ({ id: w.id, label: w.label, used_pct: Math.min(100, Math.max(0, w.utilization!)), resets_at: w.resets_at })),
    credits:
      credits && typeof credits.used === "number"
        ? { used: credits.used, limit: credits.limit, currency: credits.currency }
        : null,
  };
}
