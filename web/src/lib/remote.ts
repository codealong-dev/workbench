import type { Editor, HostInfo } from "@/contracts";

/** True when this browser is not on the Workbench machine (M7: reached over Tailscale). */
export const isRemote = !["127.0.0.1", "localhost", "::1", "[::1]"].includes(location.hostname);

/**
 * Deep link that makes the editor on THIS machine open the worktree on the
 * Workbench machine over SSH (Zed remote projects, VS Code / Cursor Remote-SSH).
 */
export function remoteEditorUrl(editor: Editor, host: HostInfo, dir: string, file?: string): string | null {
  const path = file ? `${dir.replace(/\/$/, "")}/${file}` : dir;
  switch (editor) {
    case "zed":
      return `zed://ssh/${host.ssh_target}${path}`;
    case "code":
      return `vscode://vscode-remote/ssh-remote+${host.ssh_target}${path}`;
    case "cursor":
      return `cursor://vscode-remote/ssh-remote+${host.ssh_target}${path}`;
    default:
      return null;
  }
}
