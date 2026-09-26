// src/babylon/sceneLook.ts
// The scene's exposure, environment intensity and background — ONE writer.
//
// ⚠️ EACH OF THESE HAD TWO OR THREE WRITERS, KEPT RIGHT BY CALL ORDER.
// RenderEnhancements wrote the Settings value; SunController then scaled it
// for night; the scene's clear colour was written by SceneManager, by the sun
// pass and by the overview backdrop. Correctness rested on "renderFx.apply()
// before the sun pass, so the sun has the final word", restated at four call
// sites — and a call path that ran them the other way round would show a baked
// villa at DAYTIME exposure all night. The two writers did not even read the
// same settings: the render pass got the device-adjusted config (no IBL on
// iOS), the sun pass the raw one.
//
// Now each input is set on its own, in any order, and `resolveLook` derives
// the three values from all of them together. `environmentReach` answers the
// question 2.496.47 shipped without asking: how many materials does an
// environment change actually reach? (Sky reflections were built, released and
// reverted because ModelLoader leaves almost every material unlit or with
// environmentIntensity 0 — so the answer was "nearly none".)

import { Color4 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

export interface LookInputs {
  /** Settings' exposure, as the render pass applies it (device-adjusted). */
  exposure: number;
  /** Whether the IBL cube is in use (the render pass owns the texture). */
  ibl: boolean;
  environmentIntensity: number;
  /** Settings → Night dimming, 0 = the mild long-standing dim, 1 = deep. */
  nightDimming: number;
  isDay: boolean;
  /** A baked-lighting GLB: its structure renders unlit. */
  baked: boolean;
  /** …and ships a night atlas, so night is already dark in the texture. */
  nightAtlas: boolean;
  /** The overview's fixed backdrop, which wins over the sky colour. */
  backdrop: readonly [number, number, number, number] | null;
}

export interface Look {
  exposure: number;
  /** null: IBL is off, so the intensity is not the look's to write. */
  environmentIntensity: number | null;
  clearColor: readonly [number, number, number, number];
}

const DAY_SKY = [0.53, 0.67, 0.84, 1] as const;
const NIGHT_SKY = [0.03, 0.03, 0.05, 1] as const;

export function resolveLook(i: LookInputs): Look {
  // 0 by day; at night, how much EXTRA dimming beyond the mild baseline.
  const nd = i.isDay ? 0 : Math.min(1, Math.max(0, i.nightDimming));
  const lerp = (a: number, b: number) => a + (b - a) * nd;
  // Baked structure ignores every light, so night reaches it only through
  // exposure: a night atlas is already dark and only ADDS dimming (floor 0.5);
  // a single daytime atlas needs the full day→0.45 range to read as night at
  // all. A non-baked villa is lit by the sun pass and keeps Settings' value.
  const exposure = i.baked && !i.isDay
    ? i.exposure * (i.nightAtlas ? lerp(1, 0.5) : lerp(1, 0.45))
    : i.exposure;
  // The IBL cube is a fixed DAYTIME sky; at full strength after dark it dumps
  // a cold blue-grey ambient on every wall, so it counts for less at night.
  const environmentIntensity = i.ibl
    ? i.environmentIntensity * (i.isDay ? 1 : lerp(0.4, 0.12))
    : null;
  const clearColor = i.backdrop ?? (i.isDay ? DAY_SKY : NIGHT_SKY);
  return { exposure, environmentIntensity, clearColor };
}

export class SceneLook {
  private readonly scene: Scene;
  private inputs: LookInputs = {
    exposure: 1, ibl: false, environmentIntensity: 1, nightDimming: 0,
    isDay: true, baked: false, nightAtlas: false, backdrop: null,
  };

  constructor(scene: Scene) {
    this.scene = scene;
    this.write();
  }

  /** From the render pass, with the device-adjusted config. */
  setRender(r: { exposure: number; ibl: boolean; environmentIntensity: number; nightDimming?: number }): void {
    this.set({ exposure: r.exposure, ibl: r.ibl, environmentIntensity: r.environmentIntensity,
      nightDimming: r.nightDimming ?? 0 });
  }

  /** From the sun pass. */
  setDay(isDay: boolean): void { this.set({ isDay }); }

  setBaked(baked: boolean, nightAtlas: boolean): void { this.set({ baked, nightAtlas }); }

  /** The overview backdrop, or null for the live sky colour. */
  setBackdrop(c: Color4 | null): void {
    this.set({ backdrop: c ? [c.r, c.g, c.b, c.a] : null });
  }

  get current(): Look { return resolveLook(this.inputs); }

  /**
   * How many of the scene's materials an environment change can reach: lit,
   * and not zeroed. Logged after a model load, so a feature built on the
   * environment (sky reflections, 2.496.47) can be judged by its reach before
   * it is built, rather than after it is released.
   */
  environmentReach(): { reach: number; total: number } {
    let reach = 0;
    const mats = this.scene.materials;
    for (const m of mats) {
      const mat = m as unknown as { unlit?: boolean; disableLighting?: boolean; environmentIntensity?: number };
      if (mat.unlit || mat.disableLighting) continue;
      if (mat.environmentIntensity === 0) continue;
      reach++;
    }
    return { reach, total: mats.length };
  }

  private set(patch: Partial<LookInputs>): void {
    this.inputs = { ...this.inputs, ...patch };
    this.write();
  }

  private write(): void {
    const look = resolveLook(this.inputs);
    this.scene.imageProcessingConfiguration.exposure = look.exposure;
    if (look.environmentIntensity !== null) this.scene.environmentIntensity = look.environmentIntensity;
    const [r, g, b, a] = look.clearColor;
    this.scene.clearColor = new Color4(r, g, b, a);
  }
}
