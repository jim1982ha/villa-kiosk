// tests/oracles/history_offline.mjs
//
// Does a device's OFFLINE time survive the fetch and reach the chart?
//
// ⚠️ THIS FILE USED TO REPLAY THE PIPELINE INSTEAD OF RUNNING IT. It declared
// an OLD transform (drop unknown states, then collapse duplicates) and a NEW
// one, ran both over recorded rows and compared them. That proved the decision
// and pinned nothing: `fetchStateHistory` could have gone back to dropping
// `unavailable` and not one line here would have gone red — which is precisely
// the regression the file is named for.
//
// It drives the shipped function now. `fetchStateHistory` fetches, so the two
// things it reaches for are stubbed: `window.location` (ingressApiBase builds a
// same-origin URL from it) and `fetch` (which returns the recorded rows). Both
// are three lines, and they are the only reason this was ever called untestable.
// An EMPTY origin, not a plausible hostname. The first version used one, and
// tests/hard-rules.py's third-party-host clause caught it immediately — the
// guard doing its job on a file written minutes earlier. `fetch` is stubbed, so
// the URL is never dialled and only its shape matters.
globalThis.window = { location: { origin: "", pathname: "/" } };

import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

// Real rows for a master-bedroom lock on 2026-09-14 — a device that flapped
// between unlocked and unavailable all day. The ids are fixture names; the
// SHAPE and the sequence are what was recorded.
const T = (min) => new Date(Date.UTC(2026, 8, 14, 0, min)).toISOString();
const ROWS = [
  { state: "unavailable", last_changed: T(0) },   // the window-start anchor
  { state: "unlocked",    last_changed: T(20) },
  { state: "unavailable", last_changed: T(21) },
  { state: "unlocked",    last_changed: T(48) },
  { state: "unlocked",    last_changed: T(49) },  // attribute-only change
  { state: "unavailable", last_changed: T(90) },
];
globalThis.fetch = async () => ({ ok: true, json: async () => [ROWS] });

const { fetchStateHistory } = await import("@/ha/HAHistoryAPI");
const points = await fetchStateHistory("lock.fixture", 24);
const states = points.map((p) => p.state);
console.log(`  ${ROWS.length} recorded rows → ${points.length} points\n`);

console.log("  offline time survives the fetch:");
// ⚠️ THE OLD DEFAULT DROPPED THESE BEFORE THE CHART EVER SAW THEM, two ways:
// a window whose first in-window change is late rendered BLANK up to it,
// because the anchor row HA returns at the window start WAS an `unavailable`;
// and a long window collapsed to ONE solid band of the surviving state — the
// worse lie, since it claims a device held one state for twelve hours when it
// was offline for most of them.
eq("`unavailable` reaches the chart", states.includes("unavailable"), true);
eq("...including the window-start anchor, so nothing renders blank",
   states[0], "unavailable");
eq("the real alternation is preserved, not flattened",
   states, ["unavailable", "unlocked", "unavailable", "unlocked", "unavailable"]);

console.log("\n  and consecutive duplicates are still collapsed:");
// An attribute-only change reports the same state twice; drawing a boundary
// there would put a visible seam in one continuous segment.
eq("two identical rows become one point", points.filter((p) => p.state === "unlocked").length, 2);
eq("no two adjacent points share a state",
   states.every((s, i) => i === 0 || s !== states[i - 1]), true);

console.log("\n  and the rows are ordered and real:");
eq("timestamps are finite", points.every((p) => Number.isFinite(p.t)), true);
eq("...and ascending", points.every((p, i) => i === 0 || p.t >= points[i - 1].t), true);

console.log("\n  a null state does not travel:");
globalThis.fetch = async () => ({ ok: true, json: async () => [[
  { state: null, last_changed: T(0) }, { state: "on", last_changed: T(5) },
]] });
const withNull = await fetchStateHistory("sensor.fresh", 24);
eq("HA's null on a fresh entity is coerced at the door",
   withNull.every((p) => typeof p.state === "string"), true);

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ offline time reaches the chart"}`);
process.exit(fail ? 1 : 0);
