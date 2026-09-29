import { useState } from "react";
import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Approval, Decision } from "@/contracts";
import { toolSummary } from "./tool-call";

export function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide: (d: Decision) => Promise<void> }) {
  const [busy, setBusy] = useState<Decision | null>(null);
  const decide = async (d: Decision) => {
    setBusy(d);
    await onDecide(d);
    setBusy(null);
  };

  return (
    <div className="w-full rounded-xl bg-surface-3 p-3 shadow-surface-3">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <ShieldQuestion className="size-4 text-amber-500" />
        Allow {approval.tool}?
      </div>
      {approval.reason && <div className="mt-1 text-[12px] text-muted-foreground">{approval.reason}</div>}
      <pre className="wb-tool-pre mt-2">{toolSummary(approval.tool, approval.input) || JSON.stringify(approval.input, null, 2)}</pre>
      <div className="mt-3 flex gap-2">
        <Button size="compact" variant="primary" loading={busy === "allow"} onClick={() => decide("allow")}>
          Allow
        </Button>
        <Button size="compact" variant="secondary" loading={busy === "allow_session"} onClick={() => decide("allow_session")}>
          Allow for session
        </Button>
        <Button size="compact" variant="ghost" loading={busy === "deny"} onClick={() => decide("deny")}>
          Deny
        </Button>
      </div>
    </div>
  );
}
