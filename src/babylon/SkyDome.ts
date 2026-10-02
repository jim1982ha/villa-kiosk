// src/babylon/SkyDome.ts
// A sun-driven procedural sky so the view through windows reads as real sky/outside
// instead of a flat clear colour. Uses Babylon's atmospheric SkyMaterial driven by
// the same sun direction that lights the scene (SunController), so it tracks the
// villa's latitude/longitude and the time of day: blue by day, warm at dusk, deep
// blue at night. No texture assets required (SweetHome's sky never exports to GLB).

import { wrapAngle } from "@/utils/geometry";
import {
  bodyFade, defaultSkyCamera, displayAltitude, displayAzimuth, framePosition, lift, liftFor, sunWarmth,
  type SkyCamera,
} from "./skyFraming";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { cameraFrame } from "./cameraFrame";
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
  /** The drawn BEARING, or null when the disc is not drawn at all. Null rather
   *  than a stale number because `drawn=` used to keep reporting the true
   *  altitude all night, which reads as a placement and is not one — an
   *  instrument must not answer a question it did not measure. */
  private drawn: number | null = null;

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

  /** Where the camera is looking, refreshed once per rendered frame — see
   *  trackCamera. The framing maths (skyFraming.ts) takes it as an argument;
   *  the moon (NightSky) is handed this same object, so both bodies are framed
   *  against one camera. */
  readonly camera: SkyCamera = defaultSkyCamera();

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
    const camAz = Math.atan2(this.fwd.x, this.fwd.z);
    // Both half-angles, from the one place that knows which of them this
    // camera holds fixed — see cameraFrame.ts.
    const { vHalf: halfFov, hHalf } = cameraFrame(this.scene, cam);
    // ~0.3°: below that nothing has moved a pixel, and re-placing would repaint
    // nothing while defeating the on-demand render.
    const c = this.camera;
    if (Math.abs(pitch - c.pitch) < 0.005
      && Math.abs(wrapAngle(camAz - c.camAz)) < 0.005
      && halfFov === c.halfFov && hHalf === c.hHalf) return;
    c.pitch = pitch;
    c.camAz = camAz;
    c.halfFov = halfFov;
    c.hHalf = hHalf;
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

    const drop = liftFor(this.dropUnits);
    const alt = Math.atan2(y, Math.hypot(x, z));
    // Fade on the TRUE altitude — see skyFraming.horizonFade. Below the horizon
    // the sun is simply gone, and the night sky takes over.
    const fade = bodyFade(x, y, z, drop, this.camera);
    // First person shows the material's own disc in a sky the viewer is
    // genuinely standing under, so the billboard would only ever be a second
    // sun beside the real one.
    const visible = drop > 0 && fade > 0;
    this.sunMat.alpha = fade;
    this.sunDisc.setEnabled(this.enabled && visible);
    this.drawn = null;
    if (!visible) return;

    this.drawnAlt = displayAltitude(alt, drop, this.camera);
    this.drawn = displayAzimuth(Math.atan2(x, z), this.camera);
    const d = lift(x, y, z, drop, this.camera);
    this.sunDisc.position = new Vector3(d.x, d.y, d.z).scale(SUN_DIST);

    const warmth = sunWarmth(alt);
    const key = warmth.toFixed(2);
    if (key !== this.sunKey) { this.sunKey = key; this.drawSun(warmth); }
  }

  /** Where the disc is DRAWN, in degrees, and the true altitude it came from —
   *  for the `sky` debug channel. A sun that cannot be seen is answered by
   *  comparing the drawn figure against the camera's own `sinTilt`. */
  sunReport(): {
    trueDeg: number; drawnDeg: number | null;
    alpha: number; frameX: number | null; frameY: number | null;
  } {
    const deg = (r: number) => (r * 180) / Math.PI;
    const trueDeg = deg(
      Math.atan2(-this.sunDir.y, Math.hypot(this.sunDir.x, this.sunDir.z)));
    // ⚠️ BOTH axes, because reporting only one is how a whole round was spent
    // on a disc that was perfectly placed vertically and off the side of the
    // screen: `frameY=0.21 discAlpha=1.00` with an empty sky in the recording.
    // 0 is the left/top edge, 1 the right/bottom, 0.5 dead centre — which is
    // where the camera's target, the villa, sits. Outside 0..1 is off screen.
    if (this.drawn === null) {
      return { trueDeg, drawnDeg: null, alpha: this.sunMat.alpha, frameX: null, frameY: null };
    }
    return {
      trueDeg,
      drawnDeg: deg(this.drawnAlt),
      alpha: this.sunMat.alpha,
      ...framePosition(this.drawnAlt, this.drawn, this.camera),
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
}
