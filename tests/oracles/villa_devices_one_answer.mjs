// "What devices does this villa have" is ONE value, and the device registry
// reaches it.
//
// It was a five-positional-argument tuple restated at twelve call sites, with
// three functions re-ordering the same nouns three different ways, and two
// arguments defaulting to empty so a forgotten one silently resurrected
// dismissed devices. Worse, the module's own internal call DROPPED Home
// Assistant's device registry — the signal its docstring calls "authoritative,
// needs no name matching" — so a combo sensor was ONE device in Advanced
// Settings and TWO in the offline count.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register("../consistency/alias-hook.mjs", import.meta.url);
const { villaDevices } = await import("@/config/deviceGroups");

const live = (id) => ({ entity_id: id, state: "12", attributes: {} });
const dead = (id) => ({ entity_id: id, state: "unavailable", attributes: {} });
const map = (...ids) => Object.fromEntries(ids.map((id) => [id, { entityId: id, type: "sensor", label: id }]));

const base = {
  deviceGroups: [], dismissedEntityIds: [],
  mappedEntityIds: new Set(), entityDeviceIds: {},
};

/* ── 1. the registry folds what the suffix pair cannot ────────────────── */
// A combo sensor HA links by device_id, whose entities match NEITHER half of
// the hardcoded _temperature/_humidity pair.
const comboIds = ["sensor.probe_co2", "sensor.probe_pressure"];
const comboEntities = Object.fromEntries(comboIds.map((id) => [id, live(id)]));
const withRegistry = villaDevices({
  ...base, entityMap: map(...comboIds), entities: comboEntities,
  entityDeviceIds: { "sensor.probe_co2": "dev1", "sensor.probe_pressure": "dev1" },
});
const withoutRegistry = villaDevices({
  ...base, entityMap: map(...comboIds), entities: comboEntities,
});
console.log(`  combo sensor, registry known   -> ${withRegistry.ids.length} device(s): ${withRegistry.ids}`);
console.log(`  combo sensor, registry missing -> ${withoutRegistry.ids.length} device(s)`);

/* ── 2. and the suffix fallback still works where it has to ───────────── */
const pairIds = ["sensor.hall_temperature", "sensor.hall_humidity"];
const pair = villaDevices({
  ...base, entityMap: map(...pairIds),
  entities: Object.fromEntries(pairIds.map((id) => [id, live(id)])),
});

/* ── 3. the reality filters still hold ────────────────────────────────── */
// ⚠️ `sensor.removed` CARRIES GEOMETRY, and that is the whole point. A
// dismissed id with no entity AND no mesh is already dropped as config debris,
// so a fixture like that tests the debris rule and leaves the dismissal rule
// unmeasured — which is exactly what an earlier version of this file did. The
// dismissal exists for the id the MODEL keeps supplying: "I press Remove and
// they come straight back."
const mixed = {
  ...base,
  entityMap: {
    ...map("sensor.real", "sensor.debris", "sensor.removed"),
    "sensor.hidden": { entityId: "sensor.hidden", type: "sensor", label: "h", disabled: true },
  },
  entities: { "sensor.real": live("sensor.real") },
  mappedEntityIds: new Set(["sensor.removed"]),
  dismissedEntityIds: ["sensor.removed"],
};
const filtered = villaDevices(mixed);

/* ── 4. offline is a SUBSET of the same list, never its own rule ──────── */
// ⚠️ THE OFFLINE ONE IS ALSO DISABLED. If every entityMap key were a villa
// device, "offline devices" and "offline entities" would agree by accident and
// nothing here would notice a second rule creeping back in. A hidden device
// that is ALSO unavailable is the case that separates them.
const offlineCase = villaDevices({
  ...base,
  entityMap: {
    ...map("sensor.up", "sensor.down"),
    "sensor.hidden_and_down": {
      entityId: "sensor.hidden_and_down", type: "sensor", label: "h", disabled: true,
    },
  },
  entities: {
    "sensor.up": live("sensor.up"),
    "sensor.down": dead("sensor.down"),
    "sensor.hidden_and_down": dead("sensor.hidden_and_down"),
  },
});

console.log(`  reality filter kept: ${filtered.ids}`);
console.log(`  offline subset     : ${offlineCase.unavailable} of ${offlineCase.ids}`);

/* ── 5. no caller reassembles the tuple ───────────────────────────────── */
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const FILES = walk(SRC);
const legacy = FILES.filter((f) =>
  /\b(selectableDeviceIds|unavailableDeviceIds)\s*\(/.test(readFileSync(f, "utf8"))
  && !f.endsWith("deviceGroups.ts")).map((f) => f.slice(SRC.length + 1));
// One call per screen: a surface asking twice has two dependency arrays to
// keep in step, which is how FacilityModal ended up asking five times.
const callCounts = FILES
  .map((f) => [f.slice(SRC.length + 1), (readFileSync(f, "utf8").match(/villaDevices\(\{/g) ?? []).length])
  .filter(([, n]) => n > 0);
const asksTwice = callCounts.filter(([, n]) => n > 1).map(([f]) => f);

console.log(`\n  scanned ${FILES.length} source files`);
console.log(`  villaDevices call sites: ${callCounts.map(([f, n]) => `${f}×${n}`).join(", ")}`);
if (legacy.length) console.log(`      still calls the old tuple: ${legacy.join(", ")}`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("the scan reached the source tree", FILES.length > 100);
ck("the device registry folds a combo sensor to one device", withRegistry.ids.length === 1);
ck("  ...and it genuinely could not before", withoutRegistry.ids.length === 2);
ck("the suffix fallback still folds a temp/humidity pair", pair.ids.length === 1);
ck("  ...choosing temperature as the one that stays", pair.ids[0] === "sensor.hall_temperature");
ck("config debris is not a device", !filtered.has("sensor.debris"));
ck("a disabled device is not a device", !filtered.has("sensor.hidden"));
ck("a dismissed device is not a device", !filtered.has("sensor.removed"));
ck("a real one survives all three", filtered.ids.join() === "sensor.real");
ck("offline is drawn from the same list, not from the raw entity map",
   offlineCase.unavailable.join() === "sensor.down" && offlineCase.ids.length === 2);
ck("the old positional tuple has no callers left", legacy.length === 0);
ck("no screen asks the question twice", asksTwice.length === 0);
process.exit(fail ? 1 : 0);
