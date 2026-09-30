import {
  Atom,
  BookOpen,
  Braces,
  Code,
  Container,
  Database,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileKey,
  FileLock,
  FileText,
  FileType,
  FileVideo,
  GitBranch,
  Hash,
  Package,
  Palette,
  Scale,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export interface FileIcon {
  icon: LucideIcon;
  className: string;
}

const by = (icon: LucideIcon, className: string): FileIcon => ({ icon, className });

// Exact names first, then extensions. Colours follow the usual editor
// conventions so a glance finds the file type.
const NAMES: Record<string, FileIcon> = {
  ".gitignore": by(GitBranch, "text-orange-600 dark:text-orange-400"),
  ".gitattributes": by(GitBranch, "text-orange-600 dark:text-orange-400"),
  ".gitmodules": by(GitBranch, "text-orange-600 dark:text-orange-400"),
  "package.json": by(Package, "text-green-600 dark:text-green-400"),
  "mix.exs": by(Package, "text-violet-600 dark:text-violet-400"),
  "go.mod": by(Package, "text-cyan-600 dark:text-cyan-400"),
  "cargo.toml": by(Package, "text-orange-600 dark:text-orange-400"),
  dockerfile: by(Container, "text-sky-600 dark:text-sky-400"),
  "docker-compose.yml": by(Container, "text-sky-600 dark:text-sky-400"),
  makefile: by(SquareTerminal, "text-orange-600 dark:text-orange-400"),
  license: by(Scale, "text-muted-foreground"),
  ".env": by(FileKey, "text-yellow-600 dark:text-yellow-400"),
};

const EXT: Record<string, FileIcon> = {
  ts: by(FileCode, "text-blue-600 dark:text-blue-400"),
  tsx: by(Atom, "text-sky-600 dark:text-sky-400"),
  js: by(FileCode, "text-yellow-600 dark:text-yellow-400"),
  mjs: by(FileCode, "text-yellow-600 dark:text-yellow-400"),
  cjs: by(FileCode, "text-yellow-600 dark:text-yellow-400"),
  jsx: by(Atom, "text-sky-600 dark:text-sky-400"),
  ex: by(Code, "text-violet-600 dark:text-violet-400"),
  exs: by(Code, "text-violet-600 dark:text-violet-400"),
  heex: by(Code, "text-violet-600 dark:text-violet-400"),
  go: by(Code, "text-cyan-600 dark:text-cyan-400"),
  rs: by(Code, "text-orange-700 dark:text-orange-400"),
  py: by(Code, "text-blue-600 dark:text-blue-400"),
  rb: by(Code, "text-red-600 dark:text-red-400"),
  java: by(Code, "text-red-600 dark:text-red-400"),
  swift: by(Code, "text-orange-600 dark:text-orange-400"),
  c: by(Code, "text-blue-600 dark:text-blue-400"),
  h: by(Code, "text-blue-600 dark:text-blue-400"),
  json: by(Braces, "text-yellow-600 dark:text-yellow-400"),
  jsonl: by(Braces, "text-yellow-600 dark:text-yellow-400"),
  yml: by(Settings, "text-rose-600 dark:text-rose-400"),
  yaml: by(Settings, "text-rose-600 dark:text-rose-400"),
  toml: by(Settings, "text-muted-foreground"),
  ini: by(Settings, "text-muted-foreground"),
  sh: by(SquareTerminal, "text-orange-600 dark:text-orange-400"),
  bash: by(SquareTerminal, "text-orange-600 dark:text-orange-400"),
  zsh: by(SquareTerminal, "text-orange-600 dark:text-orange-400"),
  md: by(BookOpen, "text-sky-600 dark:text-sky-400"),
  mdx: by(BookOpen, "text-sky-600 dark:text-sky-400"),
  txt: by(FileText, "text-muted-foreground"),
  css: by(Palette, "text-pink-600 dark:text-pink-400"),
  scss: by(Palette, "text-pink-600 dark:text-pink-400"),
  html: by(Code, "text-orange-600 dark:text-orange-400"),
  svg: by(FileImage, "text-amber-600 dark:text-amber-400"),
  png: by(FileImage, "text-emerald-600 dark:text-emerald-400"),
  jpg: by(FileImage, "text-emerald-600 dark:text-emerald-400"),
  jpeg: by(FileImage, "text-emerald-600 dark:text-emerald-400"),
  gif: by(FileImage, "text-emerald-600 dark:text-emerald-400"),
  webp: by(FileImage, "text-emerald-600 dark:text-emerald-400"),
  ico: by(FileImage, "text-emerald-600 dark:text-emerald-400"),
  mp4: by(FileVideo, "text-purple-600 dark:text-purple-400"),
  mp3: by(FileAudio, "text-purple-600 dark:text-purple-400"),
  sql: by(Database, "text-teal-600 dark:text-teal-400"),
  db: by(Database, "text-teal-600 dark:text-teal-400"),
  lock: by(FileLock, "text-muted-foreground"),
  zip: by(FileArchive, "text-muted-foreground"),
  gz: by(FileArchive, "text-muted-foreground"),
  woff: by(FileType, "text-muted-foreground"),
  woff2: by(FileType, "text-muted-foreground"),
  ttf: by(FileType, "text-muted-foreground"),
  plist: by(Settings, "text-muted-foreground"),
  graphql: by(Hash, "text-pink-600 dark:text-pink-400"),
};

const FALLBACK = by(FileText, "text-muted-foreground");

export function fileIcon(path: string): FileIcon {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (NAMES[name]) return NAMES[name];
  if (name.startsWith(".env")) return NAMES[".env"];
  const dot = name.lastIndexOf(".");
  return (dot > 0 || (dot === 0 && name.indexOf(".", 1) > 0) ? EXT[name.slice(dot + 1)] : undefined) ?? FALLBACK;
}
