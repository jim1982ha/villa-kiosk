// src/utils/glbRoomDataExtractor.ts
// Reads the room/entity plan data a Blender pipeline ≥2.14.0 embeds directly
// in the GLB (see blender_pipeline.py's _embed_room_data: a bare Empty node
// carrying the JSON as a `vk_rooms_json` glTF extra) — so a freshly exported
// .glb can carry its own room data with no separate ".rooms.json" upload.
//
// Reads the raw glTF-Binary container directly rather than loading the file
// into a Babylon scene: this needs to run right after picking the file (in
// Settings, before/without any WebGL context), and glTF-Binary's layout is
// simple enough not to need a full parser for it — a 12-byte header, then one
// or more 8-byte-prefixed chunks, and the FIRST chunk is always the JSON
// document per the glTF 2.0 spec (an Draco/binary chunk, if present, always
// comes second). The glTF document's own `nodes[].extras` is exactly what
// Babylon's ExtrasAsMetadata loader extension later surfaces as
// `mesh.metadata.gltf.extras` — same data, read here before the model is
// ever loaded into a scene at all.

const GLB_MAGIC = 0x46546c67; // "glTF", little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON", little-endian
const ROOMS_JSON_EXTRAS_KEY = "vk_rooms_json";

interface MinimalGltfNode {
  extras?: Record<string, unknown>;
}
interface MinimalGltfTexture {
  source?: number;
  extensions?: Record<string, { source?: number } | undefined>;
}
interface MinimalGltfDocument {
  nodes?: MinimalGltfNode[];
  textures?: MinimalGltfTexture[];
  materials?: { name?: string }[];
}

/** The GLB's glTF document (its first chunk), or null when it is not glTF-Binary or cannot be read. Never throws. */
function gltfDocument(glb: ArrayBuffer): MinimalGltfDocument | null {
  try {
    if (glb.byteLength < 20) return null;
    const dv = new DataView(glb);
    if (dv.getUint32(0, true) !== GLB_MAGIC) return null;
    // Header: magic(4) + version(4) + total length(4) = 12 bytes, then the
    // first chunk: chunkLength(4) + chunkType(4) + chunkData(chunkLength).
    const chunkLength = dv.getUint32(12, true);
    const chunkType = dv.getUint32(16, true);
    if (chunkType !== CHUNK_TYPE_JSON) return null;
    if (20 + chunkLength > glb.byteLength) return null;
    return JSON.parse(new TextDecoder("utf-8").decode(new Uint8Array(glb, 20, chunkLength))) as MinimalGltfDocument;
  } catch {
    return null;
  }
}

/**
 * The materials of a GLB that use a texture with no image (neither its own `source` nor an extension's, such as
 * EXT_texture_webp): the 3D view refuses the WHOLE model for one ("/textures/364/source: Failed to find index").
 * ⚠️ OWNER, 2026-11-12: the pipeline could not save a greyscale picture as WebP and wrote its texture without it; the
 * upload took the file and every tablet then failed to load the villa. Empty when it has none, or cannot be read.
 */
export function materialsMissingImages(glb: ArrayBuffer): string[] {
  const doc = gltfDocument(glb);
  if (!doc?.textures) return [];
  const missing = new Set(doc.textures.flatMap((t, i) =>
    typeof t.source === "number" || Object.values(t.extensions ?? {}).some((e) => typeof e?.source === "number") ? [] : [i]));
  if (!missing.size) return [];
  const names = (doc.materials ?? []).flatMap((m, i) => {
    const used = JSON.stringify(m).match(/"index":\s*\d+/g)?.some((x) => missing.has(Number(x.split(":")[1]))) ?? false;
    return used ? [m.name || `material ${i}`] : [];
  });
  return names.length ? names : [...missing].map((i) => `texture ${i}`);
}

/**
 * Extract the embedded room/entity plan JSON from a GLB's glTF extras, or
 * null if this GLB carries none — an older pipeline's export, a hand-built
 * GLB, or anything not in glTF-Binary form at all. Never throws: any parse
 * failure (corrupt file, unexpected layout) is treated the same as "not
 * present" so a malformed GLB doesn't block the upload it's actually there
 * for. The returned string is the SAME shape a ".rooms.json" sidecar has —
 * validate it with config/roomData.readRoomData exactly like an uploaded file.
 */
export function extractEmbeddedRoomDataJson(glb: ArrayBuffer): string | null {
  for (const node of gltfDocument(glb)?.nodes ?? []) {
    const raw = node.extras?.[ROOMS_JSON_EXTRAS_KEY];
    if (typeof raw === "string" && raw.length > 0) return raw;
  }
  return null;
}
