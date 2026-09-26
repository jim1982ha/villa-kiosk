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
const { badgeKindFor, meshLookFor } = await import("@/utils/deviceActivity");
const { alertStateFor } = await import("@/config/BinarySensorClasses");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const ent = (state, attrs = {}) => ({ entity_id: "x.y", state, attributes: attrs, last_changed: "", last_updated: "" });
const read = (type, state, attrs = {}, override) => ({
  type, entity: ent(state, attrs), linkedOn: false,
  alertState: alertStateFor(attrs.device_class, override),
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
  ck("a motion PIR on: no pulse — informational, like its badge", meshLookFor(motion).on === false && badgeKindFor(motion) !== "alert");
  const leak = read("binary_sensor", "on", { device_class: "moisture" });
  ck("a leak sensor on: pulses", meshLookFor(leak).on === true && badgeKindFor(leak) === "alert");
  const net = read("binary_sensor", "off", { device_class: "connectivity" });
  ck("a connectivity sensor gone OFF: pulses (the old rule never did)", meshLookFor(net).on === true && !oldPulse("off"));
  const quiet = read("binary_sensor", "on", { device_class: "moisture" }, "none");
  ck("the villa's override 'never a fault' silences the pulse", badgeKindFor(quiet) !== "alert" && meshLookFor(quiet).on === false, [badgeKindFor(quiet), meshLookFor(quiet)]);
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
  ck("applyToMesh paints meshLookFor, read through the one DeviceReading",
     /const look = meshLookFor\(this\.reading\(map\.type, state, false\)\);/.test(ev));
  ck("  ...and reads no raw state of its own", !/state\.state === "locked"|const alert = state\.state === "on"|state\.state === "playing"/.test(ev));
  ck("  ...nor a literal colour", !/new Color3\(0\.2, 0\.75, 0\.3\)|new Color3\(0\.9, 0\.2, 0\.2\)|new Color3\(0\.1, 0\.35, 0\.4\)/.test(ev));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one reading, one look");
process.exit(fail ? 1 : 0);
