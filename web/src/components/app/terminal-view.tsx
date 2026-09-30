import { useEffect, useRef } from "react";
import type { Channel } from "phoenix";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { socket } from "@/socket";
import { useResolvedTheme } from "@/lib/theme";

const LIGHT: ITheme = {
  foreground: "#1f2328",
  cursor: "#1f2328",
  cursorAccent: "#ffffff",
  selectionBackground: "#0969da33",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#7d4e00",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

const DARK: ITheme = {
  foreground: "#e6edf3",
  cursor: "#e6edf3",
  cursorAccent: "#171717",
  selectionBackground: "#388bfd55",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

// xterm paints its own background; match whatever surface it sits on
function surfaceColor(el: HTMLElement | null): string {
  for (let n = el; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return document.documentElement.classList.contains("dark") ? "#171717" : "#ffffff";
}

const themed = (base: ITheme, el: HTMLElement | null): ITheme => ({ ...base, background: surfaceColor(el) });

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Keys the app keeps even while the terminal has focus. */
export const isAppShortcut = (e: KeyboardEvent) => e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "`" || e.key === "~");

/**
 * One shell, attached over `terminal:<id>`. Stays mounted while hidden so its
 * screen survives switching tabs; a remount replays the server's scrollback.
 */
export function TerminalView({ id, active, focusSignal, onExit }: { id: string; active: boolean; focusSignal: number; onExit: (code: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const theme = useResolvedTheme();
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const t = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: themed(document.documentElement.classList.contains("dark") ? DARK : LIGHT, host.current),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon());
    t.attachCustomKeyEventHandler((e) => !isAppShortcut(e));
    t.open(host.current!);
    term.current = t;
    fit.current = f;

    const ch: Channel = socket.channel(`terminal:${id}`, {});
    let lastSize = "";
    const sendSize = () => {
      if (!host.current?.offsetParent) return; // hidden
      try {
        f.fit();
      } catch {
        return;
      }
      const size = `${t.cols}x${t.rows}`;
      if (size !== lastSize && ch.state === "joined") {
        lastSize = size;
        ch.push("resize", { cols: t.cols, rows: t.rows });
      }
    };

    ch.on("output", ({ data }: { data: string }) => t.write(decode(data)));
    ch.on("exit", ({ code }: { code: number }) => {
      t.write(`\r\n\x1b[2m[process exited${code ? ` with code ${code}` : ""}]\x1b[0m\r\n`);
      onExitRef.current(code);
    });
    ch.join()
      .receive("ok", ({ buffer }: { buffer: string }) => {
        t.reset();
        if (buffer) t.write(decode(buffer));
        sendSize();
      })
      .receive("error", ({ reason }: { reason?: string }) => t.write(`\x1b[2m[${reason === "not_found" ? "this terminal has ended" : reason}]\x1b[0m\r\n`));

    const input = t.onData((d) => ch.push("input", { data: d }));
    const ro = new ResizeObserver(() => sendSize());
    ro.observe(host.current!);

    return () => {
      ro.disconnect();
      input.dispose();
      ch.leave();
      t.dispose();
      term.current = null;
    };
  }, [id]);

  useEffect(() => {
    // after the theme class flips, the surface colour has too
    requestAnimationFrame(() => {
      if (term.current) term.current.options.theme = themed(theme === "dark" ? DARK : LIGHT, host.current);
    });
  }, [theme]);

  // shown (or asked to focus): fit to the space and take the keyboard
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        fit.current?.fit();
      } catch {
        /* not laid out yet */
      }
      term.current?.focus();
    });
  }, [active, focusSignal]);

  return <div ref={host} className="wb-terminal h-full w-full" />;
}
