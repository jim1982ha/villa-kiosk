// src/babylon/cameraPose.ts
// Where a camera stands and looks, and how wide it sees: its view matrix and field of view. What a person moves, and
// nothing the render resolution touches — the open room chip folds when this changes (EntityVisuals.setOpenChip).
//
// ⚠️ NEVER THE VIEW-PROJECTION (owner's clip, 2026-11-14): a chip opened by one click folded by itself 0.7s later, the
// mouse still. A tap is motion to the resolution valve: the render size dips and comes back, the projection's aspect
// moves by a rounding, and the view-projection read that as the camera moving. Pure: tests/oracles/room_chips.mjs.

import type { Camera } from "@babylonjs/core/Cameras/camera";

/** The camera's pose, as numbers to compare. */
export function cameraPose(cam: Camera | null): number[] | null {
  return cam ? [...Array.from(cam.getViewMatrix(true).m), cam.fov] : null;
}

/** Has the camera moved, zoomed or turned between two poses? (No pose now: it is gone, which counts.) */
export function poseMoved(before: readonly number[], now: readonly number[] | null): boolean {
  return !now || before.some((v, i) => Math.abs(v - now[i]) > 1e-6);
}
