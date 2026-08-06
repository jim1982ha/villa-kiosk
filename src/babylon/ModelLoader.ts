// src/babylon/ModelLoader.ts
// Load a GLB into the scene from an ArrayBuffer (IndexedDB) or an uploaded File,
// and persist uploads to IndexedDB so a refresh doesn't re-upload.

import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DracoCompression } from "@babylonjs/core/Meshes/Compression/dracoCompression";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
// Bundle the Draco decoder from @babylonjs/core so a Draco-compressed GLB loads
// WITHOUT hitting Babylon's default CDN — required for the offline HA-Ingress
// kiosk. Vite's `?url` rewrites these to hashed, correctly-based build assets.
import dracoWrapperUrl from "@babylonjs/core/assets/Draco/draco_wasm_wrapper_gltf.js?url";
import dracoWasmUrl from "@babylonjs/core/assets/Draco/draco_decoder_gltf.wasm?url";
import dracoFallbackUrl from "@babylonjs/core/assets/Draco/draco_decoder_gltf.js?url";
// KTX2 (GPU-compressed textures) needs the same treatment, and needs it MORE:
// @babylonjs/core bundles Draco but NOT the KTX2 decoder, so out of the box
// Babylon fetches it from cdn.babylonjs.com. On the villa iPad — which may
// have no internet at all — that is not "slower", it is a model with no
// textures. The decoder module comes from npm; the MSC transcoder (the one
// ETC1S needs) is not published there, so it is vendored under src/assets/ktx2
// and imported the same way, which lets Vite hash it and resolve the correct
// base URL under HA Ingress.
import ktx2DecoderUrl from "babylonjs-ktx2decoder/babylon.ktx2Decoder.js?url";
import mscTranscoderJsUrl from "@/assets/ktx2/msc_basis_transcoder.js?url";
import mscTranscoderWasmUrl from "@/assets/ktx2/msc_basis_transcoder.wasm?url";
import { saveModelToIndexedDB } from "@/utils/storage";
import { devLog } from "@/utils/devLog";
import { isStructureMesh } from "./meshRoles";

// Point Babylon at the bundled decoder. Set once at module load; the decoder is
// still only instantiated lazily, when a model actually uses Draco — so an
// uncompressed GLB pays nothing for this.
//
// `numWorkers` is deliberately NOT set: Babylon's own default is right here.
// 2.102.0 doubled it on the theory that the import's ~1,430ms Draco phase was
// per-call overhead sitting inside the workers, and the field data refuted it —
// Android went 4 → 8 workers and the phase moved 1431 → 1430/1431ms, the Mac
// went 2 → 4 and moved within its existing noise. The cost is ~1.9ms of
// CALLING-THREAD work per primitive, 765 times over (slicing each buffer view,
// marshalling to a worker and back, building vertex buffers, uploading each
// primitive's attributes to the GPU), which no worker count can touch — while a
// bigger pool does cost one WASM instance per worker on a wall-mounted iPad.
// DO NOT raise it again expecting a win; it has been measured and disproved.
// The remaining lever is FEWER PRIMITIVES in the GLB, a pipeline change.
DracoCompression.Configuration = {
  decoder: {
    wasmUrl: dracoWrapperUrl,
    wasmBinaryUrl: dracoWasmUrl,
    fallbackUrl: dracoFallbackUrl,
  },
};

// The Draco decode instrumentation that lived here is GONE, on purpose.
//
// It monkey-patched a PRIVATE Babylon method (`_decodeMeshToGeometryForGltf-
// Async`) on the villa's critical load path to time every primitive's decode.
// It did its job: it proved Draco owns the import's tail, and then that the
// cost is calling-thread work per primitive rather than anything the worker
// pool can help with (2.101.0-2.103.0). With that settled, keeping a patched
// private API in production is a liability with no remaining payoff — the next
// Babylon upgrade could change its shape, and the load path is the worst place
// in this app to carry a surprise.
//
// Nothing diagnostic is actually lost: `glMeshes` counts the same primitives
// from a PUBLIC observable, and primitive count is the one number that matters
// for the remaining lever (merging meshes in the Blender pipeline). If that
// pipeline change ever lands, `glMeshes` falling and `importMs` falling with it
// is the whole confirmation needed.

// Only the ETC1S path is wired up, because that is what the pipeline produces
// (`blender_pipeline.py --ktx2` / `gltf-transform etc1s`). The UASTC entries
// stay null on purpose: pointing them at a CDN would reintroduce exactly the
// offline dependency this block exists to remove, and shipping four more WASM
// binaries for a format nothing here emits is dead weight in the bundle. A GLB
// using UASTC would fail to decode its textures rather than silently phone
// home — the louder failure, and the right one.
KhronosTextureContainer2.URLConfig = {
  jsDecoderModule: ktx2DecoderUrl,
  jsMSCTranscoder: mscTranscoderJsUrl,
  wasmMSCTranscoder: mscTranscoderWasmUrl,
  wasmUASTCToASTC: null,
  wasmUASTCToBC7: null,
  wasmUASTCToRGBA_UNORM: null,
  wasmUASTCToRGBA_SRGB: null,
  wasmUASTCToR8_UNORM: null,
  wasmUASTCToRG8_UNORM: null,
  wasmZSTDDecoder: null,
};

export interface LoadResult {
  meshes: AbstractMesh[];
  /** True when the GLB carries pre-baked lighting (see BAKED_MATERIAL_PREFIX). */
  baked: boolean;
  /**
   * True for a LIGHTMAP-mode GLB (pipeline ≥2.7.0 --bake-lightmap): the
   * structure keeps its original crisp tiled textures (UV0) and the baked
   * light rides a second atlas (UV1) multiplied in at render time — instead
   * of the classic single albedo atlas that caps the whole villa at a few
   * cm/texel. Implies `baked` (all dynamic-light systems stand down).
   */
  lightmapped?: boolean;
  /**
   * Present when the GLB also carries a second, sun-free NIGHT atlas
   * (pipeline ≥2.1.0). Call with 0 = full day atlas … 1 = full night atlas;
   * SunController drives it from the real sun altitude so the structure
   * crossfades to a genuinely dark bake after sunset instead of just dimming
   * the (sunlit) day image.
   */
  nightBlend?: (t: number) => void;
  /**
   * Present when glass panes were detected. Call with the same 0 = day …
   * 1 = night factor as nightBlend: ramps the panes' forced light albedo and
   * constant emissive sheen down for the night, so windows dim with the rest
   * of the villa instead of staying day-bright white panels after dark.
   */
  glassDim?: (t: number) => void;
  /**
   * Time SceneLoader.ImportMeshAsync itself took (ms) — Babylon parsing the
   * glTF, decompressing Draco geometry, decoding every texture and uploading
   * it all to the GPU. Split out from the rest of loadModel's post-processing
   * (mesh indexing, structure/collision setup) so a slow load can be
   * attributed to the right half — see the (i) tooltip's "Load time" row.
   */
  importMs: number;
  /**
   * What the GLB is made of, and when the loader's own milestones landed —
   * loose keys forwarded straight into the load telemetry:
   *   `glJson`     the container became readable
   *   `glGraph`    the whole object graph was built (~7% of the import; NOT a
   *                decode timing, see the note at the observables)
   *   `glTexReady` the last texture finished decoding AND uploading, with
   *                `glTexDone` reporting how many answered
   *   `glMeshes` / `glTextures` / `glMaterials`  object counts
   *   `glTexImgs` / `glTexMp`  DISTINCT decoded images and their megapixels
   *                (de-duplicated: many texture objects share one image)
   *   `glTexCompressed`  how many of those images reached the GPU still
   *                compressed (KTX2). 0 against a non-zero `glTexImgs` means
   *                the villa is paying ~8x the GPU texture memory it needs to
   *                — the resource whose exhaustion causes `context-lost`.
   *   `glKVerts`   thousands of vertices across every primitive
   *
   * `glMeshes` is the number that matters most now: the import's dominant cost
   * is fixed per-primitive work on the calling thread, so it scales with that
   * COUNT rather than with vertices or pixels.
   */
  importPhases: Record<string, number>;
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

// LIGHTMAP-mode GLB (pipeline ≥2.7.0 --bake-lightmap): the structure keeps its
// ORIGINAL tiled textures/materials on TEXCOORD_0 and the baked light arrives
// as a separate atlas on TEXCOORD_1, carried by hidden micro-planes wearing
// these materials (glTF can't ship an unreferenced texture). The app wires the
// atlas into each structure material's lightmapTexture with
// useLightmapAsShadowmap=true — Babylon's PBR shader then MULTIPLIES the lit
// result by the lightmap — and lights the structure with a dedicated uniform
// white hemispheric so "the lit result" is exactly the albedo. Net effect:
// finalColor ≈ original texture × baked light, i.e. full texture sharpness
// AND Cycles GI, where the classic albedo bake capped the whole villa at a
// few cm/texel. Must be tested BEFORE the generic BAKED_ branch below (the
// night carrier would otherwise be captured as an albedo night atlas).
const BAKED_LIGHTMAP_PREFIX = "BAKED_Lightmap";
// Meshes whose materials receive the lightmap: the pipeline's structure
// groups (it forks any material shared with entities to a private _ST copy,
// so wiring these never leaks the lightmap onto UV2-less entity meshes).
// Identified via meshRoles.isStructureMesh — pipeline metadata first, legacy
// name convention only as a fallback.

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
// Daytime pane colours (see the long comment at the assignment site): a light
// neutral albedo plus a small constant emissive sheen so a clear pane over a
// dark background reads as glass, not a black hole. Both are DAY values — at
// night the only structure dim for a day-only bake is a global exposure drop,
// which scales walls and panes equally, so a pane whose intrinsic luminance is
// ~1.0 (bright albedo under the uniform white lightmap fill, plus the sheen)
// stays 2-3× brighter than the darkest-lit wall and tonemaps to glowing white
// panels (the "why is the glass so bright at night" report). glassDim() below
// ramps both colours down to GLASS_NIGHT_LEVEL over the same civil-twilight
// ramp SunController uses for everything else.
const GLASS_DAY_ALBEDO = new Color3(0.74, 0.80, 0.86);
const GLASS_DAY_SHEEN = new Color3(0.20, 0.23, 0.27);
// Fraction of the day colours left at full night — enough that a pane still
// reads as a faint surface (not a hole), nowhere near enough to glow.
const GLASS_NIGHT_LEVEL = 0.18;

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
    const tImportStart = performance.now();
    // Split Babylon's own import into phases. `importMs` is ~60% of the whole
    // load's machine time and has always been ONE number, which is exactly the
    // state that let a 5.6s phase hide inside `revealMs` until it was broken
    // apart. Without this the only honest answer to "why is the import slow?"
    // is a guess, and the plausible causes point at opposite fixes: geometry
    // (Draco decode / triangle count / 765 separate meshes) is solved by
    // pipeline decimation or a different mesh compression, whereas textures
    // are solved by a texture format — and one of those, KTX2, has already
    // been considered and declined, so guessing wrong is expensive.
    //
    // The glTF loader publishes exactly the milestones needed. Costs one
    // timestamp per callback (~765 mesh + a few dozen texture calls, sub-ms in
    // total) and the observer is removed again below, so nothing accumulates
    // across the re-loads this app does constantly.
    const gl: Record<string, number> = { glMeshes: 0, glTextures: 0, glMaterials: 0 };
    // Raw pixels, converted to megapixels ONCE at the end. Accumulating in
    // rounded megapixels instead would round every individual texture to zero
    // (a 512×512 image is 0.26MP) and report a total of 0 forever.
    let texPx = 0;
    // Distinct InternalTextures, i.e. distinct decoded IMAGES — see the
    // de-duplication note where this is filled.
    const seenImages = new Set<object>();
    /** How many of those images arrived GPU-compressed (KTX2) — see below. */
    let compressedImages = 0;
    const since = () => Math.round(performance.now() - tImportStart);
    const pluginObserver = SceneLoader.OnPluginActivatedObservable.addOnce((plugin) => {
      type GlTexture = Partial<{
        isReady(): boolean;
        getSize(): { width: number; height: number };
        getInternalTexture(): object | null;
        onLoadObservable: { addOnce(cb: () => void): unknown };
      }>;
      const p = plugin as Partial<{
        onParsedObservable: { addOnce(cb: () => void): unknown };
        onMeshLoadedObservable: { add(cb: () => void): unknown };
        onTextureLoadedObservable: { add(cb: (tex: GlTexture) => void): unknown };
        onMaterialLoadedObservable: { add(cb: () => void): unknown };
      }>;
      // When the glTF JSON + binary chunk are readable — everything after this
      // is real decode work rather than container parsing.
      p.onParsedObservable?.addOnce(() => { gl.glJson = since(); });
      // These fire when an OBJECT IS CREATED, not when its data is ready —
      // Babylon's own docs say so ("some data may not have been setup yet").
      // The field data made that unmistakable: mesh, texture and material
      // milestones all landed at the same instant (110ms) while the import ran
      // to 1,609ms, i.e. building the whole object graph is ~7% of the import.
      // Three separate timestamps for one event was just noise, so they are now
      // ONE — `glGraph`, "the object graph was built by here". Never read it as
      // a decode timing; the counts are what these callbacks are really for.
      p.onMeshLoadedObservable?.add(() => { gl.glMeshes++; gl.glGraph = since(); });
      p.onMaterialLoadedObservable?.add(() => { gl.glMaterials++; gl.glGraph = since(); });
      // A texture is READY only once its image has actually been decoded and
      // uploaded. `glTexReady` is when the LAST of them finished: measured at
      // 25-38% of the import, which is what ruled textures out as the load's
      // bottleneck (and retroactively justified not adopting KTX2). `glTexDone`
      // reports how many actually answered, so partial coverage can never be
      // mistaken for an early finish.
      p.onTextureLoadedObservable?.add((t: GlTexture) => {
        gl.glTextures++;
        gl.glGraph = since();
        const done = () => {
          gl.glTexDone = (gl.glTexDone ?? 0) + 1;
          gl.glTexReady = since();
          // Count each IMAGE once, not once per material that references it.
          //
          // Babylon builds one Texture OBJECT per material slot, but resolves
          // the pixels through a shared InternalTexture keyed by the image's
          // URL (glTFLoader's `data:<root>#image{index}` + texture.js's
          // `_getFromCache`). `getSize()` therefore reports the SHARED image's
          // dimensions, so summing it per object multiplied every baked atlas
          // by however many materials used it — which is how this first
          // reported 1,260MP, a reference-weighted total that reads like an
          // impossible amount of texture memory. De-duplicating on the internal
          // texture's identity turns it into the real figure, which is the one
          // that matters: texture memory is what drives the GPU context losses
          // this telemetry also records, and the iPad's memory ceiling.
          const internal = t.getInternalTexture?.();
          if (internal && !seenImages.has(internal)) {
            seenImages.add(internal);
            const sz = t.getSize?.();
            if (sz?.width) texPx += sz.width * sz.height;
            // Whether this image reached the GPU still COMPRESSED (KTX2/ETC1S,
            // transcoded to ASTC/BCn) or as raw pixels. Uncompressed is ~4
            // bytes per texel plus a third again for mipmaps; a compressed
            // format is closer to half a byte — an ~8x difference in the one
            // resource whose exhaustion takes the WebGL context away, which is
            // exactly what the context-lost events record. Reported so "is this
            // villa's GLB actually KTX2?" is answerable from telemetry instead
            // of by remembering which flags the bake was run with.
            if ((internal as { _compression?: string | null })._compression) {
              compressedImages++;
            }
          }
        };
        // Already decoded by the time we see it (a cache hit) — onLoadObservable
        // would never fire again, so count it now rather than under-report.
        if (t.isReady?.()) done();
        else t.onLoadObservable?.addOnce(done);
      });
    });
    let result;
    try {
      result = await SceneLoader.ImportMeshAsync("", "", url, scene, undefined, ".glb");
    } finally {
      // Remove it even if the import throws — a stale observer would attach a
      // second set of counters to the NEXT load and silently double-count.
      SceneLoader.OnPluginActivatedObservable.remove(pluginObserver);
    }
    const importMs = performance.now() - tImportStart;
    // The geometry workload's SIZE, to sit beside the texture megapixels above:
    // whichever phase owns the tail, the fix depends on whether the villa is
    // heavy in triangles or heavy in images, and those have opposite remedies.
    // Counted after the import so every primitive is present.
    let verts = 0;
    for (const m of result.meshes) verts += (m as { getTotalVertices?: () => number }).getTotalVertices?.() ?? 0;
    gl.glKVerts = Math.round(verts / 1000);
    // Megapixels of DISTINCT decoded image, and how many distinct images that
    // was. Read against `glTextures` (texture OBJECTS, one per material slot):
    // the gap between the two is how heavily the villa's atlases are reused.
    gl.glTexMp = Math.round((texPx / 1e6) * 10) / 10;
    gl.glTexImgs = seenImages.size;
    gl.glTexCompressed = compressedImages;
    const glassMats = new Set<string>();
    // Material OBJECT refs (a Set — one material is shared by many meshes) so
    // glassDim below can re-drive their colours every day/night tick.
    const glassMatObjs = new Set<{ albedoColor?: Color3; emissiveColor?: Color3 }>();
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
    let lightmapDayMat: BakedMat | null = null;
    let lightmapNightMat: BakedMat | null = null;
    for (const m of result.meshes) {
      const mat = m.material as
        | { name?: string; maxSimultaneousLights?: number; alpha?: number; transparencyMode?: number | null; backFaceCulling?: boolean; roughness?: number; metallic?: number; forceDepthWrite?: boolean; unlit?: boolean; emissiveColor?: Color3; albedoColor?: Color3 }
        | null;
      if (!mat) continue;
      if (mat.name) allMats.add(mat.name);
      if ("maxSimultaneousLights" in mat) mat.maxSimultaneousLights = MAX_SIMULTANEOUS_LIGHTS;

      // Lightmap carriers (checked FIRST — their names also match the generic
      // BAKED_ prefix and the night one matches BAKED_NIGHT_RE): keep the
      // material (it owns the light atlas), hide the micro-plane, and wire
      // the atlas into the structure materials after this loop.
      if (mat.name?.startsWith(BAKED_LIGHTMAP_PREFIX)) {
        if (BAKED_NIGHT_RE.test(mat.name)) lightmapNightMat = mat as BakedMat;
        else lightmapDayMat = mat as BakedMat;
        baked = true;
        m.setEnabled(false);
        m.isPickable = false;
        continue;
      }

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
        // Double-side the baked structure. SweetHome exports thin slabs (floors,
        // ceilings) whose covering can carry a downward normal; with the default
        // backFaceCulling the camera above the 2F sees the culled back of those
        // floor faces and looks straight through to the now-hidden 1F, reading
        // as black holes. The texture already IS the finished lit image, so
        // rendering both faces is free of any lighting artefact — it just fills
        // the hole. (Glass panes below set this for the same see-both-sides
        // reason.)
        if ("backFaceCulling" in mat) mat.backFaceCulling = false;
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
        // A pane is a clear PBR material, so what you see through it is whatever
        // sits behind: with the exclusive floor toggle (2.9.0) the OTHER floor is
        // hidden, so a ground-floor room loses its ceiling (the upper floor slab)
        // and a window ends up framing the dim evening interior or the dark
        // sky — a clear pane over near-black reads as an opaque black panel, not
        // glass. A small CONSTANT emissive sheen (independent of the dimmed night
        // hemi) keeps every detected pane reading as a lit glass surface even
        // when what's behind it is dark; it's faint enough not to glow like a
        // light. SweetHome pane base colours also range down to a near-black
        // 0.18 grey — normalising the albedo to a light neutral stops those dark
        // panes from reading as solid panels too. These are the DAY values;
        // glassDim() scales them down after dark (see GLASS_NIGHT_LEVEL).
        if ("albedoColor" in mat) mat.albedoColor = GLASS_DAY_ALBEDO.clone();
        if ("emissiveColor" in mat) mat.emissiveColor = GLASS_DAY_SHEEN.clone();
        glassMatObjs.add(mat);
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

    // ---- Lightmap-mode wiring (see BAKED_LIGHTMAP_PREFIX) ----------------
    type LightmapTex = { coordinatesIndex?: number } | undefined;
    type LightmapMat = {
      name?: string;
      lightmapTexture?: unknown;
      useLightmapAsShadowmap?: boolean;
      environmentIntensity?: number;
      specularIntensity?: number;
      backFaceCulling?: boolean;
    };
    const lightmapped = !!lightmapDayMat;
    // A model reload must not leave the previous model's fill light behind
    // (its includedOnlyMeshes point at disposed meshes).
    scene.getLightByName("lightmapFill")?.dispose();
    const lmDayTex = lightmapDayMat?.albedoTexture as LightmapTex;
    if (lmDayTex) {
      lmDayTex.coordinatesIndex = 1; // the pipeline's BakeUV → TEXCOORD_1
      const structureMeshes: AbstractMesh[] = [];
      const lmMats = new Set<LightmapMat>();
      let missingUv2 = 0;
      for (const m of result.meshes) {
        if (!isStructureMesh(m)) continue;
        if (m.getTotalVertices() === 0) continue;
        // Blender's glTF exporter drops UV layers no material references —
        // pipeline < 2.7.1 lost BakeUV that way, and without TEXCOORD_1 the
        // lightmap samples at the tiling texture UVs (light smeared per tile).
        if (!m.isVerticesDataPresent(VertexBuffer.UV2Kind)) missingUv2++;
        structureMeshes.push(m);
        const mat = m.material as LightmapMat | null;
        if (!mat) continue;
        // Panes keep the runtime glass treatment above — a lightmap multiply
        // would just darken what you see through them.
        if (mat.name && glassMats.has(mat.name)) continue;
        lmMats.add(mat);
      }
      for (const sm of lmMats) {
        // useLightmapAsShadowmap makes the PBR shader MULTIPLY the lit result
        // by the lightmap (without it the lightmap is ADDED, unscaled by the
        // texture). The uniform white hemi below makes "the lit result" the
        // plain albedo, so finalColor = texture × baked light.
        sm.lightmapTexture = lmDayTex;
        sm.useLightmapAsShadowmap = true;
        // The bake already contains ALL ambient light — the scene's IBL
        // gradient (which ignores light.excludedMeshes) would double-light.
        sm.environmentIntensity = 0;
        sm.specularIntensity = 0;
        // Same thin-slab reason as the albedo-baked branch: floors export
        // with downward normals; culling their backs opens holes to the
        // hidden floor below. Uniform hemi light = no back-face artefact.
        sm.backFaceCulling = false;
      }
      // The structure's ONLY runtime light: a uniform white hemispheric
      // (diffuse = ground = white ⇒ every normal receives exactly 1.0), so
      // the material evaluates to its plain albedo before the lightmap
      // multiply. The scene's real sun/fill must not add on top — the bake
      // already contains them — so the structure is excluded from every
      // other light. (Lights created later — per-entity point lights — are
      // never created in baked mode, which `baked = true` guarantees.)
      const fill = new HemisphericLight("lightmapFill", new Vector3(0, 1, 0), scene);
      fill.diffuse = new Color3(1, 1, 1);
      fill.groundColor = new Color3(1, 1, 1);
      fill.specular = new Color3(0, 0, 0);
      fill.intensity = 1.0;
      fill.includedOnlyMeshes = structureMeshes;
      for (const l of scene.lights) {
        if (l === fill) continue;
        for (const m of structureMeshes) l.excludedMeshes.push(m);
      }
      // Night lightmap: swap the atlas at solar midnight of the twilight ramp
      // (a hard swap — smoothly crossfading two lightmaps needs a shader
      // plugin; day-only bakes never get here and use exposure dimming).
      const lmNightTex = lightmapNightMat?.albedoTexture as LightmapTex;
      if (lmNightTex) {
        lmNightTex.coordinatesIndex = 1;
        nightBlend = (t: number) => {
          const tex = t >= 0.5 ? lmNightTex : lmDayTex;
          for (const sm of lmMats) {
            if (sm.lightmapTexture !== tex) sm.lightmapTexture = tex;
          }
        };
      }
      devLog(
        `[ModelLoader] LIGHTMAP GLB detected — baked light on UV1 multiplied ` +
        `onto ${lmMats.size} original structure material(s) across ` +
        `${structureMeshes.length} mesh(es)` +
        (lmNightTex ? "; night lightmap present (hard swap at twilight)" : ""),
      );
      if (missingUv2 > 0) {
        console.warn(
          `[ModelLoader] ${missingUv2}/${structureMeshes.length} structure ` +
          `mesh(es) have NO TEXCOORD_1 — the lightmap cannot be sampled at ` +
          `its bake UVs and lighting will look wrong. This GLB was exported ` +
          `by pipeline 2.7.0 (Blender drops the unused BakeUV layer); ` +
          `re-bake with blender_pipeline ≥ 2.7.1.`,
        );
      }
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
    // Day/night hook for the panes. Works in every mode: in lightmap/albedo
    // baked GLBs the panes skip the bake (a lightmap multiply would darken
    // the view THROUGH them) so nothing else ever dims their colours; in
    // unbaked GLBs the scene lights dim but the constant emissive sheen
    // would not. SunController drives this with its twilight ramp.
    const glassDim = glassMatObjs.size > 0
      ? (t: number) => {
          const s = 1 - (1 - GLASS_NIGHT_LEVEL) * Math.min(1, Math.max(0, t));
          for (const gm of glassMatObjs) {
            if ("albedoColor" in gm) gm.albedoColor = GLASS_DAY_ALBEDO.scale(s);
            if ("emissiveColor" in gm) gm.emissiveColor = GLASS_DAY_SHEEN.scale(s);
          }
        }
      : undefined;
    return { meshes: result.meshes, baked, lightmapped, nightBlend, glassDim, importMs, importPhases: gl };
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
