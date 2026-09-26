// The energy flow and the pie of every device (src/config/energyFlow.ts), as
// Home Assistant's Energy dashboard draws them — replayed with the villa's day
// as HA showed it (owner's screenshots, 2026-09-26; generic ids): 43.94 kWh;
// phase C 26.2 with the pool pump inside; phase A 8.90 with thirteen small
// devices; phase B 8.88 whose two pumps used nothing.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const E = await import("@/config/energyModel");
const F = await import("@/config/energyFlow");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

const small = [0.55, 0.48, 0.43, 0.37, 0.35, 0.23, 0.12, 0.08, 0.05, 0.03, 0.02, 0.01, 0.01];
const aKids = small.map((_, i) => `sensor.a_dev_${i}`);
const prefs = {
  energy_sources: [{ type: "grid", stat_energy_from: "sensor.grid_in" }],
  device_consumption: [
    { stat_consumption: "sensor.phase_c", name: "Phase C" }, { stat_consumption: "sensor.phase_a", name: "Phase A" }, { stat_consumption: "sensor.phase_b", name: "Phase B" },
    { stat_consumption: "sensor.pool", name: "Pool Pump", included_in_stat: "sensor.phase_c" },
    { stat_consumption: "sensor.spa", name: "Spa Pump", included_in_stat: "sensor.phase_b" },
    ...aKids.map((id, i) => ({ stat_consumption: id, name: `Device ${i}`, included_in_stat: "sensor.phase_a" })),
  ],
};
const setup = E.energySetup(prefs, (x) => x);
const kwh = { "sensor.grid_in": 43.94, "sensor.phase_c": 26.16, "sensor.phase_a": 8.90, "sensor.phase_b": 8.88, "sensor.pool": 5.25, "sensor.spa": 0,
  ...Object.fromEntries(aKids.map((id, i) => [id, small[i]])) };
const split = E.energySplit(setup, (id) => kwh[id]);
const colourOf = F.deviceColours(setup);

console.log("  the tree — HA's, from the house:");
const tree = F.flowTree(split, "The House", colourOf);
ck("it starts at the house, with the day's total", tree.label === "The House" && near(tree.kwh, 43.94, 0.01), tree.kwh);
ck("then each top-level device, largest first", tree.children.map((c) => c.label).join() === "Phase C,Phase A,Phase B");
const [c, a, b] = tree.children;
ck("inside phase C: the pool pump, and C's own untracked 20.92 kWh", c.children.map((n) => n.label).join() === "Pool Pump,Untracked" && near(c.children[1].kwh, 20.92, 0.02), c.children.map((n) => [n.label, n.kwh]));
ck("phase B's pumps used nothing: B is all untracked (8.88), no zero-kWh children", b.children.length === 1 && b.children[0].kind === "untracked" && near(b.children[0].kwh, 8.88, 0.01));
const other = a.children.find((n) => n.kind === "other");
ck("phase A's tiny devices (< 1% of the day) fold into one 'Other' — HA does the same — with its members named",
   !!other && other.members.length === 11 && a.children.filter((n) => n.kind === "device").map((n) => n.label).join() === "Device 0,Device 1", a.children.map((n) => n.label));
ck("  ...and nothing is lost: A's children add up to A", near(a.children.reduce((s, n) => s + n.kwh, 0), 8.90, 0.01));
ck("one small device alone keeps its name (nothing to fold it with)",
   F.flowTree(E.energySplit(setup, (id) => (aKids.includes(id) ? (id === aKids[0] ? 0.1 : 0) : kwh[id])), "H", colourOf).children[1].children.some((n) => n.label === "Device 0"));

console.log("\n  the layout:");
const L = F.flowLayout(tree);
const box = (n) => L.boxes.find((x) => x.node === n);
ck("the house is the full bar, in the first column", box(tree).x === 0 && near(box(tree).h, 150));
ck("three columns: house, top-level devices, what is inside them", new Set(L.boxes.map((x) => x.depth)).size === 3);
ck("the last column leaves room for its labels", Math.max(...L.boxes.map((x) => x.x)) + L.nodeW <= L.W - 250 + 1e-9);
const overlaps = [0, 1, 2].flatMap((d) => {
  const col = L.boxes.filter((x) => x.depth === d).sort((p, q) => p.y - q.y);
  return col.slice(1).filter((x, i) => x.y < col[i].y + Math.max(col[i].h, 20)).map((x) => x.node.label);
});
ck("no two labels in a column overlap (each node has at least a line of room)", overlaps.length === 0, overlaps);
const out = L.links.filter((k) => k.from.node === tree);
ck("the house's links leave it in order, top to bottom, filling it", out.every((k, i) => i === 0 || near(k.sy, out[i - 1].sy + out[i - 1].w)) && near(out[out.length - 1].sy + out[out.length - 1].w, 150, 0.1));
ck("every link arrives at its child's top", L.links.every((k) => near(k.dy, k.to.y)));
ck("the drawing is tall enough for every node", L.boxes.every((x) => x.y + Math.max(x.h, 20) <= L.H + 1e-9));

console.log("\n  the pie of every device — HA's 'Individual devices':");
const slices = F.energySlices(split, colourOf);
ck("its slices add up to what was used (the list's rows count a parent AND its children)", near(slices.reduce((s, x) => s + x.kwh, 0), 43.94, 0.02));
ck("largest first: 'Phase C (untracked)' 20.92, as HA shows it", slices[0].label === "Phase C (untracked)" && near(slices[0].kwh, 20.92, 0.02), slices.slice(0, 3));
ck("B and A's own remainders, then the pool pump — HA's order", slices.slice(1, 4).map((x) => x.label).join() === "Phase B (untracked),Phase A (untracked),Pool Pump", slices.slice(1, 4).map((x) => x.label));
ck("no zero slices", slices.every((x) => x.kwh > 0.005));
const turns = F.sliceTurns(slices.map((x) => x.kwh));
ck("the slices go once round, from the top, without gaps", turns[0].from === 0 && near(turns[turns.length - 1].to, 1) && turns.every((t, i) => i === 0 || near(t.from, turns[i - 1].to)));

console.log("\n  one colour a device, everywhere (round 7):");
{
  // 2.496.121: the flow's counter also counted the devices INSIDE a phase,
  // so Phase A took C's pool pump's slot — pink in the flow, blue in the chart.
  const flowA = tree.children.find((n) => n.label === "Phase A").cls;
  ck("a top-level device's colour is HA's order: C, A, B → e-s0, e-s1, e-s2", colourOf("sensor.phase_c") === "e-s0" && colourOf("sensor.phase_a") === "e-s1" && colourOf("sensor.phase_b") === "e-s2");
  ck("the flow gives Phase A the SAME colour the history chart and legend do", flowA === colourOf("sensor.phase_a"), flowA);
  ck("a device inside one takes the wider palette in HA's order", colourOf("sensor.pool") === "e-p0" && colourOf(aKids[0]) === "e-p2");
  const sl = F.energySlices(split, colourOf);
  ck("the pie: a device's slice is its colour; a parent's remainder the parent's; the rest untracked",
     sl.find((x) => x.label === "Pool Pump").cls === "e-p0" && sl.find((x) => x.label === "Phase C (untracked)").cls === "e-s0");
  const other = E.energySplit(setup, (id) => (id === "sensor.phase_a" ? 40 : kwh[id]));
  ck("the colour does not follow the kWh: Phase A leading the day keeps e-s1", F.flowTree(other, "H", colourOf).children[0].label === "Phase A" && F.flowTree(other, "H", colourOf).children[0].cls === "e-s1");
}

console.log("\n  the pie's legend, ten a page (owner, 2026-09-26):");
{
  const p0 = F.legendPage(20, 0), p1 = F.legendPage(20, 1);
  ck("twenty devices: 1–10, then 11–20", p0.from === 0 && p0.to === 10 && p1.from === 10 && p1.to === 20 && p0.pages === 2, [p0, p1]);
  ck("seventeen: the second page holds 11–17", F.legendPage(17, 1).to === 17);
  ck("a page past the end (a shorter period picked) is the last page, never an empty legend", F.legendPage(17, 5).page === 1 && F.legendPage(17, 5).from === 10);
  ck("ten or fewer: one page, no pager", F.legendPage(10, 0).pages === 1 && F.legendPage(0, 0).pages === 1);
}

console.log("\n  the callers:");
const panel = readFileSync(new URL("../../src/components/panels/EnergyPanel.tsx", import.meta.url), "utf8");
ck("the flow starts at the house the kiosk's title names (never a name in the code)", /const house = resolveSiteTitle\(config, haConfig\?\.location_name\);/.test(panel) && /<Flow split=\{split\} rateKw=\{rateKw\} house=\{house\} colourOf=\{colourOf\} \/>/.test(panel));
ck("the window decides colour in ONE place: no e-s/e-p slot is computed in the panel",
   !/`e-[sp]\$\{/.test(panel) && /const colourOf = useMemo\(\(\) => \(setup \? deviceColours\(setup\)/.test(panel));
ck("the legend shows one page, the pie every slice", /slices\.slice\(pg\.from, pg\.to\)\.map/.test(panel) && /const pg = legendPage\(slices\.length, page\);/.test(panel) && /\{slices\.map\(\(s, i\) => \(\s*<path/.test(panel));
ck("'Every device' switches between the list and the pie", /shape === "pie"\s*\? <DevicePie split=\{whole\} colourOf=\{colourOf\} \/>/.test(panel) && /useSegmentedChoice\(SHAPES, "list"/.test(panel));
ck("the period picker is in the header, the Weather window's control", /headerActions=\{view === "now" \? <span className="weather-live">Home Assistant Energy<\/span> : picker\}/.test(panel)
   && /useSegmentedChoice\(RANGE_OPTIONS, "week", "Period", "weather-ranges"\)/.test(panel) && !/energy-history-head/.test(panel));
const hr = readFileSync(new URL("../../src/components/panels/historyRange.tsx", import.meta.url), "utf8");
ck("  ...and the Weather/device range picker is the same control", /const \{ key, picker \} = useSegmentedChoice\(RANGES\.filter/.test(hr));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ HA's flow and pie, laid out");
