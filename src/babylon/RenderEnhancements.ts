// src/babylon/RenderEnhancements.ts
// Owns the optional, runtime-tunable render-quality stack so each effect can be
// toggled and tuned independently from Settings → Render quality (and persisted
// in AppConfig.render). Nothing here is load-bearing for the base scene: with
// every effect off the result is the original flat look, so it is safe to A/B.
//
// Effects, in the order they fight the "too bright / no contrast" problem:
//   1. Tone mapping + exposure/contrast  — rolls off blown-out white highlights.
//   2. Light rebalance (hemi intensity)  — less flat fill ⇒ directional contrast.
//   3. SSAO2                             — darkens corners/contacts (depth).
//   4. IBL — soft ambient for PBR, from one of TWO procedural environments:
//      "gradient" (the original three-colour cube) or "sky" (an analytic sky
//      with the real sun in it, babylon/proceduralSky.ts). Both are computed
//      in-app; neither fetches anything.

import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";
import type { RenderConfig } from "@/config/AppConfig";
import { buildSkyFaces, SKY_FACE_SIZE, type Dir3 } from "./proceduralSky";
import { devLog } from "@/utils/devLog";

const TONE_MAP: Record<string, number> = {
  standard: ImageProcessingConfiguration.TONEMAPPING_STANDARD,
  aces: ImageProcessingConfiguration.TONEMAPPING_ACES,
  khr_neutral: ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL,
};

export class RenderEnhancements {
  private scene: Scene;

  private ssao: SSAO2RenderingPipeline | null = null;
  private ssaoAttached = false;
  private env: RawCubeTexture | null = null;
  /** Signature of the sky `env` was built for — mode/turbidity/sun/night. */
  private envKey = "";
  /** Latest sun from SunController. Identity (straight up) until it reports,
   *  so a sky built before the first tick is still a legal sky. */
  private sunDir: Dir3 = { x: 0, y: 1, z: 0 };
  private nightT = 0;
  /**
   * Set once a float cube has failed to allocate on THIS device. The sky mode
   * then behaves exactly as "gradient" for the rest of the session.
   *
   * ⚠️ THE FALLBACK IS THE POINT, NOT AN AFTERTHOUGHT. A float RGBA cube with
   * mips is a WebGL capability, and this app's target is an iPad — the
   * platform that breaks first here. A mode that throws on the wall and works
   * on the desk would be worse than not shipping it.
   */
  private skyUnavailable = false;

  private cfg: RenderConfig | null = null;
  private baked = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Baked-lighting GLB loaded (see ModelLoader's BAKED_MATERIAL_PREFIX): the
   * structure's texture already contains real Cycles ambient occlusion, GI and
   * sun shadows. SSAO on top double-darkens every corner the bake already
   * darkened, so it's forced off while a baked model is loaded, whatever the
   * quality preset says. Tone mapping and IBL (entity meshes are still lit
   * PBR) stay user-controlled.
   */
  setBakedMode(baked: boolean): void {
    if (this.baked === baked) return;
    this.baked = baked;
    if (this.cfg) this.apply(this.cfg);
  }

  /** Whether SSAO is currently forced off by a baked-lighting model — see
   *  setBakedMode. Lets the Settings UI describe the Quality preset options
   *  accurately instead of promising an AO effect that won't actually apply. */
  isBaked(): boolean {
    return this.baked;
  }

  /** Apply the full render config. Idempotent — safe to call on every change. */
  apply(cfg: RenderConfig): void {
    this.cfg = cfg;
    this.applyToneMapping(cfg);
    // NB: the hemispheric fill light's intensity/warmth is owned by SunController
    // (it varies with day/night). renderFx must not also write it or the two
    // fight and the night fill flickers between values depending on call order.
    this.applyIBL(cfg);
    this.applySSAO(cfg);
  }

  // ── 1. Tone mapping + exposure / contrast ────────────────────────────────
  private applyToneMapping(cfg: RenderConfig): void {
    const ip = this.scene.imageProcessingConfiguration;
    ip.exposure = cfg.exposure;
    ip.contrast = cfg.contrast;
    if (cfg.toneMapping === "none") {
      ip.toneMappingEnabled = false;
    } else {
      ip.toneMappingEnabled = true;
      ip.toneMappingType = TONE_MAP[cfg.toneMapping] ?? ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    }
  }

  // ── 3. SSAO2 (screen-space ambient occlusion) ────────────────────────────
  private applySSAO(cfg: RenderConfig): void {
    if (cfg.ssao && !this.baked) {
      if (!this.ssao) {
        try {
          this.ssao = new SSAO2RenderingPipeline("villaSSAO", this.scene, { ssaoRatio: 0.75, blurRatio: 1.0 });
        } catch (err) {
          devLog("[Render] SSAO2 unavailable (needs WebGL2) — skipping:", err);
          this.ssao = null;
          return;
        }
      }
      this.ssao.radius = cfg.ssaoRadius;
      this.ssao.totalStrength = cfg.ssaoStrength;
      this.ssao.samples = cfg.ssaoSamples;
      this.ssao.base = 0;
      // Enable by (re)attaching cameras — never dispose on toggle. Disposing
      // leaves the disposed pipeline registered in the manager, whose per-frame
      // update() then reads `isSupported` on null post-processes and throws,
      // killing the render loop so the model vanishes for good.
      if (!this.ssaoAttached) {
        this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("villaSSAO", this.scene.cameras);
        this.ssaoAttached = true;
      }
    } else if (this.ssao && this.ssaoAttached) {
      // Disable by detaching cameras only; the pipeline stays alive and valid.
      this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("villaSSAO", this.scene.cameras);
      this.ssaoAttached = false;
    }
  }

  /**
   * The sun moved, or day/night did. Called by SunController on the same beat
   * that drives the villa's own lighting, so the sky and the baked atlas
   * crossfade can never disagree about the time of day.
   *
   * Cheap and idempotent: it only records the sun, and `applyIBL` decides
   * whether that is a big enough change to be worth re-evaluating 98,304
   * texels for. Safe to call every tick.
   */
  setSun(dir: Dir3, nightT: number): void {
    this.sunDir = dir;
    this.nightT = nightT;
    if (this.cfg) this.applyIBL(this.cfg);
  }

  /**
   * Whether the sky mode is currently degraded to the gradient because this
   * device could not allocate a float cube. Lets Settings say so instead of
   * showing a selected option that is not what the screen is doing.
   */
  isSkyUnavailable(): boolean {
    return this.skyUnavailable;
  }

  /**
   * Signature of the environment worth rebuilding for.
   *
   * ⚠️ THE SUN IS QUANTISED, AND THAT IS THE WHOLE COST CONTROL. SunController
   * ticks far more often than the sky meaningfully changes — the real sun moves
   * about a quarter of a degree per minute — so rebuilding on every tick would
   * burn ~98k radiance evaluations for a picture nobody could tell apart.
   * Rounding the direction to ~1.4° buckets means a rebuild happens a few times
   * an hour, and each one is a few milliseconds.
   */
  private skySignature(cfg: RenderConfig): string {
    const q = (v: number) => Math.round(v * 40);
    return `sky:${cfg.skyTurbidity}:${q(this.sunDir.x)},${q(this.sunDir.y)},${q(this.sunDir.z)}:${Math.round(this.nightT * 20)}`;
  }

  // ── 4. IBL — one of two procedural environments (offline, no asset) ───────
  private applyIBL(cfg: RenderConfig): void {
    if (!cfg.ibl) {
      if (this.scene.environmentTexture && this.scene.environmentTexture === this.env) {
        this.scene.environmentTexture = null;
      }
      return;
    }

    const wantSky = cfg.iblMode === "sky" && !this.skyUnavailable;
    const key = wantSky ? this.skySignature(cfg) : "gradient";

    if (!this.env || this.envKey !== key) {
      const next = wantSky ? this.buildSkyEnv(cfg) : this.buildGradientEnv();
      // ⚠️ DISPOSE THE OLD ONE, AND ONLY AFTER THE NEW ONE EXISTS. The sky is
      // rebuilt repeatedly across a day, unlike the gradient which was built
      // once and lived for the session — so the leak this guards against did
      // not exist before this mode and would have been a slow one: a 2.1 MB
      // cube abandoned every few minutes, on a device that is never reloaded.
      if (this.env) this.env.dispose();
      this.env = next;
      this.envKey = wantSky ? key : "gradient";
    }

    this.scene.environmentTexture = this.env;
    this.scene.environmentIntensity = cfg.environmentIntensity;
  }

  /**
   * Build the analytic sky as a FLOAT cube.
   *
   * Float because the sun is the entire reason this mode exists and 8 bits
   * cannot hold one: clamped to 255 the disc would be no brighter than white
   * paper and would drive no highlight worth having.
   *
   * Falls back to the gradient — permanently, for the session — if the device
   * refuses the allocation, rather than leaving the scene with no environment
   * at all. `skyUnavailable` is what Settings reads to stop claiming the sky
   * is on when it is not.
   */
  private buildSkyEnv(cfg: RenderConfig): RawCubeTexture {
    try {
      const faces = buildSkyFaces({
        sun: this.sunDir,
        turbidity: cfg.skyTurbidity,
        nightT: this.nightT,
      });
      const tex = new RawCubeTexture(
        this.scene,
        faces as unknown as ArrayBufferView[],
        SKY_FACE_SIZE,
        Constants.TEXTUREFORMAT_RGBA,
        Constants.TEXTURETYPE_FLOAT,
        true,  // generateMipMaps — roughness picks the mip, so this is required
        false, // invertY
      );
      // Already linear radiance, unlike the sRGB gradient next door.
      tex.gammaSpace = false;
      tex.name = "villaProceduralSky";
      return tex;
    } catch (err) {
      devLog("[Render] float cube unavailable — sky falls back to gradient:", err);
      this.skyUnavailable = true;
      return this.buildGradientEnv();
    }
  }

  /**
   * Build a gradient cube map (sky above → horizon → ground below) used as the
   * scene environment texture. Needs no shipped HDR asset, so it works fully
   * offline in the add-on.
   *
   * ── Why this is 128 and not 16 (2.220.0) ─────────────────────────────────
   * It was 16, deliberately, on the reasoning that this cube only has to drive
   * soft DIFFUSE irradiance on matte interior surfaces. That is true of walls
   * and floors — Babylon derives spherical harmonics from the cube for those,
   * and SH throws the resolution away anyway.
   *
   * It is NOT true of the windows. A PBR material's SPECULAR lobe samples this
   * same cube directly, at a mip chosen by roughness, and glass is set to
   * roughness 0.1 (ModelLoader) — so it read mip 0, a literal 16x16 image in
   * which one texel spans ~5.6 degrees of sky. Those texels were visible as
   * pale square blocks in the panes, which was reported repeatedly and misread
   * (by me) five times as a lightmap-bake, atlas, texture or geometry problem.
   *
   * The tell that ruled all of those out: two instances of the same SH3D asset,
   * same name, same material, same dimensions, side by side — one clean, one
   * blocky. Nothing keyed on name, material or UV can differ between those. An
   * environment reflection can, because it is a function of the reflected VIEW
   * direction: the two panes face different ways and sample different parts of
   * the cube. It also explains why the blocks moved with the camera and stayed
   * square and constant-size under heavy perspective foreshortening — they were
   * never on the surface.
   *
   * 128 puts a texel at ~0.7 degrees, below the visible-banding threshold for a
   * gradient this smooth. Cost is 6 * 128 * 128 * 4 B = 393 KB of VRAM (~524 KB
   * with mips), it is generated once and lazily, and it adds NOTHING to the GLB
   * and nothing to the network — which is the constraint this had to respect.
   */
  private buildGradientEnv(): RawCubeTexture {
    const size = 128;
    const sky: [number, number, number] = [120, 158, 210];
    const horizon: [number, number, number] = [178, 178, 182];
    const ground: [number, number, number] = [120, 110, 98];
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // Direction for a given cube face + uv (Babylon face order: +X,-X,+Y,-Y,+Z,-Z).
    const dirFor = (face: number, u: number, v: number): number => {
      // u,v in [-1,1]; we only need the (normalised) Y component for the gradient.
      let y: number;
      switch (face) {
        case 2: y = 1; break;            // +Y (sky)
        case 3: y = -1; break;           // -Y (ground)
        default: {                       // ±X / ±Z side faces: v is the up axis
          const len = Math.sqrt(1 + u * u + v * v);
          y = -v / len; // Babylon flips V on side faces
        }
      }
      return y;
    };

    const faces: Uint8Array[] = [];
    for (let face = 0; face < 6; face++) {
      const data = new Uint8Array(size * size * 4);
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const u = (i / (size - 1)) * 2 - 1;
          const v = (j / (size - 1)) * 2 - 1;
          const y = dirFor(face, u, v);
          let c: [number, number, number];
          if (y >= 0) {
            const t = Math.pow(y, 0.6);
            c = [lerp(horizon[0], sky[0], t), lerp(horizon[1], sky[1], t), lerp(horizon[2], sky[2], t)];
          } else {
            const t = Math.pow(-y, 0.6);
            c = [lerp(horizon[0], ground[0], t), lerp(horizon[1], ground[1], t), lerp(horizon[2], ground[2], t)];
          }
          const o = (j * size + i) * 4;
          data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
        }
      }
      faces.push(data);
    }

    const tex = new RawCubeTexture(
      this.scene,
      faces as unknown as ArrayBufferView[],
      size,
      Constants.TEXTUREFORMAT_RGBA,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
      true, // generateMipMaps
      false, // invertY
    );
    tex.gammaSpace = true; // sRGB gradient → Babylon derives diffuse irradiance from it
    tex.name = "villaGradientEnv";
    return tex;
  }

  dispose(): void {
    if (this.ssao) {
      if (this.ssaoAttached) {
        this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("villaSSAO", this.scene.cameras);
        this.ssaoAttached = false;
      }
      this.ssao.dispose();
      this.ssao = null;
    }
    if (this.env) { this.env.dispose(); this.env = null; }
    this.envKey = "";
  }
}
