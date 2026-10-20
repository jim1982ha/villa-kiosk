// The settings every device shares (config/deviceConfig.ts), driven by value.
//
// Before 2.496.224 the five shared keys were spelled out by hand in seven
// places (the parser, the diff type, the diff, "is it empty", apply, the empty
// baseline, the key list); missing one in the parser silently dropped that
// setting on every pull, and none of it was tested. Each key is one row now.
// These checks loop over EVERY key, so a key added later is covered unasked.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const dc = await import("@/config/deviceConfig");
const { SHARED_CONFIG_KEYS: KEYS } = dc;

// One sample value per key, and a way to add/change one item in it.
const sample = {
  entityMap: { "light.a": { type: "light", label: "A" }, "light.b": { type: "light", label: "B" } },
  meshBindings: { m1: "light.a", m2: "light.b" },
  deviceGroups: [{ id: "g1", primaryEntityId: "light.a", memberEntityIds: [] }, { id: "g2", primaryEntityId: "light.b", memberEntityIds: [] }],
  teleportPoints: [{ name: "Kitchen", position: [0, 0, 0] }, { name: "Patio", position: [1, 0, 1] }],
  dismissedEntityIds: ["sensor.x", "sensor.y"],
  unavailableByDesign: ["binary_sensor.x", "binary_sensor.y"],
  fmContract: { monthlyCap: 1000, warnAtPercent: 0 },
  latitude: -8.5,
  longitude: 115.2,
  northOffsetDeg: 117,
  presenceSensor: "binary_sensor.example_empty",
  recordsKeptDays: 180,
};
const edit = {
  entityMap: (v, n) => ({ ...v, [`light.n${n}`]: { type: "light", label: `N${n}` } }),
  meshBindings: (v, n) => ({ ...v, [`mn${n}`]: "light.a" }),
  deviceGroups: (v, n) => [...v, { id: `gn${n}`, primaryEntityId: "light.a", memberEntityIds: [] }],
  teleportPoints: (v, n) => [...v, { name: `Room ${n}`, position: [n, 0, 0] }],
  dismissedEntityIds: (v, n) => [...v, `sensor.n${n}`],
  unavailableByDesign: (v, n) => [...v, `binary_sensor.n${n}`],
  fmContract: (v, n) => ({ ...v, monthlyCap: 1000 + n }),
  latitude: (v, n) => v + n,
  longitude: (v, n) => v + n,
  northOffsetDeg: (v, n) => v + n,
  presenceSensor: (v, n) => `${v}_${n}`,
  recordsKeptDays: (v, n) => v + n,
};
// Keys holding ONE value rather than a collection: a change replaces it whole,
// so two devices' edits cannot both survive — the later one wins.
const SINGLE = new Set(["fmContract", "latitude", "longitude", "northOffsetDeg", "presenceSensor", "recordsKeptDays"]);
const base = Object.fromEntries(KEYS.map((k) => [k, sample[k]]));
const J = JSON.stringify;

console.log("  every key has a sample (a new key must be added here too):");
ck("the samples cover exactly the shared keys", J(Object.keys(sample).sort()) === J([...KEYS].sort()), KEYS.join());

console.log("\n  reading what the server holds:");
{
  const parsed = dc.parseSharedConfig({ ...base, fromANewerVersion: 1 });
  ck("every shared key is read back as stored", KEYS.every((k) => J(parsed[k]) === J(base[k])));
  ck("a key this version does not know is dropped", !("fromANewerVersion" in parsed));
  const wrong = dc.parseSharedConfig({ entityMap: [], meshBindings: "x", deviceGroups: {}, teleportPoints: 3, dismissedEntityIds: "a", unavailableByDesign: 4, fmContract: 5, latitude: "x", longitude: null, northOffsetDeg: NaN, presenceSensor: 3, recordsKeptDays: 1.5 });
  ck("a wrong-shaped value is left out, so the device keeps its own", Object.keys(wrong).length === 0, J(wrong));
  ck("a dismissed list keeps only its ids", J(dc.parseSharedConfig({ dismissedEntityIds: ["a", 3, null, "b"] }).dismissedEntityIds) === J(["a", "b"]));
  ck("nothing usable reads as nothing", J(dc.parseSharedConfig(null)) === "{}" && J(dc.parseSharedConfig([1])) === "{}");
}

console.log("\n  the per-item diff, key by key:");
ck("no change: an empty diff", dc.isSharedConfigDiffEmpty(dc.diffSharedConfig(base, base)));
for (const k of KEYS) {
  const next = { ...base, [k]: edit[k](base[k], 1) };
  const diff = dc.diffSharedConfig(base, next);
  ck(`${k}: one added item is seen, and counted under its key`,
     !dc.isSharedConfigDiffEmpty(diff) && J(dc.describeSharedConfigDiff(diff)) === J({ [k]: 1 }), J(dc.describeSharedConfigDiff(diff)));
  ck(`${k}: replaying the diff onto the base gives the edit`,
     J(dc.applySharedConfigDiff(base, diff)[k]) === J(next[k]));
  if (SINGLE.has(k)) {
    const a = dc.diffSharedConfig(base, { ...base, [k]: edit[k](base[k], 1) });
    const b = dc.diffSharedConfig(base, { ...base, [k]: edit[k](base[k], 2) });
    ck(`${k}: one value — the later of two edits wins, whole`,
       J(dc.applySharedConfigDiff(dc.applySharedConfigDiff(base, a), b)[k]) === J(edit[k](base[k], 2)));
    continue;
  }
  // Two devices adding DIFFERENT items at once: both survive, in either order.
  const a = dc.diffSharedConfig(base, { ...base, [k]: edit[k](base[k], 1) });
  const b = dc.diffSharedConfig(base, { ...base, [k]: edit[k](base[k], 2) });
  const ab = dc.applySharedConfigDiff(dc.applySharedConfigDiff(base, a), b)[k];
  const ba = dc.applySharedConfigDiff(dc.applySharedConfigDiff(base, b), a)[k];
  // The one item edit n added, and whether a value holds it.
  const has = (v, n) => {
    const e = edit[k](base[k], n);
    if (Array.isArray(e)) return v.some((x) => J(x) === J(e[e.length - 1]));
    const id = Object.keys(e).find((i) => !(i in base[k]));
    return J(v[id]) === J(e[id]);
  };
  ck(`${k}: two devices' different edits both survive, in either order`, has(ab, 1) && has(ab, 2) && has(ba, 1) && has(ba, 2));
}
{
  const removed = { ...base, dismissedEntityIds: ["sensor.y"] };
  const diff = dc.diffSharedConfig(base, removed);
  const other = { ...base, dismissedEntityIds: [...base.dismissedEntityIds, "sensor.z"] };
  ck("removing one item replays as removing THAT item only",
     J(dc.applySharedConfigDiff(other, diff).dismissedEntityIds.sort()) === J(["sensor.y", "sensor.z"]));
}

console.log("\n  the baseline when the server holds nothing:");
{
  const empty = dc.baselineFromServer({});
  ck("every key is present, empty", KEYS.every((k) => k in empty && (SINGLE.has(k) ? !empty[k].monthlyCap : J(empty[k]).length === 2)), J(empty));
  ck("built in the same key order as the push (the gate compares JSON strings)",
     J(Object.keys(empty)) === J(KEYS));
  ck("a key the server holds is taken as held", J(dc.baselineFromServer({ meshBindings: { m: "x" } }).meshBindings) === J({ m: "x" }));
}

console.log("\n  where the villa is and which way north lies — shared, never a device's own:");
{
  // owner, 2026-10-17: the main app's browser drew the sun on the wrong side of
  // the house — the north offset lived in each browser, and that one had never
  // been told. The villa's three numbers are shared keys now.
  const NUMBERS = ["latitude", "longitude", "northOffsetDeg"];
  ck("the villa's location and north are shared keys", NUMBERS.every((k) => KEYS.includes(k)), KEYS.join());
  const nothing = dc.baselineFromServer({});
  ck("their empty is 0, the app's own \"not set\" — never a villa's number", NUMBERS.every((k) => nothing[k] === 0), J(nothing));
  const onDefault = { ...nothing };
  ck("a device still on the default proposes nothing", dc.isSharedConfigDiffEmpty(dc.diffSharedConfig(nothing, onDefault)));
  const tuned = { ...nothing, northOffsetDeg: 117 };
  ck("a device holding a north the villa has never stored proposes it, as an edit would",
     J(dc.describeSharedConfigDiff(dc.diffSharedConfig(nothing, tuned))) === J({ northOffsetDeg: 1 })
     && dc.applySharedConfigDiff(nothing, dc.diffSharedConfig(nothing, tuned)).northOffsetDeg === 117);
}

// the villa's location from Home Assistant's own only while none is set (architecture review scan 3, 2026-10-19: it
// was taken on every load, over a value typed in Settings)
{
  const ha = { latitude: -8.6, longitude: 115.1 }, set = { latitude: -8.7, longitude: 115.2 }, none = { latitude: 0, longitude: 0 };
  ck("Home Assistant's location is taken only while the villa has none, and never before this device synced",
     JSON.stringify(dc.locationToAdopt(none, none, ha)) === JSON.stringify(ha)
     && dc.locationToAdopt(set, set, ha) === null && dc.locationToAdopt(none, set, ha) === null
     && dc.locationToAdopt(set, none, ha) === null && dc.locationToAdopt(none, null, ha) === null
     && dc.locationToAdopt(none, none, { latitude: "x" }) === null);
  const dash = (await import("node:fs")).readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  ck("  ...and the Dashboard asks it", /const loc = locationToAdopt\(config, loadSyncBaseline\(\), haConfig\);\s*if \(loc\) update\(loc\);/.test(dash)
     && !/update\(\{ latitude: haConfig\.latitude/.test(dash));
}
// how long the Facility record is kept: the villa's, set in Advanced Settings (owner, 2026-10-20: it was an add-on
// option). The server applies it, so the app's default and ceiling are the server's.
{
  const { RECORDS_KEPT_DAYS_DEFAULT: DEF, RECORDS_KEPT_DAYS_MAX: MAX } = await import("@/config/AppConfig");
  const proxySrc = (await import("node:fs")).readFileSync(new URL("../../rootfs/usr/bin/supervisor-proxy.py", import.meta.url), "utf8");
  const row = proxySrc.match(/^RECORDS_KEPT_DAYS = Option\("int", (\d+), 0, (\d+)\)$/m);
  ck("the app's default and ceiling are the server's", !!row && Number(row[1]) === DEF && Number(row[2]) === MAX, row && row.slice(1).join());
  const nothing = dc.baselineFromServer({});
  ck("nothing stored: the default, one year", nothing.recordsKeptDays === DEF && DEF === 365, nothing.recordsKeptDays);
  ck("a device still on the default proposes nothing",
     dc.isSharedConfigDiffEmpty(dc.diffSharedConfig(nothing, { ...nothing, recordsKeptDays: DEF })));
  ck("the owner's \"keep for ever\" (0) is proposed, as an edit",
     J(dc.describeSharedConfigDiff(dc.diffSharedConfig(nothing, { ...nothing, recordsKeptDays: 0 }))) === J({ recordsKeptDays: 1 }));
  const read = (v) => dc.parseSharedConfig({ recordsKeptDays: v }).recordsKeptDays;
  ck("whole days from 0 to the ceiling are read; anything else keeps the device's own",
     read(0) === 0 && read(MAX) === MAX && [-1, MAX + 1, 1.5, "30", null].every((v) => read(v) === undefined));
}
done("✅ every shared key is read, diffed, replayed and baselined from its one row");
