// src/fm/faultNotes.ts
// What a fault's card says about its history: the "when" line under its title and the notes below it. Pure, so the
// oracle drives it (tests/oracles/agent_view.mjs).
//
// ⚠️ A STEP SAYS WHAT IT IS (architecture review 26): the card used to recognise the VESTA Agent's title changes by
// their first words ("Now: …") and took them for status steps — "in progress since 03:00 by VESTA Agent" replaced the
// facility manager's own time and name the night the agent updated the title, and the kept "Now: …" line repeated the
// title word for word. Each step now carries its kind (FmTicketUpdate.kind, agent-contract.json `ticketUpdate`).

import { isTicketResolved, stageOf, statusChanges, stepsInTimeOrder } from "./fmEngine";
import type { FmTicket, FmTicketUpdate } from "./fmTypes";
import { agentOwned } from "./issueSource";
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

/** When it happened, in one line: opened, reopened, picked up, resolved — and by whom (the name typed for who does the
 *  work, else the profile that recorded it), from its status steps only. */
export function faultWhen(t: FmTicket, stamp: (at: string) => string): string {
  const steps = statusSteps(t);
  const last = steps[steps.length - 1];
  const by = (u?: FmTicketUpdate) => {
    const who = u?.who || authorWords(u);
    return who ? ` by ${who}` : "";
  };
  // who raised it: its first step, when that step is the raising (fmCommands.addTicket stamps it, as every other step)
  // — a person; the VESTA Agent's own faults already wear its mark beside this line (AgentMark)
  const raised = !agentOwned(t) && steps[0]?.status === "open" && !steps[0]?.kind ? by(steps[0]) : "";
  const parts = [`Opened ${stamp(t.openedAt)}${raised}`];
  if (t.status === "open" && last?.kind === "reopened") parts.push(`reopened ${stamp(last.at)}${by(last)}`);
  if (stageOf(t) === "ticket" && last?.status === "in_progress") parts.push(`in progress since ${stamp(last.at)}${by(last)}`);
  if (t.resolvedAt && isTicketResolved(t)) {
    const done = [...steps].reverse().find((u) => isTicketResolved(u));
    parts.push(`resolved ${stamp(t.resolvedAt)}${by(done)}`);
  }
  return parts.join(" · ");
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
