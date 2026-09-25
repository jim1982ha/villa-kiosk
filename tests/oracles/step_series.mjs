// A held reading must be DRAWN as held — and the step must survive the gap split.
//
// ⚠️ FOUND BY THE OWNER LOOKING AT A CHART, 2026-09-19. The Jacuzzi pump's power
// trend showed repeating ramps with apparently nothing between the peaks. The
// recorder was innocent: 167 changes in 24 hours, no gap, no `unavailable`, and
// almost every reading 0.0. Home Assistant's own chart of the same entity over
// the same window is flat at zero with thin vertical spikes.
//
// The cause is that a state series is a STEP function and this drew it as a
// line. Home Assistant records a CHANGE, not a sample, so:
//
//     00:10:00  0.0      00:52:01  3.1      00:52:03  0.0
//
// is 0 W held for forty-two minutes, 3.1 W for two seconds, then 0 W. A
// polyline through those three points climbs for forty-two minutes through
// values that never existed.
//
// ⚠️ AND IT IS NOT THE GAP DEFECT, WHICH THIS BRANCH ALREADY FIXED (2.496.49).
// A gap is the absence of knowledge, shown as absence. This is the opposite:
// the value is perfectly known and interpolation threw that away. The two
// compose — step first, then split — and the last check below is the one that
// proves the composition rather than either half.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);

const { stepped } = await import("@/utils/stepSeries");
const { splitAtGaps } = await import("@/utils/historyGaps");

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

// The villa's own three readings.
const BLIP = [
  { t: 0, v: 0.0 },
  { t: 42 * 60_000, v: 3.1 },
  { t: 42 * 60_000 + 2_000, v: 0.0 },
];
const valueAt = (s, t) => {
  for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= t) return s[i].v;
  return null;
};

ck("halfway through the held stretch the line reads 0, not 1.55",
   valueAt(stepped(BLIP), 21 * 60_000) === 0.0);
ck("every drawn value was actually recorded",
   stepped(BLIP).every((p) => BLIP.some((r) => r.v === p.v)));
ck("the riser sits at the instant of the change",
   stepped(BLIP).filter((p) => p.t === 42 * 60_000).length === 2);
ck("an unchanged value adds no riser",
   stepped([{ t: 0, v: 2 }, { t: 10, v: 2 }]).length === 2);
ck("a single reading is returned unchanged", stepped([{ t: 5, v: 9 }]).length === 1);
ck("an empty series stays empty", stepped([]).length === 0);

// ⚠️ THE COMPOSITION, WHICH NEITHER HALF'S OWN TEST COVERS. A stepped series
// carries duplicate timestamps; `splitAtGaps` compares consecutive `t` values,
// so a riser must not swallow an outage boundary or the gap stops breaking the
// line and the chart draws straight through an outage again.
const series = [{ t: 0, v: 1 }, { t: 1_000, v: 2 }, { t: 900_000, v: 5 }];
const gaps = [{ from: 1_000, to: 900_000 }];
const runs = splitAtGaps(stepped(series).map((d) => ({ ...d })), gaps);
ck("a gap still breaks the line after stepping", runs.length === 2);
ck("the break lands on the outage, not on a riser",
   runs[0].every((p) => p.t <= 1_000) && runs[1].every((p) => p.t >= 900_000));

console.log(fail === 0 ? "  step series: all checks passed" : `  step series: ${fail} FAILED`);
process.exit(fail ? 1 : 0);
