export interface FileMatch {
  path: string;
  score: number;
  /** indices into `path` of the matched characters, ascending */
  hits: number[];
}

const SEP = /[/._\-\s]/;

/**
 * Subsequence match of `query` (already lower-cased) against a path, or null.
 * Rewards runs of consecutive characters, matches at the start of a word or
 * path segment, and matches inside the file name over the folders above it.
 */
export function matchPath(path: string, query: string): FileMatch | null {
  const nameStart = path.lastIndexOf("/") + 1;
  // a query that fits inside the file name should highlight there, not in the folders
  return match(path, query, nameStart, nameStart) ?? (nameStart ? match(path, query, 0, nameStart) : null);
}

function match(path: string, query: string, start: number, nameStart: number): FileMatch | null {
  const lower = path.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let from = start;
  let prev = -2;

  for (const ch of query) {
    const i = lower.indexOf(ch, from);
    if (i < 0) return null;
    hits.push(i);
    if (i === prev + 1) score += 8;
    if (i === 0 || SEP.test(path[i - 1]) || (path[i] !== lower[i] && path[i - 1] === lower[i - 1])) score += 6;
    if (i >= nameStart) score += 3;
    score -= Math.min(i - from, 5) * 0.2;
    prev = i;
    from = i + 1;
  }

  const name = lower.slice(nameStart);
  if (name === query) score += 40;
  else if (name.startsWith(query)) score += 20;
  else if (name.includes(query)) score += 10;
  score -= path.length * 0.05; // shorter paths first among equals

  return { path, score, hits };
}

/** The best `limit` matches for `query`, best first. An empty query matches nothing. */
export function searchPaths(paths: string[], query: string, limit = 50): FileMatch[] {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return [];
  const out: FileMatch[] = [];
  for (const p of paths) {
    const m = matchPath(p, q);
    if (m) out.push(m);
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}
