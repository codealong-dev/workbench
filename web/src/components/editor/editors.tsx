import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { DiffEditor as MonacoDiff } from "@monaco-editor/react";
import { diffLines } from "diff";
import { Columns2, ExternalLink, Rows2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { push } from "@/hooks/use-channels";
import { fetchFile } from "@/hooks/use-files";
import { contextEditorKey, editorKey, useEditors, type Saved } from "@/lib/editor-state";
import { useStore } from "@/store";
import { monaco, themeFor } from "@/lib/monaco";
import { useEditorOptions } from "@/lib/code-prefs";
import { useResolvedTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { preferredEditor } from "@/components/app/open-menu";
import { useWorkspace, type Reveal } from "@/components/workspace/buffers";

type Model = monaco.editor.ITextModel;

// Font, size, wrapping and the like come from Settings › Appearance (useEditorOptions).
const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderLineHighlight: "line",
  smoothScrolling: true,
  padding: { top: 8 },
  fixedOverflowWidgets: true,
};
const CONTEXT_OPTIONS = { ...OPTIONS, wordWrap: "on", ariaLabel: "Initial context editor" } as const;

const fileUri = (root: string, path: string) => monaco.Uri.from({ scheme: "file", path: `/${root}/${path}` });
const baseUri = (root: string, path: string, from?: string) => monaco.Uri.from({ scheme: "wb-base", path: `/${root}/${path}`, query: from ?? "" });

/** Replace a model's text as one undoable edit, keeping cursors and scroll. */
function replaceText(model: Model, text: string) {
  if (model.getValue() === text) return;
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
}

/**
 * The editable model for a worktree file, shared by every tab showing it:
 * load, save (refused if the file changed meanwhile), reload when it changes
 * on disk (or flag a conflict when there are unsaved edits).
 */
function useFileModel(path: string, source: "file" | "context" = "file") {
  const ws = useWorkspace();
  const context = source === "context";
  const key = context ? contextEditorKey(ws.rootId) : editorKey(ws.rootId, path);
  const sharedContext = useStore((s) => context ? s.threads.find((t) => t.id === ws.rootId)?.initial_context : undefined);
  const { saved, dirty, conflict, setSaved, setDirty, setConflict } = useEditors();
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "binary" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = context
      ? await push(ws.channel.current, "context.get").then((r) => r.ok
        ? { ok: true as const, file: { ...(r.payload as { content: string; hash: string }), binary: false, truncated: false } }
        : { ok: false as const, error: r.reason })
      : await fetchFile(ws.channel.current, path);
    const uri = context ? monaco.Uri.from({ scheme: "wb-context", path: `/${ws.rootId}/initial-context.md` }) : fileUri(ws.rootId, path);
    if (!r.ok) {
      if (/does not exist/.test(r.error)) {
        setStatus("missing");
        return;
      }
      setError(r.error);
      setStatus("error");
      return;
    }
    const f = r.file;
    if (f.binary || f.truncated) {
      setStatus("binary");
      return;
    }
    const content = f.content ?? "";
    let m = monaco.editor.getModel(uri);
    const st = useEditors.getState();
    if (!m) {
      m = monaco.editor.createModel(content, context ? "markdown" : undefined, uri);
      st.setSaved(key, { content, hash: f.hash ?? null });
    } else if (!st.dirty[key] || m.getValue() === content) {
      replaceText(m, content);
      st.setSaved(key, { content, hash: f.hash ?? null });
      st.setDirty(key, false);
    } else if (st.saved[key]?.content !== content) {
      // edited here and changed there: let the user pick
      st.setConflict(key, { content, hash: f.hash ?? null });
    }
    setModel(m);
    setError(null);
    setStatus("ready");
  }, [ws.channel, ws.rootId, path, key, context]);

  useEffect(() => {
    void load();
  }, [load, sharedContext]);

  // track dirtiness against what's on disk
  useEffect(() => {
    if (!model) return;
    const d = model.onDidChangeContent(() => {
      const s = useEditors.getState().saved[key];
      setDirty(key, !!s && model.getValue() !== s.content);
    });
    return () => d.dispose();
  }, [model, key, setDirty]);

  // an agent, a terminal or another editor changed it
  useEffect(() => context ? undefined : ws.onFilesChanged((paths) => paths.includes(path) && void load()), [ws, path, load, context]);

  const write = useCallback(
    async (baseHash: string | null) => {
      if (!model || saving) return;
      const content = model.getValue();
      setSaving(true);
      const r = await push(ws.channel.current, context ? "context.write" : "file.write", { ...(context ? {} : { path }), content, base_hash: baseHash });
      setSaving(false);
      if (r.ok) {
        const savedContent = context ? (r.payload as { content: string }).content : content;
        if (model.getValue() === content) replaceText(model, savedContent);
        setSaved(key, { content: savedContent, hash: (r.payload as { hash: string }).hash });
        setDirty(key, model.getValue() !== savedContent);
        setConflict(key, null);
        setError(null);
      } else if (r.reason === "conflict") {
        const p = r.payload as { content: string | null; hash: string | null };
        setConflict(key, { content: p.content ?? "", hash: p.hash });
      } else setError(r.reason);
    },
    [model, saving, ws.channel, path, key, setSaved, setDirty, setConflict, context],
  );

  const save = useCallback(() => {
    const c = useEditors.getState().conflict[key];
    // a known conflict must be resolved from the banner first
    if (c) return;
    void write(useEditors.getState().saved[key]?.hash ?? null);
  }, [write, key]);

  const resolve = {
    /** take what's on disk, dropping local edits */
    reload: (c: Saved) => {
      if (model) replaceText(model, c.content);
      setSaved(key, c);
      setDirty(key, false);
      setConflict(key, null);
    },
    /** keep local edits and write them over the disk version */
    overwrite: (c: Saved) => {
      setConflict(key, null);
      void write(c.hash);
    },
  };

  return { status, error, model, saving, save, dirty: !!dirty[key], conflict: conflict[key] ?? null, saved: saved[key], resolve };
}

/** The file as it was at the thread's base (or `from`, for a rename), refetched when an agent finishes. */
function useBase(path: string, from?: string) {
  const ws = useWorkspace();
  const [base, setBase] = useState<{ model: Model; label: string; exists: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void push(ws.channel.current, "file.base", { path, ...(from ? { from } : {}) }).then((r) => {
      if (cancelled || !r.ok) return;
      const b = r.payload as { content: string; exists: boolean; base: string };
      const uri = baseUri(ws.rootId, path, from);
      const m = monaco.editor.getModel(uri) ?? monaco.editor.createModel(b.content, undefined, uri);
      if (m.getValue() !== b.content) m.setValue(b.content);
      setBase({ model: m, label: b.base, exists: b.exists });
    });
    return () => {
      cancelled = true;
    };
  }, [ws.channel, ws.rootId, path, from, ws.version]);

  return base;
}

type LineChange = { kind: "added" | "modified" | "deleted"; start: number; end: number };

/** Line ranges of `text` that differ from `base`, VS Code's way: an insertion is
 *  added, a replacement is modified, a removal marks the line above the gap. */
function lineChanges(base: string, text: string): LineChange[] {
  const out: LineChange[] = [];
  const parts = diffLines(base, text);
  let line = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const n = p.count ?? 0;
    if (!p.added && !p.removed) {
      line += n;
    } else if (p.removed && parts[i + 1]?.added) {
      const m = parts[++i].count ?? 0;
      out.push({ kind: "modified", start: line, end: line + m - 1 });
      line += m;
    } else if (p.added) {
      out.push({ kind: "added", start: line, end: line + n - 1 });
      line += n;
    } else {
      const at = Math.max(line - 1, 1);
      out.push({ kind: "deleted", start: at, end: at });
    }
  }
  return out;
}

const CHANGE_COLOR = { added: "#2ea04370", modified: "#0078d470", deleted: "#f8514970" };

/** Gutter bars (and overview-ruler marks) for the lines that differ from the base, kept live while editing. */
function useChangeGutter(ed: monaco.editor.IStandaloneCodeEditor | null, model: Model | null, base: Model | null) {
  useEffect(() => {
    if (!ed || !model || !base) return;
    const decorations = ed.createDecorationsCollection();
    const paint = () =>
      decorations.set(
        lineChanges(base.getValue(), model.getValue()).map((c) => ({
          range: new monaco.Range(c.start, 1, c.end, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: `wb-gutter-${c.kind}`,
            overviewRuler: { color: CHANGE_COLOR[c.kind], position: monaco.editor.OverviewRulerLane.Left },
          },
        })),
      );
    paint();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = model.onDidChangeContent(() => {
      clearTimeout(timer);
      timer = setTimeout(paint, 150);
    });
    const subBase = base.onDidChangeContent(paint);
    return () => {
      clearTimeout(timer);
      sub.dispose();
      subBase.dispose();
      decorations.clear();
    };
  }, [ed, model, base]);
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-[12px]">{children}</div>;
}

function PathLabel({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <span className="min-w-0 flex-1 truncate font-mono" title={path}>
      {slash >= 0 && <span className="text-muted-foreground">{path.slice(0, slash + 1)}</span>}
      {path.slice(slash + 1)}
    </span>
  );
}

function ConflictBanner({ conflict, onReload, onOverwrite, context = false }: { conflict: Saved; onReload: () => void; onOverwrite: () => void; context?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-1.5 text-[12px]">
      <span className="min-w-0 flex-1">
        {context ? "The context changed in another window while you had unsaved edits." : conflict.hash ? "This file changed on disk (an agent or a terminal?) while you had unsaved edits." : "This file was deleted on disk."}
      </span>
      <Button size="compact" variant="secondary" onClick={onReload} disabled={!conflict.hash}>
        {context ? "Use saved version" : "Use disk version"}
      </Button>
      <Button size="compact" variant="ghost" onClick={onOverwrite}>
        Keep mine and save
      </Button>
    </div>
  );
}

function useSaveKey(save: () => void) {
  const ref = useRef(save);
  ref.current = save;
  return (ed: monaco.editor.IStandaloneCodeEditor) => ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => ref.current());
}

/** The workspace's shared context page, saved in Workbench rather than the worktree. */
export function ContextEditor() {
  const mode = useResolvedTheme();
  const options = useEditorOptions(CONTEXT_OPTIONS);
  const f = useFileModel("initial-context.md", "context");
  const bindSave = useSaveKey(f.save);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Bar>
        <span className="min-w-0 flex-1 truncate">Initial context</span>
        {f.dirty && <span className="text-muted-foreground">Unsaved</span>}
        <button type="button" title="Save (⌘S)" aria-label="Save context" disabled={!f.dirty || f.saving} onClick={f.save} className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40">
          <Save className={cn("size-3.5", f.saving && "animate-pulse")} />
        </button>
      </Bar>
      {f.conflict && <ConflictBanner context conflict={f.conflict} onReload={() => f.resolve.reload(f.conflict!)} onOverwrite={() => f.resolve.overwrite(f.conflict!)} />}
      {f.error && <div role="alert" className="m-3 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{f.error}</div>}
      {f.status === "loading" && <div className="p-4 text-[12px] text-muted-foreground">Loading…</div>}
      {f.model && (
        <div className="min-h-0 flex-1">
          <Editor
            path={f.model.uri.toString()}
            theme={themeFor(mode)}
            keepCurrentModel
            options={options}
            onMount={(editor) => { editor.setModel(f.model); bindSave(editor); editor.focus(); }}
          />
        </div>
      )}
    </div>
  );
}

/** A worktree file, editable. */
export function FileEditor({ path, reveal }: { path: string; reveal?: Reveal }) {
  const ws = useWorkspace();
  const mode = useResolvedTheme();
  const options = useEditorOptions(OPTIONS);
  const f = useFileModel(path);
  const base = useBase(path);
  const bindSave = useSaveKey(f.save);
  const [ed, setEd] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  useChangeGutter(ed, f.model, base?.model ?? null);

  // scroll to the lines an agent pointed at, and select them
  useEffect(() => {
    if (!ed || !reveal || !f.model) return;
    const last = f.model.getLineCount();
    const start = Math.min(reveal.line, last);
    const end = Math.min(Math.max(reveal.end ?? start, start), last);
    ed.setSelection(new monaco.Selection(start, 1, end, f.model.getLineMaxColumn(end)));
    ed.revealLinesInCenter(start, end);
    ed.focus();
  }, [ed, reveal?.n, f.model]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Bar>
        <PathLabel path={path} />
        {f.dirty && <span className="text-muted-foreground">Unsaved</span>}
        <button type="button" title="Save (⌘S)" aria-label="Save" disabled={!f.dirty || f.saving} onClick={f.save} className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40">
          <Save className={cn("size-3.5", f.saving && "animate-pulse")} />
        </button>
        <button type="button" title="Open in editor" aria-label="Open in editor" onClick={() => void ws.openIn(preferredEditor(), path)} className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground">
          <ExternalLink className="size-3.5" />
        </button>
      </Bar>
      {f.conflict && <ConflictBanner conflict={f.conflict} onReload={() => f.resolve.reload(f.conflict!)} onOverwrite={() => f.resolve.overwrite(f.conflict!)} />}
      {f.error && <div className="m-3 rounded-lg bg-destructive-light px-3 py-2 text-[12px] text-destructive">{f.error}</div>}
      {f.status === "loading" && <div className="p-4 text-[12px] text-muted-foreground">Loading…</div>}
      {f.status === "missing" && <div className="p-4 text-[12px] text-muted-foreground">This file doesn't exist (anymore).</div>}
      {f.status === "binary" && <div className="p-4 text-[12px] text-muted-foreground">Binary or larger than 1 MB: open it in your editor.</div>}
      {f.status === "ready" && f.model && (
        <div className="min-h-0 flex-1">
          <Editor
            path={f.model.uri.toString()}
            theme={themeFor(mode)}
            keepCurrentModel
            options={options}
            onMount={(editor) => {
              editor.setModel(f.model);
              bindSave(editor);
              setEd(editor);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** One file's changes against the thread's base: base on the left, the file (editable) on the right. */
export function FileDiffEditor({ path, from }: { path: string; from?: string }) {
  const ws = useWorkspace();
  const mode = useResolvedTheme();
  const f = useFileModel(path);
  const bindSave = useSaveKey(f.save);
  const base = useBase(path, from);
  const [inline, setInline] = useState(() => localStorage.getItem("wb.diffInline") === "1");
  const options = useEditorOptions(OPTIONS);
  const [empty, setEmpty] = useState<Model | null>(null);

  // a deleted file: diff against nothing
  useEffect(() => {
    if (f.status !== "missing" || !base) return;
    const uri = monaco.Uri.from({ scheme: "wb-empty", path: `/${ws.rootId}/${path}` });
    setEmpty(monaco.editor.getModel(uri) ?? monaco.editor.createModel("", base.model.getLanguageId(), uri));
  }, [f.status, base, ws.rootId, path]);

  const modified = f.model ?? empty;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Bar>
        <PathLabel path={path} />
        {base && <span className="shrink-0 text-muted-foreground">{base.exists ? `vs ${base.label}` : "new file"}</span>}
        {f.dirty && <span className="text-muted-foreground">Unsaved</span>}
        <button
          type="button"
          title={inline ? "Side by side" : "Inline"}
          aria-label="Toggle inline diff"
          onClick={() => {
            setInline(!inline);
            localStorage.setItem("wb.diffInline", inline ? "0" : "1");
          }}
          className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          {inline ? <Columns2 className="size-3.5" /> : <Rows2 className="size-3.5" />}
        </button>
        <button type="button" title="Save (⌘S)" aria-label="Save" disabled={!f.dirty || f.saving} onClick={f.save} className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40">
          <Save className={cn("size-3.5", f.saving && "animate-pulse")} />
        </button>
        <button type="button" title="Open in editor" aria-label="Open in editor" onClick={() => void ws.openIn(preferredEditor(), path)} className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground">
          <ExternalLink className="size-3.5" />
        </button>
      </Bar>
      {f.conflict && <ConflictBanner conflict={f.conflict} onReload={() => f.resolve.reload(f.conflict!)} onOverwrite={() => f.resolve.overwrite(f.conflict!)} />}
      {f.status === "binary" && <div className="p-4 text-[12px] text-muted-foreground">Binary or larger than 1 MB: open it in your editor.</div>}
      {base && modified && f.status !== "binary" && (
        <div className="min-h-0 flex-1">
          <MonacoDiff
            original={base.model.getValue()}
            modified={modified.getValue()}
            originalModelPath={base.model.uri.toString()}
            modifiedModelPath={modified.uri.toString()}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            theme={themeFor(mode)}
            options={{
              ...options,
              renderSideBySide: !inline,
              useInlineViewWhenSpaceIsLimited: true,
              renderSideBySideInlineBreakpoint: 700,
              originalEditable: false,
              readOnly: f.status === "missing",
              renderOverviewRuler: false,
              hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6, revealLineCount: 20 },
            }}
            onMount={(ed) => {
              ed.setModel({ original: base.model, modified });
              bindSave(ed.getModifiedEditor());
            }}
          />
        </div>
      )}
    </div>
  );
}
