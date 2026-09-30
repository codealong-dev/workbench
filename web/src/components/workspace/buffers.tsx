import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import type { DockviewPanelApi, IDockviewPanelProps } from "dockview-react";
import { FileDiff as FileDiffIcon, FlaskConical, Sparkle, SquareTerminal, type LucideIcon } from "lucide-react";
import type { DiffResult, Editor, FileList, TerminalInfo, Thread } from "@/contracts";
import { useStore } from "@/store";
import { fileIcon } from "@/lib/file-icons";
import { threadLabel } from "@/components/app/sidebar";
import { DiffView } from "@/components/app/diff-view";
import { FileView } from "@/components/app/file-view";
import { TerminalView } from "@/components/app/terminal-view";
import { ChatView } from "./chat-view";
import { preferredEditor } from "@/components/app/open-menu";

// ── buffers: anything that can be a tab ──────────────────────────────────────

export type Buffer =
  | { kind: "chat"; threadId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "changes" }
  | { kind: "file"; path: string }
  | { kind: "diff"; path: string };

export const bufferId = (b: Buffer): string => {
  switch (b.kind) {
    case "chat":
      return `chat:${b.threadId}`;
    case "terminal":
      return `term:${b.terminalId}`;
    case "changes":
      return "changes";
    case "file":
      return `file:${b.path}`;
    case "diff":
      return `diff:${b.path}`;
  }
};

export interface OpenOptions {
  /** open beside the active group instead of in it */
  direction?: "right" | "below";
  /** leave focus where it is */
  background?: boolean;
}

// ── what every buffer can reach ─────────────────────────────────────────────

export interface Workspace {
  rootId: string;
  /** the root thread's channel: diff, files, terminals, push all go through it */
  channel: RefObject<Channel | null>;
  diff: DiffResult | null;
  diffError: string | null;
  diffLoading: boolean;
  refreshDiff: () => void;
  files: {
    list: FileList | null;
    error: string | null;
    loading: boolean;
    refresh: () => void;
  };
  terminals: TerminalInfo[] | null;
  /** bumps whenever an agent in the workspace finishes, so open files re-read */
  version: number;
  /** the changes buffer scrolls here */
  focus: { path: string; n: number } | null;
  setActiveChange: (path: string | null) => void;
  open: (b: Buffer, o?: OpenOptions) => void;
  openIn: (editor: Editor, path?: string) => Promise<string | null>;
  loadPatch: (path: string) => Promise<string | null>;
  newChat: (provider: "claude" | "codex") => Promise<void>;
  newTerminal: () => Promise<void>;
  quickOpen: () => void;
}

export const WorkspaceContext = createContext<Workspace | null>(null);
export const useWorkspace = () => {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error("useWorkspace outside a workspace");
  return ws;
};

/** Whether this dock panel is on screen (its group shows it). */
function useVisible(api: DockviewPanelApi) {
  const [visible, setVisible] = useState(api.isVisible);
  useEffect(() => {
    const d = api.onDidVisibilityChange((e) => setVisible(e.isVisible));
    return () => d.dispose();
  }, [api]);
  return visible;
}

// ── tab titles and icons ────────────────────────────────────────────────────

const PROVIDER_ICON: Record<string, LucideIcon> = {
  claude: Sparkle,
  codex: SquareTerminal,
  fake: FlaskConical,
};

export function useBufferTitle(b: Buffer): {
  title: string;
  icon: LucideIcon;
  iconClass?: string;
  thread?: Thread;
  hint?: string;
} {
  const thread = useStore((s) => (b.kind === "chat" ? s.threads.find((t) => t.id === b.threadId) : undefined));
  const ws = useContext(WorkspaceContext);
  switch (b.kind) {
    case "chat":
      return {
        title: thread ? threadLabel(thread) : "Chat",
        icon: PROVIDER_ICON[thread?.provider ?? "claude"] ?? Sparkle,
        thread,
        hint: thread?.branch ?? undefined,
      };
    case "terminal": {
      const t = ws?.terminals?.find((x) => x.id === b.terminalId);
      return {
        title: t?.title ?? "Terminal",
        icon: SquareTerminal,
        hint: t?.cwd,
      };
    }
    case "changes":
      return {
        title: "Changes",
        icon: FileDiffIcon,
        hint: ws?.diff ? `against ${ws.diff.base}` : undefined,
      };
    case "file":
    case "diff": {
      const name = b.path.slice(b.path.lastIndexOf("/") + 1);
      const fi = fileIcon(b.path);
      return {
        title: b.kind === "diff" ? `${name} (changes)` : name,
        icon: b.kind === "diff" ? FileDiffIcon : fi.icon,
        iconClass: b.kind === "diff" ? undefined : fi.className,
        hint: b.path,
      };
    }
  }
}

// ── panel components, one per kind ──────────────────────────────────────────

function ChatPanel({ params }: IDockviewPanelProps<Buffer & { kind: "chat" }>) {
  return <ChatView threadId={params.threadId} />;
}

function TerminalPanel({ params, api }: IDockviewPanelProps<Buffer & { kind: "terminal" }>) {
  const visible = useVisible(api);
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    const d = api.onDidActiveChange((e) => e.isActive && setFocus((n) => n + 1));
    return () => d.dispose();
  }, [api]);
  return (
    <div className="h-full py-1.5 pl-2.5">
      <TerminalView id={params.terminalId} active={visible} focusSignal={focus} onExit={() => api.close()} />
    </div>
  );
}

function ChangesPanel() {
  const ws = useWorkspace();
  return (
    <DiffView
      diff={ws.diff}
      error={ws.diffError}
      focus={ws.focus}
      onActive={ws.setActiveChange}
      onOpenFile={(p) => void ws.openIn(preferredEditor(), p)}
      loadFile={ws.loadPatch}
    />
  );
}

function FilePanel({ params }: IDockviewPanelProps<Buffer & { kind: "file" }>) {
  const ws = useWorkspace();
  return <FileView channel={ws.channel.current} path={params.path} version={ws.version} onOpenInEditor={(p) => void ws.openIn(preferredEditor(), p)} />;
}

export const PANEL_COMPONENTS = {
  chat: ChatPanel,
  terminal: TerminalPanel,
  changes: ChangesPanel,
  file: FilePanel,
  // replaced by the editable Monaco diff in the editing phase
  diff: FilePanel,
} as Record<string, React.FunctionComponent<IDockviewPanelProps>>;
