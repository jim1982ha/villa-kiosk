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
const CACHE = "villa-kiosk-v4";
// The big central 3D model (GLB/SH3D, tens of MB) lives in its OWN cache that
// survives app updates — it rarely changes and re-downloading it on every open
// is the main load-time cost. Version-stamped URLs (?v=<etag>) invalidate it.
const MODEL_CACHE = "villa-kiosk-model-v1";
const SHELL = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
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

  // Central 3D model files (GLB/SH3D): cache-first in the persistent model cache.
  // Checked BEFORE the /api/ exclusion below because, behind Ingress, the model
  // is served under /api/hassio_ingress/<token>/model/… — without this branch it
  // matched the "never cache" rule and was re-downloaded on every single open.
  if (url.pathname.includes("/model/") && !url.pathname.includes("camera_proxy")) {
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
