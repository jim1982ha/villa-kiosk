/* Villa Kiosk service worker.
 *
 * Strategy:
 *  - App shell (HTML/JS/CSS/fonts/icons): cache-first, so the kiosk still boots
 *    if HA is briefly unreachable after a reboot.
 *  - Everything else (HA WebSocket is not HTTP; camera proxy, REST history):
 *    network-only — we never want to serve a stale camera frame or sensor value.
 */
const CACHE = "villa-kiosk-v2";
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

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

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
