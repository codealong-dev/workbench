import { cn } from "@/lib/utils";
import type { Status } from "@/contracts";

const styles: Record<Exclude<Status, "running">, string> = {
  idle: "bg-neutral-300 dark:bg-neutral-600",
  awaiting_approval: "bg-orange-500 animate-pulse",
  error: "bg-red-500",
};

const labels: Record<Status, string> = { idle: "Idle", running: "Working", awaiting_approval: "Needs you", error: "Error" };

/**
 * Where an agent is: a spinning ring while it works, orange when it needs
 * you, red on error, green once it has finished something (`done`), grey
 * when it has not been asked anything yet.
 */
export function StatusDot({ status, done = false, className }: { status: Status; done?: boolean; className?: string }) {
  if (status === "running") {
    return (
      <svg role="img" aria-label={labels.running} viewBox="0 0 16 16" fill="none" className={cn("inline-block size-2 shrink-0 animate-spin text-amber-500", className)}>
        <title>{labels.running}</title>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="29 9" />
      </svg>
    );
  }
  const look = status === "idle" && done ? "bg-green-500" : styles[status];
  return <span title={status === "idle" && done ? "Done" : labels[status]} className={cn("inline-block size-2 shrink-0 rounded-full", look, className)} />;
}
