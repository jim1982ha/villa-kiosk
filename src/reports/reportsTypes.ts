/**
 * VESTA Reports — the SPA's half of the shared vocabulary.
 *
 * ⚠️ THIS FILE HAS A TWIN: `rootfs/usr/bin/reports/contracts.py`. It is the
 * source of truth (the backend is what writes the stored documents); this file
 * mirrors it. `tests/py/test_contract_parity.py` FAILS THE BUILD if the two
 * disagree in either direction, including a value present on only one side.
 *
 * Each set is declared as a `const` array and the union is DERIVED from it
 * with `typeof X[number]`. Writing the union by hand instead would give the
 * parity test nothing to read at runtime — a TypeScript type is erased before
 * anything can compare it — and would let the array and the union drift from
 * each other, which is the same class of bug one level down.
 *
 * ⚠️ NO IMPORTS, and nothing villa-specific. This is vocabulary only: no
 * entity_id, no room name, no threshold. Types and constants that describe the
 * SHAPE of a report, never its content.
 */

/** Bumped when a value's MEANING changes; never for an addition. */
export const CONTRACT_VERSION = 1;

/** Ordered least to most urgent — report sections sort by this order. */
export const SEVERITY = ["info", "notice", "warning", "critical"] as const;
export type Severity = (typeof SEVERITY)[number];

/**
 * Who a report is written for. An AUDIENCE, not a role — it selects modules and
 * pitches the prose, and deliberately does not map onto `auth/permissions.ts`
 * profiles (the owner may perfectly well read the facility brief).
 */
export const AUDIENCE = ["owner", "facility"] as const;
export type Audience = (typeof AUDIENCE)[number];

/**
 * What kind of claim a finding makes. `DATA_QUALITY` is the one that keeps the
 * report honest: a sensor that stopped reporting is a measurement fault, not an
 * equipment fault, and saying "the freezer is warming" when the truth is "the
 * freezer's thermometer went offline" is the fastest way to lose a reader.
 */
export const FINDING_KIND = [
  "OBSERVATION",
  "ANOMALY",
  "DATA_QUALITY",
  "FORECAST",
  "VERIFICATION",
] as const;
export type FindingKind = (typeof FINDING_KIND)[number];

/** Not a cron expression — an operator on an iPad should never meet one. */
export const CADENCE = ["daily", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCE)[number];

/**
 * The outcome of ONE delivery to ONE target. Per-target on purpose: a report
 * that reached the owner and failed to reach the facility manager is not
 * "failed", and collapsing that loses the distinction a resend needs.
 */
export const DELIVERY_STATUS = ["pending", "sent", "failed", "skipped"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[number];

/** Where the prose came from. Recorded so "the tone changed" is answerable. */
export const NARRATION_MODE = ["deterministic", "provider"] as const;
export type NarrationMode = (typeof NARRATION_MODE)[number];

/**
 * Why a module did not run. A module is NEVER silently absent — a thin
 * deployment should produce a short honest report, not one that looks complete.
 */
export const SKIP_REASON = [
  "missing_capability",
  "disabled",
  "insufficient_history",
  "audience_mismatch",
  "timed_out",
  "errored",
] as const;
export type SkipReason = (typeof SKIP_REASON)[number];

/**
 * ⚠️ THE PRIVACY BOUNDARY. The only field names that may leave the villa in an
 * LLM narration payload (Phase 6). Mirrored here so the UI's payload inspector
 * shows the operator exactly what would be transmitted, from the same list the
 * backend filters by — a preview built from a second, hand-kept list would be a
 * privacy claim verified against the wrong thing.
 *
 * Allow-list BY CONSTRUCTION: a new Finding field is excluded until someone
 * adds it here, and the reviewer of that line is looking at a privacy decision.
 * A deny-list fails open on every field nobody thought of.
 *
 * Note the absence of entity IDs: they routinely carry room and person names
 * (`sensor.emmas_bedroom_window`). The label is what a reader needs; `ref` is
 * the opaque handle a model needs to refer to something.
 */
export const PAYLOAD_ALLOWED_FIELDS = [
  "ref",
  "kind",
  "severity",
  "label",
  "area",
  "metric",
  "unit",
  "observed",
  "baseline",
  "delta",
  "window_days",
  "confidence",
  "completeness",
  "horizon_days",
] as const;
export type PayloadField = (typeof PAYLOAD_ALLOWED_FIELDS)[number];

/**
 * One entry in a schedule. `hour` is local wall-clock in the villa's timezone,
 * not UTC: an owner asking for a report "at 7am" means 7am on the wall, and
 * that has to stay 7am across a DST change.
 */
export interface ReportSchedule {
  id: string;
  cadence: Cadence;
  hour: number;
  audience: Audience;
  /** Empty means "every target configured globally". */
  targets?: string[];
}

/**
 * The operator's settings. Every field optional because the STORED document is
 * a sparse overlay — absent means "use the default", and the backend applies
 * defaults at read time rather than persisting them. Writing a fully populated
 * document back would make a deleted schedule indistinguishable from an absent
 * one, which is the config-resurrection bug CLAUDE.md's hard rule describes.
 */
export interface ReportsConfig {
  enabled?: boolean;
  schedules?: ReportSchedule[];
  notifyTargets?: string[];
  modules?: Record<string, boolean>;
  /** ⚠️ `monthlyLimit` IS A CEILING ON REQUESTS, NOT ON TOKENS — see
   *  `providers.DEFAULT_MONTHLY_LIMIT`. Token accounting needs a provider's own
   *  reply to be trusted for billing and differs per provider; a request count
   *  is exact, provider-agnostic, and an owner can reason about it. */
  narration?: { mode?: NarrationMode; monthlyLimit?: number };
  timezone?: string;
  minHistoryDays?: number;
}

/** The result of one delivery attempt to one target. */
export interface DeliveryResult {
  target: string;
  status: DeliveryStatus;
  /** Why, when the status alone is not actionable. Never a credential. */
  detail?: string;
}

/**
 * One produced report, as recorded in the bounded history ring. Holds metadata
 * and findings rather than rendered prose — the ring is capped by entry count,
 * so an entry whose size depends on how much a narrator wrote would make the
 * cap meaningless.
 */
export interface ReportHistoryEntry {
  id: string;
  at: string;
  audience: Audience;
  cadence: Cadence;
  narration: NarrationMode;
  findingCount: number;
  severity: Severity;
  deliveries: DeliveryResult[];
}

export interface ReportsHistory {
  version: number;
  entries: ReportHistoryEntry[];
}
