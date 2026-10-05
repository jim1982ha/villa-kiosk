// src/babylon/skyShader.ts
// The sky material's OWN sun — its disc and the bright glow round it — is
// switched off in the overview, where SkyDome draws the sun itself.
//
// ⚠️ TWO SUNS (owner, 2026-10-05, a screenshot at 17:37). SkyMaterial always
// paints a sun at the TRUE direction: a small white disc (`sundisk`) and a
// wide forward-scattering glow (`hgPhase`). Walking, that IS the sun, and the
// billboard is off. In the overview the billboard is the sun — on a dome round
// the villa (skyFraming) — and the material's one is usually out of frame
// because the camera looks down; at a shallow tilt it came into view beside
// the billboard. The sky's COLOUR still comes from the true direction
// (sunPosition), so the hour and the twilight stay honest: only the disc and
// its glow go.
//
// SkyMaterial has no switch for either, so its fragment shader is patched in
// Babylon's shader store before the first sky is compiled. The gate is the
// horizon drop the overview already sets (cameraOffset.y > 0: SkyDome's
// setHorizonDrop), exactly when the billboard is drawn — no new uniform.
// A Babylon upgrade that rewrites those lines leaves the shader untouched and
// SKY_SUN_GATED false: tests/oracles/sky_bodies.mjs fails on it.

import "@babylonjs/materials/sky/sky.fragment";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";

const KEY = "skyPixelShader";
/** [Babylon's line, the gated one]. */
const PATCHES: readonly (readonly [string, string])[] = [
  ["L0+=(sunE*19000.0*Fex)*sundisk;",
    "L0+=(sunE*19000.0*Fex)*sundisk*(cameraOffset.y>0.0?0.0:1.0);"],
  // g = 0 is an even scatter: the haze stays, the glow that marks a second
  // sun goes.
  ["float mPhase=hgPhase(cosTheta,mieDirectionalG);",
    "float mPhase=hgPhase(cosTheta,cameraOffset.y>0.0?0.0:mieDirectionalG);"],
];

function gate(): boolean {
  const src = ShaderStore.ShadersStore[KEY];
  if (typeof src !== "string") return false;
  if (PATCHES.every(([, to]) => src.includes(to))) return true;   // already done (HMR, a second import)
  if (!PATCHES.every(([from]) => src.split(from).length === 2)) return false;
  ShaderStore.ShadersStore[KEY] = PATCHES.reduce((s, [from, to]) => s.replace(from, to), src);
  return true;
}

/** Whether the material's own sun is switched off in the overview. */
export const SKY_SUN_GATED = gate();
