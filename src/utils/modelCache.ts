// The service worker's persistent model cache, named ONCE for the page side.
//
// public/sw.js serves a cached GLB / rooms sidecar BEFORE the network — and so
// before nginx's /model/ gate, which requires a session. On a shared tablet the
// floor plan therefore outlived the session it was fetched under: the next
// person, with no passcode, was served it from the cache (2.496.206). The
// profile context purges it whenever a session ends. The name must match the
// worker's `MODEL_CACHE`; tests/oracles/model_cache_purge.mjs pins that.
export const MODEL_CACHE_NAME = "villa-kiosk-model-v2";

/** Drop every cached model file. False when there was nothing to drop or the
 *  Cache API is unavailable (insecure context, storage blocked) — a purge that
 *  cannot run must never block the sign-out that asked for it. */
export async function purgeModelCache(): Promise<boolean> {
  try {
    return (await globalThis.caches?.delete(MODEL_CACHE_NAME)) === true;
  } catch {
    return false;
  }
}
