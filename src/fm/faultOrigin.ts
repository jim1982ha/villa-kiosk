// src/fm/faultOrigin.ts
// WHAT MADE A CARD'S PROBLEM, in words: the (?) pill at the left of a card's next-check pill (owner, 2026-11-21: "the
// tooltip indicates what has generated this fault card (name the automation when relevant, mention the skill when
// relevant, etc..)"). Every kind of line a card holds says one sentence here: a device's live state, an overdue task,
// a fault by its source (fm/issueSource) and, for the VESTA Agent's, what it wrote of its maker (FmTicket.raisedBy:
// the villa automation of its alert, the skill's check that found it). Nothing known: "Source not recorded.", never a
// guess. Pure: tests/oracles/fault_origin.mjs drives it by value.

import { authorWords } from "@/auth/roles";
import { DUE_WORDS } from "./fmEngine";
import { faultSource } from "./issueSource";
import type { FaultRaiser, FmTicket } from "./fmTypes";

/** Said when nothing tells what made it. */
export const ORIGIN_UNKNOWN = "Source not recorded.";

/** What separates a blueprint's prefix from an automation's own name ("critical_condition---master_bedroom_unlocked"). */
const PREFIX = "---";

/** An automation's own name, as a person reads it: its friendly name after a blueprint's prefix, "_" read as spaces,
 *  its first letter a capital ("critical_condition---master_bedroom_unlocked" → "Master bedroom unlocked"); none: its
 *  entity id's object id so read. */
export function automationName(friendly: string | undefined, entityId: string): string {
  let text = (friendly ?? "").trim() || entityId.split(".").slice(1).join(".");
  if (text.includes(PREFIX)) text = text.slice(text.indexOf(PREFIX) + PREFIX.length);
  text = text.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The villa automation `id` named: "the villa's automation "Master bedroom unlocked" (critical_condition---…)", its
 *  name from the villa's live states (`friendlyOf`), its friendly name (else its id) after it when that says more. A
 *  profile the add-on sends no automation to (the facility manager: readDomains) reads its id in words, and the id. */
function automationSaid(id: string, friendlyOf: (entityId: string) => string | undefined): string {
  const friendly = friendlyOf(id);
  const name = automationName(friendly, id);
  // its domain only names its kind: no script is read (a profile that reads no automation or script gets its id in words)
  const kind = id.split(".")[0] === "script" ? "script" : "automation";
  const ref = friendly && friendly !== name ? friendly : id;
  return `the villa's ${kind} "${name}" (${ref})`;
}

/** A skill's check named: "VESTA's preventive maintenance check "Missing device" (PM-MISSING)". */
function checkSaid(r: FaultRaiser): string {
  const skill = r.skill ? `VESTA's ${r.skill}` : "VESTA";
  if (!r.check) return skill;
  return r.name ? `${skill} check "${r.name}" (${r.check})` : `${skill} check ${r.check}`;
}

/** How a fault VESTA reads again is read: its card's next check (FmTicket.check). */
const READ_AGAIN: Record<NonNullable<FmTicket["check"]>, string> = {
  minutes: " It looks again every few minutes.",
  nightly: " It looks again at its nightly check.",
};

/** What made fault `t`: the VESTA Agent's alert (its automation), its check (its skill and check), a chat, a person in
 *  the Cockpit, a guest. `friendlyOf`: an entity's friendly name in the villa's live states. Pure. */
export function faultOrigin(t: Pick<FmTicket, "source" | "origin" | "alertNumber" | "reportedBy" | "updates" | "raisedBy" | "check">,
  friendlyOf: (entityId: string) => string | undefined): string {
  const r = t.raisedBy;
  switch (faultSource(t)) {
    case "alert":
      if (r?.automation) return `Raised by ${automationSaid(r.automation, friendlyOf)}, which sent its alert to VESTA.`;
      if (r?.check) return `Raised by ${checkSaid(r)}.`;
      return "Raised by an alert of the villa's system, sent to VESTA. Which automation sent it was not recorded.";
    case "night": {
      const again = t.check ? READ_AGAIN[t.check] ?? "" : "";
      if (r?.check) return `Found by ${checkSaid(r)}.${again}`;
      return `Found by VESTA's maintenance check. Which check found it was not recorded.${again}`;
    }
    case "chat":
      return "Created by VESTA from a chat, when a person pressed \"Create this fault\".";
    case "guest":
      return "Reported by a guest with Report a problem.";
    case "owner":
    case "fm":
    case "person": {
      const first = t.updates?.[0];
      const who = (first?.who ?? "").trim() || authorWords(first);
      return who ? `Opened by ${who} in the Cockpit.` : "Opened by a person in the Cockpit. Who was not recorded.";
    }
    default:
      return ORIGIN_UNKNOWN;
  }
}

/** A device's live state with no record behind it: what the villa's system reports right now. `detail`: its word
 *  ("Unavailable", "Missing", the lost parts, an alarm's reading). Pure. */
export function liveOrigin(kind: "unavailable" | "parts" | "alarm", detail: string | undefined, missing = false): string {
  const after = " Nobody opened it: it goes away by itself once the device is back to normal.";
  if (kind === "alarm") return `Seen live in the villa's system: this device reads "${detail ?? ""}", an alarm state.${after}`;
  if (kind === "parts") return `Seen live in the villa's system: parts of this device stopped answering (${detail ?? ""}).${after}`;
  return missing
    ? `Seen live: the villa's system no longer has this device.${after}`
    : `Seen live in the villa's system: this device is offline right now.${after}`;
}

/** An overdue task of the Schedule. Pure. */
export function scheduleOrigin(title: string, state: keyof typeof DUE_WORDS): string {
  return `From the Schedule: the maintenance task "${title}" is ${DUE_WORDS[state].word.toLowerCase()}.`;
}

/** The villa's own alert card that VESTA has not taken over (messagesModel.villaAlertCards): sent by the villa's
 *  system itself. Pure. */
export const VILLA_ALERT_ORIGIN = "Sent by the villa's system itself (its visit alert), before VESTA took it over. Which automation sent it is not recorded on this card.";

/** A card line's (?) words: its sentences, or "Source not recorded." when it has none. Pure. */
export function lineOrigin(said: readonly string[] | undefined): string[] {
  return said?.length ? [...said] : [ORIGIN_UNKNOWN];
}
