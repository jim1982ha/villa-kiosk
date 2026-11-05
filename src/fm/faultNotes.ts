// src/fm/faultNotes.ts
// What a fault's card says about its history: who last moved it (its strip's state, its who line) and its notes. Pure, so the
// oracle drives it (tests/oracles/agent_view.mjs).
//
// ⚠️ A STEP SAYS WHAT IT IS (architecture review 26): the card used to recognise the VESTA Agent's title changes by
// their first words ("Now: …") and took them for status steps — "in progress since 03:00 by VESTA Agent" replaced the
// facility manager's own time and name the night the agent updated the title, and the kept "Now: …" line repeated the
// title word for word. Each step now carries its kind (FmTicketUpdate.kind, agent-contract.json `ticketUpdate`).

import { NEED_HELP } from "./deviceWork";
import { closedTold } from "./faultConfirm";
import { ACCENT_PILL, QUIET_PILL, pillClass } from "./tone";
import { STAGE_WORDS, type FmStage, isTicketResolved, helpIsLatest, recordLife, stageOf, standingHelp, statusChanges, stepsInTimeOrder } from "./fmEngine";
import type { FmTicket, FmTicketUpdate } from "./fmTypes";
import { authorWords } from "@/auth/roles";

/** A note written before steps had a kind (VESTA Agent before 0.12.151): its title change read "Now: <new title>".
 *  The one place the old words are still read — stored history is never rewritten. */
const OLD_TITLE_NOTE = "Now: ";

/** The new title a step gave the fault, when it is a title step: the agent's change, or its reading under a person's
 *  title. Undefined for a status step. */
function titleOf(u: FmTicketUpdate): string | undefined {
  if (u.kind === "retitled" || u.kind === "reading") return u.title ?? "";
  if (!u.kind && (u.note ?? "").startsWith(OLD_TITLE_NOTE)) return u.note!.slice(OLD_TITLE_NOTE.length);
  return undefined;
}

/** The steps that changed the fault's status — raised, picked up, resolved, reopened; never a title change, never a
 *  line of what happened on Telegram ("noted": a reminder sent is not the fault moving). */
export function statusSteps(t: Pick<FmTicket, "updates">): FmTicketUpdate[] {
  // fmEngine.statusChanges, less a title change only an old "Now: …" note says
  return statusChanges(t).filter((u) => titleOf(u) === undefined);
}

/** What happened about the fault on Telegram, from the VESTA Agent ("Alert sent (to: Facility Manager)", "🆘 Need help
 *  on Telegram (Wayan)"), each with when, in time order: the short story Telegram's Status tells, under the open issue
 *  in Messages (owner, 2026-10-14: Telegram told the whole story, the card only its start; ticket 19 of "One inbox",
 *  2026-10-28: the card told only the last line). A line is written minutes after its moment: in its moment's place. */
export function notedStory(t: Pick<FmTicket, "updates">): { note: string; at: string }[] {
  return stepsInTimeOrder(t).filter((x) => x.kind === "noted" && x.note).map((x) => ({ note: x.note as string, at: x.at }));
}

/** A stage's pill colour: its tone (fmEngine.STAGE_WORDS), a ticket in progress the buttons' accent (tone.ACCENT_PILL),
 *  the colour of its Edit Ticket. The Tickets tab's stage pill and every card's who-moved-it pill alike. */
export function stagePillClass(stage: FmStage): string {
  // a closed record is quiet: its card grey (owner, 2026-11-05, the "Status on top" card)
  return stage === "ticket" ? ACCENT_PILL : stage === "closed" ? QUIET_PILL : pillClass(STAGE_WORDS[stage].tone);
}

/** ⚠️ WHO LAST MOVED IT, IN PARTS (owner, 2026-11-05, the "Status on top" card): the card's strip says where it stands
 *  and since when, its who line only who moved it (moveState, moveWho). It was one sentence in one pill ("Ticket opened
 *  by Wayan, on 31/10/2026 09:55 · In progress"); that sentence went with the pill (architecture review, 2026-11-05): nothing
 *  draws it. Who: the name typed for who does the work, else the profile that recorded it. A stage only for a ticket
 *  (owner, 2026-11-04: "the status in the pill shall only appear for real ticket opened in the Ticket tab"). `word`: what the step did ("Ticket opened", "Reopened",
 *  "Done", "Need help asked", a close's word); `stage`: a ticket's, said on a ticket only; `tone`: its stage's colour. */
export interface FaultMove {
  kind: "help" | "opened" | "reopened" | "closed";
  word: string;
  who?: string;
  at: string;
  stage?: FmStage;
  tone: string;
}

/** The latest of its status steps, as its parts: null while it is only a fault nobody moved. Pure. */
export function faultMove(t: FmTicket): FaultMove | null {
  const stage = stageOf(t);
  const ticket = recordLife(t).ticket;
  const said = (kind: FaultMove["kind"], word: string, at: string, who?: string): FaultMove =>
    ({ kind, word, at, ...(who ? { who } : {}), ...(ticket ? { stage } : {}), tone: stagePillClass(stage) });
  const steps = statusSteps(t);
  const last = steps[steps.length - 1];
  const help = standingHelp(t);
  if (help && helpIsLatest(t)) return said("help", `${NEED_HELP} asked`, help.at, help.by);
  if (!last) {
    if (t.resolvedAt && isTicketResolved(t)) return said("closed", "Done", t.resolvedAt);
    return stage === "ticket" ? said("opened", "Ticket opened", t.openedAt) : null;
  }
  // closed: told as every Closed section tells it (faultConfirm.closedTold), the action's word and who
  if (isTicketResolved(last)) { const c = closedTold(t); return said("closed", c.word, last.at, c.who); }
  const who = last.who || authorWords(last);
  if (last.kind === "reopened") return said("reopened", "Reopened", last.at, who);
  return last.status === "in_progress" ? said("opened", "Ticket opened", last.at, who) : null;
}

/** What the card's strip says of the move: a ticket its stage ("Ticket in progress", "Resolved"), a reopening or a
 *  close its word; a Need help nothing (its who line says it, with when). Pure. */
export function moveState(m: FaultMove | null | undefined): { text: string; tone: string } | null {
  if (!m) return null;
  if (m.stage) return { text: STAGE_WORDS[m.stage].card, tone: m.tone };
  if (m.kind === "reopened" || m.kind === "closed") return { text: m.word, tone: m.tone };
  return null;
}

/** ⚠️ WHO MOVED IT, SAID ONCE (owner, 2026-11-05: "Opened by Fab & Jm", "By VESTA Agent", "Done by Wayan"): the move's
 *  word unless the strip says it (`strip`: the strip's words; a ticket's opening is "Opened" under its stage), who, and
 *  its moment unless the strip's time is that moment (`when`). null when nothing is left to say. Pure. */
export function moveWho(m: FaultMove | null | undefined, strip: readonly string[], when: string | undefined,
  stamp: (at: string) => string): string | null {
  if (!m) return null;
  const word = strip.includes(m.word) ? "" : m.kind === "opened" && m.stage && strip.includes(STAGE_WORDS[m.stage].card) ? "Opened" : m.word;
  const moment = stamp(m.at) === when ? "" : stamp(m.at);
  const head = word && m.who ? `${word} by ${m.who}` : m.who ? `By ${m.who}` : word;
  if (!head) return moment ? `On ${moment}` : null;
  return moment ? `${head}${m.who ? "," : ""} on ${moment}` : head;
}

/** The card's notes, in order, each with its date: the fault's own note ("Check: …"), every step's note, and of its
 *  title changes only the LAST (owner, 2026-10-11: "only show the latest one"), said as what it replaced — "Was: …"
 *  (owner, review 26) — since the title above already says what it is now; the agent's reading under a title a person
 *  wrote is "VESTA reads: …". */
/** "renamed by Owner, " when the step says who (its profile's name today, roles.authorWords). */
const renamedBy = (u: FmTicketUpdate) => (authorWords(u) ? `renamed by ${authorWords(u)}, ` : "");

export function faultNoteLines(t: Pick<FmTicket, "note" | "updates">, stamp: (at: string) => string): string[] {
  const ups = stepsInTimeOrder(t);
  const titled = ups.map(titleOf);
  // ⚠️ A REOPENING THAT GIVES A NEW TITLE IS A RENAME TOO (review 31): it is a status step, and its `was` the title it
  // replaced — read as a status step only, "Was:" named the title two renames back
  const renamed = ups.map((u, i) => titled[i] ?? (u.kind === "reopened" && u.was && u.title ? u.title : undefined));
  const lastTitle = renamed.map((x) => x !== undefined).lastIndexOf(true);
  const lines = [t.note ?? ""];
  ups.forEach((u, i) => {
    if (titled[i] === undefined) {
      if (u.note) lines.push(`${u.note} (${stamp(u.at)})`);
      if (i === lastTitle) lines.push(`Was: ${u.was} (${renamedBy(u)}${stamp(u.at)})`);
      return;
    }
    if (i !== lastTitle) return;
    if (u.kind === "reading") {
      lines.push(`VESTA reads: ${u.title} (${stamp(u.at)})`);
      return;
    }
    // an old "Now: …" step names only the new title: what it replaced is the title step before it, when there is one
    const before = u.kind === "retitled" ? u.was : renamed.slice(0, i).filter((x) => x !== undefined).pop();
    // who renamed it, when the step says (a person's rename in the editor, the VESTA Agent's own) — review 29
    if (before) lines.push(`Was: ${before} (${renamedBy(u)}${stamp(u.at)})`);
  });
  return lines.map((n) => n.trim()).filter(Boolean);
}
