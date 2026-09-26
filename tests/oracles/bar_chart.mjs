// The app's one bar chart (src/utils/barChart.ts) — the Energy window's four
// charts and the Weather window's rain. Round-6 candidate 1 (2.496.114).
//
// ⚠️ REPRODUCED FIRST: the Energy bars wrote "kWh" after every tooltip value,
// so the COST chart's tooltip read "Cost 45,000 kWh"; the rain bars scaled by
// the line rule, so their top tick could sit below the tallest bar; and a
// bucket with no reading was a bar of 0.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const B = await import("@/utils/barChart");
const { fmtMoney, fmtKwh } = await import("@/config/energyModel");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const seg = (v, key = "used") => ({ key, label: key === "cost" ? "Cost" : "Used", v, cls: "e-used" });

console.log("  the scale — 0 to a round top, every bar under it:");
const week = [26.49, 29.89, 30.99, 30.99, 27.47, 28.76, 75.46].map((v, i) => ({ t: i, segs: [seg(v)] }));
const L = B.barLayout(week, 29.89);
ck("a 75 kWh week scales to 100 with ticks 0 / 50 / 100", L.top === 100 && L.ticks.map((t) => t.v).join() === "0,50,100", L.ticks);
ck("the tallest bar is under the top tick", Math.max(...L.bars.map((b) => b.segs[0].h)) <= 1);
ck("a bar's height is its value over the top", Math.abs(L.bars[6].segs[0].h - 0.7546) < 1e-9);
ck("the typical line sits at its value", Math.abs(L.typicalAt - 0.2989) < 1e-9);
const rain = [0.2, 3.7, 0.5].map((v, i) => ({ t: i, segs: [seg(v)] }));
ck("rain's 3.7 mm hour: the top tick is ABOVE it (the line rule put it below)", B.barLayout(rain).top >= 3.7, B.barLayout(rain).top);

const dry = B.barLayout([{ t: 0, segs: [seg(0)] }, { t: 1, segs: [seg(0)] }]);
ck("nothing above zero scales to ONE unit — a dry day's axis read '0, 0, 0'", dry.top === 1 && dry.ticks.map((t) => t.v).join() === "0,0.5,1", dry.ticks);

console.log("\n  three kinds of bucket:");
const mixed = B.barLayout([{ t: 0, segs: [seg(2)] }, { t: 1, segs: null }, { t: 2, segs: [] }]);
ck("no reading is an outage band, not a bar of 0", mixed.bars[1].missing === true && mixed.bars[1].segs.length === 0);
ck("nothing yet is neither", mixed.bars[2].missing === false && mixed.bars[2].segs.length === 0);

console.log("\n  the slots — the bucket under the pointer is exact:");
ck("the first and last slots own the plot's edges", B.barAt(0, 24) === 0 && B.barAt(0.9999, 24) === 23 && B.barAt(1, 24) === 23 && B.barAt(-0.1, 24) === 0);
ck("a pointer a quarter across 24 slots is hour 6", B.barAt(0.25, 24) === 6);
ck("  ...and just before hour 7's slot it is still hour 6 (a slot, not the nearest centre)", B.barAt(6.96 / 24, 24) === 6);
ck("a bucket's centre is the middle of its slot", B.barCentre(6, 24) === 6.5 / 24);
ck("labels: flush at the ends, centred between",
   B.barTick(0, 7).align === "start" && B.barTick(6, 7).align === "end" && B.barTick(3, 7).align === "middle" && B.barTick(3, 7).at === 3.5 / 7);

console.log("\n  the tooltip, in the CHART's unit:");
const money = (v) => fmtMoney(v, "IDR", "en-US");
const costRows = B.barTipRows({ t: 0, segs: [seg(45000, "cost")] }, money);
ck("the cost chart's row is money — not 'Cost 45,000 kWh'", costRows.length === 1 && /IDR|Rp/.test(costRows[0].text) && !/kWh/.test(costRows[0].text), costRows);
const kwh = (v) => `${fmtKwh(v)} kWh`;
const stack = B.barTipRows({ t: 0, segs: [seg(2, "a"), seg(0, "b"), seg(1, "c")] }, kwh);
ck("a stack: its total first, then each segment that is not zero", stack.map((r) => r.key).join() === "_total,a,c" && stack[0].text === "Total 3.00 kWh", stack);
ck("a dry hour still says 0", B.barTipRows({ t: 0, segs: [seg(0)] }, (v) => `${v} mm`)[0].text === "Used 0 mm");
ck("no reading says so", B.barTipRows({ t: 0, segs: null }, kwh)[0].text === "No reading");
ck("nothing yet says nothing", B.barTipRows({ t: 0, segs: [] }, kwh).length === 0);

console.log("\n  a second measure over the bars (the cost over the energy):");
{
  const LL = B.lineLayout([1700, 2550, undefined, 3400, 12800]);
  ck("its own round top: 12.8k scales to 15k", LL.top === 15000 && LL.ticks.map((t) => t.v).join() === "0,5000,10000,15000", LL);
  ck("a missing value BREAKS the line — never a drop to 0", LL.runs.length === 2 && LL.runs[0].length === 2 && LL.runs[1][0].i === 3, LL.runs);
  ck("  ...each point at its value (y down from the top)", Math.abs(LL.runs[1][1].y - (1 - 12800 / 15000)) < 1e-9);
  const rows = B.barTipRows({ t: 0, segs: [seg(2, "a"), seg(1, "b")] }, (v) => `${v} kWh`, { label: "Cost", cls: "cost", v: 7500, fmt: (v) => `IDR ${v}` });
  ck("ONE tooltip: the total, the cost, then each device", rows.map((r) => r.key).join() === "_total,_line,a,b" && rows[1].text === "Cost IDR 7500", rows);
  ck("  ...no cost in the bucket: no cost row", B.barTipRows({ t: 0, segs: [seg(2)] }, (v) => `${v}`, { label: "Cost", cls: "cost", v: undefined, fmt: String }).every((r) => r.key !== "_line"));
}

console.log("\n  a totals series as buckets (the rain gauge):");
{
  const H = 3_600_000, t0 = Date.UTC(2026, 8, 26, 0);
  // The window opens at 00:30, mid-bucket: the recorder, asked from 00:30,
  // returns the buckets that START from then on — 01:00 first.
  const win = { from: t0 + 30 * 60_000, to: t0 + 7 * H + 5 * 60_000 };          // 00:30 → 07:05
  const pts = [{ t: t0 + H, v: 0 }, { t: t0 + 2 * H, v: 1.2 }, { t: t0 + 4 * H, v: 0 }, { t: t0 + 5 * H, v: 0.4 }];
  const bs = B.seriesBuckets({ points: pts, window: win }, H, { key: "rain", label: "Rain", cls: "water" });
  ck("one bucket an hour, on the recorder's own hour starts, the first STARTING INSIDE the window (01:00, not 00:00)",
     bs.length === 7 && bs[0].t === t0 + H && bs[6].t === t0 + 7 * H, bs.map((b) => b.t));
  ck("  ...so the first bar is a reading, not 'No reading' (the bucket straddling the start is never returned — owner's screenshot)", bs[0].segs?.length === 1, bs[0]);
  ck("a reported dry hour is 0 mm, a reading", bs[0].segs?.[0].v === 0);
  ck("an hour the recorder has nothing for is NO READING, not a dry hour", bs[2].segs === null, bs[2]);
  ck("the hour just ended is still within HA's compile grace: nothing yet", bs[5].segs?.length === 0, bs[5]);
  ck("the running hour: nothing yet", bs[6].segs?.length === 0);
  const D = 86_400_000, d0 = new Date(2026, 9, 24).getTime();          // a daylight-saving week in Europe
  const days = [0, 1, 2, 3].map((i) => new Date(2026, 9, 24 + i).getTime());
  const dbs = B.seriesBuckets({ points: days.map((t) => ({ t, v: 1 })), window: { from: d0, to: days[3] + D + H } }, D, { key: "r", label: "R", cls: "water" });
  ck("a 25-hour day still lands in its own bucket", dbs.filter((b) => b.segs?.length).length === 4, dbs.map((b) => b.segs?.length));
  ck("'No rain readings' when there is none; 'No rain' only over zero readings",
     B.barNote([{ t: 0, segs: null }, { t: 1, segs: [] }], "none", "zero") === "none"
       && B.barNote([{ t: 0, segs: [seg(0)] }, { t: 1, segs: null }], "none", "zero") === "zero"
       && B.barNote([{ t: 0, segs: [seg(0.2)] }], "none", "zero") === undefined);
}

console.log("\n  the callers:");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const energy = read("../../src/components/panels/EnergyPanel.tsx");
ck("the cost is plotted OVER the energy bars, in money, on its own right axis (owner, 2026-09-26: one chart)",
   /line=\{hasCost \? \{ values: p\.buckets\.map\(\(b, i\) => \(b\.state === "pending" \? undefined : costs\[i\]\)\), label: "Cost", cls: "cost", unit: costUnit, fmt: \(v\) => fmtMoney\(v, costUnit\) \} : undefined\}/.test(energy)
     && !/Cost per \{unit\}<\/div>/.test(energy));
ck("an Energy bucket with no reading is a band (null), pending is a stub ([])",
   /return b\.state === "ready" \? ready\(\) : b\.state === "pending" \? \[\] : null;/.test(energy));
const weather = read("../../src/components/panels/WeatherPanel.tsx");
ck("the rain chart builds its buckets from the series", /seriesBuckets\(\{ points: s\.points, window: win \}, slot,/.test(weather));
const comp = read("../../src/components/panels/BarChart.tsx");
ck("BarChart draws what barLayout says, and its tooltip rows are barTipRows'",
   /const L = barLayout\(buckets, typical\);/.test(comp) && /barTipRows\(hb, fmt, line && \{ label: line\.label, cls: line\.cls, v: line\.values\[hover!\], fmt: line\.fmt \}\)/.test(comp)
     && /const hover = frac === null \? null : barAt\(frac, n\);/.test(comp)
     && /\{LL && <YAxis side="right" unit=\{line!\.unit\} height=\{height\} frame=\{1\} ticks=\{LL\.ticks\} \/>\}/.test(comp));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one bar chart, every value in its own unit");
