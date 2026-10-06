import { cn } from "@/lib/utils";
import type { Status } from "@/contracts";

const styles: Record<Exclude<Status, "running">, string> = {
  idle: "bg-neutral-300 dark:bg-neutral-600",
  awaiting_approval: "bg-orange-500 animate-pulse",
  error: "bg-red-500",
};

const labels: Record<Status, string> = { idle: "Idle", running: "Working", awaiting_approval: "Needs you", error: "Error" };

/**
 * Where an agent is: the fluid figure-eight spinner while it works, orange when it needs
 * you, red on error, green once it has finished something (`done`), grey
 * when it has not been asked anything yet.
 */
export function StatusDot({ status, done = false, className }: { status: Status; done?: boolean; className?: string }) {
  if (status === "running") {
    // Same glyph as the fluid Button's loading state, with the viewBox cropped
    // to the figure-eight so it reads at dot size.
    return (
      <svg role="img" aria-label={labels.running} viewBox="4 4 16 16" fill="none" className={cn("inline-block size-2 shrink-0 text-muted-foreground", className)}>
        <title>{labels.running}</title>
        <path
          d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          pathLength="100"
          style={{ strokeDasharray: "15 85", animation: "spinner-move 2s linear infinite, spinner-dash 4s ease-in-out infinite" }}
        />
      </svg>
    );
  }
  const look = status === "idle" && done ? "bg-green-500" : styles[status];
  return <span title={status === "idle" && done ? "Done" : labels[status]} className={cn("inline-block size-2 shrink-0 rounded-full", look, className)} />;
}
