import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { Check, Columns2, Monitor, Moon, Rows2, Sun } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { FileDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { diffMetrics, diffOptions } from "@/lib/diff-options";
import {
  CODE_FONTS,
  DEFAULT_CODE_PREFS,
  fontInstalled,
  setCodePrefs,
  updateDiffPrefs,
  updateEditorPrefs,
  useCodePrefs,
  type CodePrefs,
} from "@/lib/code-prefs";
import { getTheme, setTheme, useResolvedTheme, type Theme } from "@/lib/theme";
import { spring } from "@/lib/springs";
import type { IconComponent } from "@/lib/icon-context";
import { SettingsList, SettingsPage, SettingsRow, SettingsSection, Stepper } from "./settings-ui";

const EditorPreview = lazy(() => import("@/components/editor/editor-preview"));

const THEMES: { id: Theme; label: string; description: string; icon: IconComponent }[] = [
  { id: "system", label: "System", description: "Follow your computer's light or dark setting", icon: Monitor },
  { id: "light", label: "Light", description: "Always light", icon: Sun },
  { id: "dark", label: "Dark", description: "Always dark", icon: Moon },
];

type Option<T extends string> = { value: T; label: string };

const WHITESPACE: Option<CodePrefs["editor"]["renderWhitespace"]>[] = [
  { value: "none", label: "Hidden" },
  { value: "boundary", label: "Between words" },
  { value: "all", label: "All" },
];
const CURSOR: Option<CodePrefs["editor"]["cursorBlinking"]>[] = [
  { value: "blink", label: "Blink" },
  { value: "smooth", label: "Smooth" },
  { value: "phase", label: "Phase" },
  { value: "solid", label: "Solid" },
];
const TAB_SIZES: Option<string>[] = ["2", "4", "8"].map((v) => ({ value: v, label: `${v} spaces` }));
const INDICATORS: Option<CodePrefs["diff"]["indicators"]>[] = [
  { value: "bars", label: "Bars" },
  { value: "classic", label: "+ and −" },
  { value: "none", label: "None" },
];
const LINE_DIFF: Option<CodePrefs["diff"]["lineDiffType"]>[] = [
  { value: "word", label: "Words" },
  { value: "word-alt", label: "Words, joined" },
  { value: "char", label: "Characters" },
  { value: "none", label: "Off" },
];
const SEPARATORS: Option<CodePrefs["diff"]["hunkSeparators"]>[] = [
  { value: "line-info", label: "Lines hidden + expand" },
  { value: "line-info-basic", label: "Lines hidden" },
  { value: "metadata", label: "Hunk header" },
  { value: "simple", label: "Plain gap" },
];

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} size="compact">
      <SelectTrigger aria-label={label} className="w-44" />
      <SelectContent>
        {options.map((o, i) => (
          <SelectItem key={o.value} index={i} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A row that toggles: clicking anywhere on it flips the switch. */
function ToggleRow({ index, title, description, checked, onToggle }: { index: number; title: string; description?: string; checked: boolean; onToggle: () => void }) {
  return (
    <SettingsRow
      index={index}
      title={title}
      description={description}
      onClick={onToggle}
      trailing={
        // the row toggles too; don't let the switch's click toggle twice
        <span onClick={(e) => e.stopPropagation()}>
          <Switch label={title} checked={checked} onToggle={onToggle} size="compact" className="px-0 [&>span:last-child]:sr-only" />
        </span>
      }
    />
  );
}

function Preview({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-xl bg-surface-2 shadow-surface-2 ${className ?? ""}`}>{children}</div>;
}

function Reset({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button size="compact" variant="ghost" disabled={disabled} onClick={onClick}>
      Reset
    </Button>
  );
}

const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── diff preview ──────────────────────────────────────────────────────────────

const OLD = `export function total(items: Item[]) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}

export function label(n: number) {
  return "$" + n;
}
`;
const NEW = `export function total(items: Item[], tax = 0) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum * (1 + tax);
}

export function label(n: number) {
  return "$" + n;
}

export const formatTotal = (items: Item[]) => label(total(items));
`;
const SAMPLE_DIFF = parseDiffFromFile({ name: "src/cart.ts", contents: OLD }, { name: "src/cart.ts", contents: NEW });

function DiffPreview({ prefs }: { prefs: CodePrefs["diff"] }) {
  const themeType = useResolvedTheme();
  const [style, setStyle] = useState<"unified" | "split">("unified");
  const options = useMemo(() => diffOptions(prefs, style, themeType), [prefs, style, themeType]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end px-1">
        <Tabs value={style} onValueChange={(v) => setStyle(v as "unified")} size="compact">
          <TabsList>
            <TabItem value="unified" label="Unified" icon={Rows2} iconOnly />
            <TabItem value="split" label="Split" icon={Columns2} iconOnly />
          </TabsList>
        </Tabs>
      </div>
      <Preview className="wb-diff">
        <FileDiff fileDiff={SAMPLE_DIFF} options={options} metrics={diffMetrics(prefs.lineHeight)} />
      </Preview>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export function AppearanceSettings() {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const pick = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };
  const prefs = useCodePrefs();
  const { editor, diff } = prefs;
  // checked once: fonts don't come and go while the page is open
  const installed = useMemo(() => new Set(CODE_FONTS.filter((f) => fontInstalled(f.id)).map((f) => f.id)), []);
  const font = CODE_FONTS.find((f) => f.stack === prefs.fontFamily) ?? CODE_FONTS[0];

  return (
    <SettingsPage title="Appearance" description="How Workbench looks in this browser. Changes apply right away and are saved in this browser only.">
      <SettingsSection title="Theme">
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

      <SettingsSection title="Code font" description="Used by the editor, diffs, and code in chats.">
        <SettingsList>
          <SettingsRow
            index={0}
            title="Font"
            description={installed.has(font.id) ? undefined : `${font.label} isn't installed, so a fallback is showing.`}
            trailing={
              <Select value={font.id} onValueChange={(id) => setCodePrefs({ ...prefs, fontFamily: CODE_FONTS.find((f) => f.id === id)!.stack })} size="compact">
                <SelectTrigger aria-label="Code font" className="w-44" />
                <SelectContent>
                  {CODE_FONTS.map((f, i) => (
                    <SelectItem key={f.id} index={i} value={f.id} disabled={!installed.has(f.id) && f.id !== font.id}>
                      <span style={{ fontFamily: f.stack }}>{f.label}</span>
                      {!installed.has(f.id) && <span className="text-muted-foreground"> · not installed</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <ToggleRow index={1} title="Ligatures" description="Draw => and != as single glyphs, in fonts that have them." checked={prefs.ligatures} onToggle={() => setCodePrefs({ ...prefs, ligatures: !prefs.ligatures })} />
        </SettingsList>
      </SettingsSection>

      <SettingsSection
        title="Editor"
        description="Files opened in a panel, and their diffs against the base."
        aside={<Reset disabled={sameJSON(editor, DEFAULT_CODE_PREFS.editor)} onClick={() => setCodePrefs({ ...prefs, editor: DEFAULT_CODE_PREFS.editor })} />}
      >
        <Preview className="h-72">
          <Suspense fallback={<div className="p-4 text-[12px] text-muted-foreground">Loading…</div>}>
            <EditorPreview />
          </Suspense>
        </Preview>
        <SettingsList>
          <SettingsRow index={0} title="Font size" trailing={<Stepper label="Font size" value={editor.fontSize} min={9} max={24} step={0.5} unit="px" onChange={(fontSize) => updateEditorPrefs({ fontSize })} />} />
          <SettingsRow index={1} title="Line height" trailing={<Stepper label="Line height" value={editor.lineHeight} min={12} max={40} unit="px" onChange={(lineHeight) => updateEditorPrefs({ lineHeight })} />} />
          <SettingsRow index={2} title="Tab size" trailing={<Choice label="Tab size" value={String(editor.tabSize)} options={TAB_SIZES} onChange={(v) => updateEditorPrefs({ tabSize: Number(v) })} />} />
          <SettingsRow index={3} title="Whitespace" description="Show spaces and tabs as dots and arrows." trailing={<Choice label="Whitespace" value={editor.renderWhitespace} options={WHITESPACE} onChange={(renderWhitespace) => updateEditorPrefs({ renderWhitespace })} />} />
          <SettingsRow index={4} title="Cursor" trailing={<Choice label="Cursor" value={editor.cursorBlinking} options={CURSOR} onChange={(cursorBlinking) => updateEditorPrefs({ cursorBlinking })} />} />
          <ToggleRow index={5} title="Word wrap" checked={editor.wordWrap} onToggle={() => updateEditorPrefs({ wordWrap: !editor.wordWrap })} />
          <ToggleRow index={6} title="Line numbers" checked={editor.lineNumbers} onToggle={() => updateEditorPrefs({ lineNumbers: !editor.lineNumbers })} />
          <ToggleRow index={7} title="Minimap" checked={editor.minimap} onToggle={() => updateEditorPrefs({ minimap: !editor.minimap })} />
          <ToggleRow index={8} title="Sticky scroll" description="Keep the enclosing function or block pinned at the top." checked={editor.stickyScroll} onToggle={() => updateEditorPrefs({ stickyScroll: !editor.stickyScroll })} />
          <ToggleRow index={9} title="Bracket pair colors" checked={editor.bracketPairs} onToggle={() => updateEditorPrefs({ bracketPairs: !editor.bracketPairs })} />
        </SettingsList>
      </SettingsSection>

      <SettingsSection
        title="Diffs"
        description="A thread's Changes and Guide."
        aside={<Reset disabled={sameJSON(diff, DEFAULT_CODE_PREFS.diff)} onClick={() => setCodePrefs({ ...prefs, diff: DEFAULT_CODE_PREFS.diff })} />}
      >
        <DiffPreview prefs={diff} />
        <SettingsList>
          <SettingsRow index={0} title="Font size" trailing={<Stepper label="Font size" value={diff.fontSize} min={9} max={24} step={0.5} unit="px" onChange={(fontSize) => updateDiffPrefs({ fontSize })} />} />
          <SettingsRow index={1} title="Line height" trailing={<Stepper label="Line height" value={diff.lineHeight} min={12} max={40} unit="px" onChange={(lineHeight) => updateDiffPrefs({ lineHeight })} />} />
          <SettingsRow index={2} title="Change markers" description="How added and removed lines are marked in the gutter." trailing={<Choice label="Change markers" value={diff.indicators} options={INDICATORS} onChange={(indicators) => updateDiffPrefs({ indicators })} />} />
          <SettingsRow index={3} title="Inline highlight" description="What changed within a modified line." trailing={<Choice label="Inline highlight" value={diff.lineDiffType} options={LINE_DIFF} onChange={(lineDiffType) => updateDiffPrefs({ lineDiffType })} />} />
          <SettingsRow index={4} title="Collapsed lines" description="What stands in for the unchanged lines between hunks." trailing={<Choice label="Collapsed lines" value={diff.hunkSeparators} options={SEPARATORS} onChange={(hunkSeparators) => updateDiffPrefs({ hunkSeparators })} />} />
          <ToggleRow index={5} title="Wrap long lines" description="Off: scroll sideways instead." checked={diff.wrap} onToggle={() => updateDiffPrefs({ wrap: !diff.wrap })} />
          <ToggleRow index={6} title="Line numbers" checked={diff.lineNumbers} onToggle={() => updateDiffPrefs({ lineNumbers: !diff.lineNumbers })} />
          <ToggleRow index={7} title="Line backgrounds" description="Tint added and removed lines green and red." checked={diff.background} onToggle={() => updateDiffPrefs({ background: !diff.background })} />
        </SettingsList>
      </SettingsSection>
    </SettingsPage>
  );
}
