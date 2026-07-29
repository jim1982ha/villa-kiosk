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
interface MinimalGltfDocument {
  nodes?: MinimalGltfNode[];
}

/**
 * Extract the embedded room/entity plan JSON from a GLB's glTF extras, or
 * null if this GLB carries none — an older pipeline's export, a hand-built
 * GLB, or anything not in glTF-Binary form at all. Never throws: any parse
 * failure (corrupt file, unexpected layout) is treated the same as "not
 * present" so a malformed GLB doesn't block the upload it's actually there
 * for. The returned string is the SAME shape a ".rooms.json" sidecar has —
 * validate it with sh3dParser.parseRoomData exactly like an uploaded file.
 */
export function extractEmbeddedRoomDataJson(glb: ArrayBuffer): string | null {
  try {
    if (glb.byteLength < 20) return null;
    const dv = new DataView(glb);
    if (dv.getUint32(0, true) !== GLB_MAGIC) return null;
    // Header: magic(4) + version(4) + total length(4) = 12 bytes, then the
    // first chunk: chunkLength(4) + chunkType(4) + chunkData(chunkLength).
    const chunkLength = dv.getUint32(12, true);
    const chunkType = dv.getUint32(16, true);
    if (chunkType !== CHUNK_TYPE_JSON) return null;
    const jsonEnd = 20 + chunkLength;
    if (jsonEnd > glb.byteLength) return null;
    const jsonBytes = new Uint8Array(glb, 20, chunkLength);
    const doc = JSON.parse(new TextDecoder("utf-8").decode(jsonBytes)) as MinimalGltfDocument;
    for (const node of doc.nodes ?? []) {
      const raw = node.extras?.[ROOMS_JSON_EXTRAS_KEY];
      if (typeof raw === "string" && raw.length > 0) return raw;
    }
    return null;
  } catch {
    return null;
  }
}
