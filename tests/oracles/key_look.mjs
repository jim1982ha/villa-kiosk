// Keyboard turning in walk mode is a rate per SECOND (src/babylon/keyLook.ts,
// round 11, 2.496.173). It was 0.03 rad per rendered frame: a 120 Hz iPad
// turned twice as fast as a 60 Hz screen.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { keyLook, KEY_TURN_RAD_PER_S, PITCH_LIMIT } = await import("@/babylon/keyLook");

const second = (hz) => { let r = { x: 0, y: 0 }; for (let i = 0; i < hz; i++) r = keyLook(r, 1, 0, 60 / hz); return r.y; };

ck("one second held turns the same at 30, 60 and 120 Hz", [30, 60, 120].every((hz) => Math.abs(second(hz) - 1.8) < 1e-9), [30, 60, 120].map(second));
ck("  ...which is the speed it was tuned to: 0.03 rad per 60 Hz frame", Math.abs(keyLook({ x: 0, y: 0 }, 1, 0, 1).y - 0.03) < 1e-12 && KEY_TURN_RAD_PER_S === 1.8);
ck("left is the mirror of right; no key, no turn", keyLook({ x: 0, y: 1 }, -1, 0, 1).y === 1 - 0.03 && keyLook({ x: 0.2, y: 1 }, 0, 0, 2).y === 1);
ck("the head never tilts past ±1.4 rad", keyLook({ x: 1.39, y: 0 }, 0, 1, 3).x === PITCH_LIMIT && keyLook({ x: -1.39, y: 0 }, 0, -1, 3).x === -1.4);

const cc = readFileSync(new URL("../../src/babylon/CameraController.ts", import.meta.url), "utf8");
ck("CameraController turns through keyLook with the step's frame factor — no per-frame constant",
   /keyLook\(this\.camera\.rotation, yaw, pitch, this\.stepFrames\)/.test(cc) && !/yaw \* 0\.03|pitch \* 0\.03/.test(cc));
ck("the frame factor is read ONCE per step (the clock advances when read) and shared by look, walk and auto-walk",
   (cc.match(/this\.frameFactor\(\)/g) ?? []).length === 1 && /this\.stepFrames = this\.frameFactor\(\);/.test(cc)
   && (cc.match(/\* this\.stepFrames;/g) ?? []).length === 2);

done("✅ keyboard turning is per second");
