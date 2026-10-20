// src/babylon/SkyDome.ts
// A sun-driven procedural sky so the view through windows reads as real sky/outside
// instead of a flat clear colour. Uses Babylon's atmospheric SkyMaterial driven by
// the same sun direction that lights the scene (SunController), so it tracks the
// villa's latitude/longitude and the time of day: blue by day, warm at dusk, deep
// blue at night. No texture assets required (SweetHome's sky never exports to GLB).

import { placeMoon, type Vec3 } from "./skyBodies";
import type { MoonNow, SkyMoment } from "./skyMoment";
import type { NightSky } from "./NightSky";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";
import "./skyShader";   // the material's own sun is off in the overview (no sun is drawn there: skyBodies)

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
    mat.sunPosition = new Vector3(0, 300, 0);   // overhead until the first moment
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

  /** The moon and the stars' painter — optional to the sky. */
  private moon: NightSky | null = null;

  /** The moon and the stars, painted from here — the moon placed
   *  (skyBodies.placeMoon) whenever the hour or the drop changes. This is the
   *  ONE owner of the moon's state: the moment and the drop.
   *
   *  ⚠️ THE DROP WAS HANDED TO EACH BODY SEPARATELY (until 2.496.297): the moon
   *  stayed where the overview had put it until the next sky-clock tick. */
  setMoon(moon: NightSky): void {
    this.moon = moon;
    if (this.moonNow) moon.setNight(this.nightT);
    this.place();
  }

  /** Where the moon really is and its night fade (skyMoment), kept so a drop
   *  change re-places it without waiting for the next astronomical tick. */
  private now: { moon: Vec3 | null; moonT: number } = { moon: null, moonT: 0 };
  /** The moon's phase, null until a moment brings one. */
  private moonNow: MoonNow | null = null;
  /** The stars' night fade, by Settings' preview. */
  private nightT = 0;
  private dropUnits = 0;

  /**
   * Update the sky for a moment (skyMoment): the sky's colour from the
   * PREVIEW sun, the moon from the REAL one, the stars
   * from the preview's night. A moment without a moon (no coordinates) leaves
   * the moon and the stars as they were.
   */
  update(m: SkyMoment): void {
    // ⚠️ THE MATERIAL GETS THE SKY'S SUN, always, in every view. It is what
    // tells SkyMaterial whether it is day, so any adjustment here is a lie
    // about the hour — a below-horizon value renders night at noon (2.394.0).
    this.mat.sunPosition = new Vector3(m.skySun.x, m.skySun.y, m.skySun.z).scale(300);
    if (m.moon) {
      this.moonNow = m.moon;
      this.nightT = m.light.nightT;
      this.moon?.setNight(m.light.nightT);
    }
    this.now = { moon: this.moonNow ? this.moonNow.dir : null, moonT: m.moon ? m.moonT : this.now.moonT };
    this.place();
    const isDay = m.light.isDay;
    // Night: drop the luminance hard so the dome reads as a deep night sky rather
    // than a glowing daytime dome, and lift turbidity slightly so the little light
    // that remains pools softly at the horizon instead of leaving a harsh edge.
    // SkyMaterial already darkens once the sun is below the horizon; this finishes
    // the look so dusk/indoors don't glare. Day uses the crisp low-haze values.
    this.mat.luminance = isDay ? 0.7 : 0.18;
    this.mat.turbidity = isDay ? 2 : 4;
  }

  /**
   * Push the horizon DOWN in the view, so the graded band stays on screen at a
   * steeper downward tilt than it otherwise would.
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
   * (The material's own sun disc, computed from the UN-offset direction, is
   * switched off whenever the offset is on: skyShader.)
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
    this.place();
  }

  /**
   * Place the moon (skyBodies.placeMoon) and hand it to NightSky. In the
   * overview no body is drawn (owner, 2026-10-20); walking, the material draws
   * the real sun and the moon is in its true direction.
   */
  private place(): void {
    if (this.moon && this.moonNow) this.moon.paintMoon(placeMoon(this.now.moon, this.now.moonT, this.dropUnits > 0), this.moonNow);
  }

  setEnabled(on: boolean): void {
    this.box.setEnabled(on);
  }

  dispose(): void {
    this.box.dispose();
    this.mat.dispose();
  }
}

