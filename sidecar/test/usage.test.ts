import { test } from "node:test";
import assert from "node:assert/strict";
import { toUsage } from "../src/usage.ts";

const base = { session: {}, subscription_type: "max", rate_limits_available: true };

test("plan windows become the neutral shape, per-model rows last", () => {
  const out = toUsage({
    ...base,
    rate_limits: {
      five_hour: { utilization: 42, resets_at: "2026-09-30T18:00:00Z" },
      seven_day: { utilization: 130, resets_at: "2026-10-04T00:00:00Z" },
      seven_day_opus: null,
      seven_day_oauth_apps: { utilization: 5, resets_at: null },
      seven_day_sonnet: { utilization: null, resets_at: null },
      model_scoped: [{ display_name: "Fable", utilization: 7, resets_at: "2026-10-04T00:00:00Z" }],
    },
  } as never);
  assert.deepEqual(out, {
    plan: "max",
    windows: [
      { id: "five_hour", label: "Session (5h)", used_pct: 42, resets_at: "2026-09-30T18:00:00Z" },
      { id: "seven_day", label: "Weekly", used_pct: 100, resets_at: "2026-10-04T00:00:00Z" },
      { id: "model:Fable", label: "Weekly · Fable", used_pct: 7, resets_at: "2026-10-04T00:00:00Z" },
    ],
    credits: null,
  });
});

test("usage credits are kept even when an account has no plan limit windows", () => {
  const out = toUsage({
    ...base,
    rate_limits_available: false,
    rate_limits: {
      extra_usage: { is_enabled: true, monthly_limit: 75000, used_credits: 8263, utilization: 11, currency: "USD" },
    },
  } as never);
  assert.deepEqual(out, {
    plan: "max",
    windows: [],
    credits: { used: 82.63, limit: 750, currency: "USD" },
  });
});

test("credit amounts follow the currency's minor-unit precision", () => {
  const out = toUsage({
    ...base,
    rate_limits_available: false,
    rate_limits: {
      extra_usage: { is_enabled: true, monthly_limit: 3000, used_credits: 1234, utilization: 41.13, currency: "JPY" },
    },
  } as never);
  assert.deepEqual(out?.credits, { used: 1234, limit: 3000, currency: "JPY" });
});

test("disabled or absent usage credits are not reported", () => {
  const disabled = toUsage({
    ...base,
    rate_limits: { extra_usage: { is_enabled: false, monthly_limit: 750, used_credits: 6.94, utilization: 0.93, currency: "USD" } },
  } as never);
  assert.deepEqual(disabled, { plan: "max", windows: [], credits: null });
});

test("no plan limits (API key, Bedrock, Vertex) means no usage", () => {
  assert.equal(toUsage({ ...base, rate_limits_available: false, rate_limits: null } as never), null);
  assert.equal(toUsage({ ...base, rate_limits: null } as never), null);
});
