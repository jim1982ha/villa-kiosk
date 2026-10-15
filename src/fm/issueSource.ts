// src/fm/issueSource.ts
// Where a problem in the Overview's Open issues comes from (owner, 2026-10-14: "show in each card the source of the
// issue", drawn as an icon in place of the warning sign — components/fm/sourceIcons.tsx; the legend is the (i)'s).
// Pure: tests/oracles/live_issues.mjs drives it by value.

import { ROLE_LABELS } from "@/auth/roles";
import { AGENT_ORIGINS, AGENT_SOURCE, type FmTicket } from "./fmTypes";

/** live: what Home Assistant reports right now (unavailable, not in Home Assistant, red on the map) — clears by itself.
 *  alert / night / chat: a fault the VESTA Agent made from an alert, its nightly check, or a chat ("Create this
 *  fault"); agent: one it made before it said which (VESTA Agent before 0.12.198). owner / fm / person: "Open a
 *  ticket" by that profile (person: a profile this build does not name). guest: "Report a problem". schedule:
 *  maintenance overdue. */
export type IssueSource = "live" | "alert" | "night" | "chat" | "agent" | "owner" | "fm" | "person" | "guest" | "schedule";

/** Every source, in the legend's order. */
export const ISSUE_SOURCES: readonly IssueSource[] =
  ["live", "alert", "night", "chat", "agent", "owner", "fm", "person", "guest", "schedule"];

/** The sources only a VESTA Agent produces: the legend leaves them out when there is none (agentView.agentVisible). */
export const AGENT_SOURCES: ReadonlySet<IssueSource> = new Set(["alert", "night", "chat", "agent"]);

/** A fault's source — from what its record says, never from its words: the Agent's `origin` (or its alert number),
 *  a guest's mark, else the profile its first step names (fmCommands.addTicket stamps it). */
export function faultSource(t: Pick<FmTicket, "source" | "origin" | "alertNumber" | "reportedBy" | "updates">): IssueSource {
  if (t.reportedBy === "guest") return "guest";
  if (t.source === AGENT_SOURCE) {
    if (t.origin && AGENT_ORIGINS.includes(t.origin)) return t.origin;
    return typeof t.alertNumber === "number" ? "alert" : "agent";
  }
  const by = t.updates?.[0]?.by;
  return by === ROLE_LABELS.owner ? "owner" : by === ROLE_LABELS.ops ? "fm" : "person";
}
