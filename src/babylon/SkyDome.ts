// src/babylon/SkyDome.ts
// A sun-driven procedural sky so the view through windows reads as real sky/outside
// instead of a flat clear colour. Uses Babylon's atmospheric SkyMaterial driven by
// the same sun direction that lights the scene (SunController), so it tracks the
// villa's latitude/longitude and the time of day: blue by day, warm at dusk, deep
// blue at night. No texture assets required (SweetHome's sky never exports to GLB).

import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";

/** Distance from the camera, in world units. THE SAME AS NightSky's MOON_DIST
 *  on purpose — two bodies at two radii read as two different skies. */
const SUN_DIST = 380;
/** The billboard's full extent at SUN_DIST, halo included; the bright core is
 *  about a third of it (see drawSun). ~7° across, against the real sun's 0.5°,
 *  for the same reason the moon is oversized: a physically-sized disc is a dot
 *  on a phone and reads as a dead pixel rather than as the sun. */
const SUN_PLANE = 46;
const SUN_TEX = 256;

export class SkyDome {
  private box: Mesh;
  private mat: SkyMaterial;
  private sunDisc: Mesh;
  private sunMat: StandardMaterial;
  private sunTex: DynamicTexture;
  /** Last warmth the disc was painted for, so a per-minute sun update does not
   *  repaint an identical gradient. */
  private sunKey = "";
  /** Whether the sky as a whole is on — the disc is a part of it and must not
   *  come back on its own when the dome is off. */
  private enabled = true;
  /** Where the disc was last DRAWN, in radians. Reported on the `sky` debug
   *  channel: it is the one field that answers "why can't I see the sun". */
  private drawnAlt = 0;

  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
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

    // ── The sun disc, and why it is a MESH and not the material's own sun ────
    //
    // SkyMaterial draws a sun, but `sunPosition` is ONE input with TWO outputs:
    // where that disc lands AND what colour the whole sky is. The overview
    // camera's visible cone is entirely below the horizon (see BAND_MIN), so
    // inside SkyMaterial the two outputs are in direct conflict — an
    // above-horizon sun is out of frame (2.388.0, 2.392.0) and a below-horizon
    // one renders night at noon (2.394.0, reverted the same evening). Seven
    // releases were spent proving there is no third option.
    //
    // Splitting them dissolves the conflict rather than trading one wrong for
    // the other: `mat.sunPosition` keeps the TRUE direction, so the sky's
    // colour, gradient and twilight are physically honest, and the disc is a
    // separate billboard placed wherever the camera can actually see it —
    // exactly how NightSky has always drawn the moon.
    this.sunTex = new DynamicTexture(
      "sunTex", { width: SUN_TEX, height: SUN_TEX }, scene, true);
    this.sunTex.hasAlpha = true;

    const sunMat = new StandardMaterial("sunMat", scene);
    sunMat.emissiveTexture = this.sunTex;
    // Set so needAlphaBlending() is true and alphaMode below is honoured at
    // all; it is also what `alpha` scales for the sunrise/sunset fade.
    sunMat.opacityTexture = this.sunTex;
    sunMat.disableLighting = true;
    sunMat.diffuseColor = Color3.Black();
    sunMat.specularColor = Color3.Black();
    sunMat.backFaceCulling = false;
    // ADDITIVE, unlike the moon's ordinary blend, because a sun is a light
    // source: it must blow the sky out toward white rather than paint a warm
    // film over it. Alpha-blending a semi-transparent halo over a sky BRIGHTER
    // than the halo would darken it into a visible grey ring.
    sunMat.alphaMode = Constants.ALPHA_ADD;
    sunMat.alpha = 0;
    this.sunMat = sunMat;

    const sun = MeshBuilder.CreatePlane("sunDisc", { size: SUN_PLANE }, scene);
    sun.material = sunMat;
    sun.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sun.infiniteDistance = true;     // position is read as a camera offset
    sun.isPickable = false;
    sun.applyFog = false;
    sun.checkCollisions = false;
    // Its bounding box sits at the position, not at the camera it actually
    // follows, so frustum culling would drop it as soon as the camera moved far
    // enough from the origin — an invisible sun, which is the exact bug this
    // whole mesh exists to fix.
    sun.alwaysSelectAsActiveMesh = true;
    sun.setEnabled(false);
    this.sunDisc = sun;

    // The arc is framed against the camera, so it has to see the camera move.
    // onBeforeRenderObservable and not a timer: it fires exactly on the frames
    // that are actually drawn, which on an on-demand scene is precisely the set
    // of frames where the answer could have changed.
    scene.onBeforeRenderObservable.add(() => this.trackCamera());
  }

  /**
   * Paint the disc: a hot core in a soft halo, warming toward the horizon.
   *
   * PROCEDURAL, like the moon and the stars, because the add-on's target is an
   * iPad on a villa wall with no internet — a sun PNG would work on a
   * developer's desk and simply be missing on the wall.
   *
   * `warmth` runs 0 (high sun: white core, pale gold halo) to 1 (on the
   * horizon: orange core, deep amber halo). Redrawn only when it actually
   * changes — see sunKey.
   */
  private drawSun(warmth: number): void {
    const ctx = this.sunTex.getContext() as CanvasRenderingContext2D;
    const S = SUN_TEX;
    const c = S / 2;
    const w = Math.max(0, Math.min(1, warmth));
    // Channel ramps, not named colours, so the horizon shift is continuous.
    const g1 = Math.round(244 - 54 * w), b1 = Math.round(206 - 146 * w);
    const g2 = Math.round(208 - 58 * w), b2 = Math.round(126 - 66 * w);
    const g3 = Math.round(176 - 46 * w), b3 = Math.round(94 - 44 * w);

    ctx.clearRect(0, 0, S, S);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255,255,252,1)");
    g.addColorStop(0.17, `rgba(255,${g1},${b1},1)`);      // edge of the core
    g.addColorStop(0.32, `rgba(255,${g2},${b2},0.5)`);
    g.addColorStop(0.62, `rgba(255,${g3},${b3},0.14)`);
    g.addColorStop(1, `rgba(255,${g3},${b3},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    this.sunTex.update();
  }

  /**
   * Lift a direction's ELEVATION by `radians`, leaving its azimuth alone.
   *
   * Shared with NightSky so the sun and the moon are raised by one expression:
   * two copies of this drifting apart would put the two bodies in skies tilted
   * differently from each other, which is the kind of wrongness nobody can name
   * but everybody sees.
   */
  static lift(x: number, y: number, z: number, drop: number): Vector3 {
    const horiz = Math.hypot(x, z);
    if (horiz < 1e-6 || drop <= 0) return new Vector3(x, y, z);
    const alt = SkyDome.displayAltitude(Math.atan2(y, horiz), drop);
    const c = Math.cos(alt);
    return new Vector3((x / horiz) * c, Math.sin(alt), (z / horiz) * c);
  }

  /**
   * How opaque a body at TRUE altitude `alt` should be, so it sets and rises
   * rather than blinking out.
   *
   * ⚠️ TRUE altitude, never the drawn one. Until this existed NightSky tested
   * its own LIFTED `dir.y > -0.02`, which was survivable while the band was
   * positive and is fatal now that it is negative: every drawn altitude is
   * below the horizon, so the test would fail always and the moon would never
   * be drawn at all. The two questions are genuinely different — "has it set?"
   * is about the real sky, "where do I paint it?" is about this camera.
   */
  static horizonFade(alt: number): number {
    const t = (alt - SkyDome.SET_LOW) / (SkyDome.SET_HIGH - SkyDome.SET_LOW);
    return Math.max(0, Math.min(1, t));
  }

  private static readonly SET_LOW = (-1 * Math.PI) / 180;
  private static readonly SET_HIGH = (3 * Math.PI) / 180;

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
  private static displayAltitude(alt: number, drop: number): number {
    if (drop <= 0) return alt;
    const t = Math.max(0, Math.min(1, alt / (Math.PI / 2)));
    const frac = SkyDome.BAND_LOW + (SkyDome.BAND_HIGH - SkyDome.BAND_LOW) * t;
    return -SkyDome.pitch + SkyDome.halfFov * frac;
  }

  /** Where the camera is looking, refreshed once per rendered frame — see
   *  trackCamera. `pitch` is radians BELOW horizontal (positive); `halfFov` is
   *  half the vertical field of view, the unit the band is expressed in. */
  private static pitch = 0;
  private static halfFov = 0.4;

  /**
   * Follow the camera, because the arc is drawn in the FRAME and not in the sky.
   *
   * Cheap enough to run per rendered frame — two trig calls and an early-out on
   * a pitch that has not moved — and this scene renders on demand, so it costs
   * nothing at all while the camera is still.
   */
  private trackCamera(): void {
    const cam = this.scene.activeCamera;
    if (!cam || this.dropUnits <= 0) return;
    cam.getDirectionToRef(SkyDome.FORWARD, this.fwd);
    const pitch = Math.atan2(-this.fwd.y, Math.hypot(this.fwd.x, this.fwd.z));
    const halfFov = cam.fov / 2;
    // ~0.3°: below that the disc has not moved a pixel, and re-placing it would
    // repaint nothing while defeating the on-demand render.
    if (Math.abs(pitch - SkyDome.pitch) < 0.005 && halfFov === SkyDome.halfFov) return;
    SkyDome.pitch = pitch;
    SkyDome.halfFov = halfFov;
    this.placeSun();
    this.onFraming?.();
  }

  private readonly fwd = new Vector3(0, 0, 1);
  private static readonly FORWARD = new Vector3(0, 0, 1);
  private onFraming: (() => void) | null = null;

  /** Called after the framing moved, so the moon can be re-placed by the same
   *  rule in the same frame. Wired by SceneManager rather than by a second
   *  observer inside NightSky, which would race this one for ordering. */
  setFramingHook(fn: () => void): void {
    this.onFraming = fn;
  }

  /**
   * Where the arc sits IN THE FRAME, as a fraction of the half field of view
   * above the camera's own forward ray: 0 is dead centre, 1 the top edge.
   *
   * ⚠️ THE UNIT IS THE FRAME, NOT THE SKY, and 2.396.0 is why. That release put
   * the arc at a fixed WORLD elevation, computed against the overview's DEFAULT
   * pitch of 61.4° — correct there, and wrong everywhere else, because the pitch
   * is a control the user holds. `beta` clamps to 0.05..1.4 rad, so the camera
   * looks anywhere between 10° and 87° below horizontal, and with a vertical fov
   * of 0.8 rad (±22.9°) the visible cone travels with it: -84°..-38° at the
   * default, -62°..-16° at the pitch the sun was reported low from
   * (`sinTilt=0.634`), -33°..+13° at the shallow limit. Those do not intersect.
   * NO fixed elevation can be well framed at every tilt, so a fixed one always
   * had a range of poses where it sat on the villa or fell off an edge —
   * reported as "the sun appears but below the villa".
   *
   * Measuring from the camera's forward ray removes the whole problem by
   * construction: 0.35 and 0.85 land the disc between 33% and 15% of the way
   * down the frame at EVERY tilt, always above the villa (which the camera
   * targets, so it sits at the centre), and the sun climbs across the day as it
   * should. Azimuth is still untouched, so east/west and the live arc are what
   * they always were and still validate northOffsetDeg.
   *
   * This is openly a diagram — the same licence displayAltitude has always had,
   * now spent on the axis that was actually causing trouble.
   */
  private static readonly BAND_LOW = 0.35;
  /** Where a sun directly overhead is drawn. BAND_LOW and this are the whole
   *  tuning surface if the arc wants to sit higher or flatter. */
  private static readonly BAND_HIGH = 0.85;

  /**
   * The angle, in radians, that a given horizon drop rotated the sky by — and
   * therefore the angle bodies must be moved DOWN by to stay in it. 0 in first
   * person, where the true sky is what the viewer is standing under and must
   * not be redrawn at all.
   *
   * The name survives from when this returned a 0/1 strength; it is now the
   * drop itself, so `displayAltitude` cannot disagree with `setHorizonDrop`
   * about how far the horizon moved.
   */
  static liftFor(units: number): number {
    return units > 0 ? Math.atan(units / SkyDome.RADIUS) : 0;
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
    const x = -this.sunDir.x, y = -this.sunDir.y, z = -this.sunDir.z;

    // ⚠️ THE MATERIAL GETS THE TRUE DIRECTION, always, in every view. It is
    // what tells SkyMaterial whether it is day, so any adjustment here is a
    // lie about the hour — a below-horizon value renders night at noon
    // (2.394.0). Where the disc is DRAWN is the billboard's business now, and
    // the two questions stopped being one input the moment it existed.
    this.mat.sunPosition = new Vector3(x, y, z).scale(300);

    const drop = SkyDome.liftFor(this.dropUnits);
    const alt = Math.atan2(y, Math.hypot(x, z));
    // Fade on the TRUE altitude — see horizonFade. Below the horizon the sun is
    // simply gone, and the night sky takes over.
    const fade = SkyDome.horizonFade(alt);
    // First person shows the material's own disc in a sky the viewer is
    // genuinely standing under, so the billboard would only ever be a second
    // sun beside the real one.
    const visible = drop > 0 && fade > 0;
    this.sunMat.alpha = fade;
    this.sunDisc.setEnabled(this.enabled && visible);
    this.drawnAlt = alt;
    if (!visible) return;

    this.drawnAlt = SkyDome.displayAltitude(alt, drop);
    this.sunDisc.position = SkyDome.lift(x, y, z, drop).scale(SUN_DIST);

    // Warm the disc as it nears the horizon, over the last 25° — the same
    // reddening the sky itself is doing behind it, so the two agree.
    const warmth = Math.max(0, 1 - alt / ((25 * Math.PI) / 180));
    const key = warmth.toFixed(2);
    if (key !== this.sunKey) { this.sunKey = key; this.drawSun(warmth); }
  }

  /** Where the disc is DRAWN, in degrees, and the true altitude it came from —
   *  for the `sky` debug channel. A sun that cannot be seen is answered by
   *  comparing the drawn figure against the camera's own `sinTilt`. */
  sunReport(): { trueDeg: number; drawnDeg: number; alpha: number; frameY: number } {
    const deg = (r: number) => (r * 180) / Math.PI;
    // Where the disc lands DOWN the frame: 0 the top edge, 1 the bottom, 0.5
    // dead centre (which is where the camera's target — the villa — sits). This
    // is the field that answers "the sun is in the wrong place" without anyone
    // re-deriving the projection: outside 0..1 it is off screen, and near 1 it
    // is under the villa, which is exactly what 2.396.0 was reported for.
    const above = this.drawnAlt + SkyDome.pitch;
    const frameY = 0.5 - 0.5 * (Math.tan(above) / Math.tan(SkyDome.halfFov));
    return {
      trueDeg: deg(Math.atan2(-this.sunDir.y, Math.hypot(this.sunDir.x, this.sunDir.z))),
      drawnDeg: deg(this.drawnAlt),
      alpha: this.sunMat.alpha,
      frameY,
    };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.box.setEnabled(on);
    // Never turned on FROM here — placeSun owns whether the sun is up at all,
    // and re-enabling a set sun would hang a disc in the night sky.
    if (!on) this.sunDisc.setEnabled(false);
    else this.placeSun();
  }

  dispose(): void {
    this.box.dispose();
    this.mat.dispose();
    this.sunDisc.dispose();
    this.sunMat.dispose();
    this.sunTex.dispose();
  }

  // Kept for callers that want a quick neutral tint reference (unused internally).
  static readonly NIGHT_TINT = new Color3(0.03, 0.04, 0.08);
}
