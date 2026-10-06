import { useMemo, useSyncExternalStore } from "react";
import type { editor } from "monaco-editor";
import type { DiffIndicators, HunkSeparators, LineDiffTypes } from "@pierre/diffs";

// How code looks: the font every code view shares, Monaco's editor options,
// and the Changes diff's. Saved in this browser, like the theme. The font and
// the diff's size go on <html> as CSS variables (they inherit into the diffs'
// shadow DOM); Monaco takes its options from `useEditorOptions`.

export interface CodePrefs {
  /** A font stack; the first entry is the one picked. */
  fontFamily: string;
  ligatures: boolean;
  editor: {
    fontSize: number;
    lineHeight: number;
    tabSize: number;
    wordWrap: boolean;
    minimap: boolean;
    lineNumbers: boolean;
    stickyScroll: boolean;
    bracketPairs: boolean;
    renderWhitespace: "none" | "boundary" | "all";
    cursorBlinking: "blink" | "smooth" | "phase" | "solid";
  };
  diff: {
    fontSize: number;
    lineHeight: number;
    wrap: boolean;
    lineNumbers: boolean;
    background: boolean;
    indicators: DiffIndicators;
    lineDiffType: LineDiffTypes;
    hunkSeparators: Exclude<HunkSeparators, "custom">;
  };
}

const FALLBACK = 'ui-monospace, Consolas, monospace';

export const CODE_FONTS: { id: string; label: string; stack: string }[] = [
  { id: "Menlo", label: "Menlo", stack: `Menlo, "SF Mono", SFMono-Regular, ${FALLBACK}` },
  { id: "SF Mono", label: "SF Mono", stack: `"SF Mono", SFMono-Regular, Menlo, ${FALLBACK}` },
  { id: "Monaco", label: "Monaco", stack: `Monaco, Menlo, ${FALLBACK}` },
  { id: "JetBrains Mono", label: "JetBrains Mono", stack: `"JetBrains Mono", Menlo, ${FALLBACK}` },
  { id: "Fira Code", label: "Fira Code", stack: `"Fira Code", Menlo, ${FALLBACK}` },
  { id: "Cascadia Code", label: "Cascadia Code", stack: `"Cascadia Code", Menlo, ${FALLBACK}` },
  { id: "Source Code Pro", label: "Source Code Pro", stack: `"Source Code Pro", Menlo, ${FALLBACK}` },
  { id: "IBM Plex Mono", label: "IBM Plex Mono", stack: `"IBM Plex Mono", Menlo, ${FALLBACK}` },
  { id: "Geist Mono", label: "Geist Mono", stack: `"Geist Mono", Menlo, ${FALLBACK}` },
];

export const DEFAULT_CODE_PREFS: CodePrefs = {
  fontFamily: CODE_FONTS[0].stack,
  ligatures: false,
  editor: {
    fontSize: 12.5,
    lineHeight: 20,
    tabSize: 2,
    wordWrap: false,
    minimap: false,
    lineNumbers: true,
    stickyScroll: true,
    bracketPairs: false,
    renderWhitespace: "none",
    cursorBlinking: "blink",
  },
  diff: {
    fontSize: 13,
    lineHeight: 20,
    wrap: true,
    lineNumbers: true,
    background: true,
    indicators: "bars",
    lineDiffType: "word",
    hunkSeparators: "line-info",
  },
};

const KEY = "wb.codePrefs";

function load(): CodePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CodePrefs> | null;
    if (!raw) return DEFAULT_CODE_PREFS;
    // merge, so prefs saved before a field existed pick up its default
    return {
      ...DEFAULT_CODE_PREFS,
      ...raw,
      editor: { ...DEFAULT_CODE_PREFS.editor, ...raw.editor },
      diff: { ...DEFAULT_CODE_PREFS.diff, ...raw.diff },
    };
  } catch {
    return DEFAULT_CODE_PREFS;
  }
}

let prefs = load();
const listeners = new Set<() => void>();

export const getCodePrefs = () => prefs;

export function setCodePrefs(next: CodePrefs) {
  prefs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  applyCodePrefs();
  listeners.forEach((l) => l());
}

export const updateEditorPrefs = (patch: Partial<CodePrefs["editor"]>) => setCodePrefs({ ...prefs, editor: { ...prefs.editor, ...patch } });
export const updateDiffPrefs = (patch: Partial<CodePrefs["diff"]>) => setCodePrefs({ ...prefs, diff: { ...prefs.diff, ...patch } });

/** The CSS side: the code font everywhere, and the diff's size. */
export function applyCodePrefs() {
  const s = document.documentElement.style;
  s.setProperty("--font-code", prefs.fontFamily);
  s.setProperty("--diffs-font-features", prefs.ligatures ? '"liga" 1, "calt" 1' : '"liga" 0, "calt" 0');
  s.setProperty("--diffs-font-size", `${prefs.diff.fontSize}px`);
  s.setProperty("--diffs-line-height", `${prefs.diff.lineHeight}px`);
}

export function subscribeCodePrefs(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function useCodePrefs(): CodePrefs {
  return useSyncExternalStore(subscribeCodePrefs, getCodePrefs);
}

/** Monaco's options for the user's editor settings, with `overrides` (a view's own needs) on top. */
export function useEditorOptions<T extends editor.IEditorOptions>(overrides: T): T {
  const p = useCodePrefs();
  return useMemo(
    () => ({
      fontFamily: p.fontFamily,
      fontLigatures: p.ligatures,
      fontSize: p.editor.fontSize,
      lineHeight: p.editor.lineHeight,
      tabSize: p.editor.tabSize,
      wordWrap: p.editor.wordWrap ? "on" : "off",
      minimap: { enabled: p.editor.minimap },
      lineNumbers: p.editor.lineNumbers ? "on" : "off",
      stickyScroll: { enabled: p.editor.stickyScroll },
      bracketPairColorization: { enabled: p.editor.bracketPairs },
      renderWhitespace: p.editor.renderWhitespace,
      cursorBlinking: p.editor.cursorBlinking,
      ...overrides,
    }),
    [p, overrides],
  );
}

/** Whether a font is installed: text in it measures differently from the bare fallbacks. */
export function fontInstalled(name: string): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const sample = "mmmmmmmmmmlli10OO@#";
  return ["monospace", "serif"].some((base) => {
    ctx.font = `72px ${base}`;
    const w = ctx.measureText(sample).width;
    ctx.font = `72px "${name}", ${base}`;
    return ctx.measureText(sample).width !== w;
  });
}
