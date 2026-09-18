/**
 * A held reading must be DRAWN as held. Pinned against the villa's own data.
 *
 * ⚠️ THE OWNER FOUND THIS BY LOOKING AT A CHART AND SAYING "THAT IS NOT
 * POSSIBLE". A pump's power trend showed repeating ramps; the recorder held no
 * gaps, no `unavailable`, and 167 changes in 24 hours that were almost all
 * 0.0. Home Assistant's OWN chart of the same entity over the same window is
 * flat at zero with thin vertical spikes. Ours drew sawteeth, because it joined
 * recorded points with straight lines and Home Assistant records CHANGES, not
 * samples — so 42 minutes of held zero became a 42-minute diagonal climb.
 */

import { stepped, type Reading } from "../../src/utils/stepSeries.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS ${name}`); return; }
  console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  failures++;
}

// ── the exact readings behind the chart the owner questioned ───────────────
// 0 W held for 42 minutes, 3.1 W for two seconds, then 0 W again.
const BLIP: Reading[] = [
  { t: 0, v: 0.0 },
  { t: 42 * 60_000, v: 3.1 },
  { t: 42 * 60_000 + 2_000, v: 0.0 },
];

check("a held value is carried to the instant it changes",
  stepped(BLIP),
  [
    { t: 0, v: 0.0 },
    { t: 2_520_000, v: 0.0 },          // ← the 42 minutes of zero, made explicit
    { t: 2_520_000, v: 3.1 },
    { t: 2_522_000, v: 3.1 },
    { t: 2_522_000, v: 0.0 },
  ]);

// ⚠️ THE ASSERTION THAT ACTUALLY CATCHES THE BUG, rather than restating the
// output above: between two readings, nothing may be drawn at a value that was
// never recorded. Linear interpolation puts the midpoint of the blip at 1.55 W.
function valueAt(series: Reading[], t: number): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].t <= t) return series[i].v;
  return null;
}
const midpoint = 21 * 60_000;
check("halfway through the held stretch the line is still at zero",
  valueAt(stepped(BLIP), midpoint), 0.0);

check("every drawn value is one that was actually recorded",
  stepped(BLIP).every((p) => BLIP.some((r) => r.v === p.v)), true);

// ── the shape rules ────────────────────────────────────────────────────────
check("a series of one is returned unchanged", stepped([{ t: 5, v: 9 }]), [{ t: 5, v: 9 }]);
check("an empty series stays empty", stepped([]), []);

check("an unchanged value adds no riser",
  stepped([{ t: 0, v: 2 }, { t: 10, v: 2 }, { t: 20, v: 2 }]),
  [{ t: 0, v: 2 }, { t: 10, v: 2 }, { t: 20, v: 2 }]);

check("the input is not mutated", (() => {
  const input: Reading[] = [{ t: 0, v: 1 }, { t: 1, v: 2 }];
  stepped(input);
  return input.length;
})(), 2);

// ⚠️ A DENSELY-SAMPLED SENSOR MUST NOT DOUBLE IN SIZE FOR NOTHING. The villa's
// meter reports every minute; a riser per point would make every chart in the
// app carry twice the geometry it needs.
const dense: Reading[] = Array.from({ length: 100 }, (_, i) => ({ t: i, v: 1 }));
check("a flat dense series gains no points", stepped(dense).length, 100);

console.log(failures === 0 ? "\nstep series: all checks passed"
                           : `\nstep series: ${failures} FAILED`);
if (failures > 0) process.exit(1);
