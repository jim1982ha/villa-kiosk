// The Energy window's rules (src/config/energyModel.ts) over Home Assistant's
// own Energy setup — replayed with the SHAPE of the villa's real one: a grid
// meter with a return meter, three phase meters at the top level, ten light
// circuits configured INSIDE phase A, and five pumps with no upstream device
// (so they overlap the phases). Generic ids; the kWh are the measured ones
// (Fri 25 Sep and the six days before it).
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const E = await import("@/config/energyModel");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const lights = Array.from({ length: 10 }, (_, i) => `sensor.light_${i}_energy`);
const pumps = ["sensor.pool_pump_energy", "sensor.spa_pump_energy", "sensor.jet_pump_energy", "sensor.well_pump_energy", "sensor.bath_pump_energy"];
const prefs = {
  energy_sources: [{ type: "grid", stat_energy_from: "sensor.grid_in", stat_energy_to: "sensor.grid_out" }],
  device_consumption: [
    ...lights.map((id) => ({ stat_consumption: id, included_in_stat: "sensor.phase_a_energy" })),
    { stat_consumption: "sensor.phase_a_energy", stat_rate: "sensor.phase_a_power" },
    { stat_consumption: "sensor.phase_b_energy", stat_rate: "sensor.phase_b_power" },
    { stat_consumption: "sensor.phase_c_energy", stat_rate: "sensor.phase_c_power" },
    ...pumps.map((id) => ({ stat_consumption: id })),
  ],
};
const setup = E.energySetup(prefs, (id) => id.replace("sensor.", "").replace(/_energy$/, ""));

console.log("  HA's hierarchy, read — not configured:");
ck("grid import and export are the grid source's", setup.gridIn.join() === "sensor.grid_in" && setup.gridOut.join() === "sensor.grid_out");
ck("the lights sit INSIDE phase A (their upstream device)", setup.roots.find((r) => r.id === "sensor.phase_a_energy").children.length === 10);
ck("the pumps, with no upstream device, are top level", pumps.every((p) => setup.roots.some((r) => r.id === p)));
ck("a device's name in HA's settings wins over its entity's", E.energySetup({ energy_sources: [], device_consumption: [{ stat_consumption: "sensor.x", name: "Heat pump" }] }, () => "X").devices[0].name === "Heat pump");
const loop = E.energySetup({ energy_sources: [], device_consumption: [{ stat_consumption: "a", included_in_stat: "b" }, { stat_consumption: "b", included_in_stat: "a" }] }, (x) => x);
ck("an upstream LOOP (a misconfiguration) loses no device: both are shown", loop.roots.length === 2);

console.log("\n  Friday 25 September, split as HA's dashboard does:");
const fri = {
  "sensor.grid_in": 75.46, "sensor.grid_out": 0,
  "sensor.phase_a_energy": 15.01, "sensor.phase_b_energy": 20.77, "sensor.phase_c_energy": 39.68,
  "sensor.pool_pump_energy": 5.38, "sensor.spa_pump_energy": 1.16, "sensor.jet_pump_energy": 1.09, "sensor.well_pump_energy": 0.48, "sensor.bath_pump_energy": 0.14,
  ...Object.fromEntries(lights.map((id, i) => [id, [1.15, 0.92, 0.76, 0.71, 0.67, 0.28, 0.16, 0.09, 0, 0][i]])),
};
const split = E.energySplit(setup, (id) => fri[id]);
ck("used = the grid import (no solar, nothing returned)", Math.abs(split.used - 75.46) < 1e-9);
ck("the phases account for it all: nothing untracked", split.untracked === 0, split.untracked);
ck("the pumps beside the phases are an OVERLAP of their 8.25 kWh — not a negative untracked", Math.abs(split.overlap - 8.25) < 1e-6, split.overlap);
const a = split.roots.find((r) => r.node.id === "sensor.phase_a_energy");
ck("phase A's own untracked is what its lights leave", Math.abs(a.untracked - (15.01 - 4.74)) < 1e-6, a.untracked);
ck("top level largest first", split.roots[0].node.id === "sensor.phase_c_energy");
const rank = E.deviceRanking(split);
ck("every device ranked, nested ones included", rank.length === 18 && rank[0].node.id === "sensor.phase_c_energy");

console.log("\n  the words:");
const week = [26.49, 29.89, 30.99, 30.99, 27.47, 28.76, 75.46];
ck("a typical day is the MEDIAN — Friday's 75 kWh does not move it", E.typicalDay(week) === 29.89, E.typicalDay(week));
const so = E.standoutDay(week, E.typicalDay(week));
ck("Friday stands out at 2.5× a typical day", so?.index === 6 && Math.abs(so.ratio - 75.46 / 29.89) < 1e-9, so);
ck("a week with no such day has none", E.standoutDay(week.slice(0, 6), E.typicalDay(week.slice(0, 6))) === null);
ck("today at 13:00, 11.7 kWh against 29.9: 'A quiet day — 39% of a typical one by 13:00.'",
   E.todayHeadline(11.7, 29.89, 13 / 24, "13:00") === "A quiet day — 39% of a typical one by 13:00.", E.todayHeadline(11.7, 29.89, 13 / 24, "13:00"));
ck("on pace: a usual day; well over: a busy one",
   /^A usual day/.test(E.todayHeadline(15, 30, 0.5, "12:00")) && /^A busy day/.test(E.todayHeadline(25, 30, 0.5, "12:00")));
ck("no history yet: just the figure", E.todayHeadline(4.2, undefined, 0.5, "12:00") === "4.20 kWh so far today.");
const leafs = setup.devices.filter((d) => d.children.length === 0);
const typ = { "sensor.spa_pump_energy": 0, "sensor.jet_pump_energy": 0, "sensor.pool_pump_energy": 5.26 };
const up = E.risers(leafs, (id) => fri[id], (id) => typ[id] ?? 0.0);
ck("what rose on Friday: devices at least 0.5 kWh over their own typical day, biggest first",
   ["sensor.spa_pump_energy", "sensor.jet_pump_energy"].every((id) => up.some((r) => r.node.id === id)) && !up.some((r) => r.node.id === "sensor.pool_pump_energy")
     && up.every((r, i) => i === 0 || up[i - 1].extra >= r.extra), up.map((r) => r.node.id));
ck("money in the cost statistic's currency", /19,887|19\.887/.test(E.fmtMoney(19887.47, "IDR", "en-US")) && E.fmtMoney(12.5, "kr?", "en-US") === "13 kr?");

console.log("\n  the callers:");
const api = readFileSync(new URL("../../src/ha/HAEnergyAPI.ts", import.meta.url), "utf8");
ck("the setup is read from HA on every open — prefs and HA's own cost statistics",
   /await ws\.getEnergyPrefs\(\);/.test(api) && /ws\.getEnergyInfo\(\)/.test(api));
const panel = readFileSync(new URL("../../src/components/panels/EnergyPanel.tsx", import.meta.url), "utf8");
ck("the window reads that setup, and falls back to the device list when HA has none",
   /fetchEnergySetup\(ws, nameOf\)/.test(panel) && /if \(status === "ready" && setup === null\) return <>\{fallback\(\)\}<\/>;/.test(panel));
ck("the flow sits BELOW the last-7-days trend (owner, 2026-09-26)", panel.indexOf("Last 7 days") < panel.indexOf("Where today&apos;s"));
ck("  ...at half its first height: a 150-unit bar, one line a device", /const BAR = 150, SLOT = 22, GAP = 4;/.test(panel));
const css = readFileSync(new URL("../../src/styles/03-panels.css", import.meta.url), "utf8");
ck("the observation cards share the row however many there are (two cards, no empty third column)",
   /\.weather-advice \{ display: grid; grid-auto-flow: column; grid-auto-columns: minmax\(0, 1fr\);/.test(css) && !/\.weather-advice \{[^}]*repeat\(3/.test(css));
const cfg = readFileSync(new URL("../../src/config/AppConfig.ts", import.meta.url), "utf8");
ck("nothing about energy is stored in VESTA's config", !/energy(Sources|Devices|Tariff)/i.test(cfg));
const bar = readFileSync(new URL("../../src/components/hud/SummaryBar.tsx", import.meta.url), "utf8");
ck("the Energy tile opens the Energy window", /openGroup\?\.id === "__energy" && \(\s*<EnergyPanel/.test(bar));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ HA's Energy, laid out — never re-configured");
process.exit(fail ? 1 : 0);
