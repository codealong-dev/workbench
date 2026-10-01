import { FlaskConical, Sparkle, SquareTerminal } from "lucide-react";
import type { IconComponent } from "@/lib/icon-context";
import { useStore } from "@/store";
import type { ModelOption, Provider } from "@/contracts";

/** A lab is the company behind a model family; each comes to Workbench through one agent. */
export interface Lab {
  id: Provider;
  lab: string;
  agent: string;
  blurb: string;
  icon: IconComponent;
}

export const LABS: Lab[] = [
  { id: "claude", lab: "Anthropic", agent: "Claude Code", blurb: "Claude models, through your Claude Code login", icon: Sparkle },
  { id: "codex", lab: "OpenAI", agent: "Codex", blurb: "GPT models, through the Codex CLI and `codex login`", icon: SquareTerminal },
  { id: "fake", lab: "Workbench", agent: "Fake", blurb: "No agent: canned replies, for working on the UI", icon: FlaskConical },
];

/** The labs that are on (all of them until the settings arrive). */
export function useEnabledLabs(): Lab[] {
  const labs = useStore((s) => s.settings?.labs);
  return LABS.filter((l) => labs?.[l.id]?.enabled ?? true);
}

const NONE: string[] = [];

/** The model ids picked for a lab's chat picker; empty means every model. */
export function useLoadout(provider: Provider): string[] {
  return useStore((s) => s.settings?.labs[provider]?.models) ?? NONE;
}

/**
 * The loadout's models, in loadout order. Every model when there is no
 * loadout, or when none of its models is offered any more.
 */
export function inLoadout(models: ModelOption[], loadout: string[]): ModelOption[] {
  const picked = loadout.flatMap((id) => models.find((m) => m.id === id) ?? []);
  return picked.length > 0 ? picked : models;
}
