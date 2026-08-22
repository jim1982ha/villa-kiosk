// src/components/cockpit/CockpitConcerns.tsx
//
// What the agent has concluded, on the wall. TASK-061, TASK-062.
//
// ⚠️ THE WALL IS NOT A NOTIFICATION CHANNEL. It renders every open concern,
// live and offline, with no routing decision involved — it is the state of the
// villa, always true. `route.py` decides what gets PUSHED; this decides
// nothing. Confusing the two is how a `notice` ends up buzzing a phone.
//
// ⚠️ AND IT RENDERS DURING SHADOW MODE TOO, deliberately. Shadow suppresses
// what the villa ORIGINATES — a push, a brief — and the wall is somewhere a
// person chose to look. Suppressing it would hide the very evidence a shadow
// period exists to gather.
//
// ⚠️ THE TWO BUTTONS ARE THE HALF THAT HAS NEVER EXISTED. RPT-05: "No
// acknowledgement mechanism anywhere, so no rule can be judged noisy… Neither
// half exists." Three "not useful" on one subject suppress it — by a COUNTER in
// the store, never by agent judgement, because "stop telling me about the gym
// lights" must work reliably rather than probabilistically.

import { useCallback, useEffect, useState } from "react";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";

import { loadConcerns, sendConcernFeedback } from "@/agent/agentApi";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";
import type { Concern } from "@/agent/agentTypes";

/** Worst first. ⚠️ With no prose to carry the weight, the ORDER is the report. */
const RANK: Record<string, number> = {
  critical: 0, warning: 1, notice: 2, info: 3,
};

/** ⚠️ Settled concerns are not shown: closed, verified and dismissed are the
 *  record, not the state of the villa. */
const LIVE = new Set(["open", "acted"]);

export default function CockpitConcerns() {
  // ⚠️ THE CAPABILITY IS READ HERE, IN THE LEAF, AND NOT PASSED DOWN FROM A
  // SHELL. `test_cockpit_is_gated_nowhere` forbids `manageFacility` in
  // `CockpitModal` and in `CockpitTab` — the modal exists precisely so a
  // profile WITHOUT it can reach this view, and a check in the shared body is
  // one step from becoming a check on the view itself. Two buttons are a
  // CONTROL rather than the view, so they carry their own check where every
  // other control does.
  //
  // ⚠️ AND IT IS COSMETIC. The server refuses a non-owner, non-FM verdict
  // regardless; this only avoids rendering a button that could only ever 403.
  const { role } = useProfile();
  const canJudge = role != null && hasCapability(role, "manageFacility");
  const [rows, setRows] = useState<Concern[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await loadConcerns();
    setRows(found.filter((c) => LIVE.has(String(c.state ?? "open")))
      .sort((a, b) => (RANK[String(a.severity)] ?? 9)
        - (RANK[String(b.severity)] ?? 9)));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const judge = useCallback(async (id: string, useful: boolean) => {
    setBusy(id);
    await sendConcernFeedback(id, useful);
    setBusy(null);
    void load();
  }, [load]);

  if (rows === null) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Loading…
      </p>
    );
  }

  // ⚠️ NOTHING AT ALL WHEN THERE IS NOTHING, rather than a green "all clear".
  // An empty concern list means nobody has raised anything — which is not the
  // same as the villa being well, and the health headline above already speaks
  // to that from data the kiosk measured itself.
  if (rows.length === 0) return null;

  return (
    <>
      <div className="settings-section-title">What the villa has noticed</div>
      <div className="cockpit-attention-list">
        {rows.map((c) => (
          <div className="editable-row" key={c.id}>
            <div className="editable-row-fields" style={{ alignItems: "flex-start" }}>
              <span className={`cockpit-concern-sev cockpit-sev-${c.severity}`}>
                {String(c.severity)}
              </span>
              <span className="body-text" style={{ flex: "1 1 200px", minWidth: 0 }}>
                {c.title}
              </span>
            </div>
            {canJudge && (
              <>
                <button
                  type="button" className="icon-btn" disabled={busy === c.id}
                  aria-label={`Useful: ${c.title}`}
                  onClick={() => void judge(c.id, true)}
                >
                  <ThumbsUp size={16} aria-hidden />
                </button>
                <button
                  type="button" className="btn danger icon-only"
                  disabled={busy === c.id}
                  aria-label={`Not useful: ${c.title}`}
                  onClick={() => void judge(c.id, false)}
                >
                  <ThumbsDown size={16} aria-hidden />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
