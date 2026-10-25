// The control panels' per-device rules (src/utils/panelRules.ts, round 11,
// 2.496.165) — driven by value, and each panel pinned to them: a rule copied
// back into a .tsx would pass here and still be the one the screen runs.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const R = await import("@/utils/panelRules");

const band = { min: 16, max: 30 };

// Thermostat
ck("a 0.1 step from 22.8 is 22.9 — not 22.900000000000002", R.climateStep(22.8, 1, 0.1, band) === 22.9, R.climateStep(22.8, 1, 0.1, band));
ck("a 0.5 step: 21.5 → 21", R.climateStep(21.5, -1, 0.5, band) === 21, R.climateStep(21.5, -1, 0.5, band));
ck("a step is clamped to the range", R.climateStep(30, 1, 1, band) === 30 && R.climateStep(16, -1, 1, band) === 16);
const r = R.climateRange({ min_temp: 7, max_temp: 35 });
ck("the range is the device's own", r.min === 7 && r.max === 35, r);
const d = R.climateRange(undefined);
ck("  ...HA's 16–30 when the device reports none", d.min === 16 && d.max === 30, d);
ck("a temperature in HA's unit — °F stays °F", R.fmtTemp(72, "°F") === "72°F" && R.fmtTemp(null, "°C") === "--°C", R.fmtTemp(72, "°F"));

// Fan
const five = R.fanLevels(20);
ck("a 20% step is five speeds, Low…High", five.length === 5 && five[0].label === "Low" && five[4].label === "High" && five[4].value === 100, five);
ck("  ...a STRINGIFIED step counts the same (Tuya/template fans)", R.fanLevels("20").length === 5);
ck("  ...no step, no levels", R.fanLevels(undefined).length === 0 && R.fanLevels(0).length === 0);
ck("  ...seven speeds fall back to percentages", R.fanLevels(100 / 7)[0].label === "14%", R.fanLevels(100 / 7)[0]);
ck("the nearest level to 55% of three is Medium (67 is nearer than 33)", R.nearestLevel(R.fanLevels(100 / 3), 55)?.label === "Medium");
ck("  ...none reported, none chosen", R.nearestLevel(five, undefined) === undefined);

// Cover
ck("a cover at 40% reads Partially open (40%)", R.coverStateLabel("open", 40) === "Partially open (40%)");
ck("  ...at 100% Open, without a position Open, closed Closed, moving is HA's word",
   R.coverStateLabel("open", 100) === "Open" && R.coverStateLabel("open", undefined) === "Open" && R.coverStateLabel("closed", 0) === "Closed" && R.coverStateLabel("opening", 20) === "opening");

// Light
ck("an rgb light takes brightness, not a colour temperature", JSON.stringify(R.lightSupport(["rgb"])) === '{"brightness":true,"temperature":false}');
ck("  ...onoff takes neither; color_temp both", !R.lightSupport(["onoff"]).brightness && R.lightSupport(["color_temp"]).temperature);

// The callers — each panel runs the shared rule, not its own copy.
const src = (f) => readFileSync(new URL(`../../src/components/panels/${f}`, import.meta.url), "utf8");
const ac = src("ACPanel.tsx"), fan = src("FanPanel.tsx"), light = src("LightPanel.tsx"), cover = src("CoverPanel.tsx");
ck("ACPanel steps through climateStep, reads HA's unit, writes no °C literal",
   /climateStep\(/.test(ac) && /unit_system\?\.temperature/.test(ac) && !/°C/.test(ac.replace(/\/\/.*$/gm, "")));
ck("FanPanel's levels come from fanLevels (no SPEED_LABELS of its own)", /fanLevels\(/.test(fan) && !/SPEED_LABELS/.test(fan));
// The draft's rules (hold, send on any release, back on a refusal) are
// utils/liveDraft.draftStep, driven by value in live_draft.mjs (2.496.231).
ck("the light's sliders and the cover's follow the device (useLiveDraft, one set of range handlers)",
   (light.match(/useLiveDraft</g) ?? []).length === 2 && (light.match(/\.rangeProps\}/g) ?? []).length === 2
   && /useLiveDraft</.test(cover) && /position\.rangeProps\}/.test(cover) && !/useState/.test(light));
// The control panels show it through ControlFrame (live_draft.mjs pins that).
for (const f of ["GenericPanel.tsx", "ControlFrame.tsx"])
  ck(`${f} shows the shared UnavailableNotice`, /<UnavailableNotice\b/.test(src(f)));

// owner, 2026-10-21: a camera that turns and has a siren shows them on its video — found on the camera's DEVICE
{
  const reg = {
    "camera.cam_hd": "d1", "camera.cam_direct": "d1", "button.cam_move_up": "d1", "button.cam_move_down": "d1",
    "button.cam_move_left": "d1", "button.cam_move_right": "d1", "button.cam_reboot": "d1", "button.cam_format_sd_card": "d1",
    "siren.cam_siren": "d1", "button.cam_backup": "d1", "button.other_move_up": "d2", "siren.other_siren": "d2", "camera.plain": "d3",
    "camera.ptz2": "d4", "button.ptz2_pan_left": "d4", "button.ptz2_tilt_up": "d4",
  };
  const c = R.cameraControlsOf("camera.cam_hd", reg);
  ck("a camera's moves and siren are its own device's: the four moves, the siren — never reboot nor format",
     JSON.stringify(c) === JSON.stringify({ moves: { down: "button.cam_move_down", left: "button.cam_move_left",
       right: "button.cam_move_right", up: "button.cam_move_up" }, siren: "siren.cam_siren" }), c);
  ck("  ...another device's are never its own; a camera with neither has none; pan/tilt names count too",
     R.cameraControlsOf("camera.plain", reg) === null && R.cameraControlsOf("camera.unknown", reg) === null
     && JSON.stringify(R.cameraControlsOf("camera.ptz2", reg)) === JSON.stringify({ moves: { left: "button.ptz2_pan_left", up: "button.ptz2_tilt_up" }, siren: null }));
}

// owner, 2026-10-21: "why do I see Tapo Storage Room HD Stream (Direct) in the list … since the one configured in the
// villa is HD Stream?" — a Tapo camera gives two streams of ONE device; the picker lists one per device, the placed one
{
  const dev = { "camera.tapo_hd": "d1", "camera.tapo_hd_direct": "d1", "button.tapo_move_up": "d1",
    "camera.hik": "camera.hik", "camera.hidden_cam": "camera.hidden_cam", "camera.dismissed": "camera.dismissed",
    "camera.solo_direct": "d2" };
  const devices = { deviceOf: (id) => dev[id] ?? id, has: (d) => ["d1", "camera.hik", "camera.hidden_cam", "d2"].includes(d),
    isHidden: (id) => id === "camera.hidden_cam" };
  const all = Object.keys(dev);
  const placed = (id) => ["camera.tapo_hd", "camera.hik"].includes(id);
  const got = (cur) => R.cameraChoices(all, cur, devices, placed).sort();
  ck("one camera per device — the stream placed in the villa; never a hidden one or a device the villa does not have",
     got("camera.hik").join() === "camera.hik,camera.solo_direct,camera.tapo_hd", got("camera.hik"));
  ck("  ...the open camera is always in it, to step on from",
     got("camera.tapo_hd_direct").join() === "camera.hik,camera.solo_direct,camera.tapo_hd,camera.tapo_hd_direct");
  // owner, 2026-10-21: the Server Room camera's placed stream was hidden in the villa's system — gone from the list
  const hid = { ...devices, has: (d) => d !== "d1" && devices.has(d), isHidden: (id) => dev[id] === "d1" || devices.isHidden(id) };
  ck("  ...a camera placed on the map is listed even when the villa's system hides it — never its other stream",
     R.cameraChoices(all, "camera.hik", hid, placed).sort().join() === "camera.hik,camera.solo_direct,camera.tapo_hd",
     R.cameraChoices(all, "camera.hik", hid, placed));
  const { readFileSync } = await import("node:fs");
  ck("  ...and the camera window steps through and lists exactly that",
     /const cameraIds = cameraChoices\(Object\.keys\(entities\), mapping\.entityId, devices, \(id\) => id in config\.entityMap\)/
       .test(readFileSync(new URL("../../src/components/panels/CameraPanel.tsx", import.meta.url), "utf8")));
}

// A Missing device's advice (owner, 2026-10-25: "i don't have any devices named light.gym_light in the GLB file"): the 3D
// model is named only when it has the object; a deleted device opened from its Cockpit card says where it went
{
  const { missingAdvice } = await import("@/utils/stateColors");
  ck("Missing: a 3D object is renamed, removed or re-pointed; anything else went away in the villa's system",
     /3D model/.test(missingAdvice(true)) && !/3D model|Edit/.test(missingAdvice(false))
     && /villa's system/.test(missingAdvice(false)), [missingAdvice(true), missingAdvice(false)]);
  const notice = readFileSync(new URL("../../src/components/panels/UnavailableNotice.tsx", import.meta.url), "utf8");
  ck("  ...the window asks the model's own objects (mappedEntityIds), never a fixed sentence",
     /\{missingAdvice\(mappedEntityIds\.has\(entityId\)\)\}/.test(notice) && !/Rename or remove its object/.test(notice));
}

done("✅ panel rules hold");

