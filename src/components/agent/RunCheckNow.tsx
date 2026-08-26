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
import { outcomeOf } from "@/components/agent/RecentChecks";
import { useProfile } from "@/auth/ProfileContext";
import { hasCapability } from "@/auth/permissions";

export default function RunCheckNow({ onDone }: { onDone?: () => void }) {
  // ⚠️ `editConfig` MIRRORS THE SERVER, WHICH IS THE ONLY REASON TO PICK IT.
  // `agent_run_now_handler` refuses anything but `_role_for(request) ==
  // "owner"`, and `editConfig` is held by the owner alone — `ops` does not have
  // it. So this hides a control the proxy would refuse anyway, rather than
  // inventing a second opinion about who may spend the budget.
  //
  // ⚠️ AND IT IS DELIBERATELY NOT THE CAPABILITY MOST AGENT CONTROLS USE. This
  // comment claimed `editConfig` was "the same capability that gates every
  // other agent control"; /dry-audit checked and it is one of TWO vocabularies.
  // `AgentProposals` is the only other `editConfig` reader — `AgentConcerns`,
  // `AgentMemories` and `AgentReview` all use `manageFacility`, which the
  // facility manager holds and the owner also holds. Those are content
  // judgements the facility manager is meant to make; this spends money and is
  // owner-only. Copying the wrong half of that sentence onto a concerns control
  // would hide the facility manager's own workspace from them.
  const { role } = useProfile();
  const mayRun = role != null && hasCapability(role, "editConfig");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setNote(null);
    const result = await runTriageNow();
    // ⚠️ THREE OUTCOMES, CLASSIFIED BY THE SHARED PREDICATE. Until 2.773.0 this
    // read the response's `ok` field, which was `not reason` on the proxy while
    // `run_once` returns a reason on every path — so it was false for every
    // pass that had ever succeeded, and a textbook run that escalated three
    // subjects and investigated two reported "The check stopped".
    //
    // ⚠️ AND "FOUND NOTHING" IS NOT A FAILURE EITHER. A villa the assistant
    // judges well produces exactly that, and `reason.SYSTEM` says so outright:
    // "finding nothing is a good outcome and a complete answer".
    const outcome = result.ok ? outcomeOf(result.reason) : "blocked";
    setNote(
      !result.ok ? `Could not reach the villa: ${result.reason}`
      : outcome === "raised"
        ? `The check ran and raised something — ${result.reason}. It is in the `
          + "list above."
      : outcome === "quiet"
        ? "The check ran and found nothing worth raising, which is a complete "
          + "answer rather than a failure."
        : `The check could not run: ${result.reason}`);
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
      {/* ⚠️ THE NOTE IS RENDERED BY THE CALLER'S ROW, NOT UNDER THE BUTTON.
          This component now sits on the heading's line, so a paragraph inside
          it would push the heading's own row apart. */}
      {note && <p className="muted body-text" role="status">{note}</p>}
      <button className="btn ghost" disabled={busy} onClick={() => void run()}
              title="Run a check right now instead of waiting for the schedule. Costs about a cent; anything it flags appears in the list below.">
        {busy ? <Loader2 size={16} className="spin" aria-hidden />
              : <Play size={16} aria-hidden />}
        {/* ⚠️ THE WORDS GO AT THE PHONE TIER, THE ICON NEVER DOES. `.btn-label`
            is the same class the modal footer uses for exactly this, so there
            is one rule for "hide the word, keep the target" rather than two.
            The accessible name is on the button, so hiding the text never
            leaves the control unnamed. */}
        <span className="btn-label">Check the villa now</span>
      </button>
    </>
  );
}
