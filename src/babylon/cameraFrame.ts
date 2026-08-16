// src/babylon/cameraFrame.ts
// ONE answer to "what solid angle does this camera show?".
//
// ── Why this file exists ──────────────────────────────────────────────────
// Four separate places converted `camera.fov` into an on-screen angle, and all
// four independently assumed it was the VERTICAL one:
//
//   • SkyDome          — where in the frame the sun and moon are drawn
//   • SceneManager     — the radius that fits a room in shot
//   • OverviewController — the radius limits, as an aspect correction
//   • EntityVisuals    — pixels per world unit, which drives the zoom rung
//
// The assumption is true today, because nothing in this app assigns `fovMode`
// and Babylon defaults to FOVMODE_VERTICAL_FIXED. That is exactly what makes it
// dangerous: four agreements that happen to match, with nothing for a fifth
// reader to join, and the justification written out three times in prose and
// nowhere in code. It is the same shape as the `badgeStyle === "card"` bug,
// where five inline copies agreed and the sixth site that had to agree simply
// was not one of them.
//
// Set `fovMode` to FOVMODE_HORIZONTAL_FIXED — a reasonable thing to want on a
// portrait phone — and under the old arrangement three of those four would
// silently compute the wrong angle while the fourth computed the right one, so
// the sky and the framing would disagree with no error anywhere. Asking here
// makes that a one-line change instead of a hunt.

import type { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";

/** Babylon's own `Camera.fov` default, used only when a camera somehow carries
 *  a non-positive one. NOT the app's chosen fov — OverviewController and
 *  CameraController each set theirs explicitly, and those are settings rather
 *  than fallbacks. */
const FALLBACK_FOV = 0.8;

export interface CameraFrame {
  /** Half the VERTICAL field of view, in radians. */
  vHalf: number;
  /** Half the HORIZONTAL field of view, in radians. */
  hHalf: number;
  /** Viewport width / height. */
  aspect: number;
}

/**
 * Both half-angles, derived from whichever one this camera actually holds
 * fixed.
 *
 * ⚠️ `aspect` is a RATIO of two render dimensions, so it is invariant to the
 * resolution valve (`SceneManager.sharpen`/`unsharpen`), which scales width and
 * height together. That is what makes it safe to compare between frames — see
 * CLAUDE.md on why `getRenderHeight()` alone is not.
 */
export function cameraFrame(scene: Scene, cam: Camera): CameraFrame {
  const aspect = scene.getEngine().getAspectRatio(cam) || 1;
  const fov = cam.fov > 0 ? cam.fov : FALLBACK_FOV;
  if (cam.fovMode === Camera.FOVMODE_HORIZONTAL_FIXED) {
    const hHalf = fov / 2;
    return { vHalf: Math.atan(Math.tan(hHalf) / aspect), hHalf, aspect };
  }
  const vHalf = fov / 2;
  return { vHalf, hHalf: Math.atan(Math.tan(vHalf) * aspect), aspect };
}
