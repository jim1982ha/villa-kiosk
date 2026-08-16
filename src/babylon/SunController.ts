// src/babylon/SunController.ts
// Drives scene lighting from either the real sun position (configured lat/lng) or the
// HA sun.sun entity state. Day -> bright blue sky; night -> warm indoor glow.

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { LightingSystem } from "./LightingSystem";
import type { SkyDome } from "./SkyDome";
import { skyNow, skyTickMs, skySimActive, skySimLabel } from "@/utils/skyClock";
import { tapDebug } from "@/utils/tapDebug";
import { type AppConfig, DEFAULT_RENDER } from "@/config/AppConfig";
import { getSunPosition, getMoonPosition, getMoonIllumination } from "@/utils/sunCalc";
import type { NightSky } from "./NightSky";

export class SunController {
  private scene: Scene;
  private lighting: LightingSystem;
  private hemi: HemisphericLight;
  private sky: SkyDome | null;
  /** Only set when `?skySpeed` is running the sky fast — see startSkySim. */
  private simTimer: ReturnType<typeof setInterval> | null = null;
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
  private nightSky: NightSky | null = null;
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
    this.startSkySim();
    // Announce it, so a simulated sky is never mistaken for a broken one in a
    // capture — a sun in the wrong place with no explanation is exactly the
    // kind of report that costs a measurement round.
    if (skySimActive()) tapDebug(`sky: ${skySimLabel()}`, "sky");
  }

  /**
   * Drive the sky from the simulated clock when `?skySpeed` asks for it.
   *
   * ⚠️ Guarded so a frozen `?skyTime` schedules NOTHING: at speed 1 the sky
   * does not move, and a timer that recomputes an unchanged answer would still
   * request a frame every tick — on a scene that renders on demand, that is a
   * permanently-awake kiosk with a warm battery and no visible reason for it.
   *
   * The tick asks for a frame the same way every other change does rather than
   * running a loop of its own, so it composes with the resolution valve and
   * the idle sharpening instead of fighting them.
   */
  private startSkySim(): void {
    const every = skyTickMs();
    if (every <= 0) return;
    this.simTimer = setInterval(() => {
      this.applyRealSun();
      this.requestRender?.();
    }, every);
  }

  /** Stop the simulated-sky timer. Idempotent — SceneManager.dispose is the
   *  only caller and is itself guarded, but a stray interval outliving the
   *  scene would keep re-lighting a disposed one. */
  dispose(): void {
    if (this.simTimer !== null) { clearInterval(this.simTimer); this.simTimer = null; }
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

  /**
   * A true compass bearing, turned into a bearing in THIS model's axes.
   *
   * ONE reader for the whole file, and it has to be: the sun and the moon are
   * computed independently and would otherwise need the correction applied
   * twice, which is how they would come to disagree about which way is north.
   * See AppConfig.northOffsetDeg for why the correction exists at all.
   */
  private modelAzimuth(azimuth: number): number {
    return azimuth + ((this.config.northOffsetDeg ?? 0) * Math.PI) / 180;
  }

  /** Compute lighting from the computed sun altitude/azimuth right now. */
  applyRealSun(date = skyNow()): void {
    const { latitude, longitude } = this.config;
    const { azimuth: trueAzimuth, altitude: realAltitude } =
      getSunPosition(date, latitude, longitude);
    const azimuth = this.modelAzimuth(trueAzimuth);
    // Settings' day/night preview (baked villas): "day"/"night" PIN the sun
    // to the matching side of the horizon regardless of the real altitude —
    // everything downstream (isDay, light dir, sky dir, the twilight nightT
    // ramp) then derives that look consistently, including a plausible
    // above-horizon sun position for a forced day. Math.abs (not a sign
    // flip) is what makes it an absolute PIN rather than a relative invert —
    // forcing "day" at 3am and forcing "day" at noon must look the same.
    const preview = this.config.render?.dayNightPreview ?? "auto";
    const altitude =
      preview === "day" ? Math.abs(realAltitude)
      : preview === "night" ? -Math.abs(realAltitude)
      : realAltitude;
    const isDay = altitude > 0;

    // Direction the light travels: from the sun toward the scene. Floored at
    // 0.05 so the lighting never goes fully edge-on after dark (the hemi/
    // ambient fill carries the room past sunset) — but that floor must NOT
    // reach the sky dome below: reusing it there kept SkyMaterial's "sun"
    // hovering just above the horizon all night, so the physical scattering
    // model never actually rendered a dark sky, just a dimmer haze of the
    // daytime one ("night sky doesn't look like night" in first person).
    const dir = new Vector3(
      -Math.sin(azimuth) * Math.cos(altitude),
      -Math.max(0.05, Math.sin(altitude)),
      -Math.cos(azimuth) * Math.cos(altitude),
    ).normalize();

    // Unclamped sun direction for the sky dome ONLY — lets the sun marker
    // genuinely sink below the horizon at night.
    const skyDir = new Vector3(
      -Math.sin(azimuth) * Math.cos(altitude),
      -Math.sin(altitude),
      -Math.cos(azimuth) * Math.cos(altitude),
    ).normalize();

    // Night-atlas crossfade factor: ramp 0→1 as the sun sinks from the
    // horizon to 6° below it (civil twilight), so the baked day image fades
    // into the night bake over ~25 real minutes instead of snapping.
    const TWILIGHT = (6 * Math.PI) / 180;
    const nightT = Math.min(1, Math.max(0, -altitude / TWILIGHT));

    this.applyDayNight(isDay, dir, nightT, skyDir);

    // The moon rides the same beat as the sun, so an unattended kiosk walks it
    // across the sky and through its phases on its own. Computed here from the
    // same date/lat/lng — never from HA, whose sensor.moon_phase is an enum
    // with no position at all (see utils/sunCalc) and which is opt-in, so it
    // can never be a prerequisite for this running.
    if (this.nightSky) {
      const m = getMoonPosition(date, latitude, longitude);
      const mAz = this.modelAzimuth(m.azimuth);
      const ill = getMoonIllumination(date);
      // Same convention as skyDir above: a unit vector pointing AT the body.
      this.nightSky.update({
        dir: new Vector3(
          -Math.sin(mAz) * Math.cos(m.altitude),
          Math.sin(m.altitude),
          -Math.cos(mAz) * Math.cos(m.altitude),
        ).normalize(),
        fraction: ill.fraction,
        angle: ill.angle,
        parallacticAngle: m.parallacticAngle,
        nightT,
      });
    }
  }

  /** Optional — the scene works without it, and so does every install that
   *  never enabled HA's Moon integration. */
  setNightSky(ns: NightSky): void {
    this.nightSky = ns;
  }

  /** Override from HA sun.sun entity ("above_horizon" | "below_horizon"). */
  applyHaSunState(state: string): void {
    // ── Never overwrite a REAL sun with a synthetic one (2.224.0) ───────────
    // sun.sun carries only "above_horizon"/"below_horizon" — no azimuth, no
    // altitude — so everything below is a made-up direction pinned near noon.
    // That is a fine last resort and a terrible update: this fires on every
    // sun.sun state_changed, and HA republishes that entity's elevation/azimuth
    // ATTRIBUTES about once a minute, so a correctly-computed sunset was being
    // stomped to synthetic midday within a minute of every 15-minute
    // applyRealSun tick. Reported as the sky "suddenly disappearing" and coming
    // back, with the camera untouched and no reload — two writers to one sky,
    // last-write-wins, and the crude one wrote 15x more often.
    //
    // When the villa's latitude/longitude are known, the event is still worth
    // having — just as a TRIGGER to recompute rather than as a source of
    // geometry. That keeps HA's promptness at the horizon crossing (no waiting
    // out the remainder of a 15-minute tick) and, as a bonus, moves the sky to
    // roughly per-minute updates, which is what a wall kiosk wants anyway.
    // A simulated sky owns the clock outright. HA's sun.sun reports the REAL
    // horizon, so letting it through would drag the synthetic midnight back to
    // the actual afternoon roughly once a minute — the same two-writers race
    // the comment above describes, in a new costume.
    if (skySimActive()) { this.applyRealSun(); return; }
    const { latitude, longitude } = this.config;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)
      && (latitude !== 0 || longitude !== 0)) {
      this.applyRealSun();
      return;
    }
    // Same day/night preview honoured here so the HA-driven path can't
    // silently undo the override on the next sun.sun state event.
    const preview = this.config.render?.dayNightPreview ?? "auto";
    const isDay = preview === "day" ? true : preview === "night" ? false : state === "above_horizon";
    const dir = isDay ? new Vector3(-0.4, -1, -0.6) : new Vector3(-0.2, -1, -0.2);
    // No real azimuth/altitude from the binary HA state — mirror the
    // lighting direction below the horizon (positive Y) for the sky at
    // night, same reasoning as the unclamped skyDir above.
    const skyDir = isDay ? dir : new Vector3(-0.2, 1, -0.2);
    this.applyDayNight(isDay, dir.normalize(), isDay ? 0 : 1, skyDir.normalize());
  }

  private applyDayNight(
    isDay: boolean, dir: Vector3, nightT: number = isDay ? 0 : 1, skyDir: Vector3 = dir,
  ): void {
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
    // • Dual-atlas / lightmap GLB (pipeline ≥2.1.0): the structure crossfades
    //   (or hard-swaps) between its day and sun-free night bakes, so night is
    //   ALREADY dark from the atlas. But that darkness is fixed — nothing the
    //   "Night dimming" slider does reaches the baked structure, because its
    //   IBL/hemi/sun are all zeroed or replaced by the flat lightmap fill. So
    //   the slider only ever changed the ENTITY meshes (lamps), which read as
    //   "night dimming only affects the bulbs/windows". Apply nightDimming to
    //   the scene EXPOSURE here too so it dims the whole night scene, structure
    //   included: nd=0 leaves the night atlas exactly as baked (the long-
    //   standing look), higher nd deepens it toward `min`.
    // • Single-atlas GLB: the texture is a fixed daytime render, so the only
    //   way to sell "night" is post-processing — scale the user's exposure down
    //   after dark, deepening with nightDimming.
    // Either way this runs AFTER renderFx.applyToneMapping wrote cfg.exposure
    // (all call paths order renderFx.apply() before the sun pass), so this
    // write is the final word on exposure.
    if (this.baked) {
      if (this.nightBlend) this.nightBlend(nightT);
      // nightBlend present → atlas already dark, so only ADD dimming (floor
      // 0.5); single-atlas → the full day→0.45 range sells night by itself.
      const nightExposure = this.nightBlend ? lerp(1, 0.5) : lerp(1, 0.45);
      this.scene.imageProcessingConfiguration.exposure =
        r.exposure * (isDay ? 1 : nightExposure);
    }
    // Window panes dim on the same twilight ramp (see the field's comment) —
    // in every mode, since no bake, lightmap or scene light drives them.
    this.glassDim?.(nightT);

    // Drive the procedural sky from the UNCLAMPED sun direction (it shows
    // through the windows) — see skyDir's comment in applyRealSun/
    // applyHaSunState for why this must not be the same floored `dir` used
    // for scene lighting. clearColor is kept as a fallback for when the sky
    // dome is absent.
    this.sky?.update(skyDir, isDay);
    // In overview mode bgOverride pins a calm dark backdrop; otherwise the empty
    // space tracks the day/night sky colour.
    this.scene.clearColor = this.bgOverride ?? (isDay
      ? new Color4(0.53, 0.67, 0.84, 1)
      : new Color4(0.03, 0.03, 0.05, 1));
    this.requestRender();
  }

}
