import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { FileText, Paperclip, TextQuote, X } from "lucide-react";
import { withQuotes } from "@/lib/quotes";
import { InputMessage, type QueuedMessage } from "@/components/ui/input-message";
import { push, useThreadChannel } from "@/hooks/use-channels";
import { useStore } from "@/store";
import type { Answers, Decision } from "@/contracts";
import { Timeline } from "@/components/app/timeline";
import { ComposerBar } from "@/components/app/composer-bar";
import { ANY_FILE, encodeFile, encodeImage, isImage } from "@/components/app/images";
import { WorktreeReader } from "@/components/app/file-preview";
import { ArtifactsPanel } from "@/components/workspace/artifacts-panel";
import { ARTIFACT_DRAG, artifactsOf, type Artifact } from "@/lib/artifacts";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const AGENT_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  fake: "the fake agent",
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Drafts outlive the tab being hidden (hidden chat tabs unmount).
const drafts = new Map<string, string>();
const histories = new Map<string, string[]>();
const pendingQuotes = new Map<string, string[]>();
const pendingImages = new Map<string, File[]>();
// artifacts referenced in the next message, and whether the panel is open (folded by default)
type Ref = Pick<Artifact, "key" | "name" | "size" | "ref">;
const pendingRefs = new Map<string, Ref[]>();
const panelOpen = new Map<string, boolean>();

const MAX_IMAGES = 10;
const fingerprint = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;
const hasFiles = (e: { dataTransfer: DataTransfer | null }) => {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return types.includes("Files") || types.includes(ARTIFACT_DRAG);
};

// A file dropped where nothing takes it would make the browser open it in
// place of the app.
for (const type of ["dragover", "drop"] as const)
  window.addEventListener(type, (e) => {
    if (hasFiles(e)) e.preventDefault();
  });

/** One agent conversation: the timeline and the composer. */
export function ChatView({ threadId }: { threadId: string }) {
  const { channel, joinError } = useThreadChannel(threadId);
  const ts = useStore((s) => s.byId[threadId]);
  const [draft, setDraftState] = useState(() => drafts.get(threadId) ?? "");
  const setDraft = (v: string) => {
    drafts.set(threadId, v);
    setDraftState(v);
  };
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [history, setHistory] = useState<string[]>(() => histories.get(threadId) ?? []);
  const [sendError, setSendError] = useState<string | null>(null);
  // parts of answers you're replying to; they go out with the next message
  const [quotes, setQuotesState] = useState<string[]>(() => pendingQuotes.get(threadId) ?? []);
  const pendingRef = useRef(ts?.pending ?? []);
  pendingRef.current = ts?.pending ?? [];
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const setQuotes = (q: string[]) => {
    pendingQuotes.set(threadId, q);
    setQuotesState(q);
  };
  // images to send with the next message: dropped anywhere on the chat, pasted, or picked
  const [images, setImagesState] = useState<File[]>(() => pendingImages.get(threadId) ?? []);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const setImages = (next: File[]) => {
    if (next.length) pendingImages.set(threadId, next);
    else pendingImages.delete(threadId);
    setImagesState(next);
  };
  const [refs, setRefsState] = useState<Ref[]>(() => pendingRefs.get(threadId) ?? []);
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const setRefs = (next: Ref[]) => {
    if (next.length) pendingRefs.set(threadId, next);
    else pendingRefs.delete(threadId);
    setRefsState(next);
  };
  const addRef = (a: Ref) => {
    if (refsRef.current.some((r) => r.key === a.key)) return;
    setRefs([...refsRef.current, { key: a.key, name: a.name, size: a.size, ref: a.ref }].slice(0, MAX_IMAGES));
  };
  const [artifactsOpen, setArtifactsOpenState] = useState(() => panelOpen.get(threadId) ?? false);
  const setArtifactsOpen = (open: boolean) => {
    panelOpen.set(threadId, open);
    setArtifactsOpenState(open);
  };
  const items = ts?.items;
  const worktree = ts?.thread.worktree_path ?? "";
  const artifacts = useMemo(() => (items ? artifactsOf(items, worktree) : []), [items, worktree]);
  const readWorktree = useCallback(
    async (path: string) => {
      const r = await push(channel.current, "file", { path });
      const content = (r.ok ? (r.payload as { content?: string | null }).content : null) ?? null;
      if (content == null) throw new Error(r.ok ? "not a text file" : r.reason);
      return content;
    },
    [channel],
  );
  const [dropping, setDropping] = useState(false);
  const addImages = (files: File[]) => {
    const seen = new Set(imagesRef.current.map(fingerprint));
    const fresh = files.filter((f) => !seen.has(fingerprint(f)));
    setSendError(null);
    if (fresh.length) setImages([...imagesRef.current, ...fresh].slice(0, MAX_IMAGES));
  };
  const composer = useRef<HTMLDivElement>(null);
  const quote = (text: string) => {
    setQuotes([...quotesRef.current, text]);
    requestAnimationFrame(() => composer.current?.querySelector("textarea")?.focus());
  };

  // encoding and uploading images takes a moment; a second Enter meanwhile is ignored
  const sending = useRef(false);
  const send = useCallback(
    async (text: string, files: File[]) => {
      if ((!text.trim() && !files.length && !refsRef.current.length) || sending.current) return;
      setSendError(null);
      sending.current = true;
      const sentQuotes = quotesRef.current;
      const sentRefs = refsRef.current;
      let r;
      try {
        const [pictures, others] = [files.filter(isImage), files.filter((f) => !isImage(f))];
        const [pics, uploaded] = await Promise.all([Promise.all(pictures.map(encodeImage)), Promise.all(others.map(encodeFile))]);
        // files from the artifacts panel go by reference, not as bytes
        const attached = [...uploaded, ...sentRefs.map((r) => r.ref)];
        // uploads can take a while from another machine
        r = await push(channel.current, "send", { text: withQuotes(sentQuotes, text), images: pics, files: attached }, files.length ? 60_000 : undefined);
      } catch (e) {
        return setSendError((e as Error).message);
      } finally {
        sending.current = false;
      }
      if (r.ok) {
        drafts.delete(threadId);
        setDraftState("");
        // a queued message carries its own images; only clear the ones it sent
        const sent = new Set(files.map(fingerprint));
        const left = imagesRef.current.filter((f) => !sent.has(fingerprint(f)));
        if (left.length !== imagesRef.current.length) {
          if (left.length) pendingImages.set(threadId, left);
          else pendingImages.delete(threadId);
          setImagesState(left);
        }
        if (sentRefs.length) setRefs(refsRef.current.filter((r) => !sentRefs.some((s) => s.key === r.key)));
        if (sentQuotes.length) {
          pendingQuotes.delete(threadId);
          setQuotesState([]);
        }
        if (text.trim())
          setHistory((h) => {
            const next = [...h, text];
            histories.set(threadId, next);
            return next;
          });
      } else setSendError(r.reason === "busy" ? "Still working; your message was not sent." : r.reason);
    },
    [channel, threadId],
  );

  const decide = useCallback(
    async (request_id: string, decision: Decision, answers?: Answers) => {
      const plan = decision === "allow" && pendingRef.current.find((a) => a.request_id === request_id)?.tool === "ExitPlanMode";
      const r = await push(channel.current, "approve", {
        request_id,
        decision,
        ...(answers ? { answers } : {}),
      });
      // approving a plan leaves plan mode: keep the thread's mode in step with the agent
      if (plan && r.ok) await push(channel.current, "set_mode", { mode: "default" });
    },
    [channel],
  );

  if (joinError) return <div className="grid h-full place-items-center text-[13px] text-destructive">Could not open this chat: {joinError}</div>;
  if (!ts) return <div className="h-full" />;

  const { thread, status } = ts;
  const busy = status === "running" || status === "awaiting_approval";
  const agent = AGENT_NAMES[thread.provider] ?? "the agent";

  // Drop files anywhere on the chat. A drop on the composer is handled
  // there (it calls preventDefault), so it isn't added twice.
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
  };
  const onDrop = (e: DragEvent) => {
    setDropping(false);
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    const dragged = e.dataTransfer.getData(ARTIFACT_DRAG);
    if (dragged) {
      try {
        addRef(JSON.parse(dragged) as Ref);
      } catch {
        // not ours
      }
    } else addImages(Array.from(e.dataTransfer.files));
    composer.current?.querySelector("textarea")?.focus();
  };

  return (
    <WorktreeReader.Provider value={readWorktree}>
    <div className="relative flex h-full min-h-0 flex-col" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <ArtifactsPanel artifacts={artifacts} open={artifactsOpen} onOpenChange={setArtifactsOpen} onAttach={addRef} />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border-2 border-dashed border-[#6B97FF] bg-background/70 text-[13px] text-muted-foreground opacity-0 transition-opacity duration-100",
          dropping && "opacity-100",
        )}
      >
        Drop files to attach them
      </div>
      <Timeline items={ts.items} live={ts.live} pending={ts.pending} status={status} onDecide={decide} agent={capitalize(agent)} onQuote={quote} />
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">
        {sendError && <div className="mb-2 text-[12px] text-destructive">{sendError}</div>}
        {quotes.length > 0 && (
          <div className="mb-1.5 flex flex-col gap-1">
            {quotes.map((q, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-surface-3 px-2.5 py-1.5 text-[12px] text-muted-foreground shadow-surface-1">
                <TextQuote className="mt-0.5 size-3.5 shrink-0" />
                <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap">{q}</span>
                <button
                  type="button"
                  aria-label="Remove quote"
                  onClick={() => setQuotes(quotes.filter((_, j) => j !== i))}
                  className="rounded p-0.5 hover:bg-hover hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {refs.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {refs.map((r) => (
              <span key={r.key} title={r.name} className="flex max-w-56 items-center gap-1.5 rounded-lg bg-surface-3 py-1 pr-1 pl-2 text-[12px] text-muted-foreground shadow-surface-1">
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{r.name}</span>
                <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setRefs(refs.filter((x) => x.key !== r.key))} className="rounded p-0.5 hover:bg-hover hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <InputMessage
          ref={composer}
          hasExtraContent={refs.length > 0}
          value={draft}
          onValueChange={setDraft}
          onSend={(text, files) => void send(text, files)}
          files={images}
          onFilesChange={setImages}
          accept={ANY_FILE}
          maxFiles={MAX_IMAGES}
          filePreviewSize={64}
          leftSlot={({ openFilePicker }) => (
            <Tooltip content="Attach files (or drop or paste them)" side="top">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Attach files" onClick={() => openFilePicker()}>
                <Paperclip />
              </Button>
            </Tooltip>
          )}
          status={busy ? "streaming" : "idle"}
          onStop={() => void push(channel.current, "interrupt")}
          queue={queue}
          onQueueChange={setQueue}
          history={history}
          placeholder={busy ? "Queue a follow-up…" : `Ask ${agent} to do something…`}
          maxRows={12}
        />
        <ComposerBar thread={thread} channel={channel} />
      </div>
    </div>
    </WorktreeReader.Provider>
  );
}
