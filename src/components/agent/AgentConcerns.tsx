// src/components/agent/AgentConcerns.tsx
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
import InfoHint from "@/components/common/InfoHint";
import { Eye, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";

import { acknowledgeConcern, loadAgentConfig, loadConcerns,
         sendConcernFeedback } from "@/agent/agentApi";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";
import SourceChip from "@/components/common/SourceChip";
import { LifecycleChip, SettledSummary } from "@/components/agent/ConcernLifecycle";
import { severityRank, type Concern } from "@/agent/agentTypes";

/** ⚠️ Settled concerns are not shown: closed, verified and dismissed are the
 *  record, not the state of the villa. */
const LIVE = new Set(["open", "acted"]);

/** Profile ids as a person reads them on the People tab. ⚠️ `ops` IS THE
 *  FACILITY MANAGER — the store's word and the screen's word differ, and
 *  showing the store's would name a role nobody has heard of. */
const PROFILE_NAME: Record<string, string> = {
  owner: "Owner",
  ops: "Facility manager",
  guest: "Guest",
};

/** `sent to Owner 26 Aug 14:27` — and every later send after it.
 *
 *  ⚠️ EVERY SEND, NOT THE LAST ONE. The escalation ladder re-sends to a SECOND
 *  profile ("add the owner" is the whole point of the middle band), so a card
 *  showing only one would say the facility manager was told and never mention
 *  that the owner was too — or the reverse. The list is appended to by both the
 *  delivery sweep and the escalation sweep for exactly this reason.
 *
 *  ⚠️ AND CONCERNS RAISED BEFORE 2.782.0 HAVE NO LIST. Falling back to the
 *  AUDIENCE is honest — it says who the concern was written FOR, which is what
 *  decided the profile — and saying nothing would read as "never sent" beside
 *  a `delivered_at` that says otherwise. */
function sentSummary(c: Concern): string {
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? "" : ` ${d.toLocaleString(undefined, { day: "numeric", month: "short",
                                               hour: "2-digit", minute: "2-digit" })}`;
  };
  const rows = c.deliveries ?? [];
  if (rows.length === 0) {
    const profile = c.audience === "facility" ? "ops" : "owner";
    return `sent to ${PROFILE_NAME[profile] ?? profile}${when(c.delivered_at ?? "")}`;
  }
  return "sent to " + rows
    .map((r) => `${PROFILE_NAME[r.profile] ?? r.profile}${when(r.at)}`)
    .join(", then ");
}


export default function AgentConcerns() {
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
  const [settled, setSettled] = useState<Concern[]>([]);
  const [shadow, setShadow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // ⚠️ THE SHADOW FLAG IS READ WITH THE CONCERNS, because an empty list means
    // two completely different things depending on it. During a shadow period
    // `concerns.raise_concern` writes to a SEPARATE store — `sources.concern_rows`
    // is shadow-aware and says so at its own docstring — and this endpoint
    // serves the LIVE one. So the wall showed nothing while the shadow store
    // filled, which is exactly the failure the proxy already documents for
    // briefings: "indistinguishable from an agent that found nothing". The
    // owner hit it, having just been told an investigation had concluded.
    const cfg = await loadAgentConfig().catch(() => null);
    // ⚠️ `mode`, ONE KEY SINCE 2.756.0 — and anything unrecognised reads as
    // "observe", the direction that says "you are being told nothing" rather
    // than implying delivery on a villa that is in fact silent.
    setShadow(cfg?.config?.mode !== "live" && cfg?.config?.mode !== "ask");
    const found = await loadConcerns();
    // ⚠️ THE SETTLED ONES ARE KEPT NOW, NOT DISCARDED. They were filtered out
    // at the door on the reasoning that "closed, verified and dismissed are the
    // record, not the state of the villa" — true of the LIST, and it threw away
    // the record entirely. The HLD reads verification, noise measurement and
    // time-to-clear off exactly those rows, so they are summarised below the
    // list instead of being dropped.
    setSettled(found.filter((c) => !LIVE.has(String(c.state ?? "open"))));
    setRows(found.filter((c) => LIVE.has(String(c.state ?? "open")))
      // ⚠️ `severityRank`, NOT A LOCAL MAP. This carried its own copy with an
      // unknown severity defaulting to 9 — LAST, the quietest position — which
      // is the opposite of the project's stated rule. Found by /dry-audit
      // Part 4; the identical map existed in `agent/fallback.py`.
      .sort((a, b) => severityRank(String(a.severity))
        - severityRank(String(b.severity))));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const judge = useCallback(async (id: string, useful: boolean) => {
    setBusy(id);
    await sendConcernFeedback(id, useful);
    setBusy(null);
    void load();
  }, [load]);

  /** ⚠️ A THIRD VERB, NOT A THIRD OPINION. Useful/not-useful judges whether the
   *  concern was worth raising; this says only that somebody has it, which is
   *  what stops the escalation ladder. Until TASK-112 nothing in this system
   *  could say it, so escalation could only ever run forever — the precise
   *  failure alert fatigue names. */
  const acknowledge = useCallback(async (id: string) => {
    setBusy(id);
    await acknowledgeConcern(id);
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
  if (rows.length === 0) {
    // ⚠️ SILENCE IS ONLY HONEST WHEN IT MEANS "NOTHING WAS RAISED". While
    // "stay silent" is on, findings are written to a SEPARATE store that this
    // surface does not read — so an empty list here can equally mean the
    // assistant has been concluding things for weeks and none of them reached
    // this screen. The owner met exactly that: told an investigation had
    // finished, then shown an empty tab. Saying which of the two it is costs
    // one sentence and is the difference between a quiet villa and a broken
    // one.
    if (!shadow) return null;
    return (
      <>
        <div className="settings-section-title">
          Concerns — what the villa concluded
        </div>
        <p className="muted body-text">
          Nothing is shown here while “stay silent” is switched on.
          <InfoHint label="Why this is empty">
            Findings are still being written down, separately, so you can review
            a whole period before anything is sent. Turn “stay silent” off under
            Settings to see them here as they are raised; the comparison against
            your old automations is under Cost, people and advanced.
          </InfoHint>
        </p>
      </>
    );
  }

  return (
    <>
      {/* ⚠️ THE HEADING NOW CONTAINS THE WORD THE REST OF THE PRODUCT USES.
          "What the villa has noticed" is good plain language and it was
          unfindable: the plan, the briefs, the API and the settings all call
          these CONCERNS, and an owner reading any of those and scanning this
          screen for the word found nothing. Plain language is right for the
          explanation, not for the noun somebody is searching for — so the
          section carries both. */}
      <div className="settings-section-title">Concerns — what the villa concluded</div>
      {/* ⚠️ "Nothing done yet" READS AS "SOMETHING IS STILL COMING" AND IT IS
          NOT. Reported: two delivered warnings sitting at that state, and
          "I didn't click to stop escalating, though I don't see any escalation
          anywhere". Nothing is wrong — `route.escalate`'s FIRST line is
          `if severity != "critical": return (False, "", "only a critical
          escalates")`, so a warning is sent once and then waits for a person,
          by design. What was missing is anywhere saying so: the chip describes
          the concern's own state and the reader infers a chase that was never
          going to happen. */}
      {/* ⚠️ THE OLD LINE ANSWERED A QUESTION NOBODY HAD ASKED YET. "A warning is
          sent once and then waits for you" is a fact about the ESCALATION
          ladder, which matters only once a reader knows what these rows ARE and
          why they are on this screen at all. That is what the owner asked for,
          and it is the first thing a tier tab should say. */}
      <p className="muted body-text">
        Everything the assistant investigated and judged worth telling you
        about. Each one was raised during a check and is waiting for you to say
        you have seen it.
        <InfoHint label="What gets chased">
          <p>
            Only a critical concern is chased. If nobody acknowledges one, the
            villa re-sends it, and then brings the owner in.
          </p>
          <p>
            A warning is told to you once. It stays here at &ldquo;nothing done
            yet&rdquo; until somebody acts on it or the condition stops on its
            own — nothing further will arrive on your phone about it.
          </p>
          <p>
            So a warning sitting here is the system working, not a chase that
            failed.
          </p>
        </InfoHint>
      </p>
      <div className="cockpit-attention-list">
        {rows.map((c) => (
          <div className="editable-row" key={c.id}>
            <div className="editable-row-fields" style={{ alignItems: "flex-start" }}>
              {/* ⚠️ THE FOUR FACTS ARE ONE BLOCK, STACKED, NOT FOUR SIBLINGS OF
                  THE TITLE (2.765.0). They sat inline with it, so on any real
                  concern the title was squeezed into whatever was left after
                  three chips and a word — and the title is the only part that
                  says what actually happened. Reported: "give more space to
                  description". Stacked, they occupy one narrow column and the
                  sentence gets the rest of the row. */}
              <div className="concern-meta">
              <span className={`cockpit-concern-sev cockpit-sev-${c.severity}`}>
                {String(c.severity)}
              </span>
              {/* ⚠️ WHO CONCLUDED THIS, BESIDE HOW BAD IT IS — two independent
                  facts that were rendered as one. A concern is the output of an
                  INVESTIGATION: the severity is a model's judgement over
                  evidence it cited, not a threshold anybody set. The row beside
                  it in the approval queue looks almost identical and is nothing
                  of the kind, and until this chip the only way to tell them
                  apart was to know which list you were reading. */}
              <SourceChip source="agent" />
              {/* ⚠️ `open` AND `acted` RENDERED IDENTICALLY UNTIL NOW, which
                  meant a reader could not tell whether anything had been DONE
                  about a concern — the single most useful thing to know about
                  one that is still standing. */}
              <LifecycleChip state={c.state} />
              {/* ⚠️ WHETHER ANYONE WAS TOLD IS A DIFFERENT FACT FROM WHETHER IT
                  MATTERS, and the wall showed only the second. During a shadow
                  period nothing is sent at all, so a list of concerns with no
                  indication of that reads as "everyone has been notified". */}
              {!c.delivered_at && (
                <span className="muted body-text">not sent yet</span>
              )}
              </div>
              {/* ⚠️ INLINE AND IN PARENTHESES, at the owner's request — a
                  standalone "sent" chip beside three other chips read as a
                  fourth state of the concern rather than a fact about it.

                  ⚠️ AND IT NAMES WHERE IT WENT, WHICH IS THE HALF THAT WAS
                  MISSING. A concern routes by AUDIENCE: `owner` reaches the
                  owner's chats, `facility` the facility manager's. A villa with
                  two Telegram chats can deliver every concern successfully to
                  the one nobody reads, and the card said only "sent" — reported
                  exactly that way, two concerns marked sent and nothing on the
                  owner's own chat. `delivered_to` is written by the outbox from
                  the targets that actually ACCEPTED it, so a partial delivery
                  names the one that landed rather than the ones it aimed at.
                  Concerns raised before 2.781.0 have no such record, and the
                  audience is the honest fallback — it says who it was FOR. */}
              <span className="body-text concern-text">
                {c.title}
                {c.delivered_at && (
                  <span className="muted">
                    {" ("}{sentSummary(c)}{")"}
                  </span>
                )}
              </span>
            </div>
            {/* ⚠️ ONLY ON WHAT WAS ACTUALLY SENT. Acknowledging something
                nobody was told about stops an escalation that was never going
                to happen, and puts a button on every row for a state most rows
                are not in. A concern already acknowledged says WHO — the first
                acknowledgement wins, and hiding that would make a second reader
                think nobody had picked it up. */}
            {canJudge && c.delivered_at && (
              c.acknowledged_at ? (
                <span className="muted body-text"
                      title={`Acknowledged ${c.acknowledged_at}`}>
                  seen by {c.acknowledged_by || "somebody"}
                </span>
              ) : (
                /* ⚠️ ICON-ONLY, LIKE THE TWO BUTTONS BESIDE IT, AND THAT IS A
                   PHONE DECISION. `.editable-row` is `flex-wrap: nowrap`, so a
                   fourth control carrying a text label does not move to a
                   second line — it squeezes the title, which is the only part
                   of the row a reader needs. The label lives in `aria-label`
                   and `title`, which is how the thumbs beside it already
                   explain themselves. */
                <button
                  type="button" className="row-action" disabled={busy === c.id}
                  aria-label={`I have seen this: ${c.title}`}
                  title="I have seen this — stops it being re-sent and chased"
                  onClick={() => void acknowledge(c.id)}
                >
                  <Eye size={16} aria-hidden />
                </button>
              )
            )}
            {canJudge && (
              <>
                <button
                  type="button" className="row-action" disabled={busy === c.id}
                  aria-label={`Useful: ${c.title}`}
                  title="This was worth telling me — the villa raises this kind more readily"
                  onClick={() => void judge(c.id, true)}
                >
                  <ThumbsUp size={16} aria-hidden />
                </button>
                <button
                  type="button" className="row-action danger"
                  disabled={busy === c.id}
                  aria-label={`Not useful: ${c.title}`}
                  title="This was not worth telling me — the villa raises this kind less readily"
                  onClick={() => void judge(c.id, false)}
                >
                  <ThumbsDown size={16} aria-hidden />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <SettledSummary concerns={settled} />
    </>
  );
}
