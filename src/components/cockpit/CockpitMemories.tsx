// src/components/cockpit/CockpitMemories.tsx
//
// What the villa believes, and the one way to tell it otherwise. TASK-110,
// REQ-056.
//
// ⚠️ THE REQUIREMENT WAS GUARDED AND UNREACHABLE. `memory.write()` has always
// refused to overwrite a `corrected` memory, and that is tested — but
// `memory.correct()` is the only path that SETS that state and nothing called
// it. No route, no control. So the guard protected a state nothing could enter,
// and "a human correction outranks and is never overwritten" described
// something that could not happen. Found by the mechanical reachability check
// (TASK-109) after a careful row-by-row read of the requirement had ticked it.
//
// ⚠️ A CORRECTION APPENDS; IT DOES NOT REPLACE. The original claim stays
// readable beneath it, because "what did it think, and what did we tell it" is
// the record that makes a wrong conclusion traceable rather than merely gone.
// That rule lives in `memory.correct`, not here — this screen only collects the
// sentence.
//
// ⚠️ AND IT SENDS NO IDENTITY. The corrector is the session's role, resolved
// server-side; a browser-supplied name is a claim about identity rather than a
// fact about it.
//
// ⚠️ THE CAPABILITY IS READ IN THE LEAF, like every other Cockpit block —
// `test_cockpit_is_gated_nowhere` forbids one in either shell. This wants the
// pair that may judge a concern or a playbook draft: a memory is asserted into
// the context of every future run, so contradicting one compounds the way a
// procedure does rather than being read once and closed.

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import SourceChip from "@/components/common/SourceChip";

import { correctMemory, loadMemories, type VillaMemory } from "@/agent/agentApi";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";

/** How much of a claim is shown before it is worth opening the row. */
const CLAIM_PREVIEW = 160;

export default function CockpitMemories() {
  const { role } = useProfile();
  const canCorrect = role != null && hasCapability(role, "manageFacility");
  const [rows, setRows] = useState<VillaMemory[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");

  const load = useCallback(async () => {
    setRows(await loadMemories());
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async (subjectKey: string) => {
    const note = text.trim();
    if (!note) return;
    setBusy(true);
    setFailed("");
    const out = await correctMemory(subjectKey, note);
    // ⚠️ THE SERVER'S REASON IS SHOWN. "Nothing happened" has several causes —
    // a memory that expired between load and save, a role that changed — and
    // each is a sentence the server already wrote.
    if (!out.ok) setFailed(out.reason || "the correction could not be saved");
    else { setEditing(null); setText(""); }
    setBusy(false);
    await load();
  }, [text, load]);

  if (rows === null) return null;
  // ⚠️ NOTHING AT ALL WHEN THE VILLA HAS LEARNED NOTHING, rather than an empty
  // heading. A fresh install has no memories and that is the correct state, not
  // a gap to explain.
  if (rows.length === 0) return null;

  return (
    <>
      {/* ⚠️ AGENT-DERIVED, and on this wall that is not obvious: it
          sits between a list read straight from Home Assistant and a
          list written by automations. This one is what the agent has come to believe about this villa, in its own words. */}
      <div className="reports-title-row">
        <div className="settings-section-title">What the villa believes</div>
        <SourceChip source="agent" />
      </div>
      <p className="muted body-text">
        Claims it has formed about this property and uses in every later check.
        Correcting one does not erase it — your note is added underneath and
        outranks it from then on.
      </p>
      {failed ? <p className="body-text sev-warning" role="alert">{failed}</p> : null}
      <div className="cockpit-attention-list">
        {rows.map((m) => (
          <div className="editable-row" key={m.subjectKey}>
            <div className="editable-row-fields" style={{ alignItems: "flex-start" }}>
              <span className="body-text" style={{ flex: "1 1 240px", minWidth: 0 }}>
                {m.claim.length > CLAIM_PREVIEW
                  ? `${m.claim.slice(0, CLAIM_PREVIEW)}…` : m.claim}
                {m.corrections.length > 0 && (
                  <>
                    <br />
                    <span className="muted">
                      Corrected: {m.corrections[m.corrections.length - 1]}
                    </span>
                  </>
                )}
              </span>
              {/* ⚠️ A DIRECT CHILD OF `.editable-row-fields`, NOT NESTED IN THE
                  SPAN ABOVE. `.editable-row-fields > input` is what gives this
                  its sizing and its `min-height: var(--touch-min)`, and that
                  selector is a DIRECT-CHILD one on purpose — the stylesheet
                  says so at the rule: a descendant selector would reach into
                  every nested component that happens to sit in a field. A first
                  draft nested it and invented an `fm-input` class that does not
                  exist, which would have shipped an unstyled box with no touch
                  target on a phone — the same defect phone-parity caught in
                  `CockpitQueue` one release earlier. */}
              {editing === m.subjectKey && (
                <input
                  type="text" value={text}
                  autoFocus maxLength={500}
                  placeholder="What is actually true?"
                  aria-label={`Correction for: ${m.claim.slice(0, 60)}`}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit(m.subjectKey);
                    if (e.key === "Escape") { setEditing(null); setText(""); }
                  }}
                />
              )}
            </div>
            {canCorrect && (editing === m.subjectKey ? (
              <>
                <button type="button" className="icon-btn" disabled={busy}
                  aria-label="Save this correction"
                  onClick={() => void submit(m.subjectKey)}>
                  {busy ? <Loader2 size={16} className="spin" aria-hidden />
                        : <Check size={16} aria-hidden />}
                </button>
                <button type="button" className="btn ghost icon-only"
                  disabled={busy} aria-label="Cancel"
                  onClick={() => { setEditing(null); setText(""); }}>
                  <X size={16} aria-hidden />
                </button>
              </>
            ) : (
              <button type="button" className="icon-btn"
                aria-label={`Correct this: ${m.claim.slice(0, 60)}`}
                onClick={() => { setEditing(m.subjectKey); setText(""); }}>
                <Pencil size={16} aria-hidden />
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
