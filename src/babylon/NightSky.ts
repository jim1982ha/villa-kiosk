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
import { SkyDome } from "./SkyDome";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";

/** Distance from the camera, in world units. Inside the sky dome's 500 radius
 *  so it always reads as "in the sky", and far inside the 10000 default far
 *  plane so ordinary depth testing lets the villa occlude it. */
const MOON_DIST = 380;
const STAR_RADIUS = 470;
/** Moon disc size in world units at MOON_DIST — about 1.7°, a little larger
 *  than the real 0.5° because a physically-sized moon is a barely visible dot
 *  on a phone and reads as a rendering artifact rather than as the moon. */
const MOON_SIZE = 11;
const MOON_TEX = 256;
// Two layers instead of per-star brightness: a large faint field plus a small
// bright one. Cheaper and more legible than modulating one field, and it is
// what actually makes a sky read as stars rather than as noise.
const STAR_DIM_COUNT = 1600;
const STAR_BRIGHT_COUNT = 220;

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
  /** The sky's horizon drop as an angle, mirrored onto the moon. */
  private lift = 0;
  private starLayers: { mesh: Mesh; mat: StandardMaterial; peak: number }[] = [];
  /** Last phase the texture was drawn for, so a per-minute update does not
   *  redraw an identical disc. The moon's lit fraction moves ~3% per hour, so
   *  a 1% band repaints a handful of times a night rather than 1440. */
  private drawnKey = "";

  constructor(scene: Scene) {
    // ── Stars ──────────────────────────────────────────────────────────────
    // GL POINTS, not a textured sphere — and that is the whole fix (2.228.0).
    //
    // The first attempt painted stars into a 2048x1024 texture on a sphere seen
    // from the inside. At a ~50 degree field of view you only ever see about
    // (50/360)*2048 = 284 texels stretched across ~2000 screen pixels, so every
    // dot was magnified ~7x into a soft white orb — reported as "weird white
    // orbs", which is exactly what it was. No sane texture size fixes that: the
    // sphere would need to be ~14000px wide.
    //
    // A point cloud sidesteps magnification entirely, because gl_PointSize is
    // in SCREEN pixels: a star is 1 or 2 px however near the dome is. That is
    // also how a star actually behaves — a point source with no angular size.
    //
    // Deliberately NOT the real sky for this latitude. "Simple but nice" was
    // the ask, and an invented field is honest decoration where one claimed to
    // be real would not be.
    this.starLayers.push(this.buildStarLayer(scene, "starsDim", STAR_DIM_COUNT, 2, 0.55, 0x2f6e2b1));
    this.starLayers.push(this.buildStarLayer(scene, "starsBright", STAR_BRIGHT_COUNT, 3.5, 1, 0x9e3779b));

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
    // Same reason the star layers set this: the bounding box sits at the moon's
    // position, not at the camera it actually follows, so frustum culling would
    // drop it once the camera moved far enough from the origin.
    moon.alwaysSelectAsActiveMesh = true;
    this.moon = moon;

    this.setEnabled(false);
  }

  /**
   * Place and light the moon, and fade both it and the stars for the hour.
   *
   * Called from SunController on the same beat as the sun, so an unattended
   * kiosk walks the moon across the sky and through its phases on its own.
   */
  /**
   * Match the overview's horizon drop, so the moon is lifted by exactly the
   * angle the sun and the sky gradient are — see SkyDome.setHorizonDrop. A moon
   * left at its true elevation while everything around it rises is the same
   * empty-sky bug 2.388.0 fixed for the sun, one body over.
   */
  setHorizonDrop(units: number): void {
    this.lift = SkyDome.liftFor(units);
  }

  /** The last look handed to update(), so the moon can be re-placed when the
   *  CAMERA moves rather than only when the sky clock ticks. The arc is framed
   *  against the camera now (SkyDome.BAND_LOW), so a tilt changes the answer. */
  private lastLook: MoonLook | null = null;

  /** Re-place from the stored look. Called by SkyDome's framing hook, so sun
   *  and moon are re-framed in the same frame by the same rule. */
  reframe(): void {
    if (this.lastLook) this.update(this.lastLook);
  }

  update(look: MoonLook): void {
    this.lastLook = look;
    const night = Math.max(0, Math.min(1, look.nightT));
    for (const l of this.starLayers) {
      l.mat.alpha = night * l.peak;
      l.mesh.setEnabled(night > 0);
    }
    // Below the horizon the moon is simply not visible — no need to fade it,
    // and fading would leave a disc hanging in the ground half of the dome.
    //
    // ⚠️ "Has it set?" is asked of the TRUE altitude, never of the lifted one
    // this same line computes. The overview's band is negative (see
    // SkyDome.BAND_MIN), so every DRAWN altitude is below the horizon: the old
    // test on `dir.y` would now be false always and the moon would never be
    // drawn at all. SkyDome.horizonFade owns the rule for both bodies.
    const dir = SkyDome.lift(look.dir.x, look.dir.y, look.dir.z, this.lift);
    const fade = SkyDome.horizonFade(
      Math.atan2(look.dir.y, Math.hypot(look.dir.x, look.dir.z)))
      // The same cover for the azimuth cut the sun gets — the moon rides the
      // identical dome, so it meets the identical seam directly behind you.
      * SkyDome.azimuthFade(look.dir.x, look.dir.z, this.lift);
    const visible = night > 0 && fade > 0;
    this.moonMat.alpha = visible ? night * fade : 0;
    this.moon.setEnabled(visible);
    if (!visible) return;

    this.moon.position = dir.scale(MOON_DIST);

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

  /**
   * One layer of the field. Directions are sampled UNIFORMLY on the sphere —
   * picking a latitude at random instead would bunch every star at the poles,
   * which reads immediately as a rendering grid rather than as a sky.
   *
   * `peak` is the layer's brightness ceiling, reached at full night; `size` is
   * in screen pixels. Two layers (many faint + a few bright at 2px) is what
   * makes this legible as stars, and is simpler than modulating one field by
   * vertex colour.
   *
   * The seed is fixed, so the sky is the same every night as a real one is —
   * a field that reshuffled on every reload would read as flicker.
   */
  private buildStarLayer(
    scene: Scene, name: string, count: number, size: number, peak: number, seed: number,
  ): { mesh: Mesh; mat: StandardMaterial; peak: number } {
    let st = seed >>> 0;
    const rnd = () => {
      st = (st * 1664525 + 1013904223) >>> 0;
      return st / 0x100000000;
    };

    const positions = new Float32Array(count * 3);
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      // Uniform on the sphere: z uniform in [-1,1], longitude uniform.
      const z = rnd() * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const lon = rnd() * Math.PI * 2;
      positions[i * 3] = Math.cos(lon) * r * STAR_RADIUS;
      positions[i * 3 + 1] = z * STAR_RADIUS;
      positions[i * 3 + 2] = Math.sin(lon) * r * STAR_RADIUS;
      indices.push(i);
    }

    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions as unknown as number[];
    vd.indices = indices;
    vd.applyToMesh(mesh);

    const mat = new StandardMaterial(`${name}Mat`, scene);
    // pointsCloud switches the fill mode to GL_POINTS; pointSize is in pixels.
    mat.pointsCloud = true;
    mat.pointSize = size;
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    // Additive, so stars add light to the sky rather than punching holes in it,
    // and `alpha` scales that contribution for the dusk fade.
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.alpha = 0;

    mesh.material = mat;
    mesh.infiniteDistance = true;   // pinned to the camera, like the sky dome
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.checkCollisions = false;
    mesh.ignoreCameraMaxZ = true;
    // Its bounding box is centred on the origin, not the camera it actually
    // follows, so frustum culling would drop it whenever the camera walked away.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);

    return { mesh, mat, peak };
  }

  setEnabled(on: boolean): void {
    this.moon.setEnabled(on && this.moonMat.alpha > 0);
    for (const l of this.starLayers) l.mesh.setEnabled(on && l.mat.alpha > 0);
  }

  dispose(): void {
    this.moon.dispose();
    this.moonMat.dispose();
    this.moonTex.dispose();
    for (const l of this.starLayers) { l.mesh.dispose(); l.mat.dispose(); }
  }
}
