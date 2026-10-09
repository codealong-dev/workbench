// The macOS app (desktop/main.swift) says so in its user agent.
export const IN_MAC_APP = navigator.userAgent.includes("WorkbenchApp");

// The app hides its native title bar and tells the page how tall it is (--wb-titlebar-h) as the page starts,
// so the page draws its own (components/app/title-bar.tsx). An older app has no such variable and keeps its own.
export const CUSTOM_TITLEBAR = IN_MAC_APP && parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--wb-titlebar-h")) > 0;

/** Ask the app to move the window (the mouse is down on our title bar) or to zoom it (double-click). */
export function titlebarMouseDown(e: { button: number; detail: number }) {
  if (e.button !== 0) return;
  (window as unknown as { webkit?: { messageHandlers?: { wb?: { postMessage(m: string): void } } } }).webkit?.messageHandlers?.wb?.postMessage(
    e.detail === 2 ? "dblclick" : "drag",
  );
}
