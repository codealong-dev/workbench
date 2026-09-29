import { cn } from "@/lib/utils";
import type { Status } from "@/contracts";

const styles: Record<Status, string> = {
  idle: "bg-neutral-300 dark:bg-neutral-600",
  running: "bg-blue-500 animate-pulse",
  awaiting_approval: "bg-amber-500",
  error: "bg-red-500",
};

const labels: Record<Status, string> = { idle: "Idle", running: "Working", awaiting_approval: "Needs you", error: "Error" };

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span title={labels[status]} className={cn("inline-block size-2 shrink-0 rounded-full", styles[status], className)} />;
}
