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

export default function RunCheckNow({ onDone, onNote }: {
  onDone?: () => void;
  /** ⚠️ SAID BY THE CALLER, AND ONLY WHEN THE CHECK DID NOT RUN. Reported by
   *  the owner (2026-08-28): pressing the button grew a SECOND paragraph inside
   *  the summary's flex row, which pushed "Check the villa now" to a new
   *  position and put a sentence beside the totals that appeared to contradict
   *  them — the totals covered every check listed, the new sentence covered the
   *  one just run. Their instruction was exact: "I expect no additional text
   *  section to appear and the Check the villa button not to move. If the text
   *  from the left need to be refreshed: directly refresh it."
   *
   *  So a successful check now says nothing here at all. It does not need to:
   *  `onDone` refetches the checks, the summary sentence recomputes in place,
   *  and the check itself appears as a new card in the list below. A FAILURE
   *  still needs words, because nothing else on screen changes when a check
   *  never ran — and it is rendered outside the toolbar row, where it cannot
   *  move the button. */
  onNote?: (message: string) => void;
}) {
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

  const run = useCallback(async () => {
    setBusy(true);
    onNote?.("");
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
    //
    // ⚠️ AND THE TWO OUTCOMES THAT RAN NOW SAY NOTHING HERE. `raised` used to
    // print the reason string VERBATIM — "escalated 1 (investigated 1): Jacuzzi
    // pump energy" — which is the scheduler's vocabulary, not the screen's: in
    // this app "escalated" means chasing an unacknowledged concern, while the
    // backend uses it for "sent a flag to be investigated". So the one sentence
    // an owner read after pressing the button used the tab's most loaded word
    // to mean the opposite thing. The list below already shows the check, its
    // flag and what came of it, in the screen's own words.
    const outcome = result.ok ? outcomeOf(result.reason) : "blocked";
    if (!result.ok) {
      onNote?.(`The check could not be started: ${result.reason}`);
    } else if (outcome === "blocked") {
      onNote?.(`The check did not run: ${result.reason}`);
    }
    setBusy(false);
    onDone?.();
  }, [onDone, onNote]);

  // ⚠️ OWNER-ONLY, AND HIDDEN RATHER THAN DISABLED. The route is owner-only
  // server-side because it spends the budget (`auth/permissions.ts` is a
  // rendering convenience; the proxy is the enforcer). A disabled button would
  // advertise a control the reader can never use.
  if (!mayRun) return null;

  // ⚠️ THE BUTTON AND NOTHING ELSE. It is rendered into the summary's flex row,
  // so ANY sibling this component returns becomes a second item in that row and
  // moves the button — which is exactly what was reported. Whatever needs
  // saying goes through `onNote`, to a slot outside the row.
  return (
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
  );
}
