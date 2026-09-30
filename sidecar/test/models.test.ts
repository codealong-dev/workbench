import { test } from "node:test";
import assert from "node:assert/strict";
import { toModels } from "../src/models.ts";

test("Claude model rows become the neutral shape", () => {
  const out = toModels([
    { value: "default", displayName: "Default (recommended)", description: "Sonnet 5.5 · Efficient for routine tasks", supportedEffortLevels: ["low", "high"] },
    { value: "opus", displayName: "Opus", description: "Opus 5.5 · Best for everyday, complex tasks", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "haiku", displayName: "Haiku", description: "Fast" },
  ] as never);
  assert.deepEqual(out[0], { id: "default", name: "Default", description: "Sonnet 5.5 · Efficient for routine tasks", efforts: [{ value: "low", description: "" }, { value: "high", description: "" }], default_effort: null });
  assert.equal(out[1].name, "Opus 5.5");
  assert.equal(out[1].description, "Best for everyday, complex tasks");
  assert.equal(out[1].efforts.length, 5);
  assert.deepEqual([out[2].name, out[2].efforts], ["Haiku", []]);
});
