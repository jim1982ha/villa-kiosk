// src/vesta/shared/concernNarrative.ts
//
// What a concern card SAYS: which acts it offers, whether help is coming, when
// the next chase is due, and who it reached.
//
// ⚠️ ~140 PURE LINES THAT NO RUNNER COULD REACH (extracted 2026-09-06). They
// sat inside a 760-line component whose first line imports React, so the
// bare-node harness could not load the file — and the repository's answer had
// been six Python probes that slice the .tsx by string index. One of them
// asserted the substring `'severity) !== "critical"'`: a probe of the SPELLING,
// which fails on a correct rewrite and passes on an empty branch.
//
// ⚠️ `chaseLine` TAKES ITS CLOCK. It read `Date.now()` directly, which is the
// other reason nothing could exercise it — "delivered 20 minutes ago" and "past
// every band" are the cases that matter and neither is reachable without one.
//
// ⚠️ TYPE-ONLY IMPORTS, LIKE `concern.ts`. That is the whole reason this file
// can be tested at all; a runtime import of anything React-shaped ends it.

import type { Concern } from "./agentTypes";
// ⚠️ THE `.ts` IS LOAD-BEARING, NOT A TYPO. This module is loaded by the
// bare-node harness, which resolves specifiers literally; an extensionless
// import works under Vite and fails under `node`. `allowImportingTsExtensions`
// is already on in tsconfig, so the compiler is happy either way — and being
// node-loadable is the entire reason this file exists.
import { timeOnly, whenShort } from "./when.ts";

/** Does the server currently offer this act on this concern?
 *
 * ⚠️ THE SERVER DECIDES, AND THAT IS THE WHOLE POINT. `agent/actions.available_for`
 * is the one authority; `/agent-concerns` serves its answer per row. Anything
 * this file worked out for itself from `state`/`informational` would be a
 * second implementation of a rule that has already drifted once — the ✅ drawn
 * on an FYI and refused with "that has already been dealt with".
 *
 * ⚠️ ABSENT `acts` MEANS NO ACTS, DELIBERATELY. The tablet and the add-on ship
 * as one image, so the field is always present; if it ever is not, a row with
 * no buttons is visibly wrong and reports itself, whereas defaulting to "draw
 * everything" would silently restore exactly the defect this removed. */
export const offers = (c: Concern, id: string) =>
  (c.acts ?? []).some((a) => a && a.id === id);



/** The escalation bands, from `agent/route.py`'s `BANDS`. ⚠️ MINUTES FROM
 *  `delivered_at`, NOT from `opened_at` — you cannot acknowledge something you
 *  were never sent, so the clock starts at delivery (`outbox.escalation_sweep`
 *  states the same rule). A copy of a backend table is normally this repo's
 *  cardinal sin; it is tolerated here because it renders a PREDICTION for a
 *  reader rather than making a routing decision, and `test_ui_consistency`
 *  pins the two together. */
/** What `agent/route.py`'s `HELP_STEPS` writes into `escalated_step` when
 *  somebody presses 🆘 on the chat message.
 *
 *  ⚠️ A MIRROR OF A BACKEND TABLE, TOLERATED FOR THE SAME REASON AS `BANDS`
 *  BELOW — it renders a sentence for a reader and makes no routing decision —
 *  and pinned to the source by `test_ui_consistency`'s help-step check, beside
 *  the one that pins `BANDS`, so the two cannot drift.
 *
 *  ⚠️ IT NAMED `test_help_button` UNTIL 2.963.0, AND THAT FILE OPENS NO `.ts`.
 *  The pin did not exist: the node oracle beside it compares this copy with
 *  itself (`Object.keys(HELP_STEPS)`, then asserts the rendered line contains
 *  `HELP_STEPS[key]`), which holds whatever either table says. Reword either
 *  side and `helpLine` stops recognising the step and returns null — the chat
 *  says the counterpart was asked and this screen says nothing at all.
 *
 *  ⚠️ 🆘 ASKS THE OTHER CHANNEL (2026-09-06, owner's ruling): an alert sent to
 *  the owner asks the facility manager, and one sent to the facility manager
 *  asks the owner. That is why the step names a PERSON rather than a rung —
 *  which of the two it is depends on who was told first, and no band name can
 *  carry that. */
export const HELP_STEPS: Record<string, string> = {
  "asked the owner for help": "the owner",
  "asked the facility manager for help": "the Facility Manager",
};

export const BANDS: Array<[number, string]> = [
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
/** "Help is on the way", for any severity.
 *
 *  ⚠️ NOT PART OF `chaseLine`, WHICH ONLY SPEAKS FOR A CRITICAL. Chasing is a
 *  critical-only ladder, so that function returns null for everything else —
 *  but 🆘 can be pressed on ANY open alert, and the one surface that must agree
 *  with the phone is this one. Folding it in there would have hidden the help
 *  line on exactly the alerts a person is most likely to press it on. */
export function helpLine(c: Concern): string | null {
  const asked = HELP_STEPS[String(c.escalated_step ?? "").trim()];
  if (!asked) return null;
  const clock = timeOnly(String(c.escalated_at ?? ""));
  const stamp = clock ? ` at ${clock}` : "";
  return `Help requested${stamp} — ${asked} has been asked. The alert stays `
    + "open until somebody deals with it.";
}

export function chaseLine(c: Concern, now: number = Date.now()): string | null {
  // ⚠️ ONLY A CRITICAL IS EVER CHASED — `route.escalate`'s first line refuses
  // every other severity. Printing a countdown on a warning would promise a
  // chase that is never coming, which is the exact misreading the "What gets
  // chased" hint was written to correct.
  if (String(c.severity) !== "critical") return null;
  if (!c.delivered_at || c.acknowledged_at) return null;
  const step = String(c.escalated_step ?? "").trim();
  if (step) {
    const clock = timeOnly(String(c.escalated_at ?? ""));
    const stamp = clock ? ` at ${clock}` : "";
    return `Escalated${stamp} — ${step}. No further step is due unless `
      + "something changes.";
  }

  const sent = new Date(c.delivered_at);
  if (Number.isNaN(sent.getTime())) return null;
  // ⚠️ THE CLOCK IS AN ARGUMENT, DEFAULTED. Reading `Date.now()` inline made
  // every band case untestable — "delivered 20 minutes ago" and "past every
  // band" are exactly what a reader relies on, and neither could be exercised.
  const mins = (now - sent.getTime()) / 60000;
  const next = BANDS.find(([after]) => mins < after);
  if (!next) return "Not acknowledged — every escalation step has been taken.";
  const due = new Date(sent.getTime() + next[0] * 60000);
  // ⚠️ THE PREDICTED TIME GOES THROUGH THE SAME FORMATTER as every stored
  // stamp. It is a Date rather than a string, so it is serialised first — one
  // clock for the whole card, which is the defect `RecentChecks` records.
  return `If nobody says they have seen it, by ${timeOnly(due.toISOString())}`
    + ` it is ${next[1]}.`;
}

/** Profile ids as a person reads them on the People tab. ⚠️ `ops` IS THE
 *  FACILITY MANAGER — the store's word and the screen's word differ, and
 *  showing the store's would name a role nobody has heard of. */
export const PROFILE_NAME: Record<string, string> = {
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
export function sentSummary(c: Concern): string {
  // ⚠️ A NINTH COPY OF ONE FORMAT, IN THE MODULE BOTH SURFACES READ. `when.ts`
  // opens "EIGHT COPIES, ONE FORMAT, FOUR ANSWERS TO FAILURE" and this was
  // character-for-character `whenShort(iso, "blank")` — thirty lines below this
  // file's own import of that module. A change to the shared format would have
  // moved the Concern's timestamps on the Chat and not on the Wall tablet,
  // which is the "one card, two clocks" defect `when.ts` was written to end.
  // Only the leading space is this function's own.
  const when = (iso: string) => {
    const stamp = whenShort(iso, "blank");
    return stamp ? ` ${stamp}` : "";
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
