// src/ha/socketTiming.ts
//
// The four clocks that decide whether the wall tablet notices it has lost Home
// Assistant, in one place where they can be read against each other.
//
// ── Why this file exists, and what it deliberately is not ─────────────────
// It is NOT "the backoff arithmetic extracted". That is one expression —
// `Math.min(1000 * 2 ** attempts, 30000)` — and a module holding only it would
// be shallow: an interface as large as its implementation, which is the shape
// this repo's design vocabulary refuses.
//
// What was wrong is that these four numbers lived inline in three different
// methods of a 525-line class, so the RELATIONSHIPS between them could not be
// read. A pong timeout longer than the ping interval, or a heartbeat slower
// than the worst reconnect wait, are both defects you cannot see while the
// numbers are apart — and the failure they guard against is a tablet sitting
// "connected" for minutes while every tap does nothing, which is invisible
// from a desk and hard to report from a wall.
//
// The class keeps the sockets, the timers and the re-subscription. This is the
// numbers and the one rule over them.

/** How long between heartbeat pings on a live socket. */
export const PING_INTERVAL_MS = 25_000;

/** How long a ping may go unanswered before the socket is judged dead.
 *
 *  ⚠️ SHORTER THAN THE INTERVAL, NECESSARILY. A pong given longer than the gap
 *  between pings would be judged only after a ping had been skipped, so the
 *  dead socket the heartbeat exists to catch would take longer to notice than
 *  the heartbeat's own period. HA answers `{type:"ping"}` with
 *  `{type:"pong"}`; a socket that swallows it (slept phone, Wi-Fi roam) is
 *  force-closed so the ordinary reconnect path takes over. */
export const PONG_TIMEOUT_MS = 5_000;

/** The first reconnect wait, doubling from here. */
export const RECONNECT_BASE_MS = 1_000;

/** The longest reconnect wait, however long the outage has run. */
export const RECONNECT_MAX_MS = 30_000;

/**
 * How long to wait before the next reconnect attempt: 1s, 2s, 4s … capped.
 *
 * ⚠️ THE LADDER WAS A TRAILING COMMENT (`// 1,2,4..max 30s`) AND NOTHING
 * CHECKED IT. A cap that stopped capping would have a villa retrying on a
 * schedule nobody chose, and the only symptom is a log nobody reads.
 *
 * A negative count is a reset that went wrong, not a licence to hammer Home
 * Assistant: it waits the base delay like a first attempt.
 */
export function reconnectDelay(attempts: number): number {
  const n = Number.isFinite(attempts) && attempts > 0 ? attempts : 0;
  return Math.min(RECONNECT_BASE_MS * 2 ** n, RECONNECT_MAX_MS);
}
