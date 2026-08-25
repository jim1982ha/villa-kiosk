// src/components/agent/RecentChecks.tsx
//
// The triage trace: did the villa look, and what happened when it did.
//
// ⚠️ EXTRACTED BECAUSE THE TRIAGE TAB WAS BLANK (2.753.0). It rendered a step
// header and `CockpitQueue`, and that component correctly returns `null` in
// `auto` mode — its own comment says an empty approval queue on a villa that
// investigates by itself "is not information, it is the permanent and correct
// state". True in the Cockpit, where it is one block among many. On a tab whose
// entire job is to show this tier, it left a heading over nothing, which is the
// silent-subsystem defect this project keeps paying for: correct behaviour that
// reads as a broken feature. The tier's real output was already being recorded
// and was only visible on the Handover page, three clicks away under Advanced.
//
// ⚠️ ONE COMPONENT, TWO CALL SITES, and the pass→outcome rules stay in
// `ShadowDiffPanel` where they are pinned (`test_pass_reason_contract.py`). A
// second copy of "what does `nothing to escalate` mean" is exactly the drift
// that pin exists to stop — so this imports them rather than restating them.

import { Pager, usePaged } from "@/components/common/Paged";
import { outcomeOf, reasonOf, subjectsOf } from "@/components/settings/ShadowDiffPanel";
import type { TriagePass } from "@/agent/agentApi";

export default function RecentChecks({ passes, empty, children }: {
  passes: TriagePass[];
  /** What to say when nothing has run. ⚠️ DIFFERENT PER TAB: on Handover an
   *  empty trace invalidates the comparison above it; on Triage it just means
   *  the villa has not looked yet. */
  empty: React.ReactNode;
  /** Anything for the pager's own row — the CSV button, on Handover. */
  children?: React.ReactNode;
}) {
  const rows = [...passes].reverse().map((p) => {
    const reason = reasonOf(p);
    return { pass: p, reason, outcome: outcomeOf(reason) };
  });
  const paged = usePaged(rows);

  if (rows.length === 0) return <p className="muted body-text">{empty}</p>;

  return (
    <>
      <Pager paged={paged} unit="check">{children}</Pager>
      {/* ⚠️ `.fm-list` — WHICH IS A FLEX COLUMN OF ROWS, NOT A BULLETED LIST.
          It was the one list class in styles.css that did not reset
          `list-style`, so every row here drew a marker; reported as clutter. */}
      <ul className="fm-list">
        {paged.page.map(({ pass, reason, outcome }, i) => {
          const who = subjectsOf(reason);
          return (
            <li key={`${pass.at}-${i}`} className="body-text">
              <span className="muted">
                {pass.at.replace("T", " ").slice(0, 16)}
              </span>{" · "}
              {/* ⚠️ PLAIN LANGUAGE, AND THE NUMBERS ONLY WHERE THEY CHANGE A
                  READING. `doc=5246c/51L | escalated=0 | model=…` on thirty rows
                  is the same string thirty times; the one part that ever matters
                  — a pass handed nothing to read — is called out below, and all
                  of it survives in the CSV. */}
              {outcome === "raised" ? (
                <>
                  <strong>Raised {pass.escalated ?? ""}</strong>
                  {who ? <> — {who}</> : null}
                </>
              ) : outcome === "quiet" ? (
                <>Looked, nothing to raise</>
              ) : (
                <>
                  <strong className="sev-warning">Could not run</strong>
                  {" — "}{reason}
                </>
              )}
              {/* ⚠️ NOT ON A BLOCKED ROW. A pass that never reached the model has
                  no document by construction, so this would fire on every "could
                  not run" row and say a second thing about a row that has
                  already explained itself. The fault it reports is a pass that
                  RAN on nothing. */}
              {outcome !== "blocked" && pass.docChars === 0 && (
                <span className="sev-warning"> · nothing to read</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
