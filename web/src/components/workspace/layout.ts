import type { RefObject } from "react";
import type { Channel } from "phoenix";
import type { DockviewApi, SerializedDockview } from "dockview-react";
import { push } from "@/hooks/use-channels";

// A workspace's tabs and splits: saved on the server (every browser opens the
// same layout), with a local copy for when the server has none yet.
const key = (rootId: string) => `wb.layout.${rootId}`;

export async function fetchLayout(channel: RefObject<Channel | null>, rootId: string): Promise<SerializedDockview | null> {
  const r = await push(channel.current, "layout.get");
  if (r.ok) {
    const layout = (r.payload as { layout: SerializedDockview | null }).layout;
    if (layout) return layout;
  }
  try {
    const raw = localStorage.getItem(key(rootId));
    return raw ? (JSON.parse(raw) as SerializedDockview) : null;
  } catch {
    return null;
  }
}

/** Restore `layout`; false (and an empty dock) when it can't be. */
export function applyLayout(api: DockviewApi, layout: SerializedDockview | null): boolean {
  if (!layout) return false;
  try {
    api.fromJSON(layout);
    return api.panels.length > 0;
  } catch {
    api.clear();
    return false;
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function saveLayout(rootId: string, api: DockviewApi, channel: RefObject<Channel | null>) {
  clearTimeout(timers.get(rootId));
  timers.set(
    rootId,
    setTimeout(() => {
      const layout = api.toJSON();
      try {
        localStorage.setItem(key(rootId), JSON.stringify(layout));
      } catch {
        /* storage full or blocked */
      }
      void push(channel.current, "layout.put", { layout });
    }, 600),
  );
}
