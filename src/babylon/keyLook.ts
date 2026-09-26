// src/babylon/keyLook.ts
// Turning and tilting the walker's head from the keyboard (A/D, ←/→,
// Shift+↑/↓) — a rate in radians per SECOND, not per frame.
//
// ⚠️ IT WAS 0.03 rad PER RENDERED FRAME (round 11, 2.496.173): twice as fast
// on a 120 Hz iPad as at 60 Hz, and slower whenever the frame rate dropped —
// while walking beside it already scaled by the frame's real duration
// (frameFactor, FrameClock). 0.03 at 60 Hz is the speed it was tuned to, and
// what it keeps everywhere now. Pure: tests/oracles/key_look.mjs.

/** 0.03 rad per 60 Hz frame. */
export const KEY_TURN_RAD_PER_S = 1.8;
/** The head never tilts past ~80° up or down. */
export const PITCH_LIMIT = 1.4;

/**
 * The head's rotation after one step of held keys. `yaw`/`pitch` are the
 * key directions (−1, 0, 1); `frames60` is this step's length in 60 Hz frames
 * (CameraController.frameFactor — already clamped for idle gaps).
 */
export function keyLook(
  rot: { x: number; y: number }, yaw: number, pitch: number, frames60: number,
): { x: number; y: number } {
  const k = (KEY_TURN_RAD_PER_S / 60) * frames60;
  return {
    y: rot.y + yaw * k,
    x: Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, rot.x + pitch * k)),
  };
}
