import { AnimatePresence, motion } from "framer-motion";
import { InsetTrigger } from "@/components/app/sidebar";
import { PANEL } from "@/components/app/panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { CUSTOM_TITLEBAR } from "@/lib/mac-app";
import { sectionItem, type SectionId } from "./sections";
import { AppearanceSettings } from "./appearance-settings";
import { CommitSettingsPage } from "./commit-settings";
import { GuideSettingsPage } from "./guide-settings";
import { ModelsSettings } from "./models-settings";
import { ReviewSettingsPage } from "./review-settings";
import { ShortcutsSettings } from "./shortcuts-settings";

const PAGES: Record<SectionId, () => React.ReactNode> = {
  appearance: AppearanceSettings,
  models: ModelsSettings,
  review: ReviewSettingsPage,
  guide: GuideSettingsPage,
  commit: CommitSettingsPage,
  shortcuts: ShortcutsSettings,
};

export function SettingsView({ section }: { section: SectionId }) {
  const Page = PAGES[section];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!CUSTOM_TITLEBAR && (
        <header className="flex h-10 shrink-0 items-center gap-1.5 px-1 text-[13px]">
          <InsetTrigger />
          <span className="text-muted-foreground">Settings</span>
          <span className="text-muted-foreground/50">/</span>
          <span>{sectionItem(section).label}</span>
        </header>
      )}
      <div className={cn("min-h-0 flex-1", PANEL)}>
        <ScrollArea className="h-full">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            >
              <Page />
            </motion.div>
          </AnimatePresence>
        </ScrollArea>
      </div>
    </div>
  );
}
