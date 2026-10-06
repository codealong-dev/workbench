import { DEFAULT_VIRTUAL_FILE_METRICS, type FileDiffOptions } from "@pierre/diffs";
import type { CodePrefs } from "./code-prefs";

/** The diff renderer's options for the user's diff settings (Settings › Appearance). */
export function diffOptions(prefs: CodePrefs["diff"], diffStyle: "split" | "unified", themeType: "light" | "dark"): FileDiffOptions<undefined, undefined> {
  return {
    diffStyle,
    theme: { light: "light-plus", dark: "dark-plus" },
    themeType,
    overflow: prefs.wrap ? "wrap" : "scroll",
    lineDiffType: prefs.lineDiffType,
    hunkSeparators: prefs.hunkSeparators,
    diffIndicators: prefs.indicators,
    disableLineNumbers: !prefs.lineNumbers,
    disableBackground: !prefs.background,
  };
}

/** Row height the virtualizer assumes before measuring, kept in step with the line height setting. */
const metricsCache = new Map<number, typeof DEFAULT_VIRTUAL_FILE_METRICS>();
export function diffMetrics(lineHeight: number) {
  let m = metricsCache.get(lineHeight);
  if (!m) metricsCache.set(lineHeight, (m = { ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight }));
  return m;
}
