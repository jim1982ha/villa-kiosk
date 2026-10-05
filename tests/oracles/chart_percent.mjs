// A percentage's axis stays within 0–100 while its values do — never a cap
// (owner, 2026-10-05: a battery at 100 % was drawn under a 100.5 / 101 axis;
// "make sure you don't cap the Y-axis to 100 %… energy or others").
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { chartGeometry, naturalBounds } = await import("@/utils/chartGeometry");

const win = { from: 0, to: 3_600_000 };
const plot = { left: 0, right: 300, top: 0, bottom: 100 };
const pts = (...vs) => vs.map((v, i) => ({ t: (i * 3_600_000) / Math.max(1, vs.length - 1), v }));
const g = (unit, vs, scale) => chartGeometry(win, [{ pts: pts(...vs), gaps: [], unit, scale }], plot, 0.08).series[0];
const tops = (s) => Math.max(...s.ticks.map((t) => t.v));

const full = g(" %", [100, 100, 100]);
ck("a battery flat at 100 %: the axis tops out at 100, not 101", full.hi === 100 && tops(full) <= 100, [full.lo, full.hi]);
ck("  ...and still has a readable span to draw it in, below the line (not 99.92–100)", full.lo <= 99, full.ticks.map((t) => t.v));
const varying = g("%", [40, 70, 100]);
ck("a humidity rising to 100 %: no padding above 100, none below 0", varying.hi === 100 && varying.lo >= 0, [varying.lo, varying.hi]);
const empty = g("%", [0, 0]);
ck("flat at 0 %: the axis does not go below 0", empty.lo === 0 && empty.hi > 0, [empty.lo, empty.hi]);
const over = g("%", [80, 135]);
ck("a percentage ABOVE 100 (an energy change) is never capped", over.hi > 135, [over.lo, over.hi]);
const under = g("%", [-20, 50]);
ck("  ...nor a negative one floored", under.lo < -20);
const watts = g(" W", [100, 100]);
ck("any other unit keeps its own range (a flat 100 W still gets its span above)", watts.hi > 100);
const mixed = chartGeometry(win, [{ pts: pts(100, 100), gaps: [], unit: "%" }, { pts: pts(100, 100), gaps: [], unit: " W" }], plot, 0.08).series[0];
ck("a shared scale holds the bounds only when every series on it is a percentage", mixed.hi > 100);
ck("naturalBounds: % only", naturalBounds(" %")?.max === 100 && naturalBounds("kWh") === null && naturalBounds(undefined) === null);
done("✅ a percentage's axis stays within 0–100 while its readings do");
