import { Kbd, SettingsList, SettingsPage, SettingsRow, SettingsSection } from "./settings-ui";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      ["New thread", "N"],
      ["New thread with a chosen agent, in the open thread's project (Mac app)", "⌘T"],
      ["Search threads", "⌘K"],
      ["Show or hide the sidebar", "["],
      ["Open or close settings", "⌘,"],
    ],
  },
  {
    title: "In a workspace",
    keys: [
      ["Show or hide the files and changes panel", "]"],
      ["Open a file", "⌘P"],
      ["Find in files, with a preview", "⌘⇧F"],
      ["Search file contents in the files panel", "⌥⌘F"],
      ["Split the current tab to the right", "⌘\\"],
      ["Close the current tab", "Ctrl W"],
      ["Save the file", "⌘S"],
      ["Next terminal (opens one if there's none)", "Ctrl `"],
      ["New terminal", "Ctrl ⇧ `"],
    ],
  },
];

export function ShortcutsSettings() {
  return (
    <SettingsPage title="Keyboard shortcuts" description="Keys that work outside a text field. Some are the browser's own when Workbench runs in a tab rather than as an app.">
      {GROUPS.map((g) => (
        <SettingsSection key={g.title} title={g.title}>
          <SettingsList>
            {g.keys.map(([label, key], i) => (
              <SettingsRow key={label} index={i} title={label} trailing={<Kbd>{key}</Kbd>} />
            ))}
          </SettingsList>
        </SettingsSection>
      ))}
    </SettingsPage>
  );
}
