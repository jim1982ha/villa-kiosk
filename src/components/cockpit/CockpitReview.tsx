// src/components/cockpit/CockpitReview.tsx
//
// The half of TASK-094 that makes the queue reachable: procedures the agent has
// proposed, and a person deciding on each one.
//
// ⚠️ A PLAYBOOK THE AGENT WROTE AND APPROVED BY ITSELF IS HOW A WRONG
// ASSUMPTION BECOMES PERMANENT. `review.py`'s own header states it: everything
// else the agent produces is read once and closed, while a playbook is
// consulted on every future investigation of its class, so an error in one
// compounds silently and looks like expertise. The backend and its routes
// shipped in v2.650.0 and this did not, which meant the queue could fill and
// nothing could empty it — a draft could not become live, but nor could it be
// refused, and the cap (`MAX_PENDING`) would eventually stop the agent
// proposing at all. A gate nobody can open is a gate that jams shut.
//
// ⚠️ APPROVE IS DISABLED UNTIL THE DRAFT HAS BEEN OPENED, and that is the one
// piece of UI here doing real work. The task's architectural constraint is
// "NOTHING enters the live playbook set without human approval" — and approval
// of text nobody has read is approval in name only, which is exactly the
// failure the constraint is written against. Discard needs no such gate: a
// refusal is recorded rather than deleted, and refusing something unread costs
// nothing but a re-proposal.
//
// ⚠️ THE EDIT IS PART OF APPROVING, NOT A SEPARATE SAVE — `review.approve`
// takes the edited body with the decision. The realistic case is a reviewer who
// agrees with most of a draft and wants one paragraph changed; making that a
// second step is how they approve it unchanged instead.
//
// ⚠️ AND THE CAPABILITY IS READ HERE, IN THE LEAF. `test_cockpit_is_gated_
// nowhere` forbids `manageFacility` in `CockpitModal` and `CockpitTab` — the
// modal exists precisely so a profile without it can reach the Cockpit view —
// so a control that needs the capability owns its own check, exactly as
// `CockpitConcerns` does. It is cosmetic either way: the proxy refuses a guest's
// decision whatever the browser sends.

import { useCallback, useEffect, useState } from "react";
import InfoHint from "@/components/common/InfoHint";
import { Check, ChevronDown, ChevronRight, Loader2, Trash2 } from "lucide-react";
import SourceChip from "@/components/common/SourceChip";

import { decideReviewDraft, loadReviewDrafts, type ReviewDraft } from "@/agent/agentApi";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";

export default function CockpitReview() {
  const { role } = useProfile();
  const canReview = role != null && hasCapability(role, "manageFacility");
  const [rows, setRows] = useState<ReviewDraft[] | null>(null);
  /** Which draft is open, and the reviewer's working copy of its body.
   *  ⚠️ ONE AT A TIME: two open procedures on a tablet is a wall of prose, and
   *  the decision is made about one draft by definition. */
  const [open, setOpen] = useState<string | null>(null);
  const [edited, setEdited] = useState("");
  /** Every draft the reviewer has actually opened this session — what gates
   *  Approve. Kept per slug rather than as one flag so closing a draft does not
   *  un-read it, and so approving one does not unlock the next. */
  const [read, setRead] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { setRows(await loadReviewDrafts()); }, []);
  useEffect(() => { void load(); }, [load]);

  const expand = (draft: ReviewDraft) => {
    const next = open === draft.slug ? null : draft.slug;
    setOpen(next);
    if (next) {
      setEdited(draft.body);
      setRead((current) => new Set(current).add(draft.slug));
    }
  };

  const decide = useCallback(async (
    draft: ReviewDraft, decision: "approve" | "discard",
  ) => {
    setBusy(draft.slug);
    setError(null);
    // ⚠️ THE EDITED BODY ONLY WHEN IT IS THE ONE ON SCREEN. `edited` belongs to
    // whichever draft is open, so sending it for a row the reviewer never
    // expanded would write one draft's text into another's file.
    const ok = await decideReviewDraft(draft.slug, decision,
      decision === "approve" && open === draft.slug ? { body: edited } : {});
    setBusy(null);
    if (!ok) {
      setError("That decision was not recorded. The draft is unchanged.");
      return;
    }
    setOpen(null);
    void load();
  }, [edited, open, load]);

  if (rows === null) {
    return (
      <p className="muted body-text">
        <Loader2 size={14} className="spin" aria-hidden /> Loading…
      </p>
    );
  }

  // ⚠️ NOTHING AT ALL WHEN THE QUEUE IS EMPTY, which is the normal state —
  // `MIN_TOOL_CALLS` refuses a lookup and most investigations should propose
  // nothing. An "all reviewed" placeholder would put a permanent empty section
  // on the villa's status screen to report a non-event, and would read as a
  // feature that is broken rather than one that is quiet.
  if (rows.length === 0) return null;

  return (
    <>
      {/* ⚠️ AGENT-DERIVED, and on this wall that is not obvious: it
          sits between a list read straight from Home Assistant and a
          list written by automations. This one is a procedure the agent WROTE and may not use until a person approves it. */}
      <div className="reports-title-row">
        <div className="settings-section-title">
        Proposed procedures — {rows.length} waiting
      </div>
        <SourceChip source="agent" />
      </div>
      <p className="muted body-text">
          The villa wrote these after investigating, and asks whether to keep them.
          <InfoHint label="Proposed notes">
            An approved one is consulted every time something similar happens again.
            Nothing here is in use until you say so.
          </InfoHint>
        </p>

      <div className="cockpit-attention-list">
        {rows.map((draft) => (
          <div className="editable-row-card" key={draft.slug}>
            <button
              type="button"
              className="cockpit-review-head"
              aria-expanded={open === draft.slug}
              onClick={() => expand(draft)}
            >
              {open === draft.slug
                ? <ChevronDown size={16} aria-hidden />
                : <ChevronRight size={16} aria-hidden />}
              <span className="cockpit-review-title">
                {draft.title}
                {draft.domain && (
                  <span className="muted"> · {draft.domain}</span>
                )}
              </span>
            </button>
            <p className="muted body-text cockpit-review-desc">
              {draft.description || "No description was written."}
            </p>
            {/* ⚠️ THE SOURCE IS SHOWN, NOT HIDDEN BEHIND THE EXPANDER. "What
                made the villa think this" is the first question a reviewer has
                and the one thing that separates a procedure derived from an
                investigation from one derived from a device's own name — the
                boundary `review.py` and `memory.py` both state. */}
            <p className="muted body-text cockpit-review-desc">
              From {draft.source || "an unrecorded investigation"}
              {draft.proposedAt ? ` · proposed ${draft.proposedAt}` : ""}
            </p>

            {open === draft.slug && (
              <textarea
                className="cockpit-review-body"
                value={edited}
                spellCheck={false}
                aria-label={`Procedure text for ${draft.title}`}
                onChange={(e) => setEdited(e.target.value)}
              />
            )}

            {canReview && (
              <div className="modal-footer-actions cockpit-review-actions">
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy === draft.slug}
                  onClick={() => void decide(draft, "discard")}
                >
                  <Trash2 size={16} aria-hidden /> Discard
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy === draft.slug || !read.has(draft.slug)}
                  title={read.has(draft.slug)
                    ? "Add this to the villa's own playbooks"
                    : "Open it first — an approved procedure is used on every "
                      + "similar investigation from now on"}
                  onClick={() => void decide(draft, "approve")}
                >
                  <Check size={16} aria-hidden /> Approve
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="body-text sev-warning" role="alert">{error}</p>}
    </>
  );
}
