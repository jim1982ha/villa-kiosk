// src/babylon/SkyDome.ts
// A sun-driven procedural sky so the view through windows reads as real sky/outside
// instead of a flat clear colour. Uses Babylon's atmospheric SkyMaterial driven by
// the same sun direction that lights the scene (SunController), so it tracks the
// villa's latitude/longitude and the time of day: blue by day, warm at dusk, deep
// blue at night. No texture assets required (SweetHome's sky never exports to GLB).

import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";

export class SkyDome {
  private box: Mesh;
  private mat: SkyMaterial;

  constructor(scene: Scene) {
    const mat = new SkyMaterial("skyMaterial", scene);
    mat.backFaceCulling = false;     // we view it from the inside
    mat.useSunPosition = true;       // drive the sun from SunController, not inclination
    // High turbidity is what made the horizon read as an ugly grey/white haze band
    // (thick atmosphere scatters out the blue toward the horizon). Drop it for a
    // clean blue zenith that fades to a soft, light-blue horizon — no grey murk.
    mat.turbidity = 2;               // low haze → crisp sky, gentle horizon
    mat.rayleigh = 1.2;              // blue scattering; lower keeps it from over-saturating
    mat.mieCoefficient = 0.0035;     // less white sun-haze around the horizon
    mat.mieDirectionalG = 0.85;
    // luminance 1.0 + filmic tone mapping pushed the whole dome toward white —
    // the "white background" report. Holding it lower keeps a believable blue
    // zenith that tone mapping doesn't blow out, while windows still read bright.
    mat.luminance = 0.7;
    this.mat = mat;

    // A SPHERE, not a box, and the difference is load-bearing (2.226.0).
    //
    // The sky shader takes its direction as
    //   normalize(vPositionW - cameraPosition + cameraOffset)
    // and adds the offset BEFORE normalising, to a vector that is not unit
    // length. On a cube that vector runs from 500 at the centre of a face to
    // 500*sqrt(3) ~= 866 at a corner, so a constant offset bends the direction
    // by a different ANGLE depending on where you look — about 22 degrees at a
    // face centre against 13 at a corner. The horizon shift went non-uniform
    // and the cube's own faces and corners appeared as straight bright edges
    // and a square halo around the sun, reported from the overview.
    //
    // On a sphere pinned to the camera that distance is the radius everywhere,
    // so the same offset is the same angle in every direction and no seam can
    // exist. It costs nothing here: this mesh is drawn once, its triangle count
    // is irrelevant next to the villa's 2.5M, and with cameraOffset at 0 (first
    // person) the two shapes were always mathematically identical — magnitude
    // cancels in normalize(), which is why only the overview ever showed this.
    const box = MeshBuilder.CreateSphere(
      "skyBox", { diameter: 1000, segments: 32 }, scene);
    box.material = mat;
    box.infiniteDistance = true;     // always centred on the active camera
    box.isPickable = false;
    box.applyFog = false;
    box.checkCollisions = false;
    box.ignoreCameraMaxZ = true;     // never clipped by the camera far plane
    this.box = box;
  }

  /**
   * Lift a direction's ELEVATION by `radians`, leaving its azimuth alone.
   *
   * Shared with NightSky so the sun and the moon are raised by one expression:
   * two copies of this drifting apart would put the two bodies in skies tilted
   * differently from each other, which is the kind of wrongness nobody can name
   * but everybody sees.
   */
  static lift(x: number, y: number, z: number, strength: number): Vector3 {
    const horiz = Math.hypot(x, z);
    if (horiz < 1e-6 || strength === 0) return new Vector3(x, y, z);
    const alt = SkyDome.displayAltitude(Math.atan2(y, horiz), strength);
    const c = Math.cos(alt);
    return new Vector3((x / horiz) * c, Math.sin(alt), (z / horiz) * c);
  }

  /**
   * Map a body's TRUE altitude onto one the overview camera can actually show.
   *
   * ⚠️ This is a diagram, not a photograph, and only in overview. A camera
   * looking DOWN at a villa cannot contain an overhead sun: at local noon the
   * real altitude is ~85°, which is behind the viewer, and the fixed 54° lift
   * 2.388.0 used only pushed it further behind. The whole 0-90° range has to be
   * squeezed into a band that sits in the upper part of the frame, or the sun
   * is visible at dawn and dusk and missing in the middle of the day — which is
   * precisely when a sun is most expected.
   *
   * AZIMUTH IS NOT TOUCHED, here or anywhere else. East at dawn, west at dusk
   * and the live arc between them are the whole point of 2.385.0's revert; only
   * how HIGH the body is drawn is rescaled, so the path still reads as the time
   * of day and still validates the villa's north offset.
   *
   * Below the horizon the compression FADES OUT over the twilight band, so a
   * setting body sinks to its true position and genuinely disappears. Without
   * that fade the lift would hold it up all night: a sun at -40° would still be
   * drawn above the horizon, which is worse than never showing it at all.
   */
  private static displayAltitude(alt: number, strength: number): number {
    if (alt <= 0) return alt;
    // NOTE the band is negative (see BAND_MIN): `base` moves the body DOWN into
    // the visible cone rather than up out of it, and the eased term still grows
    // with altitude, so noon is the highest point of the arc as it should be.
    // Ease the lift in over the first few degrees so sunrise and sunset are
    // continuous — a body popping from the horizon to BASE the instant it
    // crosses zero would read as a glitch, not a dawn.
    const ease = Math.min(1, alt / SkyDome.FADE);
    const base = SkyDome.BAND_MIN * ease * strength;
    return base + alt * (SkyDome.BAND_SPAN / (Math.PI / 2)) * strength;
  }

  /**
   * Where a just-risen body is DRAWN, and it is NEGATIVE on purpose.
   *
   * ⚠️ Measured, not guessed. A `?debug` capture of the overview reports
   * `sinTilt=0.882` — the camera is pitched about 62° BELOW horizontal, and
   * with a ~45° vertical field of view the visible cone runs roughly -84° to
   * -40°. The horizon is off the top of the screen, so NOTHING at a positive
   * elevation can be in frame at all. 2.392.0's band of +14°..+40° put the sun
   * some 78° above the top edge, which is why six releases of sky work were
   * invisible.
   *
   * Drawing the sun below the horizon is only strange if the horizon is
   * visible; here it is not, and the alternative is a sky nobody ever sees.
   */
  private static readonly BAND_MIN = (-58 * Math.PI) / 180;
  /** How much higher noon is drawn than sunrise. BAND_MIN + this is where a
   *  noon sun lands (-42°), comfortably inside the visible cone. These two are
   *  the whole tuning surface if the arc wants to sit higher or flatter. */
  private static readonly BAND_SPAN = (16 * Math.PI) / 180;
  /** Altitude over which the lift eases in, so dawn and dusk are continuous. */
  private static readonly FADE = (6 * Math.PI) / 180;

  /** How strongly to compress, for a given horizon drop: 1 in the overview,
   *  0 in first person, where the true sky is what the viewer is standing
   *  under and must not be redrawn. */
  static liftFor(units: number): number {
    return units > 0 ? 1 : 0;
  }

  /** The dome's radius, and the denominator setHorizonDrop's angle is measured
   *  against — one constant so the two cannot drift apart. */
  static readonly RADIUS = 500;
  /** Last direction handed to update(), so a horizon-drop change can re-place
   *  the sun without waiting for the next astronomical tick. */
  private readonly sunDir = new Vector3(0, -1, 0);
  private dropUnits = 0;

  /**
   * Update the sky from the scene's sun. `dirToScene` is the direction the sunlight
   * travels (sun → scene), exactly as SunController computes it, so the sun in the
   * sky sits opposite that direction.
   */
  update(dirToScene: Vector3, isDay: boolean): void {
    this.sunDir.copyFrom(dirToScene);
    this.placeSun();
    // Night: drop the luminance hard so the dome reads as a deep night sky rather
    // than a glowing daytime dome, and lift turbidity slightly so the little light
    // that remains pools softly at the horizon instead of leaving a harsh edge.
    // SkyMaterial already darkens once the sun is below the horizon; this finishes
    // the look so dusk/indoors don't glare. Day uses the crisp low-haze values.
    this.mat.luminance = isDay ? 0.7 : 0.18;
    this.mat.turbidity = isDay ? 2 : 4;
  }

  /**
   * Push the horizon DOWN in the view, so the graded band and the sun stay on
   * screen at a steeper downward tilt than they otherwise would.
   *
   * ── Why this is a material setting and not a transform (2.224.0) ──────────
   * The obvious instinct — move the dome, scale it, re-anchor it nearer the
   * villa — cannot work, and it is worth writing down so nobody tries. The sky
   * shader takes its direction as `normalize(vPositionW - cameraPosition)`, and
   * the shaded point always lies ALONG the ray through that pixel. Any convex
   * shape enclosing the camera therefore yields the identical direction per
   * pixel: the dome's position, size and scale are all invisible to the result.
   * "Bring the sun closer" is not something geometry can express here.
   *
   * What CAN move it is SkyMaterial's `cameraOffset`, which the shader adds to
   * that vector before taking the zenith angle — and only for the zenith angle.
   * A positive Y makes downward rays read as less-downward, so directions that
   * previously fell below the horizon (and clamped to the flat slab of colour
   * seen under the villa in overview) now sample the real gradient instead.
   * Crucially the sun disc is computed from the UN-offset direction, so it
   * keeps its true position and stays perfectly round — the horizon slides
   * down past it rather than the sun being squashed or dragged along.
   *
   * Units are world units against the dome's RADIUS (500), not degrees, because
   * the vector is not normalised before the offset is added — so the angle this
   * buys is `atan(units / 500)`, and 200 is about 22°. That arithmetic only
   * holds because the dome is a sphere: on the box this started as, the same
   * offset bent corners and face centres by different amounts and printed the
   * cube's edges across the sky. See the constructor.
   */
  setHorizonDrop(units: number): void {
    this.mat.cameraOffset.y = units;
    this.dropUnits = units;
    this.placeSun();
  }

  /**
   * Put the sun disc in the sky, LIFTED BY THE SAME ANGLE THE HORIZON WAS
   * DROPPED.
   *
   * Until 2.388.0 this was one line — `sunPosition = dirToScene.scale(-300)` —
   * and setHorizonDrop's own docstring called it a feature that the disc used
   * the UN-offset direction: "the horizon slides down past it rather than the
   * sun being dragged along". That is right for a sun already on screen and
   * wrong for the overview, where the drop exists precisely BECAUSE the camera
   * looks down and the real sky is out of frame. The gradient came into view
   * and the sun was left behind it, so the colour changed all day over an empty
   * blue field — reported as exactly that.
   *
   * Lifting by `atan(drop / RADIUS)` is the one value that cannot be argued
   * with: it is the same rotation setHorizonDrop applies to the horizon, so the
   * sun keeps its position RELATIVE TO THE SKY IT BELONGS TO. Nothing else is
   * touched — in particular the AZIMUTH is untouched, so the sun still rises in
   * the east, sets in the west and tracks live across the day, which is the
   * whole point of 2.385.0's revert. First person passes 0 and gets the true
   * elevation back with no special case.
   */
  private placeSun(): void {
    // The sun is opposite the direction its light travels.
    this.mat.sunPosition = SkyDome.lift(
      -this.sunDir.x, -this.sunDir.y, -this.sunDir.z,
      SkyDome.liftFor(this.dropUnits),
    ).scale(300);
  }

  setEnabled(on: boolean): void {
    this.box.setEnabled(on);
  }

  dispose(): void {
    this.box.dispose();
    this.mat.dispose();
  }

  // Kept for callers that want a quick neutral tint reference (unused internally).
  static readonly NIGHT_TINT = new Color3(0.03, 0.04, 0.08);
}
