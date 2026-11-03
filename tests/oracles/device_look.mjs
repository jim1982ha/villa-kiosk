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
const { conditionOf, windowStatusOf } = await import("@/config/deviceCondition");

// its condition as the app reads it (readingOf → deviceCondition.conditionOf): an id of the type's own domain
const ent = (type, state, attrs = {}) => ({ entity_id: `${type}.y`, state, attributes: attrs, last_changed: "", last_updated: "" });
const read = (type, state, attrs = {}) => ({
  type, entity: ent(type, state, attrs), linkedOn: false,
  condition: conditionOf(type, ent(type, state, attrs)),
});

console.log("  the cases the old mesh rule got wrong:");
{
  const oldLockRed = (s) => s !== "locked";
  ck("the OLD lock rule paints `locking` red", oldLockRed("locking"));
  ck("a lock that is locking: on its way (teal), as its window and history bar, never red", meshLookFor(read("lock", "locking")).tone === "transitional");
  // owner, 2026-11-04: "always consistent with the device status": its window's colour, never a calmer one (an unlocked
  // lock was the teal "in use" glow beside a red Unlocked in its window, 2026-10-26 to 2.496.686)
  ck("  ...locked: green; unlocked: red, as its window; jammed: red", meshLookFor(read("lock", "locked")).tone === "active"
     && meshLookFor(read("lock", "unlocked")).tone === "alert" && meshLookFor(read("lock", "jammed")).tone === "alert");
  ck("  ...unavailable: grey, never an 'unlocked' red", meshLookFor(read("lock", "unavailable")).tone === "unavailable");
  const oldPulse = (s) => s === "on";
  const motion = read("binary_sensor", "on", { device_class: "motion" });
  ck("the OLD sensor rule pulses a motion PIR that sees someone", oldPulse("on"));
  // owner, 2026-11-04: its window says a red "Motion detected": its object pulses red with it
  ck("a motion PIR on: pulses, as its window is red", meshLookFor(motion).on === true);
  ck("  ...a door sensor open too; closed, no pulse", meshLookFor(read("binary_sensor", "on", { device_class: "door" })).on === true
     && meshLookFor(read("binary_sensor", "off", { device_class: "door" })).on === false);
  const leak = read("binary_sensor", "on", { device_class: "moisture" });
  ck("a leak sensor on: pulses", meshLookFor(leak).on === true && badgeKindFor(leak) === "alert");
  const net = read("binary_sensor", "off", { device_class: "connectivity" });
  ck("a connectivity sensor gone OFF: pulses (the old rule never did)", meshLookFor(net).on === true && !oldPulse("off"));
  ck("an unavailable sensor: flagged, not pulsing", meshLookFor(read("binary_sensor", "unavailable")).unavailable === true && meshLookFor(read("binary_sensor", "unavailable")).on === false);
  ck("a buffering player glows; one merely 'on' (idle) does not — like its badge",
     meshLookFor(read("media_player", "buffering")).on === true && meshLookFor(read("media_player", "on")).on === false);
}

console.log("\n  every type and state: the mesh says what its window says");
{
  const states = ["on", "off", "locked", "unlocked", "locking", "unlocking", "jammed", "open", "opening", "playing", "buffering", "idle", "paused", "heat", "unavailable", "unknown"];
  const classes = [undefined, "motion", "moisture", "door", "connectivity", "smoke"];
  const disagree = [];
  for (const type of ["lock", "binary_sensor", "switch", "media_player", "fan", "sensor", "climate", "light", "cover"]) {
    for (const st of states) for (const dc of (type === "binary_sensor" ? classes : [undefined])) {
      const r = read(type, st, dc ? { device_class: dc } : {});
      const badge = badgeKindFor(r), look = meshLookFor(r), win = windowStatusOf(r.entity);
      const ok =
        look.kind === "tint" ? look.tone === (badge === "unavailable" ? "unavailable" : win)
        : look.kind === "pulse" ? look.on === (badge !== "unavailable" && win === "alert") && look.unavailable === (badge === "unavailable")
        : look.kind === "glow" ? look.on === (badge === "on") && look.tone === win
        : true;
      if (!ok) disagree.push(`${type}/${st}/${dc ?? "-"}: badge=${badge} mesh=${JSON.stringify(look)}`);
    }
  }
  ck("no (type, state, class) where the mesh and its window disagree", disagree.length === 0, disagree.slice(0, 5));
  ck("lights and covers are painted elsewhere (BulbSet, poses)", meshLookFor(read("light", "on")).kind === "none" && meshLookFor(read("cover", "open")).kind === "none");
  // owner, 2026-11-04: a running climate device was outlined red beside its window's green "Cool"
  ck("a running climate device is outlined in its window's colour; off, not at all",
     meshLookFor(read("climate", "cool")).outline === "active" && meshLookFor(read("climate", "off")).outline === undefined);
  ck("sensors, fans and climate are dark (a placeholder must not keep the marker glow)",
     ["sensor", "fan", "climate"].every((t) => meshLookFor(read(t, "on")).kind === "dark"));
}

console.log("\n  the caller:");
{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  ck("applyToMesh paints meshLookFor, read through the one DeviceReading (deviceActivity.readingOf)",
     /const look = meshLookFor\(readingOf\(state\.entity_id, this\.lookSource\)\);/.test(ev));
  ck("  ...in the status vocabulary's colour of its tone (colors.STATUS_COLOR3), the window's", /const c = STATUS_COLOR3\[look\.tone\];/.test(ev)
     && /look\.on \? STATUS_COLOR3\[look\.tone\]/.test(ev) && !/SECURE_GREEN|ACTIVE_GLOW/.test(ev));
  ck("  ...and reads no raw state of its own", !/state\.state === "locked"|const alert = state\.state === "on"|state\.state === "playing"/.test(ev));
  ck("  ...nor a literal colour", !/new Color3\(0\.2, 0\.75, 0\.3\)|new Color3\(0\.9, 0\.2, 0\.2\)|new Color3\(0\.1, 0\.35, 0\.4\)/.test(ev));
}

// owner, 2026-10-21: "if the associated device is turning ON (the Laundry Door sensor), would the entity badge turn red
// as well? … so that I can remove the dedicated door sensor badge" — a linked entity needing attention shows on the
// badge: a red ring, then (2026-10-22, badge proposal 2) the top-right red "!", and since "one corner per device"
// (owner, 2026-10-22) the BOTTOM-RIGHT pill — the top-right is the lock's own. Its face and kind stay its own; the
// sensor lists itself in Needs attention (the lock is not listed twice)
{
  const { deviceLook, storeLookSource } = await import("@/utils/deviceActivity");
  const look = (door, { hidden = false, lock = "locked" } = {}) => deviceLook("lock.l", storeLookSource({
    "lock.l": { entity_id: "lock.l", state: lock, attributes: {} },
    "binary_sensor.d": { entity_id: "binary_sensor.d", state: door, attributes: { device_class: "door" } },
  }, { entityMap: { "lock.l": { entityId: "lock.l", type: "lock", linkedEntityId: "binary_sensor.d" } },
       isHidden: (id) => hidden && id === "binary_sensor.d" }));
  const open = look("on"), shut = look("off");
  ck("a lock whose linked door sensor reads Open: the filled dot bottom-right (in use), NOT top-right; its face Locked, its kind its own",
     open.linkPill === "on" && open.mark === null && open.kind === "off" && open.face === "off" && !open.alert, open);
  ck("  ...door closed: no mark either side, the bottom pill hollow", shut.mark === null && shut.linkPill === "off" && shut.kind !== "alert", shut);
  ck("  ...a hidden sensor raises no alarm (just on, filled); a lost one its grey \"?\" bottom-right; neither touches the top",
     look("on", { hidden: true }).linkPill === "on" && look("unavailable").linkPill === "lost"
     && look("on", { hidden: true }).mark === null && look("unavailable").mark === null);
  ck("  ...an unlocked lock: the plain dot over an OPEN (active) face, no alarm, door open or not",
     look("on", { lock: "unlocked" }).mark === "active" && look("on", { lock: "unlocked" }).face === "active"
     && !look("on", { lock: "unlocked" }).alert && look("off", { lock: "unlocked" }).mark === "active"
     && look("off", { lock: "jammed" }).mark === "alarm");
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

