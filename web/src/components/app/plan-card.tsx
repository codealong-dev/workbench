import { useState } from "react";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Approval, Decision } from "@/contracts";
import { Markdown } from "./markdown";

/** ExitPlanMode's input: the plan, as markdown. */
export const planOf = (input: unknown): string => String((input as { plan?: unknown })?.plan ?? "");

/** The agent's finished plan: read it, then approve it or send the agent back to planning. */
export function PlanCard({ approval, agent, onDecide }: { approval: Approval; agent: string; onDecide: (d: Decision) => Promise<void> }) {
  const [busy, setBusy] = useState<Decision | null>(null);
  const decide = async (d: Decision) => {
    setBusy(d);
    await onDecide(d);
    setBusy(null);
  };
  const plan = planOf(approval.input);

  return (
    <div className="w-full rounded-xl bg-surface-3 p-4 shadow-surface-3">
      <div className="mb-3 flex items-center gap-2 text-[12px] text-muted-foreground">
        <ListChecks className="size-4 text-blue-500" />
        {agent} has a plan
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {plan ? <Markdown text={plan} /> : <pre className="wb-tool-pre">{JSON.stringify(approval.input, null, 2)}</pre>}
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="compact" variant="primary" loading={busy === "allow"} onClick={() => decide("allow")}>
          Approve plan
        </Button>
        <Button size="compact" variant="ghost" loading={busy === "deny"} onClick={() => decide("deny")}>
          Keep planning
        </Button>
      </div>
    </div>
  );
}
