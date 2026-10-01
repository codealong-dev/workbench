export interface FileLink {
  path: string;
  line?: number;
  end?: number;
}

/**
 * A link an agent wrote that points at a file in the worktree, e.g.
 * `/abs/path/foo.ex:101`, `lib/foo.ex#L10-L20` or `file:///abs/foo.ex:5:3`.
 * Returns null for web links and for paths outside the worktree.
 */
export function parseFileLink(href: string | undefined, worktree: string): FileLink | null {
  if (!href || /^(https?|mailto|tel):/i.test(href) || href.startsWith("#")) return null;
  let rest = href.replace(/^file:\/\//i, "");
  try {
    rest = decodeURI(rest);
  } catch {
    // keep it as written
  }
  let line: number | undefined;
  let end: number | undefined;
  const hash = /#L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/.exec(rest);
  if (hash) {
    rest = rest.slice(0, hash.index);
    line = Number(hash[1]);
    end = hash[2] ? Number(hash[2]) : undefined;
  } else {
    // path:line, path:line:col, path:start-end
    const colon = /:(\d+)(?:-(\d+)|:\d+)?$/.exec(rest);
    if (colon) {
      rest = rest.slice(0, colon.index);
      line = Number(colon[1]);
      end = colon[2] ? Number(colon[2]) : undefined;
    }
  }
  const base = worktree.replace(/\/+$/, "");
  let path = rest;
  if (path.startsWith("/")) {
    if (!path.startsWith(base + "/")) return null;
    path = path.slice(base.length + 1);
  } else {
    path = path.replace(/^\.\//, "");
    if (path.startsWith("../") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  }
  if (!path) return null;
  if (end !== undefined && line !== undefined && end < line) end = undefined;
  return { path, line, end };
}
