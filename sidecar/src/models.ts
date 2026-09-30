import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";

// Claude's model rows in Workbench's provider-neutral shape (see
// Workbench.Models). "Opus 5.5 · Best for everyday, complex tasks" becomes
// name "Opus 5.5", description "Best for everyday, complex tasks".
export function toModels(ms: ModelInfo[]) {
  return ms.map((m) => {
    const [head, ...rest] = (m.description ?? "").split(" · ");
    const split = rest.length > 0;
    const isDefault = m.value === "default";
    return {
      id: m.value,
      name: isDefault ? "Default" : split ? head : m.displayName,
      description: isDefault ? m.description : split ? rest.join(" · ") : m.description,
      efforts: (m.supportedEffortLevels ?? []).map((e) => ({ value: e, description: "" })),
      default_effort: null,
    };
  });
}
