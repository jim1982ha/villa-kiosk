// src/babylon/SunController.ts
// Drives scene lighting from either the real sun position (configured lat/lng) or the
// HA sun.sun entity state. Day -> bright blue sky; night -> warm indoor glow.

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { Scene } from "@babylonjs/core/scene";
import type { SkyDome } from "./SkyDome";
import { skyNow, skyTickMs, skySimActive, skySimLabel } from "@/utils/skyClock";
import { tapDebug } from "@/utils/tapDebug";
import { type AppConfig } from "@/config/AppConfig";
import { getSunPosition, getMoonPosition, getMoonIllumination } from "@/utils/sunCalc";
import type { NightSky } from "./NightSky";
import type { FrameRequests } from "./frameScheduler";
import type { SceneLook } from "./sceneLook";
import type { LightingMode } from "./lightingMode";
import { sunGeometry, sunLights } from "./sunState";
import { clockTime } from "@/utils/dateText";

export class SunController {
  /** The scene's sun — a directional light this controller alone drives.
   *  (LightingSystem, a 31-line class whose two setters each assigned one
   *  field for this one caller, was folded in here in 2.496.195.) */
  readonly sunLight: DirectionalLight;
  private readonly scene: Scene;
  private hemi: HemisphericLight;
  private sky: SkyDome | null;
  /** Only set when `?skySpeed` is running the sky fast — see startSkySim. */
  private simTimer: ReturnType<typeof setInterval> | null = null;
  private config: AppConfig;
  /** Repaints after a sun/sky change. A constructor argument rather than a
   *  setter with a no-op default: a sky that changed and silently drew
   *  nothing was that default's failure mode. */
  private frames: FrameRequests;
  /** The one writer of exposure, IBL strength and background — see sceneLook.ts. */
  private look: SceneLook;
  /** The model's structure renders unlit (lightingMode's structureUnlit). */
  private structureUnlit = false;
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
    hemi: HemisphericLight,
    config: AppConfig,
    sky: SkyDome | null,
    frames: FrameRequests,
    look: SceneLook,
  ) {
    this.frames = frames;
    this.look = look;
    this.scene = scene;
    this.sunLight = new DirectionalLight("sunLight", new Vector3(-0.4, -1, -0.6), scene);
    this.sunLight.intensity = 1.2;
    this.sunLight.diffuse = new Color3(1.0, 0.95, 0.8);
    this.sunLight.specular = new Color3(0.2, 0.2, 0.2);
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
      this.frames.repaint();
    }, every);
  }

  /** Stop the simulated-sky timer. Idempotent — SceneManager.dispose is the
   *  only caller and is itself guarded, but a stray interval outliving the
   *  scene would keep re-lighting a disposed one. */
  dispose(): void {
    if (this.simTimer !== null) { clearInterval(this.simTimer); this.simTimer = null; }
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
  setLightingMode(
    mode: LightingMode,
    nightBlend?: (t: number) => void,
    glassDim?: (t: number) => void,
  ): void {
    this.structureUnlit = mode.structureUnlit;
    this.nightBlend = nightBlend ?? null;
    this.glassDim = glassDim ?? null;
    this.look.setBaked(mode.structureUnlit, !!nightBlend);
    this.applyRealSun();
  }

  /**
   * Pin the scene background to a fixed colour (overview backdrop), or pass null
   * to release it and restore the live day/night sky colour. Lighting (sun, fill,
   * IBL) is unaffected — only the empty-space clearColor changes — so switching
   * views never relights the model.
   */
  setBackgroundOverride(color: Color4 | null): void {
    this.look.setBackdrop(color);
    if (color) {
      this.frames.repaint();
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
    return azimuth + (this.config.northOffsetDeg * Math.PI) / 180;
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
    // The sun's two directions (the light's floored at 0.05 so the room is
    // never lit edge-on after dark; the sky dome's UNCLAMPED, or its sun
    // hovered over the horizon all night) and the twilight ramp that fades
    // the night bake in over ~25 minutes: sunState.sunGeometry.
    const g = sunGeometry(altitude, azimuth);
    const isDay = g.isDay, nightT = g.nightT;
    const dir = new Vector3(...g.dir);
    const skyDir = new Vector3(...g.skyDir);

    this.applyDayNight(isDay, dir, nightT, skyDir);

    // ── The `sky` channel, reporting on EVERY pass ──────────────────────────
    // It used to emit one line at startup and only when a simulation was
    // running, so `?debug=sky` could not answer the two questions actually
    // asked of it — "why is it daytime at 04:00" (it was `preview=day`, a
    // Settings pin silently outranking ?skyTime) and "why can't I see the sun"
    // (compare `drawn` against the camera's own `sinTilt` on the `place` line).
    // A diagnostic that reports on one branch reports a blank that means "not
    // measured" rather than "did not happen".
    this.reportSky(date, realAltitude, altitude, azimuth, preview, nightT);

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

  /** Last line emitted, so a per-minute sun.sun event does not fill the panel
   *  with an unchanged sky. Rounded to whole degrees for the same reason. */
  private lastSkyLine = "";

  /**
   * One line naming everything that decides how the sky looks right now.
   *
   * `real` vs `alt` is the day/night PREVIEW pin: they differ only when
   * Settings is forcing a side of the horizon, which is what made a simulated
   * 04:00 render as bright noon with no stars and no moon.
   * `drawn` is where the sun DISC lands (skyFraming.placeBody); read it
   * against `sinTilt` on the `place` line to say whether it is in frame.
   */
  private reportSky(
    date: Date, real: number, alt: number, azimuth: number,
    preview: string, nightT: number,
  ): void {
    const deg = (r: number) => Math.round((r * 180) / Math.PI);
    const clock = clockTime(date);
    const line = `sky: ${clock}${skySimActive() ? " (sim)" : ""}`
      + ` alt=${deg(alt)}° real=${deg(real)}° az=${deg(azimuth)}°`
      + ` day=${alt > 0 ? "y" : "n"} nightT=${nightT.toFixed(2)} preview=${preview}`
      + (this.sky ? this.sky.sunReport() : " sky=off");
    if (line === this.lastSkyLine) return;
    this.lastSkyLine = line;
    tapDebug(line, "sky");
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
    // Report from here too — this branch never reaches applyRealSun, and a
    // channel that goes quiet on one path reads as "nothing happened" when it
    // means "not measured". `real` is the synthetic altitude, which is the
    // point: it says the position is made up because lat/lng are unset.
    const synth = Math.asin(Math.max(-1, Math.min(1, skyDir.normalize().y)));
    this.reportSky(skyNow(), synth, synth, 0, `${preview}/ha-only`, isDay ? 0 : 1);
  }

  private applyDayNight(
    isDay: boolean, dir: Vector3, nightT: number = isDay ? 0 : 1, skyDir: Vector3 = dir,
  ): void {
    // Render-quality multipliers let Settings rebalance the key light + fill
    // without touching the day/night base values here.
    const r = this.config.render;

    // Key, ambient and fill for day or for Settings' night dimming — warm at
    // night (the "blue kitchen" and "dead grey" history is in sunState).
    const L = sunLights(isDay, r);
    this.sunLight.direction = dir;
    this.sunLight.intensity = L.sunIntensity;
    this.sunLight.diffuse = new Color3(...L.sunColor);
    this.scene.ambientColor = new Color3(...L.ambient);
    this.hemi.intensity = L.hemiIntensity;
    this.hemi.diffuse = new Color3(...L.hemiDiffuse);
    this.hemi.groundColor = new Color3(...L.hemiGround);

    // The IBL gradient cube is a fixed *daytime* sky (blue zenith, grey horizon).
    // Left at full strength it dumps a cold blue-grey ambient onto every wall at
    // night — another source of the grey look. Scale its contribution down after
    // dark. (renderFx owns whether the texture exists; we own how much it counts.)
    // (renderFx owns whether the texture exists; the look owns how much it
    // counts at night — see resolveLook.)
    this.look.setDay(isDay);

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
    // The exposure itself is resolveLook's (sceneLook.ts), from the day/night
    // and baked inputs reported here — it no longer depends on this pass
    // running after renderFx.
    if (this.structureUnlit) {
      if (this.nightBlend) this.nightBlend(nightT);
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
    this.frames.repaint();
  }

}
