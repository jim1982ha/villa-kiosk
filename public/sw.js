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
const CACHE = "villa-kiosk-v7";  // v7: evict wrongly-cached API responses
// The big central 3D model (GLB/SH3D, tens of MB) lives in its OWN cache that
// survives app updates — it rarely changes and re-downloading it on every open
// is the main load-time cost. Version-stamped URLs (?v=<etag>) invalidate it.
//
// Bumped v1 -> v2 with the respondWith fix below: the `activate` handler
// deletes any cache not in its keep-list, so this drops whatever the old
// cache held. If the field failure WAS storage-quota-driven, that reclaims
// the space in one shot; if it wasn't, the only cost is a single clean
// re-download. Either way the deployed fix starts from a known-good state
// rather than inheriting a possibly-wedged cache.
const MODEL_CACHE = "villa-kiosk-model-v2";
// Escape hatch (see fetchProgress.ts's SW_BYPASS_PARAM): a request carrying
// this query param is passed straight to the network, no interception, no
// caching. The client escalates to it after a model fetch fails, so a service
// worker that is somehow still breaking the request — a bug here, a browser
// quirk, a SW being repeatedly killed under memory pressure — can never
// permanently brick the PWA the way it just did in the field.
const SW_BYPASS_PARAM = "vk-sw-bypass";
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

  // Client-requested bypass — pure network, before any other rule. Must stay
  // the FIRST check so it also escapes any future branch added below.
  if (url.searchParams.has(SW_BYPASS_PARAM)) return;

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
    event.respondWith(modelCacheFirst(event, req, url));
    return;
  }

  // Never cache live data — HA's, and the add-on's OWN dynamic endpoints.
  //
  // The add-on's endpoints only carried the "/api/" exclusion by accident:
  // behind Ingress they sit under /api/hassio_ingress/<token>/…, so they
  // matched. On the STANDALONE hostname (which is what the installed PWA
  // uses) the very same endpoints are bare paths like /device-config — same
  // origin, matching nothing here — so they fell through to the cache-first
  // branch below and were served from cache.
  //
  // That is not a stale-looking UI, it is a broken sync: a client would read
  // a pre-write copy of the shared config, diff against it, and push
  // conclusions drawn from data hours out of date. Seen in the field as a GET
  // four seconds after a confirmed write returning a document 1.8 hours old,
  // and as reads whose body predated the `rev` field entirely. It also made
  // the telemetry panel itself serve a stale ring — i.e. it corrupted the
  // very diagnostics used to investigate it.
  //
  // /model/*.glb is handled above (deliberately cache-first, version-stamped)
  // and /fm-evidence/<id> is content-addressed by a never-reused id, so both
  // stay cacheable. Everything listed here is mutable and must not be.
  const NEVER_CACHE = [
    "/device-config", "/fm-data", "/telemetry", "/addon-config", "/model-upload",
  ];
  if (
    url.pathname.includes("/api/") ||
    url.pathname.includes("/auth/") ||
    url.pathname.includes("camera_proxy") ||
    NEVER_CACHE.some((p) => url.pathname.endsWith(p))
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
//
// THE GOVERNING RULE HERE, learned the hard way twice: the promise handed to
// event.respondWith() IS the page's network request. Anything that can reject
// inside it fails that request, and the page sees exactly
// "TypeError: Failed to fetch" — with no way to tell it apart from a real
// outage. So the ONLY thing allowed to reject out of this function is a
// genuine network failure with nothing cached to fall back on.
//
// A previous fix guarded the fetch() alone and was reported as still broken.
// It was: on a cache MISS this function used to `await cache.put(...)` (plus
// an await'ed keys()/delete() prune) INSIDE the respondWith promise, after
// the bytes had already arrived. Any failure in that write — a
// QuotaExceededError on a 15 MB entry, a response header combination the
// Cache API refuses (`Vary: *`), or the service worker being killed mid-write
// under memory pressure, which this very device does constantly (its own
// telemetry shows context-lost climbing past 30 in a session) — rejected the
// page's request AFTER a fully successful 15 MB download. Deterministic, so
// the client's retry loop re-downloaded and re-failed identically until its
// whole budget was gone: the field report shows 124 s elapsed against a 120 s
// budget, i.e. every single attempt died the same way. Under Ingress the
// service worker isn't registered at all (see main.tsx), which is precisely
// why the add-on kept working while the PWA could not load at all.
//
// So now: the response is returned to the page the moment it exists, and the
// cache write happens in the BACKGROUND, fully isolated. Nothing about
// caching can fail the request any more — the worst case is an uncached
// model (slower next open), never a broken one. This also halves the peak
// memory held in the response path and shrinks the window in which the SW
// must stay alive, both of which were feeding the very memory pressure that
// triggers the kill.
async function modelCacheFirst(event, req, url) {
  const path = url.pathname;
  let cache = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
  } catch {
    // Storage unavailable/blocked/corrupted — caching is an optimisation, so
    // fall through to a plain network fetch rather than failing the request.
    cache = null;
  }

  let res;
  try {
    res = await fetch(req);
  } catch (err) {
    // Network genuinely failed. ANY cached copy of this path (even a stale
    // ?v=) beats a dead load — the next successful open still gets the
    // current bytes, since the stamp only moves forward.
    if (cache) {
      try {
        const stale = await findStaleModelCacheEntry(cache, path);
        if (stale) return stale;
      } catch { /* cache read failed too — fall through to the throw */ }
    }
    throw err; // nothing to fall back to — the page's retry logic owns it
  }

  // Background, best-effort cache write. Deliberately NOT awaited: see the
  // rule above. waitUntil keeps the worker alive for the write when it's
  // still accepted (the event may already have settled by now, which throws
  // InvalidStateError — in that case just let it run unsupervised).
  if (cache && res && res.status === 200) {
    let copy;
    try { copy = res.clone(); } catch { copy = null; }
    if (copy) {
      const write = storeModel(cache, req, path, copy).catch(() => {});
      try { event.waitUntil(write); } catch { /* event no longer active */ }
    }
  }
  return res;
}

/** Prune older ?v= entries for this path, then store the new one. Isolated so
 *  every failure mode stays off the response path (see modelCacheFirst). */
async function storeModel(cache, req, path, body) {
  try {
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((k) => new URL(k.url).pathname === path && k.url !== req.url)
        .map((k) => cache.delete(k)),
    );
    await cache.put(req, body);
  } catch (err) {
    // Out of storage: reclaim the whole model cache so the NEXT open has room
    // to cache cleanly. Deliberately no retry with `body` here — a failed
    // cache.put has already consumed it, so re-putting would throw "body
    // already used" and mask the real error. Freeing the space is the fix;
    // this load already has its bytes and continues unaffected.
    if (err && err.name === "QuotaExceededError") {
      await caches.delete(MODEL_CACHE);
      return;
    }
    throw err;
  }
}

/** Any cached response for this exact path, regardless of its ?v= stamp —
 *  used only as a last-resort fallback when a fresh fetch fails outright. */
async function findStaleModelCacheEntry(cache, path) {
  const keys = await cache.keys();
  const match = keys.find((k) => new URL(k.url).pathname === path);
  return match ? cache.match(match) : undefined;
}
