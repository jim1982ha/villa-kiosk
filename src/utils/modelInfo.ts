// src/utils/modelInfo.ts
// Fingerprint of the GLB that is ACTUALLY loaded into the scene right now, so the
// UI can prove which file is in use — independent of entity state (you don't need
// to toggle a light to check). Compare the SHA-256 / byte size shown in Settings
// against the file on disk:  shasum -a 256 TheLysHouse_1F.glb  /  ls -l.

export interface LoadedModelInfo {
  /** Resolved fetch URL including the ?v=<etag/size> cache-busting tag (or a note). */
  url: string;
  bytes: number;
  /** Full SHA-256 hex of the loaded bytes, or "" if Web Crypto is unavailable. */
  sha256: string;
  /** Number of distinct named, vertex-bearing meshes after import. */
  meshCount: number;
  /**
   * How long getting the bytes took (network fetch, or the IndexedDB read in
   * standalone/dev mode) vs. how long Babylon then took to parse them into a
   * scene (decode geometry, build materials, upload GPU buffers). A fast
   * fetch (a service-worker cache hit is normally well under a second) with a
   * still-slow overall load means the cost is the parse, not the network —
   * see this app's caching docs in storage.ts/sw.js, which can only ever
   * speed up the fetch half.
   */
  fetchMs: number;
  parseMs: number;
  /** parseMs split in two: Babylon's own SceneLoader.ImportMeshAsync (parse
   *  glTF, decompress Draco geometry, decode every texture, upload to GPU)
   *  vs. this app's own post-processing (mesh indexing, structure/collision
   *  setup). Almost all of parseMs is normally importMs — a many-texture GLB
   *  (see ModelLoader.ts's lightmap mode, which keeps every original tiled
   *  texture rather than one atlas) makes Babylon's own decode/upload work
   *  the dominant cost, not this app's JS. */
  importMs: number;
  postMs: number;
}

let _info: LoadedModelInfo | null = null;

export function setLoadedModelInfo(info: LoadedModelInfo): void {
  _info = info;
}

export function getLoadedModelInfo(): LoadedModelInfo | null {
  return _info;
}

/** SHA-256 of a buffer as lowercase hex. Returns "" if Web Crypto isn't available
 *  (non-secure context); the byte size + mesh count are still a strong fingerprint. */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  try {
    if (!globalThis.crypto?.subtle) return "";
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}
