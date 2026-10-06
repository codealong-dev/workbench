// Monaco, bundled (no CDN: Workbench runs offline and on a LAN) with its
// workers, and themes that sit on the app's own surfaces. Imported lazily by
// the editor buffers only.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import { getCodePrefs, subscribeCodePrefs } from "./code-prefs";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

// The agent's worktree isn't a TS project Monaco knows: don't flag
// unresolved imports as errors.
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });

// Monaco caches glyph widths per font: measure again once a newly picked one has loaded.
let font = getCodePrefs().fontFamily;
subscribeCodePrefs(() => {
  if (getCodePrefs().fontFamily === font) return;
  font = getCodePrefs().fontFamily;
  void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
});

function surface(): string {
  const probe = document.createElement("div");
  probe.style.background = "var(--surface-2)";
  document.body.append(probe);
  const bg = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const m = bg.match(/\d+(\.\d+)?/g);
  if (!m) return "#ffffff";
  const [r, g, b] = m.map(Number);
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** VS Code Light+ / Dark+ on the app's surface colour. */
export function themeFor(mode: "light" | "dark"): string {
  const name = `wb-${mode}`;
  monaco.editor.defineTheme(name, {
    base: mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: { "editor.background": surface(), "editorGutter.background": surface(), "diffEditor.border": "#00000000" },
  });
  return name;
}

export { monaco };
