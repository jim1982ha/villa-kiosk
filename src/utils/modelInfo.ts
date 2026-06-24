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
