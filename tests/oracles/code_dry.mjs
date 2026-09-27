// One rule each (2.496.200): lerp / wrapAngle / clamp in utils/geometry, the
// stair-name list in meshRoles, the stale "sensor" type upgraded once at load.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync, readdirSync } from "node:fs";
const { lerp, wrapAngle, clamp } = await import("@/utils/geometry");
const { STAIR_NAME_RE } = await import("@/babylon/meshRoles");
const { isStairwell } = await import("@/babylon/storeys");
const { upgradeStaleTypes, normaliseConfig, DEFAULT_CONFIG } = await import("@/config/AppConfig");
const { mappingForEntityId } = await import("@/config/EntityMap");

console.log("  geometry:");
ck("lerp", lerp(10, 20, 0.25) === 12.5 && lerp(1, 1, 0.7) === 1);
ck("wrapAngle folds to ±π, shortest way round", Math.abs(wrapAngle(Math.PI * 1.5) + Math.PI / 2) < 1e-12 && Math.abs(wrapAngle(-Math.PI * 1.5) - Math.PI / 2) < 1e-12 && wrapAngle(0.3) === 0.3);
ck("clamp", clamp(5, 0, 3) === 3 && clamp(-1, 0, 3) === 0 && clamp(2, 0, 3) === 2);
{
  const SRC = new URL("../../src/", import.meta.url);
  const files = ["babylon/RenderEnhancements.ts", "babylon/LightPools.ts", "babylon/SkyDome.ts", "babylon/RoomHighlight.ts", "babylon/OverviewController.ts", "utils/colorUtils.ts", "utils/tapDebug.ts"];
  const own = files.filter((f) => /=> a \+ \(b - a\) \* t|\+ \(\w+ - \w+\) \* t;|Math\.min\(Math\.max\(|dAngle -= 2 \* Math\.PI|wrapPi/.test(readFileSync(new URL(f, SRC), "utf8")));
  ck("no file keeps its own lerp, wrap or min/max clamp", own.length === 0, own);
  const ev = readFileSync(new URL("babylon/EntityVisuals.ts", SRC), "utf8");
  ck("'is the orbit camera' is asked ONE way in EntityVisuals", (ev.match(/as unknown as \{ radius\?: number \}/g) ?? []).length === 1 && /this\.orbitCamera\(\) \? \(cam as unknown as \{ radius: number \}\)\.radius : 0/.test(ev));
}

console.log("\n  the stair list:");
ck("every word either file had is in the one list", ["Stair 1F", "Escalier", "escalera", "Marche", "scala", "Treppe", "Stufe", "trap", "steps", "step"].every((w) => STAIR_NAME_RE.test(w)));
ck("  ...and 'trapezoid' or 'stepper motor'? 'trap' is a whole word; 'step' is too", !STAIR_NAME_RE.test("trapezoid") && !STAIR_NAME_RE.test("stepper"));
ck("storeys asks the same list", isStairwell("Marche 2F") && !isStairwell("Living"));
{
  const ss = readFileSync(new URL("../../src/babylon/structureSet.ts", import.meta.url), "utf8");
  ck("structureSet asks it too, with no regex of its own", /STAIR_NAME_RE\.test\(name\)/.test(ss) && !/stairPat/.test(ss));
}

console.log("\n  the stale-type upgrade, once at load:");
{
  const cfg = { ...DEFAULT_CONFIG, entityMap: {
    "input_boolean.x": { type: "sensor", label: "X" },
    "sensor.t": { type: "sensor", label: "T" },
    "binary_sensor.d": { type: "sensor", label: "D" },
    "light.l": { type: "light", label: "L" },
  } };
  const up = upgradeStaleTypes(cfg);
  ck("a non-sensor domain stored as 'sensor' takes its domain's type", up.entityMap["input_boolean.x"].type === "input_boolean");
  ck("  ...sensor and binary_sensor entries are left alone, and other types untouched", up.entityMap["sensor.t"].type === "sensor" && up.entityMap["binary_sensor.d"].type === "sensor" && up.entityMap["light.l"].type === "light");
  ck("  ...a config with nothing to upgrade is returned as is", upgradeStaleTypes(up) === up);
  ck("normaliseConfig applies it (every config entering memory)", normaliseConfig(cfg).entityMap["input_boolean.x"].type === "input_boolean");
  ck("mappingForEntityId returns a stored mapping as stored (no second copy of the rule)", mappingForEntityId("input_boolean.x", cfg.entityMap).type === "sensor" && mappingForEntityId("input_boolean.x", up.entityMap).type === "input_boolean");
}

console.log("\n  the oracles' helper:");
{
  const files = readdirSync(new URL("./", import.meta.url)).filter((f) => f.endsWith(".mjs"));
  const own = files.filter((f) => /^const ck = \(n, ok, got\) => \{ console\.log/m.test(readFileSync(new URL(f, import.meta.url), "utf8")));
  // A ratchet: 13 oracles still paste it because their endings are hand-shaped
  // (their own counters or a differently worded exit). Never more than now.
  ck(`the shared ck is imported, not pasted (${files.length - own.length} of ${files.length} oracles)`, own.length <= 13, own.length);
}

done("✅ one lerp, one wrap, one clamp, one stair list, one type upgrade");
