import { useMemo } from "react";
import { GitBranch, Tag } from "lucide-react";
import { layoutGraph } from "@/lib/git-graph";
import { cn } from "@/lib/utils";
import type { CommitGraph as Graph } from "@/contracts";

const ROW = 28;
const LANE = 14;
const PAD = 8;
const COLORS = ["#6B97FF", "#34b27b", "#e5a23c", "#e0638f", "#9b7de0", "#3fb8c4"];

const color = (lane: number) => COLORS[lane % COLORS.length];
const x = (lane: number) => PAD + lane * LANE;

const AGES: [number, string][] = [[31557600, "y"], [2629800, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]];

function ago(unix: number) {
  const s = Date.now() / 1000 - unix;
  const [secs, unit] = AGES.find(([secs]) => s >= secs) ?? [0, ""];
  return secs ? `${Math.floor(s / secs)}${unit} ago` : "just now";
}

/** The recent history around the branch as a graph: dots in lanes on the left, the commit title, its branches and its age beside them. Commits not on a remote yet are filled. */
export function CommitGraph({ graph }: { graph: Graph }) {
  const { rows, lanes } = useMemo(() => layoutGraph(graph.commits), [graph]);
  const width = PAD * 2 + (lanes - 1) * LANE;

  return (
    <ol className="flex flex-col">
      {rows.map(({ commit, lane, segments }) => {
        const head = commit.sha === graph.head;
        return (
          <li key={commit.sha} className="flex items-center gap-2 text-[12px]" style={{ height: ROW }}>
            <svg width={width} height={ROW} className="shrink-0 overflow-visible" aria-hidden>
              {segments.map((s, i) => (
                <line
                  key={i}
                  x1={x(s.x1)}
                  y1={s.y1 * ROW}
                  x2={x(s.x2)}
                  y2={s.y2 * ROW}
                  stroke={color(s.lane)}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              ))}
              <circle
                cx={x(lane)}
                cy={ROW / 2}
                r={head ? 5 : 4}
                fill={commit.unpushed ? color(lane) : "var(--surface-3, #1e1e1e)"}
                stroke={color(lane)}
                strokeWidth={1.5}
              />
            </svg>
            <span className={cn("min-w-0 truncate", commit.unpushed ? "text-foreground" : "text-muted-foreground")} title={`${commit.sha.slice(0, 8)} · ${commit.author}`}>
              {commit.subject}
            </span>
            {commit.refs.map((ref) => (
              <span key={ref} className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground">
                {ref.startsWith("tag: ") ? <Tag className="size-3" /> : <GitBranch className="size-3" />}
                {ref.replace(/^tag: /, "")}
              </span>
            ))}
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground tabular-nums">{ago(commit.at)}</span>
          </li>
        );
      })}
    </ol>
  );
}
