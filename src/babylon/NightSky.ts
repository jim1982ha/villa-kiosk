// src/babylon/NightSky.ts
// The moon and the stars, for the night half of the day/night cycle.
//
// Both are PROCEDURAL — drawn into canvas textures at runtime, no image asset
// shipped or fetched — because the add-on's target is an iPad on a villa wall
// that may have no internet at all (see CLAUDE.md's second hard rule). A star
// PNG would work on a developer's desk and simply be missing on the wall.
//
// The moon's POSITION and PHASE are computed from date + latitude/longitude in
// utils/sunCalc, never read from Home Assistant. HA's Moon integration exposes
// exactly one entity, `sensor.moon_phase`, and it is an enum — eight phase
// names, no elevation, no azimuth, no illumination (verified against a live
// install). It cannot place a moon in a sky, it is opt-in, and it must never be
// a prerequisite for anything here.

import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

/** Distance from the camera, in world units. Inside the sky dome's 500 radius
 *  so it always reads as "in the sky", and far inside the 10000 default far
 *  plane so ordinary depth testing lets the villa occlude it. */
const MOON_DIST = 380;
const STAR_DIAMETER = 940;
/** Moon disc size in world units at MOON_DIST — about 1.7°, a little larger
 *  than the real 0.5° because a physically-sized moon is a barely visible dot
 *  on a phone and reads as a rendering artifact rather than as the moon. */
const MOON_SIZE = 11;
const MOON_TEX = 256;
const STAR_TEX_W = 2048;
const STAR_TEX_H = 1024;
const STAR_COUNT = 1400;

export interface MoonLook {
  /** Unit vector FROM the camera TOWARD the moon. */
  dir: Vector3;
  /** 0 = new, 1 = full. */
  fraction: number;
  /** Negative = waxing (lit on the right in the northern convention). */
  angle: number;
  /** Radians; tilt of the lit limb for this latitude and hour. */
  parallacticAngle: number;
  /** 0 by day → 1 at full night. Fades both moon and stars. */
  nightT: number;
}

export class NightSky {
  private moon: Mesh;
  private moonMat: StandardMaterial;
  private moonTex: DynamicTexture;
  private stars: Mesh;
  private starMat: StandardMaterial;
  private starTex: DynamicTexture;
  /** Last phase the texture was drawn for, so a per-minute update does not
   *  redraw an identical disc. The moon's lit fraction moves ~3% per hour, so
   *  a 1% band repaints a handful of times a night rather than 1440. */
  private drawnKey = "";

  constructor(scene: Scene) {
    // ── Stars ──────────────────────────────────────────────────────────────
    // Deliberately NOT the real sky for this latitude: the user asked for
    // "simple but nice", and a wrong-but-plausible starfield is honest as
    // decoration where a wrong-but-claimed-real one would not be.
    this.starTex = new DynamicTexture(
      "starTex", { width: STAR_TEX_W, height: STAR_TEX_H }, scene, false);
    this.drawStars();

    const starMat = new StandardMaterial("starMat", scene);
    starMat.emissiveTexture = this.starTex;
    starMat.disableLighting = true;
    starMat.diffuseColor = Color3.Black();
    starMat.specularColor = Color3.Black();
    starMat.backFaceCulling = false;   // viewed from inside
    // Additive: the black background contributes nothing, so the sky shows
    // through untouched and only the stars add light. `alpha` then scales the
    // source, which is what fades them in at dusk.
    starMat.alphaMode = Constants.ALPHA_ADD;
    starMat.alpha = 0;
    this.starMat = starMat;

    const stars = MeshBuilder.CreateSphere(
      "starDome", { diameter: STAR_DIAMETER, segments: 24 }, scene);
    stars.material = starMat;
    stars.infiniteDistance = true;     // pinned to the camera, like the sky dome
    stars.isPickable = false;
    stars.applyFog = false;
    stars.checkCollisions = false;
    stars.ignoreCameraMaxZ = true;
    this.stars = stars;

    // ── Moon ───────────────────────────────────────────────────────────────
    this.moonTex = new DynamicTexture(
      "moonTex", { width: MOON_TEX, height: MOON_TEX }, scene, true);
    this.moonTex.hasAlpha = true;

    const moonMat = new StandardMaterial("moonMat", scene);
    moonMat.emissiveTexture = this.moonTex;
    moonMat.opacityTexture = this.moonTex;
    moonMat.disableLighting = true;
    moonMat.diffuseColor = Color3.Black();
    moonMat.specularColor = Color3.Black();
    moonMat.backFaceCulling = false;
    moonMat.alpha = 0;
    this.moonMat = moonMat;

    const moon = MeshBuilder.CreatePlane("moon", { size: MOON_SIZE }, scene);
    moon.material = moonMat;
    // BILLBOARDMODE_ALL keeps the disc facing the camera from any angle — which
    // also means Babylon owns the mesh's rotation and this cannot be spun to
    // orient the crescent. The parallactic tilt is therefore baked into the
    // TEXTURE instead (see drawMoon), which sidesteps the conflict entirely.
    moon.billboardMode = Mesh.BILLBOARDMODE_ALL;
    moon.infiniteDistance = true;      // position is read as a camera offset
    moon.isPickable = false;
    moon.applyFog = false;
    moon.checkCollisions = false;
    this.moon = moon;

    this.setEnabled(false);
  }

  /**
   * Place and light the moon, and fade both it and the stars for the hour.
   *
   * Called from SunController on the same beat as the sun, so an unattended
   * kiosk walks the moon across the sky and through its phases on its own.
   */
  update(look: MoonLook): void {
    const night = Math.max(0, Math.min(1, look.nightT));
    this.starMat.alpha = night;
    // Below the horizon the moon is simply not visible — no need to fade it,
    // and fading would leave a disc hanging in the ground half of the dome.
    const up = look.dir.y;
    const visible = night > 0 && up > -0.02;
    // Ease the last few degrees so it does not pop in/out at the horizon.
    this.moonMat.alpha = visible ? night * Math.min(1, (up + 0.02) / 0.08) : 0;
    this.moon.setEnabled(visible);
    this.stars.setEnabled(night > 0);
    if (!visible) return;

    this.moon.position = look.dir.scale(MOON_DIST);

    // Redraw only when the disc would actually look different.
    const key = `${look.fraction.toFixed(2)}:${look.angle < 0 ? "w" : "n"}`
      + `:${look.parallacticAngle.toFixed(1)}`;
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.drawMoon(look.fraction, look.angle < 0, look.parallacticAngle);
    }
  }

  /**
   * Draw the lit part of the disc.
   *
   * The terminator is an ELLIPSE, not a circle: the moon is a sphere lit from
   * the side, so the boundary is the projection of a great circle and its
   * half-width is `R·|1 − 2·lit|`. The common "overlap two circles" shortcut is
   * right only for crescents and visibly wrong for a gibbous moon.
   *
   * The lit half is drawn on the right and the whole canvas is mirrored for a
   * waning moon, then rotated by the parallactic angle — which matters a great
   * deal at this villa's latitude, where the moon sits near the zenith and the
   * crescent reads as a "smile" rather than the vertical C of higher latitudes.
   * Getting that wrong looks like a bug rather than like astronomy.
   */
  private drawMoon(fraction: number, waxing: boolean, parallacticAngle: number): void {
    const ctx = this.moonTex.getContext() as CanvasRenderingContext2D;
    const S = MOON_TEX;
    const c = S / 2;
    const R = S * 0.42;                 // margin so the glow below has room
    const lit = Math.max(0, Math.min(1, fraction));

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(parallacticAngle);
    if (!waxing) ctx.scale(-1, 1);      // mirror: lit limb faces the other way

    // A soft halo, so the moon sits in the sky instead of being pasted onto it.
    const glow = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 1.35);
    glow.addColorStop(0, "rgba(214,226,255,0.28)");
    glow.addColorStop(1, "rgba(214,226,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#eef2ff";
    ctx.beginPath();
    // Lit limb: the right semicircle, top to bottom.
    ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
    // Terminator. Sweeping anticlockwise past π (the left side) ADDS the left
    // half, giving gibbous→full; sweeping clockwise back across the right side
    // SUBTRACTS, giving quarter→crescent→new. Hence the test on 0.5:
    //   lit 1.00 → b = R, anticlockwise → full disc
    //   lit 0.50 → b = 0        → the ellipse degenerates to a line: half disc
    //   lit 0.25 → b = R/2, clockwise → crescent
    //   lit 0.00 → b = R, clockwise → retraces the arc: nothing lit
    ctx.ellipse(0, 0, R * Math.abs(1 - 2 * lit), R, 0,
      Math.PI / 2, -Math.PI / 2, lit > 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    this.moonTex.update();
  }

  /** A plausible starfield on an equirectangular sphere. Directions are sampled
   *  uniformly and then converted to UV, rather than sampling UV directly,
   *  which would bunch every star around the poles. */
  private drawStars(): void {
    const ctx = this.starTex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, STAR_TEX_W, STAR_TEX_H);

    // Fixed seed: the sky is the same every night, as a real one is, and a
    // starfield that reshuffled on every reload would read as flicker.
    let seed = 0x2f6e2b1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let i = 0; i < STAR_COUNT; i++) {
      const z = rnd() * 2 - 1;                     // uniform on the sphere
      const lon = rnd() * Math.PI * 2;
      const u = lon / (Math.PI * 2) * STAR_TEX_W;
      const v = (Math.acos(z) / Math.PI) * STAR_TEX_H;
      // Mostly faint with a few bright ones — an even brightness reads as noise.
      const m = rnd();
      const bright = m * m * m;
      const r = 0.5 + bright * 1.6;
      const a = 0.25 + bright * 0.75;
      // A touch of colour on the brightest, as real stars have.
      const tint = rnd();
      const col = tint > 0.9 ? "190,210,255" : tint < 0.1 ? "255,225,200" : "255,255,255";
      ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(u, v, r, 0, Math.PI * 2);
      ctx.fill();
    }
    this.starTex.update();
  }

  setEnabled(on: boolean): void {
    this.moon.setEnabled(on && this.moonMat.alpha > 0);
    this.stars.setEnabled(on && this.starMat.alpha > 0);
  }

  dispose(): void {
    this.moon.dispose();
    this.moonMat.dispose();
    this.moonTex.dispose();
    this.stars.dispose();
    this.starMat.dispose();
    this.starTex.dispose();
  }
}
