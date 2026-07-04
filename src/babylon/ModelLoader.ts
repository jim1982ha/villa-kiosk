// src/babylon/ModelLoader.ts
// Load a GLB into the scene from an ArrayBuffer (IndexedDB) or an uploaded File,
// and persist uploads to IndexedDB so a refresh doesn't re-upload.

import { SceneLoader, Material, Color3, DracoCompression, type AbstractMesh, type Scene } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
// Bundle the Draco decoder from @babylonjs/core so a Draco-compressed GLB loads
// WITHOUT hitting Babylon's default CDN — required for the offline HA-Ingress
// kiosk. Vite's `?url` rewrites these to hashed, correctly-based build assets.
import dracoWrapperUrl from "@babylonjs/core/assets/Draco/draco_wasm_wrapper_gltf.js?url";
import dracoWasmUrl from "@babylonjs/core/assets/Draco/draco_decoder_gltf.wasm?url";
import dracoFallbackUrl from "@babylonjs/core/assets/Draco/draco_decoder_gltf.js?url";
import { saveModelToIndexedDB } from "@/utils/storage";
import { devLog } from "@/utils/devLog";

// Point Babylon at the bundled decoder. Set once at module load; the decoder is
// still only instantiated lazily, when a model actually uses Draco — so an
// uncompressed GLB pays nothing for this.
DracoCompression.Configuration = {
  decoder: {
    wasmUrl: dracoWrapperUrl,
    wasmBinaryUrl: dracoWasmUrl,
    fallbackUrl: dracoFallbackUrl,
  },
};

export interface LoadResult {
  meshes: AbstractMesh[];
  /** True when the GLB carries pre-baked lighting (see BAKED_MATERIAL_PREFIX). */
  baked: boolean;
  /**
   * Present when the GLB also carries a second, sun-free NIGHT atlas
   * (pipeline ≥2.1.0). Call with 0 = full day atlas … 1 = full night atlas;
   * SunController drives it from the real sun altitude so the structure
   * crossfades to a genuinely dark bake after sunset instead of just dimming
   * the (sunlit) day image.
   */
  nightBlend?: (t: number) => void;
}

// A GLB produced by blender_pipeline.py --bake names its lit-structure material
// "BAKED_Structure": its base-colour texture already contains the COMPLETE
// lighting (sun + sky + GI bounces + shadows, Cycles-rendered offline). Such a
// material must be rendered UNLIT — applying the runtime sun/hemi/point lights
// on top would light the image of a lit room a second time. The prefix is the
// whole contract between pipeline and app: no sidecar files, no custom glTF
// extensions, and a GLB without it behaves exactly as before this existed.
const BAKED_MATERIAL_PREFIX = "BAKED_";
// Pipeline ≥2.1.0 additionally ships a sun-free NIGHT bake of the same atlas
// layout: a microscopic hidden plane ("BAKED_NightCarrier") wears a material
// matching this test whose base-colour texture is the night atlas (glTF can't
// ship an unreferenced texture). We lift that texture into the day material's
// EMISSIVE slot — Babylon's PBR shader adds emissive even in unlit mode — so
// day↔night is a two-scalar crossfade: albedoColor scales the day image down
// while emissiveColor scales the night image up. Both bakes share TEXCOORD_0,
// so the images stay texel-aligned through the fade.
const BAKED_NIGHT_RE = /night/i;

// Babylon caps the lights a material's shader handles at once (default 4). A LED
// strip is modelled as many co-located point lights, so a wall/floor near one can
// be within range of more than 4 — beyond the cap Babylon keeps only the nearest
// few, and the chosen set changes as the camera moves, causing light "popping".
// Raise the cap modestly so dense strips light smoothly without the full per-pixel
// cost of an unbounded count on kiosk-tablet GPUs. 8 = sun + ambient fill + a
// 4-piece perimeter LED entity (one light per Led Line mesh) + two more lamps
// before anything gets dropped.
const MAX_SIMULTANEOUS_LIGHTS = 8;

// Window/door glass exports from SweetHome 3D as an opaque grey material, so you
// can't see the sky/outside through it — the panes read as flat grey panels.
// Detect glass by material OR mesh name (English + French, since the catalog mixes
// both) and make it properly see-through. Substring match, lower-cased, so e.g.
// "Vitre_2", "window_glass", "baie vitrée" all hit. Frames/handles use separate
// materials, so they keep their solidity.
const GLASS_NAME_HINTS = [
  // English / French
  "glass", "vitre", "vitrage", "vitree", "vitré", "verre",
  "window", "fenetre", "fenêtre", "baie", "mirror", "miroir",
  // Common model-author synonyms (custom imported windows rarely say "glass").
  // Kept specific to avoid false hits (e.g. "pane"→"panel", "glas"→"douglas").
  "glazing", "glaze", "transparent", "cristal", "crystal",
  "vetro", "scheibe", "fenster", "glasscheibe",
];
// Opacity of a detected pane. 1 = opaque, 0 = invisible. Low enough to clearly see
// through, but NOT zero — a faint tint so it still reads as a real glass surface
// rather than an empty hole in the wall.
const GLASS_ALPHA = 0.38;

function looksLikeGlass(names: (string | undefined)[], hints: string[]): boolean {
  for (const n of names) {
    if (!n) continue;
    const low = n.toLowerCase();
    if (hints.some((h) => low.includes(h))) return true;
  }
  return false;
}

/**
 * Append a GLB (given as ArrayBuffer) into an existing scene.
 *
 * `extraGlassHints` are user-supplied substrings (from config.extraGlassHints)
 * merged into the built-in glass keyword list — so a custom imported window whose
 * material name has no glass keyword can be made see-through by naming it in the
 * config, without a code change. Identify the name from the pane-candidate console
 * log below.
 */
export async function loadModelInto(
  scene: Scene,
  data: ArrayBuffer,
  extraGlassHints: string[] = [],
): Promise<LoadResult> {
  const glassHints = [
    ...GLASS_NAME_HINTS,
    ...extraGlassHints.map((h) => h.toLowerCase()).filter(Boolean),
  ];
  const blob = new Blob([data], { type: "model/gltf-binary" });
  const url = URL.createObjectURL(blob);
  try {
    const result = await SceneLoader.ImportMeshAsync("", "", url, scene, undefined, ".glb");
    const glassMats = new Set<string>();
    const allMats = new Set<string>();
    let baked = false;
    type BakedMat = {
      name?: string;
      unlit?: boolean;
      albedoTexture?: unknown;
      emissiveTexture?: unknown;
      albedoColor?: Color3;
      emissiveColor?: Color3;
    };
    const bakedDayMats = new Set<BakedMat>();
    let nightMat: BakedMat | null = null;
    for (const m of result.meshes) {
      const mat = m.material as
        | { name?: string; maxSimultaneousLights?: number; alpha?: number; transparencyMode?: number | null; backFaceCulling?: boolean; roughness?: number; metallic?: number; forceDepthWrite?: boolean; unlit?: boolean }
        | null;
      if (!mat) continue;
      if (mat.name) allMats.add(mat.name);
      if ("maxSimultaneousLights" in mat) mat.maxSimultaneousLights = MAX_SIMULTANEOUS_LIGHTS;

      // Pre-baked lighting: render the baked material unlit — its texture IS
      // the finished lit image. Setting the flag here (not just per-mesh in a
      // later pass) matters because a fused Structure imports as one Babylon
      // mesh PER glTF primitive, all sharing this material instance.
      if (mat.name?.startsWith(BAKED_MATERIAL_PREFIX) && "unlit" in mat) {
        if (BAKED_NIGHT_RE.test(mat.name)) {
          // Night-atlas carrier: keep the material (it owns the texture) but
          // the micro-plane itself must never render or catch a tap.
          nightMat = mat as BakedMat;
          m.setEnabled(false);
          m.isPickable = false;
          continue;
        }
        mat.unlit = true;
        baked = true;
        bakedDayMats.add(mat as BakedMat);
      }

      if (looksLikeGlass([mat.name, m.name], glassHints)) {
        mat.alpha = GLASS_ALPHA;
        mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
        mat.backFaceCulling = false; // see both faces of a thin pane
        // Alpha-blended materials don't write depth by default, so Babylon
        // sorts them back-to-front by distance-from-camera each frame — as
        // the camera moves, that sort can flip relative to nearby OPAQUE
        // geometry (e.g. an LED cove strip mounted right at the glass wall's
        // top edge), making the strip intermittently render as if it were
        // behind the glass when it isn't: a camera-angle-dependent
        // appear/disappear glitch with nothing actually between the two.
        // v2.4.78 used needDepthPrePass for this — REVERTED in v2.4.83: it
        // adds a whole separate render pass with its own shader, which (in
        // combination with GlowLayer's internal render-to-texture pass, which
        // re-renders every material in the scene to composite the glow)
        // produced a real WebGL error every frame — "glDrawElements: Active
        // draw buffers with missing fragment shader outputs" — because that
        // extra pass's shader didn't match the active framebuffer's expected
        // outputs. forceDepthWrite is a much lighter fix for the same
        // problem: it just tells the material's NORMAL alpha-blend pass to
        // also write depth, no separate pass/shader involved, so it can't
        // create this class of render-target mismatch.
        mat.forceDepthWrite = true;
        // Smooth + slightly metallic so the pane catches highlights and reads as
        // glass rather than a flat translucent sheet (PBR materials only).
        if ("roughness" in mat) mat.roughness = 0.1;
        if ("metallic" in mat) mat.metallic = 0;
        if (mat.name) glassMats.add(mat.name);
      }
    }
    // Surfaced so the glass heuristic can be tuned from the browser console if a
    // pane isn't caught (or a non-glass material is): paste the material list here.
    devLog(
      `[ModelLoader] glass-transparency: matched ${glassMats.size} material(s):`,
      [...glassMats],
      "| all materials:",
      [...allMats].sort(),
    );
    if (baked) {
      devLog("[ModelLoader] BAKED-lighting GLB detected — structure renders unlit; " +
        "dynamic light simulation will be disabled scene-wide");
    }

    // Wire the day↔night crossfade when the GLB carries a night atlas.
    let nightBlend: ((t: number) => void) | undefined;
    const nightTex = nightMat?.albedoTexture;
    if (baked && nightTex && bakedDayMats.size > 0) {
      for (const dm of bakedDayMats) {
        dm.emissiveTexture = nightTex; // samples the day material's TEXCOORD_0
        dm.emissiveColor = Color3.Black(); // start at full day
      }
      nightBlend = (t: number) => {
        const day = 1 - t;
        for (const dm of bakedDayMats) {
          dm.albedoColor = new Color3(day, day, day);
          dm.emissiveColor = new Color3(t, t, t);
        }
      };
      devLog("[ModelLoader] night atlas found (" + (nightMat?.name ?? "?") +
        ") — day/night handled by texture crossfade instead of exposure dimming");
    }

    // A custom-imported window (e.g. window_3x1) can carry a material whose name
    // has no glass keyword, so it slips past the name match above and stays a grey
    // panel. Rather than guess, find the geometry that LOOKS like a pane — a large,
    // very thin, flat slab — and print it with its material name. Walls/floors are
    // also thin slabs, so exclude those by name. The user reads the window-sized
    // entry off this list and we add that material to GLASS_NAME_HINTS for good.
    const NON_GLASS_RE = /wall|floor|ceiling|roof|ground|room|stair|door/i;
    const panes: { mesh: string; material: string; size: string }[] = [];
    for (const m of result.meshes) {
      if (m.getTotalVertices() === 0) continue;
      const mat = m.material as { name?: string } | null;
      const matName = mat?.name ?? "(none)";
      if (looksLikeGlass([matName, m.name], glassHints)) continue; // already see-through
      if (NON_GLASS_RE.test(matName) || NON_GLASS_RE.test(m.name)) continue;
      const ext = m.getBoundingInfo().boundingBox.extendSizeWorld; // half-extents
      const dims = [ext.x * 2, ext.y * 2, ext.z * 2].sort((a, b) => a - b);
      const [thin, mid, big] = dims;
      // Pane = two large dimensions, one much smaller (flat), and not tiny overall.
      if (big > 40 && mid > 40 && thin < mid * 0.2) {
        panes.push({
          mesh: m.name,
          material: matName,
          size: `${big.toFixed(0)}×${mid.toFixed(0)}×${thin.toFixed(0)}`,
        });
      }
    }
    if (panes.length) {
      devLog(
        "[ModelLoader] pane-like meshes NOT treated as glass — if one is a window, " +
        "tell me its material to add to GLASS_NAME_HINTS:",
        panes,
      );
    }
    return { meshes: result.meshes, baked, nightBlend };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Read an uploaded File, persist it, and return its bytes. */
export async function ingestUploadedModel(file: File): Promise<ArrayBuffer> {
  const buf = await file.arrayBuffer();
  await saveModelToIndexedDB(buf, file.name);
  return buf;
}
