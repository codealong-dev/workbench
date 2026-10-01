import type { GraphCommit } from "@/contracts";

/** A line inside one row of the graph. x is a lane index; y is 0 (top), 0.5 (the dot) or 1 (bottom). */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** the lane that owns the line, for its color */
  lane: number;
}

export interface GraphRow {
  commit: GraphCommit;
  /** the lane the commit's dot sits in */
  lane: number;
  segments: Segment[];
}

/**
 * Lays out commits (newest first, children before parents) in lanes, like
 * `git log --graph`: each lane follows one line of history down the page. A
 * commit's dot goes in the lane that was waiting for it; its first parent
 * continues there and further parents (merges) get a lane each. Returns the
 * rows and how many lanes are needed.
 */
export function layoutGraph(commits: GraphCommit[]): { rows: GraphRow[]; lanes: number } {
  let waiting: (string | null)[] = [];
  let lanes = 1;
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const before = waiting;
    const after = [...before];
    const segments: Segment[] = [];

    // every lane that was waiting for this commit meets at its dot
    const mine = before.flatMap((sha, i) => (sha === commit.sha ? [i] : []));
    const free = after.indexOf(null);
    const lane = mine[0] ?? (free >= 0 ? free : after.length);
    for (const i of mine) {
      segments.push({ x1: i, y1: 0, x2: lane, y2: 0.5, lane: i });
      after[i] = null;
    }
    // lanes for other lines of history pass straight through
    before.forEach((sha, i) => {
      if (sha && sha !== commit.sha) segments.push({ x1: i, y1: 0, x2: i, y2: 1, lane: i });
    });

    commit.parents.forEach((parent, k) => {
      let to = after.indexOf(parent);
      if (to < 0) {
        to = k === 0 && after[lane] == null ? lane : after.indexOf(null);
        if (to < 0) to = after.length;
        after[to] = parent;
      }
      segments.push({ x1: lane, y1: 0.5, x2: to, y2: 1, lane: k === 0 ? lane : to });
    });

    while (after.length && after[after.length - 1] == null) after.pop();
    lanes = Math.max(lanes, lane + 1, before.length, after.length);
    waiting = after;
    rows.push({ commit, lane, segments });
  }

  return { rows, lanes };
}
