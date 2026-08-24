// src/components/cockpit/CockpitQueue.tsx
//
// The approval queue, on the wall. TASK-105, ADR-021.
//
// ⚠️ IT EXISTS BECAUSE THE BACKEND HALF SHIPPED WITHOUT IT AND SAID SO.
// v2.688.0 gave the owner `investigate_mode: approve`, which records an
// `awaiting-approval` audit row per escalated subject and spends nothing — the
// correct and complete server behaviour, and half a feature. Nothing rendered
// the queue and nothing could approve an item, so choosing `approve` produced a
// villa that flagged things into a file. A control whose second half does not
// exist is the shape this project keeps finding after the fact.
//
// ⚠️ APPROVING IS NOT A SECOND INVESTIGATION PATH. The button posts a run id;
// the server hands it to `reason.investigate_subject` — the same function the
// scheduler's automatic arm calls, with the same budget check, the same prompt
// and the same audit rows. Two callers, one body; a second path here would be
// the one nobody tests, and it would be the one that spends money.
//
// ⚠️ AND THE BROWSER SENDS A RUN ID AND NOTHING ELSE. The subject is read back
// server-side from the audit row that id names, so this screen cannot ask for an
// investigation of something nobody escalated — there is no field for it.
//
// ⚠️ THE CAPABILITY IS READ IN THE LEAF, like `CockpitConcerns`,
// `CockpitReview` and `CockpitProposals`. `test_cockpit_is_gated_nowhere`
// forbids a capability in either Cockpit shell — the modal exists so a profile
// WITHOUT it can still see the villa's state — so a control that needs one
// carries its own check. This one wants the OWNER, matching the proxy exactly:
// approving an investigation spends the budget.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import SourceChip from "@/components/common/SourceChip";

import {
  decideEscalation, loadApprovalQueue, type ApprovalQueue,
} from "@/agent/agentApi";
import { useProfile } from "@/auth/ProfileContext";

export default function CockpitQueue() {
  const { role } = useProfile();
  const [queue, setQueue] = useState<ApprovalQueue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string>("");

  const load = useCallback(async () => {
    setQueue(await loadApprovalQueue());
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(
    async (runId: string, action: "approve" | "dismiss") => {
      setBusy(runId);
      setFailed("");
      // ⚠️ `finally`, SO THE BUTTON ALWAYS COMES BACK. `decideEscalation` no
      // longer throws, but a spinner that can outlive its request is the defect
      // this pair exists to prevent, and the guarantee belongs at BOTH ends —
      // this component must not depend on a helper never rejecting.
      let out: { ok: boolean; reason: string };
      try {
        out = await decideEscalation(runId, action);
      } finally {
        setBusy(null);
      }
      // ⚠️ THE REASON IS SHOWN, NOT SWALLOWED. "Nothing happened" has several
      // causes here — a spent budget, no provider, an item somebody else
      // already acted on — and every one of them is a sentence the server
      // already wrote. Rendering only a spinner that stops would make a
      // budget ceiling look like a broken button.
      if (!out.ok) setFailed(out.reason || "it could not be started");
      await load();
    }, [load]);

  // ⚠️ OWNER ONLY, AND SILENT OTHERWISE rather than shown-and-disabled. A
  // profile that can never press these has no use for the list, and the server
  // refuses them regardless — this only avoids rendering a row whose buttons
  // could exclusively 403.
  if (role !== "owner") return null;
  if (queue === null) return null;

  // ⚠️ NOTHING AT ALL IN `auto` MODE. An empty queue on a villa that
  // investigates automatically is not information — it is the permanent and
  // correct state, and a heading over it invites the reading that something is
  // stuck. The mode comes from the server for exactly this branch.
  if (queue.mode === "auto") return null;
  if (queue.pending.length === 0) {
    return (
      <>
        <div className="settings-section-title">Worth a closer look</div>
        <p className="muted body-text">
          Nothing is waiting. Checks are flagging subjects for approval rather
          than looking into them by themselves — you can change that under
          Cadence and cost.
        </p>
      </>
    );
  }

  return (
    <>
      {/* ⚠️ THE HEADING NAMES WHAT THESE ARE, NOT WHAT THEY NEED. "Waiting for
          your approval" describes the queue's mechanics, and invites the reader
          to treat the list as a worklist of findings — but a triage escalation
          is not a finding: it carries NO severity, and its order is not a
          priority. The chip on each row reads "Flagged for a look"; the heading
          now agrees with it instead of outranking it. */}
      <div className="settings-section-title">Worth a closer look</div>
      <p className="muted body-text">
        A check flagged these and stopped. Looking into one costs a full,
        expensive investigation; dismissing settles it without spending.
      </p>
      {/* ⚠️ `sev-warning` AND `role="alert"`, the pair `CockpitProposals`
          already uses for the same job. A first draft invented a
          `form-error` class that does not exist in styles.css — the error
          would have rendered as unstyled body text, which reads as part of
          the description rather than as a failure. */}
      {failed ? <p className="body-text sev-warning" role="alert">{failed}</p> : null}
      <div className="cockpit-attention-list">
        {queue.pending.map((item) => (
          <div className="editable-row" key={item.runId}>
            <div className="editable-row-fields" style={{ alignItems: "flex-start" }}>
              {/* ⚠️ `triage`, NEVER `agent`, AND THE DIFFERENCE IS THE WHOLE
                  REASON THIS QUEUE EXISTS. A triage pass ranks; it assigns NO
                  severity, because severity is what the investigation decides
                  (ADR-021 corrects the original spec on exactly this point).
                  These rows sit in a list that looks like Concerns and mean
                  something far weaker — "worth a closer look" — so the chip
                  carries "not investigated yet" as its explanation. */}
              <SourceChip source="triage" />
              <span className="body-text" style={{ flex: "1 1 200px", minWidth: 0 }}>
                <strong>{item.subject}</strong>
                {item.reason ? <><br />{item.reason}</> : null}
              </span>
            </div>
            {/* ⚠️ THE BUTTONS ARE SIBLINGS OF THE FIELDS, NOT WRAPPED. A first
                draft put them in an `editable-row-actions` div, which is not a
                class this stylesheet defines — `.editable-row` lays its own
                children out, exactly as `CockpitConcerns` relies on two rows
                above. `.icon-btn` and `.btn` carry the 44px touch target;
                inventing a container would have lost it on a phone. */}
            {/* ⚠️ EVERY ICON BUTTON CARRIES A `title` AS WELL AS AN
                `aria-label`. The label serves a screen reader and gives a
                sighted user nothing — two unlabelled circles beside a sentence
                is a guess, and the owner asked for tooltips by name. The title
                also states the DURATION, because approving runs a full
                investigation (60-150s measured) and a spinner with no stated
                cost reads as a hang after about five seconds. */}
            <button type="button" className="row-action"
              disabled={busy !== null}
              title="Investigate this now — takes a minute or two, and costs a run"
              aria-label={`Look into this now: ${item.subject}`}
              onClick={() => void decide(item.runId, "approve")}>
              {busy === item.runId
                ? <Loader2 size={16} className="spin" aria-hidden />
                : <Search size={16} aria-hidden />}
            </button>
            <button type="button" className="row-action"
              title="Dismiss — do not investigate this"
              disabled={busy !== null}
              aria-label={`Dismiss without looking: ${item.subject}`}
              onClick={() => void decide(item.runId, "dismiss")}>
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
