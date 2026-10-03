import { useMemo } from "react";
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  type CommandMenuItemData,
} from "@/components/ui/command-menu";
import { useEnabledLabs } from "@/lib/labs";
import type { Provider } from "@/contracts";

/** ⌘T: pick an agent, then the new thread dialog opens with it. Only the Mac
 *  app sees ⌘T; a browser tab keeps it for a new tab. */
export function AgentMenu({ onPick }: { onPick: (provider: Provider) => void }) {
  const labs = useEnabledLabs();
  const items = useMemo<CommandMenuItemData[]>(
    () => labs.map((l) => ({ value: l.id, label: l.agent, description: l.lab, action: `New ${l.agent} thread`, icon: l.icon, keywords: [l.id] })),
    [labs],
  );

  return (
    <CommandMenuDialog shortcut="mod+t" title="New thread" description="Choose the agent for a new thread.">
      <CommandMenu items={items} onSelect={(item) => onPick(item.value as Provider)}>
        <CommandMenuInput placeholder="New thread with…" />
        <CommandMenuList>
          <CommandMenuEmpty>No agent matches. Turn agents on in Settings.</CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}
