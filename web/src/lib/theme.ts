// System / light / dark, pinned as a class on <html> so both FF's tokens
// (color-scheme) and Tailwind's class-based `dark:` variant follow it.
export type Theme = "system" | "light" | "dark";

const KEY = "wb.theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* storage blocked */
  }
  return "system";
}

export function applyTheme(theme: Theme = getTheme()) {
  const dark = theme === "dark" || (theme === "system" && media().matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
}

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* storage blocked */
  }
  applyTheme(theme);
}

export const nextTheme = (t: Theme): Theme => (t === "system" ? "light" : t === "light" ? "dark" : "system");

/** Follow OS changes while on "system". */
export function watchSystemTheme() {
  const m = media();
  const onChange = () => getTheme() === "system" && applyTheme("system");
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}
