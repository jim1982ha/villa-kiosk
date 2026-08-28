// src/components/agent/AgentProposals.tsx
//
// The confirm turn, on the wall. TASK-083, REQ-029, ARCH-007.
//
// ⚠️ HUMAN-INITIATED IS NOT HUMAN-AUTHORISED, AND CHAT IS WHY. A message asking
// the villa to unlock the gate arrives as text, and text is the one channel an
// attacker can inject into — a note taped to the door, a forwarded message, a
// borrowed phone. So an authenticated owner ASKING is not consent. Consent is a
// separate act, on this surface, which the model cannot reach: there is no
// confirm TOOL, and there must never be one.
//
// ⚠️ THE COUNTDOWN IS THE CONTROL, NOT DECORATION. A proposal that outlives its
// context is the dangerous case: "unlock the gate for the cleaner" is reasonable
// to confirm within two minutes and reckless six hours later, when the cleaner
// has gone and the reason is forgotten. The card shows what is left, and the
// server refuses an expired key regardless of what this screen is showing — a
// tablet that slept through the expiry cannot confirm a stale action by having
// stale pixels on it.
//
// ⚠️ IT IS COMPUTED FROM `expires_at`, NEVER FROM A DURATION. A device that was
// asleep for five minutes must show the time that is ACTUALLY left, not the time
// that was left when the page last ran.
//
// ⚠️ AND THE CAPABILITY IS READ IN THE LEAF, like `AgentConcerns` and
// `AgentReview`. `test_cockpit_is_gated_nowhere` forbids a capability in
// either Cockpit shell — the modal exists so a profile WITHOUT `manageFacility`
// can still see the villa's state — so a control that needs one carries its own
// check. This one wants the OWNER, matching the proxy exactly: these are the
// actions that let somebody in or silence an alarm.

import { useCallback, useEffect, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import SourceChip from "@/components/common/SourceChip";

import { decideProposal, loadProposals, type Proposal } from "@/agent/agentApi";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";
import Loading from "@/components/common/Loading";

/** How often the countdown re-renders. ⚠️ ONE SECOND, and the list is re-read
 *  far less often: the clock is local arithmetic and the queue is a fetch. */
const TICK_MS = 1000;

/** `4:31` from seconds. Returns "" once there is nothing left, so the caller
 *  renders the expired state rather than a negative clock. */
function left(seconds: number): string {
  if (seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AgentProposals() {
  const { role } = useProfile();
  const mayConfirm = role != null && hasCapability(role, "editConfig");
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!mayConfirm) { setRows([]); return; }
    setRows(await loadProposals());
  }, [mayConfirm]);

  useEffect(() => { void load(); }, [load]);

  // ⚠️ THE CLOCK RUNS ONLY WHILE SOMETHING IS WAITING. A one-second interval on
  // a wall tablet that renders on demand is a real cost for a list that is
  // almost always empty.
  const waiting = (rows ?? []).length > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), TICK_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  const decide = useCallback(async (
    proposal: Proposal, decision: "confirm" | "decline",
  ) => {
    setBusy(proposal.action_key);
    setError(null);
    const result = await decideProposal(proposal.action_key, decision);
    setBusy(null);
    // ⚠️ RELOAD EITHER WAY. A refusal is usually "this expired while you were
    // reading it" or "another device answered first", and both mean the list on
    // screen is describing a past that no longer exists.
    if (!result.ok) setError(result.error);
    await load();
  }, [load]);

  if (rows === null) {
    return (
      <Loading />
    );
  }

  // ⚠️ NOTHING AT ALL WHEN NOTHING IS WAITING, which is the normal state and
  // must stay silent — a permanent "no actions pending" block on the villa's
  // status screen trains people to ignore the place these appear.
  if (rows.length === 0) return null;

  return (
    <>
      {/* ⚠️ AGENT-DERIVED, and on this wall that is not obvious: it
          sits between a list read straight from Home Assistant and a
          list written by automations. This one is an action the agent WANTS to take and may not — high-harm is proposed, never executed. */}
      <div className="reports-title-row">
        <div className="settings-section-title">Waiting for you to confirm</div>
        <SourceChip source="agent" />
      </div>
      <p className="muted body-text">
        The villa will not do any of these on its own, whatever it concludes and
        whoever asked. Each one can let somebody in or stop something
        protecting the property, so it needs a person.
      </p>

      <div className="cockpit-attention-list">
        {rows.map((p) => {
          const remaining = left(p.expires_at - now);
          return (
            <div className="editable-row-card cockpit-proposal" key={p.action_key}>
              <div className="cockpit-proposal-head">
                <ShieldAlert size={18} aria-hidden className="sev-warning" />
                <span className="cockpit-proposal-what">
                  {p.service.replace(/_/g, " ")} — {p.ref}
                </span>
                {/* ⚠️ THE CLOCK IS PART OF THE DECISION and sits beside it. A
                    countdown at the bottom of a card is read after the button
                    has been pressed. */}
                <span className={`cockpit-proposal-clock${
                  remaining ? "" : " sev-warning"}`}>
                  {remaining ? `${remaining} left` : "expired"}
                </span>
              </div>

              {p.why && <p className="body-text">{p.why}</p>}
              <p className="muted body-text cockpit-review-desc">
                {p.reason || "This action is classed as high harm."}
                {" · "}{p.entity_id}
              </p>

              {mayConfirm && (
                <div className="modal-footer-actions cockpit-review-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy === p.action_key}
                    onClick={() => void decide(p, "decline")}
                  >
                    <X size={16} aria-hidden /> No
                  </button>
                  {/* ⚠️ DISABLED ONCE THE CLOCK RUNS OUT, and the server refuses
                      it independently. Two gates, because this screen can be
                      stale and the villa must not act on stale pixels. */}
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy === p.action_key || !remaining}
                    onClick={() => void decide(p, "confirm")}
                  >
                    <Check size={16} aria-hidden /> Yes, do it
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="body-text sev-warning" role="alert">{error}</p>}
    </>
  );
}
