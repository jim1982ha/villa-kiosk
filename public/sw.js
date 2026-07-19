/* Villa Kiosk service worker.
 *
 * Strategy:
 *  - HTML navigation (the unhashed app shell): NETWORK-FIRST with a cache
 *    fallback. The shell references content-hashed assets, so serving a stale
 *    cached shell after an update would pin the whole app to old asset hashes
 *    (the same stale-UI failure the nginx `no-cache` header guards against).
 *    Network-first keeps the UI fresh online while still booting from cache if
 *    HA is briefly unreachable after a reboot.
 *  - Other static assets (hashed JS/CSS, fonts, icons): cache-first with a
 *    background refresh — they are immutable, so this is safe and fast.
 *  - Everything else (HA WebSocket is not HTTP; camera proxy, REST history):
 *    network-only — we never want to serve a stale camera frame or sensor value.
 */
const CACHE = "villa-kiosk-v6";
// The big central 3D model (GLB/SH3D, tens of MB) lives in its OWN cache that
// survives app updates — it rarely changes and re-downloading it on every open
// is the main load-time cost. Version-stamped URLs (?v=<etag>) invalidate it.
const MODEL_CACHE = "villa-kiosk-model-v1";
// Precache index.html by its explicit path, NOT the bare directory "./":
// Home Assistant's static file server returns "403: Forbidden" for a directory
// request (it won't auto-serve index.html), which would reject cache.addAll and
// also 403 the installed PWA at launch. The manifest start_url points at
// ./index.html for the same reason.
const SHELL = ["./index.html", "./manifest.json"];

// Warm the big content-hashed chunks (Babylon engine, Draco decoder, HLS,
// app JS/CSS) into the cache DURING install — while the OLD service worker is
// still the one actually serving the page — instead of only ever caching them
// reactively on first fetch. Without this, whichever open happens to be the
// first AFTER a deploy that changed one of those chunks pays its full
// download cost live, right in the loading spinner. asset-manifest.json is
// generated at build time (see vite.config.ts's assetManifestPlugin) listing
// every file Vite emitted under /assets/. Best-effort: if the manifest fetch
// fails for any reason (offline install, dev server with no build), fall back
// to precaching just the shell — never blocks install entirely.
async function precacheAssets(cache) {
  try {
    const res = await fetch("./asset-manifest.json", { cache: "no-store" });
    if (!res.ok) return;
    const { assets } = await res.json();
    if (Array.isArray(assets) && assets.length) {
      await cache.addAll(assets.map((a) => `./${a}`));
    }
  } catch {
    // Best-effort — SHELL precache above is enough to install successfully.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).then(() => precacheAssets(cache)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== MODEL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Central 3D model files (GLB/room-data sidecar): cache-first in the
  // persistent model cache. Checked BEFORE the /api/ exclusion below because,
  // behind Ingress, the model is served under
  // /api/hassio_ingress/<token>/model/… — without this branch it matched the
  // "never cache" rule and was re-downloaded on every single open. Matched by
  // extension (not just the "/model/" path) so a standalone build's central
  // model — served at HA's own /local/ static route, see storage.ts's
  // probeStandaloneCentralModel — gets the same treatment, not just Ingress's.
  const isModelFile = url.pathname.endsWith(".glb") || url.pathname.endsWith(".rooms.json");
  if (isModelFile && !url.pathname.includes("camera_proxy")) {
    event.respondWith(modelCacheFirst(req, url));
    return;
  }

  // Never cache live HA data.
  if (
    url.pathname.includes("/api/") ||
    url.pathname.includes("/auth/") ||
    url.pathname.includes("camera_proxy")
  ) {
    return; // default network handling
  }

  // App-shell / static assets: cache-first with background refresh.
  const isStatic =
    url.origin === self.location.origin ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com");

  if (!isStatic) return;

  const cacheCopy = (res) => {
    if (res && res.status === 200) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy));
    }
    return res;
  };

  // The unhashed HTML shell must stay fresh: network-first, fall back to cache
  // only when offline. (Hashed assets below are immutable, so cache-first.)
  const isNavigation =
    req.mode === "navigate" ||
    req.destination === "document" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith(".html");

  if (isNavigation) {
    event.respondWith(
      fetch(req).then(cacheCopy).catch(() => caches.match(req).then((c) => c || caches.match("./index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then(cacheCopy).catch(() => cached);
      return cached || network;
    }),
  );
});

// Cache-first for the central model. The ?v=<etag> stamp makes each version a
// distinct URL, so a cache hit is always the right bytes; when the model is
// replaced the stamp changes, we miss, fetch once, and prune the stale versions
// of the same path to cap cache growth.
async function modelCacheFirst(req, url) {
  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.status === 200) {
    const path = url.pathname;
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((k) => new URL(k.url).pathname === path && k.url !== req.url)
        .map((k) => cache.delete(k)),
    );
    await cache.put(req, res.clone());
  }
  return res;
}
