// src/babylon/SunController.ts
// Drives scene lighting from either the real sun position (configured lat/lng) or the
// HA sun.sun entity state. Day -> bright blue sky; night -> warm indoor glow.

import { Vector3, Color3, Color4, type Scene, type HemisphericLight } from "@babylonjs/core";
import type { LightingSystem } from "./LightingSystem";
import type { SkyDome } from "./SkyDome";
import { type AppConfig, DEFAULT_RENDER } from "@/config/AppConfig";
import { getSunPosition } from "@/utils/sunCalc";

export class SunController {
  private scene: Scene;
  private lighting: LightingSystem;
  private hemi: HemisphericLight;
  private sky: SkyDome | null;
  private config: AppConfig;
  private requestRender: () => void = () => {};
  // When set (overview mode), this fixed backdrop wins over the day/night sky
  // colour so the bird's-eye view always reads on a calm, eye-friendly dark
  // ground instead of the bright daytime sky blue. Cleared (null) in
  // first-person so the real sky shows through the windows again.
  private bgOverride: Color4 | null = null;
  private baked = false;
  // Crossfade hook for dual-atlas baked GLBs (pipeline ≥2.1.0): 0 = day
  // atlas, 1 = the sun-free night atlas. Provided by ModelLoader when the
  // GLB carries a BAKED_Structure_Night texture; null = single-atlas GLB,
  // where night falls back to the exposure dim below.
  private nightBlend: ((t: number) => void) | null = null;
  // Pane dimmer from ModelLoader: ramps the glass materials' forced light
  // albedo + emissive sheen down after dark (they are excluded from every
  // bake/lightmap, so no other night mechanism touches them — without this
  // the windows stay day-bright white panels all night). Driven with the
  // same twilight factor as nightBlend, in baked AND unbaked modes.
  private glassDim: ((t: number) => void) | null = null;

  constructor(
    scene: Scene,
    lighting: LightingSystem,
    hemi: HemisphericLight,
    config: AppConfig,
    sky: SkyDome | null = null,
  ) {
    this.scene = scene;
    this.lighting = lighting;
    this.hemi = hemi;
    this.sky = sky;
    this.config = config;
    this.applyRealSun();
  }

  setRenderHook(fn: () => void): void {
    this.requestRender = fn;
  }

  /**
   * Baked-lighting GLB loaded: the structure is unlit, so changing the sun/hemi
   * intensities does nothing to it — night ambience is instead conveyed through
   * the `nightBlend` texture crossfade when the GLB ships a night atlas, or a
   * scene-wide exposure drop when it doesn't (see applyDayNight). The lights
   * above still run at their usual values for the ENTITY meshes, which stay
   * lit PBR. Always re-applies (no early-out): a model reload passes a NEW
   * blend closure over the new materials — keeping the old one would drive
   * disposed materials.
   */
  setBakedMode(
    baked: boolean,
    nightBlend?: (t: number) => void,
    glassDim?: (t: number) => void,
  ): void {
    this.baked = baked;
    this.nightBlend = nightBlend ?? null;
    this.glassDim = glassDim ?? null;
    this.applyRealSun();
  }

  /**
   * Pin the scene background to a fixed colour (overview backdrop), or pass null
   * to release it and restore the live day/night sky colour. Lighting (sun, fill,
   * IBL) is unaffected — only the empty-space clearColor changes — so switching
   * views never relights the model.
   */
  setBackgroundOverride(color: Color4 | null): void {
    this.bgOverride = color;
    if (color) {
      this.scene.clearColor = color;
      this.requestRender();
    } else {
      this.applyRealSun(); // recompute the day/night sky colour for right now
    }
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.applyRealSun();
  }

  /** Compute lighting from the computed sun altitude/azimuth right now. */
  applyRealSun(date = new Date()): void {
    const { latitude, longitude } = this.config;
    const { azimuth, altitude } = getSunPosition(date, latitude, longitude);
    const isDay = altitude > 0;

    // Direction the light travels: from the sun toward the scene.
    const dir = new Vector3(
      -Math.sin(azimuth) * Math.cos(altitude),
      -Math.max(0.05, Math.sin(altitude)),
      -Math.cos(azimuth) * Math.cos(altitude),
    ).normalize();

    // Night-atlas crossfade factor: ramp 0→1 as the sun sinks from the
    // horizon to 6° below it (civil twilight), so the baked day image fades
    // into the night bake over ~25 real minutes instead of snapping.
    const TWILIGHT = (6 * Math.PI) / 180;
    const nightT = Math.min(1, Math.max(0, -altitude / TWILIGHT));

    this.applyDayNight(isDay, dir, nightT);
  }

  /** Override from HA sun.sun entity ("above_horizon" | "below_horizon"). */
  applyHaSunState(state: string): void {
    const isDay = state === "above_horizon";
    const dir = isDay ? new Vector3(-0.4, -1, -0.6) : new Vector3(-0.2, -1, -0.2);
    this.applyDayNight(isDay, dir.normalize(), isDay ? 0 : 1);
  }

  private applyDayNight(isDay: boolean, dir: Vector3, nightT: number = isDay ? 0 : 1): void {
    // Render-quality multipliers let Settings rebalance the key light + fill
    // without touching the day/night base values here.
    const r = this.config.render ?? DEFAULT_RENDER;

    // How much EXTRA the night pass dims beyond its old "mild dim" baseline —
    // 0 = the original mild dim (this file's long-standing default), 1 = deep
    // dim (a lit fixture's own light clearly dominates the room). Interpolated
    // rather than hardcoded so the look is user-tunable (Settings → Render
    // quality) without another round of "too dark" / "too flat" reports.
    const nd = isDay ? 0 : Math.min(1, Math.max(0, r.nightDimming));
    const lerp = (a: number, b: number) => a + (b - a) * nd;

    // Night used a cold blue key + blue ambient, which cast a strong cyan tint on
    // white/light surfaces (kitchen cabinets, tables) — the "blue kitchen" report.
    // Switch night to the warm, near-neutral indoor glow this file always claimed
    // to render (see the header comment): a low warm key + warm-neutral ambient so
    // white reads white at night, lifted a touch so interiors stay legible. The
    // sky (clearColor) stays dark so it still clearly reads as night.
    this.lighting.setSun(
      dir,
      (isDay ? 1.2 : lerp(0.32, 0.2)) * r.sunIntensity,
      isDay ? new Color3(1.0, 0.95, 0.8) : new Color3(0.95, 0.85, 0.7),
    );
    this.lighting.setAmbient(
      (isDay ? new Color3(0.4, 0.35, 0.3) : new Color3(0.26, 0.23, 0.19).scale(lerp(1, 0.35))).scale(r.ambientIntensity),
    );

    // Interior fill (hemispheric) is owned HERE so its day/night warmth stays
    // consistent. It used to be a flat neutral-white at a constant intensity,
    // which is exactly what made night walls read as a dead flat grey: a cold
    // white wash with no warm key to balance it. At night we dim it and tint it
    // warm so walls read as a warm, cosy interior; by day it stays neutral. The
    // WARM tint is what keeps a deep nightDimming reading as "cosy dim", not a
    // repeat of that old dead-grey bug — same colour treatment, just dimmer.
    this.hemi.intensity = r.hemiIntensity * (isDay ? 1 : lerp(0.7, 0.22));
    this.hemi.diffuse = isDay ? new Color3(1, 1, 1) : new Color3(1.0, 0.92, 0.82);
    this.hemi.groundColor = isDay ? new Color3(0.55, 0.54, 0.52) : new Color3(0.32, 0.30, 0.27);

    // The IBL gradient cube is a fixed *daytime* sky (blue zenith, grey horizon).
    // Left at full strength it dumps a cold blue-grey ambient onto every wall at
    // night — another source of the grey look. Scale its contribution down after
    // dark. (renderFx owns whether the texture exists; we own how much it counts.)
    if (r.ibl) this.scene.environmentIntensity = r.environmentIntensity * (isDay ? 1 : lerp(0.4, 0.12));

    // Baked mode, two flavours:
    // • Dual-atlas GLB (pipeline ≥2.1.0): crossfade the structure between its
    //   day and sun-free night bakes — real darkness, no phantom sun shadows.
    //   Exposure stays at the user's daytime value: the night atlas is
    //   ALREADY dark (baked with no sun, dim sky, low warm fill), so dimming
    //   on top would double-darken it.
    // • Single-atlas GLB: the texture is a fixed daytime render, so the only
    //   way to sell "night" is post-processing — scale the user's exposure
    //   down after dark, deepening with nightDimming. Either way this runs
    //   AFTER renderFx.applyToneMapping wrote cfg.exposure (all call paths
    //   order renderFx.apply() before the sun pass — same ownership
    //   discipline as the hemi fill above), so this write is the final word
    //   on exposure.
    if (this.baked) {
      if (this.nightBlend) {
        this.nightBlend(nightT);
        this.scene.imageProcessingConfiguration.exposure = r.exposure;
      } else {
        this.scene.imageProcessingConfiguration.exposure =
          r.exposure * (isDay ? 1 : lerp(1, 0.45));
      }
    }
    // Window panes dim on the same twilight ramp (see the field's comment) —
    // in every mode, since no bake, lightmap or scene light drives them.
    this.glassDim?.(nightT);

    // Drive the procedural sky from the same sun direction (it shows through the
    // windows). clearColor is kept as a fallback for when the sky dome is absent.
    this.sky?.update(dir, isDay);
    // In overview mode bgOverride pins a calm dark backdrop; otherwise the empty
    // space tracks the day/night sky colour.
    this.scene.clearColor = this.bgOverride ?? (isDay
      ? new Color4(0.53, 0.67, 0.84, 1)
      : new Color4(0.03, 0.03, 0.05, 1));
    this.requestRender();
  }
}
