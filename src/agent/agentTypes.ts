/**
 * VESTA Agent — the SPA's half of the agent vocabulary.
 *
 * ⚠️ THIS FILE HAS A TWIN: `rootfs/usr/bin/agent/contracts.py`. It is the source
 * of truth (the backend writes the stored concerns); this file mirrors it.
 * `tests/py/test_contract_parity.py` FAILS THE BUILD if the two disagree in
 * either direction, including a value present on only one side.
 *
 * Each set is a `const` array with the union DERIVED from it via
 * `typeof X[number]`. Writing the union by hand would give the parity test
 * nothing to read — a TypeScript type is erased before anything can compare it
 * — and would let the array and the union drift, which is the same bug one
 * level down.
 *
 * ⚠️ NO IMPORTS, and nothing villa-specific: no entity_id, no room, no
 * threshold. Vocabulary only.
 */

/** Bumped when a value's MEANING changes; never for an addition.
 *
 *  ⚠️ NOTHING IN THIS APP IMPORTS THIS, AND DELETING IT BREAKS A TEST — the
 *  parity check reads it out of this file's SOURCE TEXT. Said here so the next
 *  unused-export sweep stops at this line instead of turning that pin into a
 *  vacuous pass, exactly as its twin in reportsTypes.ts records. */
export const AGENT_CONTRACT_VERSION = 1;

/** What caused a run. `chat` is a first-class trigger, not a special case. */
export const TRIGGER = ["manual", "scheduled", "chat"] as const;
export type Trigger = (typeof TRIGGER)[number];

/** How a run ended. `declined` is a CORRECT outcome and is not `failed`. */
export const RUN_STATUS = ["answered", "declined", "failed", "partial"] as const;
export type RunStatus = (typeof RUN_STATUS)[number];

/** Ordered least to most urgent. Identical to reports' SEVERITY, deliberately —
 *  three unrelated severity scales is the defect that work removed. */
export const SEVERITY = ["info", "notice", "warning", "critical"] as const;
export type Severity = (typeof SEVERITY)[number];

/**
 * Worst first: 0 is `critical`. THE ordering, for every renderer.
 *
 * ⚠️ DERIVED FROM `SEVERITY`, NOT A HAND-WRITTEN MAP. Two copies existed —
 * here and in `agent/fallback.py` — each defaulting an unknown severity to 9,
 * which sorted it LAST, into the quietest position, in both the brief and the
 * wall. That contradicts the rule `route.py` and `standing.severity_of` both
 * state: an unclassified severity is treated as a WARNING, never as the
 * quietest thing, because that is how a new hazard arrives unnoticed.
 *
 * Mirrors `contracts.severity_rank`; `test_contract_parity` pins the pair.
 */
export function severityRank(severity: string): number {
  const at = (SEVERITY as readonly string[]).indexOf(String(severity ?? "").toLowerCase());
  const known = at >= 0 ? at : (SEVERITY as readonly string[]).indexOf("warning");
  return SEVERITY.length - 1 - known;
}

/** Who a concern is for. Three, not two. */
export const AUDIENCE = ["owner", "facility"] as const;
export type Audience = (typeof AUDIENCE)[number];

/**
 * Who may be a SENDER — the app's own three profiles, and the only three there
 * are. ⚠️ NOT the audience list above: an AUDIENCE is who a finding is written
 * for, a ROLE is who is logged in, and the owner may perfectly well read the
 * facility brief. Conflating them is what put a non-existent third profile in
 * the sender picker — `facility` and `ops` are two names for one person, and
 * `guest` was missing.
 *
 * ⚠️ Label these with `roleLabel()` from `@/auth/roles`, never with the raw id:
 * `ops` reads as the Facility Manager everywhere a person can see it.
 */
export const SENDER_ROLE = ["guest", "owner", "ops"] as const;
export type SenderRole = (typeof SENDER_ROLE)[number];

/** A concern's lifecycle. `dismissed` is not `closed`: one was dealt with, the
 *  other a person said did not matter, and alert-fatigue reads the difference. */
export const CONCERN_STATE = [
  "open", "acted", "verified", "closed", "dismissed",
] as const;
export type ConcernState = (typeof CONCERN_STATE)[number];

/** The second axis of the action gate. Reversibility alone is not a safety
 *  test: unlocking a door is reversible and the harm is instantaneous. */
export const HARM_CLASS = ["low", "high"] as const;
export type HarmClass = (typeof HARM_CLASS)[number];

/** Three answers, not a boolean — "propose to a person" is the middle one. */
export const POLICY_VERDICT = ["allow", "propose", "deny"] as const;
export type PolicyVerdict = (typeof POLICY_VERDICT)[number];

/** Why a tool call failed. A tool error is DATA the model routes around. */
export const TOOL_ERROR_CODE = [
  "not_found", "unavailable", "invalid_args", "not_permitted",
  "too_large", "rate_limited", "internal",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODE)[number];

/** MCP content blocks. */
export const CONTENT_KIND = ["text", "json"] as const;
export type ContentKind = (typeof CONTENT_KIND)[number];

/**
 * What a tool does to the world. ⚠️ THREE, NOT TWO: `ACT` exists before any
 * actuating tool does, because the MCP surface is an ALLOW-list over this
 * vocabulary — so `act_service` is off that surface the day it is written,
 * rather than the day somebody remembers to deny it.
 */
export const TOOL_MODE = ["READ", "WRITE", "ACT"] as const;
export type ToolMode = (typeof TOOL_MODE)[number];

/** One concern, as the backend stores it (CTR-010). */
export interface Concern {
  id: string;
  subjectKey: string;
  title: string;
  body: string;
  severity: Severity;
  audience: Audience;
  evidence: Array<{ tool: string; argsDigest: string; at: string; summary: string }>;
  action?: { kind: string; targetRef: string; reversible: boolean; harmClass: HarmClass };
  confidence: number;
  openedAt: string;
  state: ConcernState;
  supersedes: string[];
  /** When this was sent to somebody, or absent if it never was.
   *  ⚠️ SNAKE_CASE ON THE WIRE — the concern store is written by Python and
   *  served verbatim, so this is `delivered_at` as it arrives. */
  delivered_at?: string;
  /** When somebody said "I have seen this", and who. Absent until they do.
   *  ⚠️ NOT A STATE — a concern stays `open` after being acknowledged. A person
   *  saying they have seen an alert is not saying it is fixed, and collapsing
   *  the two would make the villa stop carrying a problem that is still
   *  happening. Snake_case for the same reason as `delivered_at` above. */
  acknowledged_at?: string;
  acknowledged_by?: string;
  /** The investigation that produced this concern. ⚠️ THE LINK BACK TO THE FLAG
   *  (2.780.0). Until then a concern named its subject only as `subjectKey`, a
   *  HASH, so "did this flag turn into anything?" could only be answered by
   *  hashing an entity id the flag usually does not carry — the reference villa
   *  reports `0/3 identified`. Snake_case for the same reason as the two above:
   *  the store is written by Python and served verbatim. */
  run_id?: string;
  /** One entry per send. ⚠️ A LIST BECAUSE ESCALATION SENDS AGAIN, to a profile
   *  the first send may not have reached — "add the owner" is the whole point
   *  of the second band, and a single field would be overwritten by it. The
   *  PROFILE is recorded rather than the notify entity: `owner` and `ops` are
   *  what a person recognises from the People tab. Absent on concerns raised
   *  before 2.782.0, where the audience is the honest fallback. */
  deliveries?: Array<{ profile: string; at: string }>;
  /** ⚠️ STAMPED AT RAISE TIME FROM THE MODE THE VILLA WAS IN (2026-08-28,
   *  owner's ruling), never derived from today's setting — the same trap
   *  `TriagePass.mode` avoids. True means the concern was raised under
   *  "Investigate & Log Only": shown here and told once as an FYI, but never
   *  escalated, never pushed, and no to-do job was raised — nothing is asked
   *  of the reader. Absent on concerns raised before this existed. */
  informational?: boolean;
  /** "This was worth telling me." ⚠️ NOT A STATE, and it used to be one: the
   *  thumb up wrote `state: "verified"`, which is SETTLED, so a compliment
   *  paid to the supervisor made the card disappear (reported 2026-08-27).
   *  `verified` means "the condition did not recur" — a claim about the
   *  VILLA — and this is a claim about the SUPERVISOR. Snake_case on the wire
   *  like every other field the Python store writes verbatim. */
  useful?: boolean;
  useful_at?: string;
  useful_note?: string;
  /** Which escalation step the villa has ALREADY taken, and when. ⚠️ THE ONLY
   *  HONEST INPUT TO "what happens next", because the screen cannot predict
   *  `route.escalate`'s earlier branches — the guests-present one skips the
   *  time bands entirely and needs live occupancy plus the People table to
   *  foresee. A card that predicted a band while this was set promised a
   *  re-send that could never arrive. Snake_case on the wire, like its
   *  neighbours. */
  escalated_step?: string;
  escalated_at?: string;
}
