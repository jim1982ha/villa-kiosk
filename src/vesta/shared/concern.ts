// src/vesta/shared/concern.ts
// The Concern domain module: one place that turns the store's wire shape into
// something the surfaces can ask questions of.
//
// ⚠️ THE WIRE SHAPE IS HYBRID AND THAT LEAKED (2026-09-06). `openedAt` is
// camelCase while `delivered_at`, `acknowledged_at`, `useful_at`, `flag_type`,
// `escalated_step` and `run_id` are snake_case, each for its own recorded
// reason. Before this module a caller had to know that PER FIELD, and had to
// know that nothing narrowed the values either — `loadConcerns` ended in
//
//     rows.filter((c): c is Concern => !!c && typeof c === "object")
//
// which is a type predicate that narrows NOTHING, sitting a hundred lines from
// a docstring in the same file insisting that EVERY READ NARROWS. So every
// consumer defended itself, in the same three tokens, in six places:
// `String(c.state ?? "open")`, `String(c.acknowledged_at ?? "").trim()`.
//
// ⚠️ THE PREDICATES ARE THE POINT, NOT THE NARROWING. The owner's ruling that
// "acknowledgement is what takes a card off the wall, and nothing else does"
// was expressed at three sites in one component plus one more next door. A
// ruling that lives in four places is a ruling that gets changed in three.

import type { Concern } from "./agentTypes";

/** Lifecycle states that still count as the villa carrying the problem.
 *
 * ⚠️ `acted` IS LIVE. Somebody has done something about it; the condition has
 * not gone away. Treating it as finished is how a still-open problem drops off
 * the wall. */
const LIVE_STATES = new Set(["open", "acted"]);

/** A stored field that is either a non-empty stamp or nothing at all.
 *
 * ⚠️ TRIM, DO NOT TRUST. A hand-edited document, an older add-on's shape or a
 * truncated write reaches here as `undefined`, `null` or `"  "`, and every one
 * of those must read as "not stamped" rather than as `undefined.trim()` in the
 * DOM. */
const stamp = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";

/** The concern's lifecycle state, defaulted the way the store defaults it. */
export const stateOf = (c: Concern): string =>
  stamp(c.state) || "open";

/** Is the villa still carrying this? */
export const isLive = (c: Concern): boolean =>
  LIVE_STATES.has(stateOf(c));

/** Has somebody said they have seen it? */
export const wasSeen = (c: Concern): boolean =>
  stamp(c.acknowledged_at) !== "";

/** Has somebody rated it? ⚠️ KEYED ON THE STAMP, NEVER ON `useful` — that is
 *  `false` both for "less like this" and for "nobody has said anything", the
 *  conflation that once hid the receipt for a rating. */
export const wasJudged = (c: Concern): boolean =>
  stamp(c.useful_at) !== "";

/** Still asking for the reader's attention: live, and nobody has picked it up.
 *
 * ⚠️ AN ACKNOWLEDGED-BUT-OPEN CONCERN IS COUNTED, NOT DROPPED, by the callers
 * — or "I have seen it" would silently come to mean "it is gone". */
export const needsAttention = (c: Concern): boolean =>
  isLive(c) && !wasSeen(c);

/** Seen, and the villa is still carrying it. */
export const isSeenButOpen = (c: Concern): boolean =>
  isLive(c) && wasSeen(c);

/** Finished, one way or another. */
export const isSettled = (c: Concern): boolean => !isLive(c);

/** Rated, but nobody has said what KIND of thing it was — the queue the flag
 *  types panel exists to drain. */
export const awaitsFlagType = (c: Concern): boolean =>
  wasJudged(c) && stamp(c.flag_type) === "";

/** Narrow whatever the store handed back into rows the surfaces can trust.
 *
 * ⚠️ THIS IS THE READ THAT WAS MISSING. Anything that is not an object is
 * dropped rather than defended against six times downstream. */
export const normalizeConcerns = (raw: unknown): Concern[] =>
  (Array.isArray(raw) ? raw : []).filter(
    (c): c is Concern => !!c && typeof c === "object",
  );
