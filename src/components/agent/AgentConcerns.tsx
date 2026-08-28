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
import { Info, ThumbsDown, ThumbsUp } from "lucide-react";

import { loadConcerns,
         sendConcernFeedback } from "@/agent/agentApi";
import { hasCapability } from "@/auth/permissions";
import { useProfile } from "@/auth/ProfileContext";
import SourceChip from "@/components/common/SourceChip";
import { SettledSummary } from "@/components/agent/ConcernLifecycle";
import { severityRank, type Concern } from "@/agent/agentTypes";
import Loading from "@/components/common/Loading";

/** ⚠️ Settled concerns are not shown: closed, verified and dismissed are the
 *  record, not the state of the villa. */
const LIVE = new Set(["open", "acted"]);

/** Is this still asking for the reader's attention?
 *
 *  ⚠️ ACKNOWLEDGEMENT IS WHAT REMOVES A CARD, AND NOTHING ELSE DOES (owner's
 *  ruling, 2026-08-27). The thumb UP used to retire it — a compliment paid to
 *  the supervisor emptied the wall — which is fixed at the source in
 *  `concerns.feedback`. This is the other half of the same rule: while a
 *  delivered concern is unacknowledged it STAYS, however many opinions have
 *  been recorded about it.
 *
 *  ⚠️ THE BACKEND STATE IS DELIBERATELY UNTOUCHED BY THIS. `acknowledge`'s own
 *  docstring is emphatic that acknowledging is not resolving — the villa keeps
 *  carrying the problem — so this is a question about what the WALL shows,
 *  answered here, and not a fifth lifecycle state. An acknowledged concern
 *  that is still open is counted below rather than dropped, or "I have seen
 *  it" would silently mean "it is gone". */
const needsAttention = (c: Concern) =>
  LIVE.has(String(c.state ?? "open")) && !String(c.acknowledged_at ?? "").trim();

/** The escalation bands, from `agent/route.py`'s `BANDS`. ⚠️ MINUTES FROM
 *  `delivered_at`, NOT from `opened_at` — you cannot acknowledge something you
 *  were never sent, so the clock starts at delivery (`outbox.escalation_sweep`
 *  states the same rule). A copy of a backend table is normally this repo's
 *  cardinal sin; it is tolerated here because it renders a PREDICTION for a
 *  reader rather than making a routing decision, and `test_ui_consistency`
 *  pins the two together. */
const BANDS: Array<[number, string]> = [
  [15, "re-sent to the same place"],
  [45, "the owner is brought in"],
  [90, "everyone configured is told, once"],
];

/** What the chase has done, or will do next.
 *
 *  ⚠️ ONCE A STEP HAS BEEN TAKEN THIS REPORTS A FACT AND STOPS PREDICTING, and
 *  the first version did not — it printed the next TIME BAND unconditionally
 *  and was caught on screen promising "at 17:38 it is re-sent" about a concern
 *  that will never be touched again.
 *
 *  The bands are the LAST question `route.escalate` asks. Before them it asks
 *  whether the condition cleared, whether somebody acknowledged, and whether
 *  guests are in residence with no Facility manager reachable — and that last
 *  one returns "add the owner" IMMEDIATELY, skipping the bands entirely. On a
 *  villa with nobody in the Facility manager role (the reference property) it
 *  fires on the first sweep, and the delivery sweep then refuses to repeat a
 *  step it has already taken. So the bands were never going to be reached, and
 *  a countdown to one was a promise nothing would keep.
 *
 *  ⚠️ THE UI CANNOT PREDICT THAT BRANCH — it would need live occupancy and the
 *  People table — so it must not pretend to. `escalated_step` is the villa's
 *  own record of what it actually did, and reporting that is always true. The
 *  un-escalated case keeps a prediction because it is the common one, and it
 *  is worded as a condition ("if nobody…") rather than a promise. */
function chaseLine(c: Concern): string | null {
  // ⚠️ ONLY A CRITICAL IS EVER CHASED — `route.escalate`'s first line refuses
  // every other severity. Printing a countdown on a warning would promise a
  // chase that is never coming, which is the exact misreading the "What gets
  // chased" hint was written to correct.
  if (String(c.severity) !== "critical") return null;
  if (!c.delivered_at || c.acknowledged_at) return null;
  const at = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const step = String(c.escalated_step ?? "").trim();
  if (step) {
    const when = new Date(c.escalated_at ?? "");
    const stamp = Number.isNaN(when.getTime()) ? "" : ` at ${at(when)}`;
    return `Escalated${stamp} — ${step}. No further step is due unless `
      + "something changes.";
  }

  const sent = new Date(c.delivered_at);
  if (Number.isNaN(sent.getTime())) return null;
  const mins = (Date.now() - sent.getTime()) / 60000;
  const next = BANDS.find(([after]) => mins < after);
  if (!next) return "Not acknowledged — every escalation step has been taken.";
  const due = new Date(sent.getTime() + next[0] * 60000);
  return `If nobody says they have seen it, by ${at(due)} it is ${next[1]}.`;
}

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
  const [seen, setSeen] = useState<Concern[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // ⚠️ NO MODE FLAG ANY MORE (2026-08-28, owner's ruling). Every mode now
    // writes the ONE live store this endpoint serves — an observe-mode concern
    // arrives stamped `informational` instead of being hidden in a separate
    // shadow file — so an empty list means exactly one thing: nothing was
    // raised. The whole "stay silent" empty-state branch left with it.
    const found = await loadConcerns();
    // ⚠️ THE SETTLED ONES ARE KEPT NOW, NOT DISCARDED. They were filtered out
    // at the door on the reasoning that "closed, verified and dismissed are the
    // record, not the state of the villa" — true of the LIST, and it threw away
    // the record entirely. The HLD reads verification, noise measurement and
    // time-to-clear off exactly those rows, so they are summarised below the
    // list instead of being dropped.
    setSettled(found.filter((c) => !LIVE.has(String(c.state ?? "open"))));
    // ⚠️ SEEN BUT STILL OPEN IS ITS OWN GROUP, NOT A DELETION. Acknowledging
    // takes a card off the wall (owner's ruling) and the villa is still
    // carrying the problem, so these are counted below the list. Dropping them
    // silently would make "I have seen it" mean "it is gone".
    setSeen(found.filter((c) => LIVE.has(String(c.state ?? "open"))
      && String(c.acknowledged_at ?? "").trim()));
    setRows(found.filter(needsAttention)
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
  if (rows === null) {
    return (
      <Loading />
    );
  }

  if (rows.length === 0) {
    // ⚠️ SILENCE IS ONLY HONEST WHEN IT MEANS "NOTHING WAS RAISED". While
    // "stay silent" is on, findings are written to a SEPARATE store that this
    // surface does not read — so an empty list here can equally mean the
    // assistant has been concluding things for weeks and none of them reached
    // this screen. The owner met exactly that: told an investigation had
    // finished, then shown an empty tab. Saying which of the two it is costs
    // one sentence and is the difference between a quiet villa and a broken
    // one.
    //
    // ⚠️ AND `return null` WAS WRONG THE MOMENT THIS MOVED TABS. Rendering
    // nothing was decided when this block sat on the Cockpit under a health
    // headline that already spoke; on the Reason tab it left a step header
    // over an empty pane — the exact "broken tier" read this file's own
    // sibling comment warns about — and the owner asked whether an empty tab
    // after an investigation was expected. One sentence answers it.
    //
    // ⚠️ THE "STAY SILENT" BRANCH IS GONE WITH THE SHADOW STORE (2026-08-28).
    // Concerns land here in every mode now, so an empty list has one meaning
    // and needs one sentence.
    return (
      <>
        <div className="settings-section-title">
          Alerts — what the villa concluded
        </div>
        <p className="muted body-text">
          {settled.length > 0
            ? "Nothing is open right now. Everything the villa has raised "
              + "has been dealt with — the record is below."
            : "No alerts right now. When an investigation decides "
              + "something needs your attention, it appears here — an "
              + "investigation that finds nothing raises nothing, and that "
              + "is a complete answer."}
        </p>
        {/* ⚠️ THE SETTLED RECORD IS SHOWN WHEN NOTHING IS OPEN, AND IT WAS
            THE ONE CASE THAT DROPPED IT (2026-08-28). This block returned
            early, so `SettledSummary` — which only renders from the main
            return below — was unreachable exactly when it was the only
            thing left to say. The owner met the contradiction it creates:
            the Triage tab totals "N raised as a concern" from the checks'
            own records while this tab said "No concerns", which reads as
            one screen disagreeing with the other about the same villa.
            Both were true; only one was complete. */}
        <SettledSummary concerns={settled} />
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
      <div className="settings-section-title">Alerts — what the villa concluded</div>
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
        about, raised during a check. One marked “for your information” asks
        nothing of you; the others wait for you to say you have seen them.
        <InfoHint label="What gets escalated">
          <p>
            Only a critical alert is escalated. If nobody acknowledges one, the
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
          <p>
            An alert marked &ldquo;for your information&rdquo; was raised in
            Alert only mode: it is never escalated at any
            severity, and nothing is added to the To-Do List for it.
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
              {/* ⚠️ THE LIFECYCLE CHIP IS GONE (2026-08-27, owner's
                  instruction), AND IT COULD ONLY EVER SAY ONE THING. It was
                  added to separate `open` from `acted` — "the single most
                  useful thing to know about a concern that is still
                  standing" — and NOTHING IN THE BACKEND HAS EVER WRITTEN
                  `acted`: `grep '"acted"' rootfs/` finds only the enum that
                  lists it. This list shows live concerns only, so every card
                  on it read "Nothing done yet", always, whatever anyone did.
                  A chip with one possible value is not a status, it is
                  decoration — and on an informational row it actively
                  contradicted the "nothing to do" mark beside it.

                  If a transition to `acted` is ever implemented, the chip
                  comes back with it; the component and its copy are kept for
                  that reason and because the settled record still uses the
                  module. */}
              {/* ⚠️ WHETHER ANYONE WAS TOLD IS A DIFFERENT FACT FROM WHETHER IT
                  MATTERS, and the wall showed only the second. A list of
                  concerns with no indication of that reads as "everyone has
                  been notified". */}
              {!c.delivered_at && (
                <span className="muted body-text">not sent yet</span>
              )}
              {/* ⚠️ THE FYI MARK (2026-08-28, owner's request). A concern
                  raised under Alert only sits on the same list as
                  one that will chase somebody, and nothing on the card said
                  which kind the reader was looking at — so every row implied
                  a task. The chip states the contract: told once, never
                  re-sent, nothing added to the To-Do List, nothing asked. Stamped at raise
                  time, so changing the mode later relabels nothing.

                  ⚠️ SHORTENED TO FIT (2026-08-27, from a screenshot). It read
                  "for your information — nothing to do", which wrapped onto
                  two lines inside this narrow column and pushed the (i) glyph
                  away from the words it belongs to. This column is capped at
                  45% of the row and holds three other chips, so its copy has
                  to be chip-length; the sentence-length version belongs in
                  the tooltip, where it already is. */}
              {c.informational && (
                <span className="muted body-text concern-fyi"
                      title={"Raised while the villa was set to Investigate & "
                             + "Log Only, so this is for your information: it "
                             + "was told to you once, it will not be re-sent "
                             + "or escalated, and nothing was added to any to-do "
                             + "list. Nothing is asked of you. Switch the "
                             + "mode under Settings if you want concerns like "
                             + "this escalated."}>
                  <Info size={14} aria-hidden /> Informational (nothing to do)
                </span>
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
                {/* ⚠️ ITS OWN LINE, NOT TRAILING THE TITLE (2026-08-28,
                    owner's request). Inline, it read as part of the sentence —
                    "Pipeline drill — this is a test, nothing is wrong (sent to
                    Owner 27 Aug, 18:58)" — so a fact ABOUT the concern sat
                    inside the concern's own words and wrapped through them. It
                    stays in this block: it belongs to the title, it is just
                    not part of it. `display: block` on the span rather than a
                    <p>, because the parent is a flex column of inline content
                    and a paragraph would inherit margins nothing else here
                    has. */}
                {c.delivered_at && (
                  <span className="muted concern-sent">
                    {sentSummary(c)}
                  </span>
                )}
                {/* ⚠️ WHEN THE CHASE COMES, ON THE CARD ITSELF (owner's
                    request). The escalation ladder was previously explained
                    only in the "What gets chased" hint, so a reader looking at
                    a critical nobody had acknowledged could not tell whether
                    anything further was coming or when. It renders for a
                    critical only, because nothing else is ever chased. */}
                {chaseLine(c) && (
                  <span className="body-text sev-warning concern-chase">
                    {chaseLine(c)}
                  </span>
                )}
                {/* ⚠️ THE THUMB UP IS NOW VISIBLE AND HARMLESS. It used to
                    retire the concern; it now records a verdict and leaves the
                    card exactly where it was, so the reader needs to see that
                    the press registered. */}
                {c.useful && (
                  <span className="muted concern-chase">
                    You marked this useful — it stays until acknowledged.
                  </span>
                )}
              </span>
            </div>
            {/* ⚠️ ONLY ON WHAT WAS ACTUALLY SENT. Acknowledging something
                nobody was told about stops an escalation that was never going
                to happen, and puts a button on every row for a state most rows
                are not in. A concern already acknowledged says WHO — the first
                acknowledgement wins, and hiding that would make a second reader
                think nobody had picked it up.

                ⚠️ IT IS SHOWN ON AN FYI TOO, AND THE GATE THAT HID IT WAS
                REMOVED (2026-08-27, owner's instruction). The argument for
                hiding it was that acknowledgement exists to stop a chase and
                an FYI is never chased, so the button "only records that it
                was pressed" — true of the ESCALATION, and it ignored what the
                press now does on screen: since 2.808.0 acknowledging is the
                one action that takes a card off the wall. Hiding it therefore
                left informational concerns with no way to be cleared at all,
                which is the opposite of the tidiness it was reaching for. */}
            {/* ⚠️ THE EYE IS GONE, AND THE THUMBS DO ITS JOB (2026-08-28,
                owner: "i like the fact that clicking on a thumb Up or Down
                acknowledge the concern: So please do it and remove the
                redundant eye icon"). Three buttons offered two ACKNOWLEDGE
                paths and one of them said nothing else — pressing a thumb
                already meant a person had read the card, so a separate "I have
                seen this" was a second click for a fact the first one proved.
                The acknowledgement is written SERVER-SIDE inside
                `/agent-feedback`, not by a second request from here, so the
                verdict and the receipt cannot disagree.

                ⚠️ THE ROW STILL SHOWS WHO PICKED IT UP. `needsAttention`
                excludes acknowledged concerns, so this branch is reached only
                between a send and the first thumb; it is kept because a
                concern acknowledged from a PHONE (`/agent-acknowledge` is
                still a route, and Telegram uses it) must not look unread on
                the tablet. */}
            {canJudge && c.delivered_at && c.acknowledged_at && (
              <span className="muted body-text"
                    title={`Acknowledged ${c.acknowledged_at}`}>
                seen by {c.acknowledged_by || "somebody"}
              </span>
            )}
            {canJudge && (
              <>
                <button
                  type="button" className="row-action" disabled={busy === c.id}
                  aria-label={`Useful, and I have seen it: ${c.title}`}
                  title="Worth telling me — marks it seen, and the villa raises this kind more readily"
                  onClick={() => void judge(c.id, true)}
                >
                  <ThumbsUp size={16} aria-hidden />
                </button>
                <button
                  type="button" className="row-action danger"
                  disabled={busy === c.id}
                  aria-label={`Not useful, and I have seen it: ${c.title}`}
                  title="Not worth telling me — marks it seen, and the villa raises this kind less readily"
                  onClick={() => void judge(c.id, false)}
                >
                  <ThumbsDown size={16} aria-hidden />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {/* ⚠️ ACKNOWLEDGED AND STILL OPEN — counted, never hidden. The card
          leaves the wall when somebody says they have seen it, and the villa
          is still carrying the problem, so the number has to be somewhere or
          "I have seen it" quietly becomes "it is gone". */}
      {seen.length > 0 && (
        <p className="muted body-text">
          {seen.length === 1
            ? "One alert you have seen is still open"
            : `${seen.length} concerns you have seen are still open`}
          {" — off the list above because somebody picked them up, and still "}
          {"being carried by the villa until the condition stops."}
        </p>
      )}
      <SettledSummary concerns={settled} />
    </>
  );
}
