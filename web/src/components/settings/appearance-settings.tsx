import { useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { spring } from "@/lib/springs";
import type { IconComponent } from "@/lib/icon-context";
import { SettingsList, SettingsPage, SettingsRow, SettingsSection } from "./settings-ui";

const THEMES: { id: Theme; label: string; description: string; icon: IconComponent }[] = [
  { id: "system", label: "System", description: "Follow your computer's light or dark setting", icon: Monitor },
  { id: "light", label: "Light", description: "Always light", icon: Sun },
  { id: "dark", label: "Dark", description: "Always dark", icon: Moon },
];

export function AppearanceSettings() {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const pick = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };

  return (
    <SettingsPage title="Appearance" description="How Workbench looks in this browser.">
      <SettingsSection title="Theme" description="Saved in this browser only.">
        <SettingsList role="radiogroup" aria-label="Theme">
          {THEMES.map((t, i) => (
            <SettingsRow
              key={t.id}
              index={i}
              role="radio"
              checked={theme === t.id}
              icon={t.icon}
              title={t.label}
              description={t.description}
              onClick={() => pick(t.id)}
              trailing={
                <span className="flex size-5 items-center justify-center">
                  <AnimatePresence initial={false}>
                    {theme === t.id && (
                      <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring.fast}>
                        <Check size={15} strokeWidth={2} className="text-[#6B97FF]" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              }
            />
          ))}
        </SettingsList>
      </SettingsSection>
    </SettingsPage>
  );
}
