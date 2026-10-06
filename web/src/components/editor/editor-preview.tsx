import Editor from "@monaco-editor/react";
import { monaco, themeFor } from "@/lib/monaco";
import { useEditorOptions } from "@/lib/code-prefs";
import { useResolvedTheme } from "@/lib/theme";

// Settings › Appearance: a scratch editor that shows the editor settings as
// they change. Editable, never saved.

const SAMPLE = `import { useEffect, useState } from "react";

// Poll a thread until its agent settles => then stop.
export function useThreadStatus(id: string, every = 1000) {
  const [status, setStatus] = useState<"idle" | "running">("idle");
  useEffect(() => {
\tconst timer = setInterval(async () => {
\t\tconst r = await fetch(\`/api/threads/\${id}\`);
\t\tif (r.ok) setStatus((await r.json()).status);
\t}, every);
\treturn () => clearInterval(timer);
  }, [id, every]);
  return status !== "idle" && status === "running" ? "Working…" : "Idle";
}
`;

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 8 },
  fixedOverflowWidgets: true,
  overviewRulerLanes: 0,
  contextmenu: false,
  ariaLabel: "Editor preview",
};

export default function EditorPreview() {
  const mode = useResolvedTheme();
  const options = useEditorOptions(OPTIONS);
  return <Editor theme={themeFor(mode)} path="file:///__workbench_preview__/use-thread-status.ts" defaultLanguage="typescript" defaultValue={SAMPLE} options={options} />;
}
