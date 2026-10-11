// src/fm/faultNotes.ts
// What a fault's card says about its history: the "when" line under its title and the notes below it. Pure, so the
// oracle drives it (tests/oracles/agent_view.mjs).
//
// ⚠️ A STEP SAYS WHAT IT IS (architecture review 26): the card used to recognise the VESTA Agent's title changes by
// their first words ("Now: …") and took them for status steps — "in progress since 03:00 by VESTA Agent" replaced the
// facility manager's own time and name the night the agent updated the title, and the kept "Now: …" line repeated the
// title word for word. Each step now carries its kind (FmTicketUpdate.kind, agent-contract.json `ticketUpdate`).

import { isTicketResolved } from "./fmEngine";
import type { FmTicket, FmTicketUpdate } from "./fmTypes";

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

/** The steps that changed the fault's status — raised, picked up, resolved, reopened; never a title change. */
export function statusSteps(t: Pick<FmTicket, "updates">): FmTicketUpdate[] {
  return (t.updates ?? []).filter((u) => titleOf(u) === undefined);
}

/** When it happened, in one line: opened, reopened, picked up, resolved — and by whom (the name typed for who does the
 *  work, else the profile that recorded it), from its status steps only. */
export function faultWhen(t: FmTicket, stamp: (at: string) => string): string {
  const steps = statusSteps(t);
  const last = steps[steps.length - 1];
  const by = (u?: FmTicketUpdate) => (u?.who || u?.by ? ` by ${u.who || u.by}` : "");
  const parts = [`Opened ${stamp(t.openedAt)}`];
  if (t.status === "open" && last?.kind === "reopened") parts.push(`reopened ${stamp(last.at)}${by(last)}`);
  if (t.status === "in_progress" && last?.status === "in_progress") parts.push(`in progress since ${stamp(last.at)}${by(last)}`);
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
export function faultNoteLines(t: Pick<FmTicket, "note" | "updates">, stamp: (at: string) => string): string[] {
  const ups = t.updates ?? [];
  const titled = ups.map(titleOf);
  const lastTitle = titled.map((x) => x !== undefined).lastIndexOf(true);
  const lines = [t.note ?? ""];
  ups.forEach((u, i) => {
    if (titled[i] === undefined) {
      if (u.note) lines.push(`${u.note} (${stamp(u.at)})`);
      return;
    }
    if (i !== lastTitle) return;
    if (u.kind === "reading") {
      lines.push(`VESTA reads: ${u.title} (${stamp(u.at)})`);
      return;
    }
    // an old "Now: …" step names only the new title: what it replaced is the title step before it, when there is one
    const before = u.kind === "retitled" ? u.was : titled.slice(0, i).filter((x) => x !== undefined).pop();
    if (before) lines.push(`Was: ${before} (${stamp(u.at)})`);
  });
  return lines.map((n) => n.trim()).filter(Boolean);
}
