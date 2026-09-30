import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { DiffEditor as MonacoDiff } from "@monaco-editor/react";
import { Columns2, ExternalLink, Rows2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { push } from "@/hooks/use-channels";
import { fetchFile } from "@/hooks/use-files";
import { editorKey, useEditors, type Saved } from "@/lib/editor-state";
import { monaco, themeFor } from "@/lib/monaco";
import { useResolvedTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { preferredEditor } from "@/components/app/open-menu";
import { useWorkspace } from "@/components/workspace/buffers";

type Model = monaco.editor.ITextModel;

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12.5,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderLineHighlight: "line",
  smoothScrolling: true,
  padding: { top: 8 },
  fixedOverflowWidgets: true,
  stickyScroll: { enabled: true },
};

const fileUri = (root: string, path: string) => monaco.Uri.from({ scheme: "file", path: `/${root}/${path}` });
const baseUri = (root: string, path: string) => monaco.Uri.from({ scheme: "wb-base", path: `/${root}/${path}` });

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
function useFileModel(path: string) {
  const ws = useWorkspace();
  const key = editorKey(ws.rootId, path);
  const { saved, dirty, conflict, setSaved, setDirty, setConflict } = useEditors();
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "binary" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchFile(ws.channel.current, path);
    const uri = fileUri(ws.rootId, path);
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
      m = monaco.editor.createModel(content, undefined, uri);
      st.setSaved(key, { content, hash: f.hash ?? null });
    } else if (!st.dirty[key]) {
      replaceText(m, content);
      st.setSaved(key, { content, hash: f.hash ?? null });
      st.setDirty(key, false);
    } else if (st.saved[key]?.content !== content) {
      // edited here and changed there: let the user pick
      st.setConflict(key, { content, hash: f.hash ?? null });
    }
    setModel(m);
    setStatus("ready");
  }, [ws.channel, ws.rootId, path, key]);

  useEffect(() => {
    void load();
  }, [load]);

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
  useEffect(() => ws.onFilesChanged((paths) => paths.includes(path) && void load()), [ws, path, load]);

  const write = useCallback(
    async (baseHash: string | null) => {
      if (!model) return;
      const content = model.getValue();
      setSaving(true);
      const r = await push(ws.channel.current, "file.write", { path, content, base_hash: baseHash });
      setSaving(false);
      if (r.ok) {
        setSaved(key, { content, hash: (r.payload as { hash: string }).hash });
        setDirty(key, false);
        setConflict(key, null);
      } else if (r.reason === "conflict") {
        const p = r.payload as { content: string | null; hash: string | null };
        setConflict(key, { content: p.content ?? "", hash: p.hash });
      } else setError(r.reason);
    },
    [model, ws.channel, path, key, setSaved, setDirty, setConflict],
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

function ConflictBanner({ conflict, onReload, onOverwrite }: { conflict: Saved; onReload: () => void; onOverwrite: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-1.5 text-[12px]">
      <span className="min-w-0 flex-1">
        {conflict.hash ? "This file changed on disk (an agent or a terminal?) while you had unsaved edits." : "This file was deleted on disk."}
      </span>
      <Button size="compact" variant="secondary" onClick={onReload} disabled={!conflict.hash}>
        Use disk version
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

/** A worktree file, editable. */
export function FileEditor({ path }: { path: string }) {
  const ws = useWorkspace();
  const mode = useResolvedTheme();
  const f = useFileModel(path);
  const bindSave = useSaveKey(f.save);

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
            options={OPTIONS}
            onMount={(ed) => {
              ed.setModel(f.model);
              bindSave(ed);
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
  const [base, setBase] = useState<{ model: Model; label: string; exists: boolean } | null>(null);
  const [inline, setInline] = useState(() => localStorage.getItem("wb.diffInline") === "1");
  const [empty, setEmpty] = useState<Model | null>(null);

  useEffect(() => {
    let cancelled = false;
    void push(ws.channel.current, "file.base", { path, ...(from ? { from } : {}) }).then((r) => {
      if (cancelled || !r.ok) return;
      const b = r.payload as { content: string; exists: boolean; base: string };
      const uri = baseUri(ws.rootId, path);
      const m = monaco.editor.getModel(uri) ?? monaco.editor.createModel(b.content, undefined, uri);
      if (m.getValue() !== b.content) m.setValue(b.content);
      setBase({ model: m, label: b.base, exists: b.exists });
    });
    return () => {
      cancelled = true;
    };
  }, [ws.channel, ws.rootId, path, from, ws.version]);

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
              ...OPTIONS,
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
