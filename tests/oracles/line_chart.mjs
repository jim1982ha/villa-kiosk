// A history chart draws the window it was ASKED for.
//
// ⚠️ REPRODUCED 2026-09-25 AGAINST THE SHIPPED CODE: a sensor offline RIGHT NOW
// drew no outage band. Both charts scaled their x-axis to their own first and
// last FINITE readings; the ongoing outage starts after the last one, so
// gapBand clamped it past the right edge and returned null. The last held
// value also stopped at the last reading. And a device down longer than its
// window was shown "… before <date>" over a bar still drawing [now − h, now].
//
// The first check below reruns the old axis and proves it loses the band, so a
// pass here means the window is what fixed it.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { gapsFrom } = await import("@/utils/historyGaps");
const { chartWindow, timeScale, lineRuns, outageBands, windowEndingAt } = await import("@/utils/lineChart");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const H = 3_600_000, L = 40, R = 320;
/** Hourly rows 0..24h; `v(h)` NaN where the sensor reported nothing usable. */
const rows = (v) => Array.from({ length: 25 }, (_, h) => ({ t: h * H, v: v(h) }));
const finite = (rs) => rs.filter((r) => Number.isFinite(r.v));
const W = { from: 0, to: 24 * H };

console.log("  an outage that has not ended:");
{
  const rs = rows((h) => (h < 20 ? 21 : NaN));
  const gaps = gapsFrom(rs, W.to), data = finite(rs);
  const oldAxis = chartWindow(undefined, data);
  const oldBands = outageBands(gaps, timeScale(oldAxis, L, R), L, R);
  ck("the OLD axis (first → last reading) draws no band for it", oldBands.length === 0, oldBands);
  const sx = timeScale(chartWindow(W, data), L, R);
  const bands = outageBands(gaps, sx, L, R);
  ck("drawn against the window, it has its band", bands.length === 1, bands);
  ck("  ...running to the right edge", bands.length === 1 && Math.abs(bands[0].x + bands[0].w - R) < 1e-9, bands);
  const runs = lineRuns(data, gaps, W);
  const end = runs.at(-1).at(-1);
  ck("the last value holds until the outage began, not past it", end.t === 20 * H && end.v === 21, end);
}
{
  const rs = rows((h) => (h < 4 ? NaN : 21));
  const gaps = gapsFrom(rs, W.to), data = finite(rs);
  const bands = outageBands(gaps, timeScale(W, L, R), L, R);
  ck("an outage at the START of the window has its band, from the left edge",
     bands.length === 1 && bands[0].x === L, bands);
}

console.log("\n  a quiet sensor:");
{
  const data = [{ t: 0, v: 5 }, { t: 3 * H, v: 7 }]; // on-change sensor, last change at 03:00
  const runs = lineRuns(data, [], W);
  const end = runs.at(-1).at(-1);
  ck("its last value holds to the end of the window", end.t === W.to && end.v === 7, end);
  ck("  ...and the step is still drawn flat-then-vertical",
     JSON.stringify(runs[0].slice(0, 3)) === JSON.stringify([{ t: 0, v: 5 }, { t: 3 * H, v: 5 }, { t: 3 * H, v: 7 }]), runs[0]);
}
ck("a caller with no window still gets the data's own span",
   JSON.stringify(chartWindow(undefined, [{ t: 5, v: 1 }, { t: 9, v: 2 }])) === JSON.stringify({ from: 5, to: 9 }));

console.log("\n  a device down longer than its window:");
{
  const seen = 100 * H, hours = 24;
  const deep = [{ t: 50 * H, state: "on" }, { t: 70 * H, state: "off" }, { t: 90 * H, state: "on" },
                { t: 100 * H, state: "off" }, { t: 101 * H, state: "unavailable" }];
  const win = windowEndingAt(deep, seen, hours);
  ck("the window keeps the state it OPENS in (the row before it)", win[0].t === 70 * H, win);
  ck("  ...and nothing after the last sighting", win.every((p) => p.t <= seen), win);
  ck("  ...and everything inside it", win.map((p) => p.t / H).join() === "70,90,100", win.map((p) => p.t / H));
}

console.log("\n  the callers:");
// The rule is only as good as its callers: a chart handed no window falls back
// to the old axis and loses the band again. Every numeric chart in the app
// must pass the series' window through.
import { readFileSync, readdirSync } from "node:fs";
const DIR = new URL("../../src/components/panels/", import.meta.url);
const sites = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".tsx"))) {
  const src = readFileSync(new URL(f, DIR), "utf8");
  for (const m of src.matchAll(/<(Sparkline|DualSparkline)\b[\s\S]*?\/>/g)) sites.push({ f, tag: m[1], ok: /\bwindow=\{/.test(m[0]) });
}
ck(`found the chart call sites (${sites.length})`, sites.length >= 3, sites);
const missing = sites.filter((x) => !x.ok).map((x) => `${x.f}:${x.tag}`);
ck("every one passes the series' window", missing.length === 0, missing);

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ every chart draws the span it was asked for");
process.exit(fail ? 1 : 0);
