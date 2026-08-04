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
//   4. IBL (procedural gradient cube)    — soft sky/ground ambient for PBR.

import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";
import type { RenderConfig } from "@/config/AppConfig";
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

  // ── 4. IBL — procedural sky/ground gradient cube (offline, no asset) ──────
  private applyIBL(cfg: RenderConfig): void {
    if (cfg.ibl) {
      if (!this.env) this.env = this.buildGradientEnv();
      this.scene.environmentTexture = this.env;
      this.scene.environmentIntensity = cfg.environmentIntensity;
    } else if (this.scene.environmentTexture && this.scene.environmentTexture === this.env) {
      this.scene.environmentTexture = null;
    }
  }

  /**
   * Build a small gradient cube map (sky above → horizon → ground below) used
   * as the scene environment texture. Low-res on purpose: it drives soft diffuse
   * IBL on matte interior surfaces (the main win) rather than sharp reflections,
   * and needs no shipped HDR asset so it works fully offline in the add-on.
   */
  private buildGradientEnv(): RawCubeTexture {
    const size = 16;
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
  }
}
