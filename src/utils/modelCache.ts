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

// ── The page keeps the model itself (2.496.255) ────────────────────────────
// Under Home Assistant (Ingress) this app registers NO service worker (see
// main.tsx), so nothing of ours kept the 17 MB model: it survived only if the
// browser's own HTTP cache happened to keep it. Chromium's does not keep an
// entry larger than a fraction of its cache, and the Android Companion app's
// WebView cache is small — the field showed the phone downloading the whole
// model on EVERY open (fetchMs 2.4-22 s, eight opens in a row, two of them on
// the same version), while the villa's own import took under 2 s. The rig
// (an Ingress path, Chromium) reproduced it: one full download per open.
//
// So the page keeps it in Cache Storage, which needs no service worker and is
// sized by the origin's storage quota, not the HTTP cache. It is THE SAME cache
// the worker uses on the add-on's own hostname, so purgeModelCache (sign-out on
// a shared tablet) clears it too, and a page controlled by that worker leaves
// the writing to it rather than storing the file twice.

/** The model bytes this device kept for `url`, or null (none, another
 *  version, or the Cache API unavailable). Never throws. */
export async function keptModel(url: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await globalThis.caches?.open(MODEL_CACHE_NAME);
    const hit = await cache?.match(url);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Whether THIS app's own service worker (public/sw.js, registered by
 *  utils/swUpdate as "./sw.js") controls the page — it then keeps the model
 *  itself. Any other worker does not count.
 *
 *  ⚠️ IT USED TO ASK "IS ANY WORKER IN CONTROL?" (2.496.255), and inside Home
 *  Assistant one always is: Home Assistant's own (/service_worker.js), which
 *  knows nothing of the model. So the copy was never kept there — the phone's
 *  next open still downloaded it (field, 2.496.256: modelKept false, swMs 190). */
export function ownWorkerControls(): boolean {
  try {
    const script = globalThis.navigator?.serviceWorker?.controller?.scriptURL;
    if (!script || !globalThis.location) return false;
    return new URL(script).pathname === new URL("./sw.js", globalThis.location.href).pathname;
  } catch {
    return false;
  }
}

/** Keep `data` as the model at `url`, dropping every other version of the
 *  same file first (only one copy of a many-MB model may ever be kept). Skips
 *  when this app's own service worker controls the page: it keeps the file
 *  itself. Never throws — a model that could not be kept is downloaded again
 *  next time. */
export async function keepModel(url: string, data: ArrayBuffer): Promise<boolean> {
  try {
    if (ownWorkerControls()) return false;
    const cache = await globalThis.caches?.open(MODEL_CACHE_NAME);
    if (!cache) return false;
    const file = (u: string) => new URL(u, globalThis.location?.href).pathname.split("/").pop();
    const mine = file(url);
    for (const k of await cache.keys()) {
      if (file(k.url) === mine && new URL(k.url).href !== new URL(url, globalThis.location?.href).href) await cache.delete(k);
    }
    await cache.put(url, new Response(data, { headers: { "Content-Type": "model/gltf-binary" } }));
    return true;
  } catch {
    return false;
  }
}
