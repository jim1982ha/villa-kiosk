// One reading, two looks: the badge and the device's own 3D mesh
// (src/utils/deviceActivity.ts — badgeKindFor and meshLookFor).
//
// ⚠️ REPRODUCED AGAINST 2.496.95. EntityVisuals.applyToMesh read the raw
// state itself: a lock's mesh flashed RED for the second it reports `locking`
// (the badge had stopped raising that alarm), every motion PIR pulsed red on
// `on` like a leak, a `connectivity` sensor that went OFF — its real alert —
// never pulsed, and a buffering player did not glow. The first checks run
// that old rule to show it; then every type and state is swept and the mesh
// must say what the badge says.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { badgeKindFor, meshLookFor } = await import("@/utils/deviceActivity");
const { alertStateFor } = await import("@/config/BinarySensorClasses");

const ent = (state, attrs = {}) => ({ entity_id: "x.y", state, attributes: attrs, last_changed: "", last_updated: "" });
const read = (type, state, attrs = {}) => ({
  type, entity: ent(state, attrs), linkedOn: false,
  alertState: alertStateFor(attrs.device_class),
});

console.log("  the cases the old mesh rule got wrong:");
{
  const oldLockRed = (s) => s !== "locked";
  ck("the OLD lock rule paints `locking` red", oldLockRed("locking"));
  ck("a lock that is locking: secure, like its badge", meshLookFor(read("lock", "locking")).tone === "secure" && badgeKindFor(read("lock", "locking")) === "off");
  ck("  ...unlocked: alert; jammed: alert", meshLookFor(read("lock", "unlocked")).tone === "alert" && meshLookFor(read("lock", "jammed")).tone === "alert");
  ck("  ...unavailable: amber, never an 'unlocked' red", meshLookFor(read("lock", "unavailable")).tone === "unavailable");
  const oldPulse = (s) => s === "on";
  const motion = read("binary_sensor", "on", { device_class: "motion" });
  ck("the OLD sensor rule pulses a motion PIR that sees someone", oldPulse("on"));
  // owner, 2026-10-21: "the entity badge to follow the state of the entity … everywhere"
  ck("a motion PIR on: pulses, as its badge is red", meshLookFor(motion).on === true && badgeKindFor(motion) === "alert");
  const leak = read("binary_sensor", "on", { device_class: "moisture" });
  ck("a leak sensor on: pulses", meshLookFor(leak).on === true && badgeKindFor(leak) === "alert");
  const net = read("binary_sensor", "off", { device_class: "connectivity" });
  ck("a connectivity sensor gone OFF: pulses (the old rule never did)", meshLookFor(net).on === true && !oldPulse("off"));
  ck("an unavailable sensor: flagged, not pulsing", meshLookFor(read("binary_sensor", "unavailable")).unavailable === true && meshLookFor(read("binary_sensor", "unavailable")).on === false);
  ck("a buffering player glows; one merely 'on' (idle) does not — like its badge",
     meshLookFor(read("media_player", "buffering")).on === true && meshLookFor(read("media_player", "on")).on === false);
}

console.log("\n  every type and state: the mesh says what the badge says");
{
  const states = ["on", "off", "locked", "unlocked", "locking", "unlocking", "jammed", "open", "opening", "playing", "buffering", "idle", "paused", "heat", "unavailable", "unknown"];
  const classes = [undefined, "motion", "moisture", "door", "connectivity", "smoke"];
  const disagree = [];
  for (const type of ["lock", "binary_sensor", "switch", "media_player", "fan", "sensor", "climate", "light", "cover"]) {
    for (const st of states) for (const dc of (type === "binary_sensor" ? classes : [undefined])) {
      const r = read(type, st, dc ? { device_class: dc } : {});
      const badge = badgeKindFor(r), look = meshLookFor(r);
      const ok =
        look.kind === "tint" ? (look.tone === "unavailable") === (badge === "unavailable") && (look.tone === "alert") === (badge === "alert")
        : look.kind === "pulse" ? look.on === (badge === "alert") && look.unavailable === (badge === "unavailable")
        : look.kind === "glow" ? look.on === (badge === "on")
        : true;
      if (!ok) disagree.push(`${type}/${st}/${dc ?? "-"}: badge=${badge} mesh=${JSON.stringify(look)}`);
    }
  }
  ck("no (type, state, class) where the mesh and the badge disagree", disagree.length === 0, disagree.slice(0, 5));
  ck("lights and covers are painted elsewhere (BulbSet, poses)", meshLookFor(read("light", "on")).kind === "none" && meshLookFor(read("cover", "open")).kind === "none");
  ck("sensors, fans and climate are dark (a placeholder must not keep the marker glow)",
     ["sensor", "fan", "climate"].every((t) => meshLookFor(read(t, "on")).kind === "dark"));
}

console.log("\n  the caller:");
{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("applyToMesh paints meshLookFor, read through the one DeviceReading (deviceActivity.readingOf)",
     /const look = meshLookFor\(readingOf\(state\.entity_id, this\.lookSource\)\);/.test(ev));
  ck("  ...and reads no raw state of its own", !/state\.state === "locked"|const alert = state\.state === "on"|state\.state === "playing"/.test(ev));
  ck("  ...nor a literal colour", !/new Color3\(0\.2, 0\.75, 0\.3\)|new Color3\(0\.9, 0\.2, 0\.2\)|new Color3\(0\.1, 0\.35, 0\.4\)/.test(ev));
}

// owner, 2026-10-21: "if the associated device is turning ON (the Laundry Door sensor), would the entity badge turn red
// as well? … so that I can remove the dedicated door sensor badge" — a linked entity needing attention gives the badge
// its red "!" (owner, 2026-10-22: badge proposal 2 — it was a red ring); its face stays its own state, and the sensor
// lists itself in Needs attention (the lock is not listed twice)
{
  const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
  const look = (door, { hidden = false, lock = "locked" } = {}) => deviceLook("lock.l", storeLookSource({
    "lock.l": { entity_id: "lock.l", state: lock, attributes: {} },
    "binary_sensor.d": { entity_id: "binary_sensor.d", state: door, attributes: { device_class: "door" } },
  }, { entityMap: { "lock.l": { entityId: "lock.l", type: "lock", linkedEntityId: "binary_sensor.d" } },
       isHidden: (id) => hidden && id === "binary_sensor.d" }));
  const open = look("on"), shut = look("off");
  ck("a lock whose linked door sensor reads Open: its badge takes the red \"!\", its face still says Locked (resting)",
     open.mark === "alarm" && open.kind === "alert" && open.face === "off" && !open.alert, open);
  ck("  ...door closed: no mark", shut.mark === null && shut.kind !== "alert", shut);
  ck("  ...a hidden or lost sensor marks nothing red",
     look("on", { hidden: true }).mark !== "alarm" && look("unavailable").mark !== "alarm");
  ck("  ...an unlocked lock: the red \"!\" over an OPEN (active) face, door open or not",
     look("on", { lock: "unlocked" }).mark === "alarm" && look("on", { lock: "unlocked" }).face === "active"
     && look("on", { lock: "unlocked" }).alert && look("off", { lock: "unlocked" }).mark === "alarm");
}

// architecture review A, 2026-10-22: "what kind of device is this" written out at four places, one skipping the map's
// own mapping (a sensor found in the 3D model: its room stayed dark) — one answer now
{
  const { deviceTypeOf } = await import("@/config/EntityMap");
  const { readFileSync, readdirSync } = await import("node:fs");
  ck("a device's type: as the map drew it, else as saved, else from its id, else a sensor",
     deviceTypeOf("sensor.x", { type: "binary_sensor" }, { type: "light" }) === "binary_sensor"
     && deviceTypeOf("sensor.x", null, { type: "light" }) === "light" && deviceTypeOf("lock.door") === "lock"
     && deviceTypeOf("weird.thing") === "sensor");
  const walk = (d) => readdirSync(new URL(`../../src/${d}/`, import.meta.url), { withFileTypes: true })
    .flatMap((f) => (f.isDirectory() ? walk(`${d}/${f.name}`) : /\.tsx?$/.test(f.name) ? [`${d}/${f.name}`] : []));
  const copies = ["utils", "babylon", "config", "components", "pages"].flatMap(walk)
    .filter((f) => f !== "config/EntityMap.ts")   // its one home
    .filter((f) => /\?\? inferTypeFromEntityId\([^)]*\) \?\? "sensor"/.test(readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8")));
  ck("  ...and nothing writes that rule out again", copies.length === 0, copies);
}
done("✅ one reading, one look");

