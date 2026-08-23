// src/components/settings/ShadowDiffPanel.tsx
//
// What the shadow period found, beside what the rules found. TASK-050/051.
//
// ⚠️ THIS IS THE PH-3 GATE'S ONLY SURFACE, AND UNTIL NOW THE GATE HAD NONE.
// `shadow.diff()` and `shadow.report()` shipped in v2.642.0 with no caller —
// no route, no UI, no command — so the document `TASK-051` asks an owner to
// read could not be produced at all. The checkpoint blocks PH-4 and PH-5, which
// is two whole phases waiting on a page nothing rendered. Same shape as the
// review queue, found the same way: by asking what actually calls the thing.
//
// ⚠️ IT SHOWS THE RENDERED DOCUMENT, NOT A RE-LAYOUT OF ITS PARTS. `report()`
// orders the sections as an argument — what the agent MISSED first, its wins
// last, deliberately, because "this page exists to decide whether to retire
// working automations and a page that opens with the agent's wins is a page
// written to be agreed with". Rebuilding that as three pretty cards here would
// be a second opinion about what the reader should weigh first, in a component
// that has no business having one. The counts above it are navigation, not a
// summary: they say whether the document is worth opening at all.
//
// ⚠️ AND IT IS DELIBERATELY NOT IN THE COCKPIT. The Cockpit is open to every
// profile and shows the state of the VILLA; this is a decision about how the
// villa is SUPERVISED, it is owner-only on the server, and it belongs beside
// the switches that act on it.

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { loadShadowDiff, type ShadowDiff } from "@/agent/agentApi";

export default function ShadowDiffPanel() {
  /** ⚠️ THREE STATES, NOT TWO. `undefined` is "not asked yet", `null` is "asked
   *  and could not read it", and a value is an answer — which may legitimately
   *  be an empty diff. Collapsing the middle one renders a failed read as a
   *  clean period, and this is the page a cutover is decided on. */
  const [diff, setDiff] = useState<ShadowDiff | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setDiff(await loadShadowDiff());
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (diff === undefined) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Reading the shadow
        period…
      </p>
    );
  }

  if (diff === null) {
    return (
      <p className="body-text sev-warning" role="alert">
        The shadow diff could not be read. That is not the same as an empty
        one — nothing here should be taken as evidence either way.
      </p>
    );
  }

  const nothingYet = diff.agentTotal === 0 && diff.rulesTotal === 0;

  return (
    <div className="fm-stack">
      <p className="muted body-text">
        While “Observe only” is on, the villa runs everything and delivers
        nothing. This is what it concluded, beside what the existing automations
        concluded over the same period — the evidence for deciding, family by
        family, whether a rule can be retired.
      </p>

      <div className="usage-total">
        <strong>{diff.rulesOnly.length}</strong>
        <span className="muted">
          caught by the rules and not by the agent — the regressions a cutover
          would ship. {diff.both.length} caught by both;{" "}
          {diff.agentOnly.length} by the agent alone.
        </span>
      </div>

      {!diff.coverageComplete && (
        <div className="fm-banner">
          Coverage was incomplete for this period, so a subject missing from
          both columns proves nothing — neither layer was watching throughout.
        </div>
      )}

      {nothingYet && (
        // ⚠️ NAMED RATHER THAN RENDERED AS A CLEAN RESULT. A period neither
        // layer has reported on yet looks exactly like a period in which
        // nothing was wrong, and one of those is a reason to cut over.
        <div className="fm-banner">
          Neither layer has recorded anything yet. On a villa that has just been
          switched on this means the period has not run, not that it was quiet —
          leave it a full cadence before reading anything into this page.
        </div>
      )}

      {/* ⚠️ `pre`, BECAUSE THE DOCUMENT'S OWN SHAPE IS ITS ARGUMENT. Its
          section order is deliberate and its indentation carries the grouping;
          reflowing it as prose would lose both. */}
      <pre className="diag-report">{diff.report}</pre>

      <div className="modal-actions" style={{ margin: 0 }}>
        <button className="btn ghost" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} aria-hidden /> Re-read
        </button>
      </div>
    </div>
  );
}
