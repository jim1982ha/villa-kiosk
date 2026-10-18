// src/fm/issueSource.ts
// Where a problem in the Overview's Open issues comes from (owner, 2026-10-14: "show in each card the source of the
// issue", drawn as an icon in place of the warning sign — components/fm/sourceIcons.tsx; the legend is the (i)'s).
// Pure: tests/oracles/live_issues.mjs drives it by value.

import { ROLE_LABELS } from "@/auth/roles";
import { AGENT_ORIGINS, AGENT_SOURCE, type FmTicket } from "./fmTypes";

/** live: what the Kiosk's map shows right now (unavailable, missing, a red badge) — clears by itself. alert / night /
 *  chat: a fault the VESTA Agent made from an alert, its nightly check, or a chat ("Create this fault"). owner / fm /
 *  person: "Open a ticket" by that profile (person: a profile this build does not name). guest: "Report a problem".
 *  schedule: maintenance overdue. */
export type IssueSource = "live" | "alert" | "night" | "chat" | "owner" | "fm" | "person" | "guest" | "schedule";

/** Did the VESTA Agent write this record (created it or last changed it)? ⚠️ ONE ANSWER (architecture review scan 1,
 *  2026-10-19): the "by VESTA Agent" mark, a fault's "Opened … by", its source and the (i)'s Agent rows each tested
 *  the record's stamp themselves. */
export function agentOwned(r: { source?: string }): boolean {
  return r.source === AGENT_SOURCE;
}

/** Every source, in the legend's order: what the Kiosk and its people produce, then what the VESTA Agent produces
 *  (owner, 2026-10-15: "first all the types that are not coming from the Agent, then those that are"). */
export const ISSUE_SOURCES: readonly IssueSource[] =
  ["live", "owner", "fm", "person", "guest", "schedule", "alert", "night", "chat"];

/** The sources only a VESTA Agent produces: the legend leaves them out when there is none (agentView.agentVisible). */
export const AGENT_SOURCES: ReadonlySet<IssueSource> = new Set(["alert", "night", "chat"]);

/** A fault's source — from what its record says, never from its words: the Agent's `origin` (or its alert number),
 *  a guest's mark, else the profile its first step names (fmCommands.addTicket stamps it). */
export function faultSource(t: Pick<FmTicket, "source" | "origin" | "alertNumber" | "reportedBy" | "updates">): IssueSource {
  if (t.reportedBy === "guest") return "guest";
  if (agentOwned(t)) {
    if (t.origin && AGENT_ORIGINS.includes(t.origin)) return t.origin;
    // ⚠️ NO "VESTA AGENT" SOURCE ANY MORE (owner, 2026-10-15: it only confused the (i)). Every fault the Agent writes
    // carries its origin (Agent 0.12.198), and its repair gives an older alert's or night check's fault its origin
    // within minutes; the one it cannot is a fault a chat made before then — so a fault without one reads as Chat.
    return typeof t.alertNumber === "number" ? "alert" : "chat";
  }
  const by = t.updates?.[0]?.by;
  return by === ROLE_LABELS.owner ? "owner" : by === ROLE_LABELS.ops ? "fm" : "person";
}
