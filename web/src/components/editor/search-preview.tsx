import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { monaco, themeFor } from "@/lib/monaco";
import { useResolvedTheme } from "@/lib/theme";
import type { SearchMatch } from "@/contracts";

type Model = monaco.editor.ITextModel;

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: 'Menlo, "SF Mono", SFMono-Regular, ui-monospace, Consolas, monospace',
  fontSize: 12,
  lineHeight: 19,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  readOnly: true,
  domReadOnly: true,
  renderLineHighlight: "none",
  padding: { top: 8 },
  stickyScroll: { enabled: true },
  overviewRulerLanes: 1,
  contextmenu: false,
};

/** A read-only look at a file, scrolled to `line`, with the search's matches marked. Models live as long as the preview. */
export default function SearchPreview({ path, text, line, matches }: { path: string; text: string; line?: number; matches: SearchMatch[] }) {
  const mode = useResolvedTheme();
  const [ed, setEd] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, Model>());

  useEffect(() => {
    const all = models.current;
    return () => {
      all.forEach((m) => m.dispose());
      all.clear();
    };
  }, []);

  // its own scheme: an open editor's model for the same file is left alone
  useEffect(() => {
    if (!ed) return;
    let model = models.current.get(path);
    if (!model) {
      const uri = monaco.Uri.from({ scheme: "wb-preview", path: `/${path}` });
      model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, undefined, uri);
      models.current.set(path, model);
    }
    if (model.getValue() !== text) model.setValue(text);
    if (ed.getModel() !== model) ed.setModel(model);
  }, [ed, path, text]);

  useEffect(() => {
    const model = ed?.getModel();
    if (!ed || !model) return;
    const last = model.getLineCount();
    const marks: monaco.editor.IModelDeltaDecoration[] = [];
    for (const m of matches) {
      if (m.line > last) continue;
      // a cut line's ranges count from the cut; its first match is at `col`
      const spans = m.cut_left ? m.ranges.slice(0, 1).map(([s, e]) => [m.col, m.col + e - s]) : m.ranges.map(([s, e]) => [s + 1, e + 1]);
      for (const [s, e] of spans) marks.push({ range: new monaco.Range(m.line, s, m.line, e), options: { inlineClassName: "wb-find-match", overviewRuler: { color: "#d9a40699", position: monaco.editor.OverviewRulerLane.Center } } });
    }
    if (line && line <= last) {
      marks.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "wb-find-line" } });
      ed.revealLineInCenter(line, monaco.editor.ScrollType.Immediate);
    }
    const decorations = ed.createDecorationsCollection(marks);
    return () => decorations.clear();
  }, [ed, path, text, line, matches]);

  return <Editor theme={themeFor(mode)} keepCurrentModel options={OPTIONS} onMount={setEd} />;
}
