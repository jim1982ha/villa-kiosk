// Float noise never takes a chart down (owner, 2026-10-05: the error screen
// opening a temperature & humidity sensor — "Invalid array length" in the axis
// ticks, three times since 2.496.269). Readings 21.4 and 21.400000000000002
// made a step below 21.4's own precision; `v += step` never moved.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { niceTicks, chartGeometry, isFlat } = await import("@/utils/chartGeometry");

const noise = niceTicks(21.4, 21.400000000000002, 4);
ck("21.4 against 21.400000000000002: a few readable ticks, not a runaway loop",
   noise.ticks.length >= 2 && noise.ticks.length <= 12 && noise.step >= 0.01, noise);
ck("  ...and the line through them is drawn as flat", isFlat(21.4, 21.400000000000002) && !isFlat(21.4, 21.5));
const g = chartGeometry({ from: 0, to: 2 }, [{ pts: [{ t: 0, v: 21.4 }, { t: 2, v: 21.400000000000002 }], gaps: [] }],
  { left: 0, right: 100, top: 0, bottom: 100 }, 0.08).series[0];
ck("a chart of such readings has a span of a whole unit, its ticks readable", g.hi - g.lo >= 1 && g.ticks.length <= 12, [g.lo, g.hi]);
ck("never more than 100 ticks, whatever the input", niceTicks(0, 1e9, 1e9).ticks.length <= 101);
ck("an infinite or missing value draws no axis rather than looping", niceTicks(0, Infinity).ticks.length === 0 && niceTicks(NaN, 1).ticks.length === 0);
done("✅ float noise is a flat line, and an axis always ends");
