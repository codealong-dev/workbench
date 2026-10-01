import { Boxes, Keyboard, Palette } from "lucide-react";
import type { IconComponent } from "@/lib/icon-context";

// Every settings page, grouped as the settings sidebar shows them. A new
// page is one entry here plus its component in settings-view.tsx.

export type SectionId = "appearance" | "models" | "shortcuts";

export interface SettingsItem {
  id: SectionId;
  label: string;
  icon: IconComponent;
  /** Extra words the sidebar search matches. */
  keywords: string;
}

export const SETTINGS_GROUPS: { title: string; items: SettingsItem[] }[] = [
  { title: "General", items: [{ id: "appearance", label: "Appearance", icon: Palette, keywords: "theme dark light system colors" }] },
  { title: "Agents", items: [{ id: "models", label: "Models", icon: Boxes, keywords: "labs loadout anthropic openai claude codex gpt picker" }] },
  { title: "Workspace", items: [{ id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard, keywords: "keys hotkeys bindings" }] },
];

export const DEFAULT_SECTION: SectionId = "models";

const ids = new Set(SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
export const isSection = (s: string | undefined): s is SectionId => !!s && ids.has(s as SectionId);
export const sectionItem = (id: SectionId) => SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.id === id)!;
