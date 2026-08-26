// src/components/agent/RunCheckNow.tsx
//
// The one control that makes any of this testable without waiting six hours.
//
// ⚠️ IT LIVES ON THE TIER IT RUNS. The button used to sit on the Handover page —
// a page about the blueprint cutover, which is a decision that has since been
// taken — so it was deleted with it in 2.756.0 and nothing replaced it. A
// control belongs beside the thing it operates, not beside the argument that
// once needed it; on the Triage tab it is under the list of passes it adds to,
// which is also where its result appears.
//
// ⚠️ THE LABEL SAYS IT COSTS MONEY. A button that spends real budget must not
// look like a refresh, and the reason string this shows back is deliberately
// verbatim: `run_once` returns WHY it stopped and the causes need different
// responses — switched off, over budget, no provider, nothing to escalate —
// which look identical from outside and most of which are fine.

import { useCallback, useState } from "react";
import { Play, Loader2 } from "lucide-react";

import { runTriageNow } from "@/agent/agentApi";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability } from "@/auth/permissions";

export default function RunCheckNow({ onDone }: { onDone?: () => void }) {
  // ⚠️ THE SAME CAPABILITY THAT GATES EVERY OTHER AGENT CONTROL, read the same
  // way `AgentProposals` reads it. A second spelling of "may this person spend
  // the budget" is the drift this repository keeps paying for.
  const { role } = useProfile();
  const mayRun = role != null && hasCapability(role, "editConfig");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setNote(null);
    const result = await runTriageNow();
    // ⚠️ "FOUND NOTHING" IS NOT A FAILURE AND MUST NOT READ AS ONE. A villa the
    // assistant judges well produces exactly this, and `reason.SYSTEM` instructs
    // it outright — "finding nothing is a good outcome and a complete answer".
    // An earlier wording implied a successful check always leaves something
    // behind, which made every quiet pass look broken.
    setNote(result.ok
      ? "The check ran. Anything worth raising is in the list above — a check "
        + "that finds the villa well adds nothing, which is not a failure."
      : `The check stopped: ${result.reason}`);
    setBusy(false);
    onDone?.();
  }, [onDone]);

  // ⚠️ OWNER-ONLY, AND HIDDEN RATHER THAN DISABLED. The route is owner-only
  // server-side because it spends the budget (`auth/permissions.ts` is a
  // rendering convenience; the proxy is the enforcer). A disabled button would
  // advertise a control the reader can never use.
  if (!mayRun) return null;

  return (
    <>
      {note && <p className="muted body-text">{note}</p>}
      <div className="modal-actions" style={{ margin: 0 }}>
        <button className="btn" disabled={busy} onClick={() => void run()}>
          {busy ? <Loader2 size={16} className="spin" aria-hidden />
                : <Play size={16} aria-hidden />}
          {busy ? "Checking…" : "Check the villa now (spends a request)"}
        </button>
      </div>
    </>
  );
}
