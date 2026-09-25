// The summary tiles and the readiness report read ONE set of facts.
//
// ⚠️ FOUND 2026-09-25: a lock that was unavailable read "1 Unknown" on the
// summary tile and "1 not locked" in the owner's readiness report — the tile's
// own comment calls the second "a plain lie about a door". The tile rules lived
// in SummaryBar.tsx, where nothing could import them. villaSummary is now the
// one source; this puts one villa through it AND through the real readiness
// report, and checks they say the same thing.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { villaSummary, lockFacts } = await import("@/config/villaSummary");
const { buildReadiness } = await import("@/fm/readiness");
const { EMPTY_FM_DATA } = await import("@/fm/fmTypes");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const E = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
const entities = Object.fromEntries([
  E("lock.front", "locked"), E("lock.back", "unlocked"), E("lock.gate", "unavailable"),
  E("lock.neighbour", "unlocked"),                          // not one of this villa's doors
  E("light.hall", "on"), E("light.bed", "off"), E("light.helper", "on"),
  E("climate.living", "cool", { current_temperature: 24 }), E("climate.bed", "unavailable"),
  E("climate.dismissed", "heat", { current_temperature: 30 }),
  E("switch.pool_pump", "on"),
  E("sensor.pump_power", "850", { unit_of_measurement: "W", device_class: "power" }),  // a FOLDED member
].map((e) => [e.entity_id, e]));
// The villa's own devices: folded, so the pump's power sensor is NOT one.
const villa = new Set(["lock.front", "lock.back", "lock.gate", "light.hall", "light.bed",
  "climate.living", "climate.bed", "switch.pool_pump"]);
const devices = { ids: [...villa], unavailable: ["lock.gate", "climate.bed"], has: (id) => villa.has(id) };

const facts = villaSummary({ entities, devices, resolvedRooms: {}, thresholds: {} });
const report = buildReadiness(entities, EMPTY_FM_DATA, devices);
const check = (id) => report.checks.find((c) => c.id === id);

console.log("  locks:");
ck("an unavailable lock is UNKNOWN, not unlocked", JSON.stringify(facts.locks.unknown) === '["lock.gate"]', facts.locks);
ck("  ...and the report no longer calls it 'not locked'", !/not locked/.test(check("locks").detail), check("locks").detail);
ck("  ...it names both: one unlocked, one not reporting", check("locks").detail === "1 unlocked, 1 not reporting.", check("locks").detail);
ck("  ...and still warns — a door nobody can confirm is not secured", check("locks").state === "warn");
ck("the report and the tile flag the same doors",
   JSON.stringify([...facts.locks.unlocked, ...facts.locks.unknown].sort()) === JSON.stringify([...check("locks").entityIds].sort()));
ck("a lock that is not this villa's is not counted", !facts.locks.ids.includes("lock.neighbour"));

console.log("\n  the rest:");
ck("lights: the tile and the report count the same lit lights",
   JSON.stringify(facts.lights.on) === JSON.stringify(check("lights").entityIds), [facts.lights.on, check("lights").entityIds]);
ck("AC: scoped to the villa, as the report always was", !facts.climate.ids.includes("climate.dismissed"), facts.climate.ids);
ck("  ...its temperature is the running units' CURRENT reading", facts.climate.avgCurrentTemp === 24, facts.climate);
ck("  ...and the report's unreachable units are the tile's", JSON.stringify(facts.climate.unreachable) === JSON.stringify(check("climate").entityIds));
ck("power counts a FOLDED member (not a villa device) — the pump's draw stays in the total",
   facts.power?.totalW === 850, facts.power);
ck("an all-locked villa reads secured", lockFacts({ a: E("lock.a", "locked") }).unknown.length === 0);

console.log("\n  the caller:");
const bar = readFileSync(new URL("../../src/components/hud/SummaryBar.tsx", import.meta.url), "utf8");
ck("the summary bar reads its facts from villaSummary", /villaSummary\(\{/.test(bar));
ck("  ...and keeps no copy of the rules", !/byDomain\("(climate|sensor|switch)"\)/.test(bar) && !/POOL_WORD\s*=/.test(bar));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one answer per door, on every screen");
process.exit(fail ? 1 : 0);
