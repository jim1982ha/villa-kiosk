// tests/consistency/socket_timing_test.ts
// Run: npm run test:socket-timing   (node strips the types; no runner, no deps)
// Also run by `tests/py/test_villa_rules.py`.
//
// ⚠️ WHAT THIS IS NOT. The reconnect "arithmetic" is one expression —
// `Math.min(1000 * 2 ** attempts, 30000)` — and a module holding only that
// would be shallow: an interface as big as its implementation, which is the
// shape this repo's design vocabulary exists to refuse.
//
// What was actually wrong is that FOUR timings governing whether a wall tablet
// notices it has lost Home Assistant were inline magic numbers in three
// different methods — 1000, 30000, 25000, 5000 — so the relationships between
// them could not be read, let alone checked. A tablet that sits "connected"
// while every tap does nothing is the failure they exist to prevent, and it is
// invisible from the desk.

import {
  PING_INTERVAL_MS, PONG_TIMEOUT_MS, RECONNECT_BASE_MS, RECONNECT_MAX_MS,
  reconnectDelay,
} from "../../src/ha/socketTiming.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

// ── the ladder the comment claims ───────────────────────────────────────────
{
  // `// 1,2,4..max 30s` — a claim in a trailing comment that nothing checked.
  const ladder = [0, 1, 2, 3, 4, 5, 6].map(reconnectDelay);
  check("the first retry is immediate-ish, then it doubles",
    JSON.stringify(ladder) === JSON.stringify([1000, 2000, 4000, 8000, 16000, 30000, 30000]),
    JSON.stringify(ladder));

  check("it never exceeds the cap, however long the outage",
    [10, 50, 1000].every((n) => reconnectDelay(n) === RECONNECT_MAX_MS));
  check("...and never overflows into nonsense at a large attempt count",
    Number.isFinite(reconnectDelay(1024)) && reconnectDelay(1024) === RECONNECT_MAX_MS);

  check("the first attempt waits the base delay, not zero",
    reconnectDelay(0) === RECONNECT_BASE_MS);
  // ⚠️ A NEGATIVE COUNT IS A RESET GONE WRONG, not a reason to hammer HA.
  check("a nonsense attempt count still waits at least the base delay",
    reconnectDelay(-5) >= RECONNECT_BASE_MS, String(reconnectDelay(-5)));
}

// ── the relationships, which is why they belong in one file ─────────────────
{
  // ⚠️ A PING MUST NOT ARRIVE WHILE THE LAST ONE IS STILL UNANSWERED. If the
  // pong timeout outlived the interval, the socket would be judged dead only
  // after skipping pings, and the "dead socket" the heartbeat exists to catch
  // would take longer to notice than the heartbeat's own period.
  check("a pong is given less time than the gap between pings",
    PONG_TIMEOUT_MS < PING_INTERVAL_MS,
    `${PONG_TIMEOUT_MS} vs ${PING_INTERVAL_MS}`);

  // ⚠️ AND THE HEARTBEAT MUST OUT-PACE THE WORST RECONNECT WAIT, or a tablet
  // that has silently lost the socket waits longer to find out than a tablet
  // that lost it loudly. The whole point of the heartbeat is that the browser
  // does not report this kind of death.
  check("a silent death is noticed no later than a loud one is retried",
    PING_INTERVAL_MS + PONG_TIMEOUT_MS <= RECONNECT_MAX_MS,
    `${PING_INTERVAL_MS} + ${PONG_TIMEOUT_MS} vs ${RECONNECT_MAX_MS}`);

  check("every timing is a positive whole number of milliseconds",
    [PING_INTERVAL_MS, PONG_TIMEOUT_MS, RECONNECT_BASE_MS, RECONNECT_MAX_MS]
      .every((n) => Number.isInteger(n) && n > 0));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
