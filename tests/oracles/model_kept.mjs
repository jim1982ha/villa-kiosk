// The page keeps the villa's model itself (src/utils/modelCache keptModel /
// keepModel, used by modelPrefetch, 2.496.255). Under Home Assistant this app
// registers no service worker, so nothing of ours kept the 17 MB file: field
// telemetry showed a phone downloading all of it on every open (fetchMs
// 2.4-22 s), and a Chromium rig on an Ingress path did the same. Driven here
// against a fake Cache Storage and a counting fetch.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";

const noop = () => {};
globalThis.window = { location: { origin: "http://localhost", pathname: "/", protocol: "http:", host: "localhost" }, addEventListener: noop, removeEventListener: noop };
globalThis.location = { href: "http://localhost/api/hassio_ingress/TOK/" };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true, serviceWorker: { controller: null } }, configurable: true });

// A fake CacheStorage: name → Map(absolute url → bytes).
const stores = new Map();
const abs = (u) => new URL(u, globalThis.location.href).href;
globalThis.caches = {
  open: async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (u) => (m.has(abs(u)) ? new Response(m.get(abs(u)).slice(0)) : undefined),
      put: async (u, res) => { m.set(abs(u), await res.arrayBuffer()); },
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (k) => m.delete(typeof k === "string" ? abs(k) : k.url),
    };
  },
  delete: async (name) => stores.delete(name),
};

const GLB = new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0]);
let downloads = 0;
globalThis.fetch = async (url) => {
  downloads++;
  return new Response(GLB, { status: 200, headers: { "content-length": String(GLB.length) } });
};

const { MODEL_CACHE_NAME, keptModel, keepModel } = await import("@/utils/modelCache");
const P = await import("@/utils/modelPrefetch");
const settle = () => new Promise((r) => setTimeout(r, 20));
const V1 = "/api/hassio_ingress/TOK/model/villa.glb?v=1", V2 = "/api/hassio_ingress/TOK/model/villa.glb?v=2";

const first = await P.modelBytes(V1, noop);
await settle();
ck("the first open downloads the model, and says it was not kept", first.ok && !first.kept && downloads === 1, { first, downloads });
ck("  ...and keeps it, in the cache the sign-out purge clears", (await keptModel(V1))?.byteLength === GLB.length && stores.has(MODEL_CACHE_NAME));
const second = await P.modelBytes(V1, noop);
ck("THE NEXT OPEN READS THE KEPT COPY: no download, the same bytes, `kept` for the load record",
   second.ok && second.kept && downloads === 1 && new Uint8Array(second.data)[0] === 103, { second, downloads });

const third = await P.modelBytes(V2, noop);
await settle();
ck("a new version is downloaded (the stamp moved)", third.ok && !third.kept && downloads === 2);
ck("  ...and only ONE version of the file is ever kept", (await keptModel(V1)) === null && (await keptModel(V2)) !== null
   && stores.get(MODEL_CACHE_NAME).size === 1, [...stores.get(MODEL_CACHE_NAME).keys()]);

stores.get(MODEL_CACHE_NAME).set(abs("/other/rooms.json"), new ArrayBuffer(1));
await keepModel(V1, GLB.buffer);
ck("  ...other files in the cache are left alone", stores.get(MODEL_CACHE_NAME).has(abs("/other/rooms.json")));

navigator.serviceWorker.controller = {};
stores.clear();
ck("a page a service worker controls leaves the keeping to it (one copy, not two)",
   (await keepModel(V1, GLB.buffer)) === false && !stores.size);
navigator.serviceWorker.controller = null;

const saved = globalThis.caches;
globalThis.caches = undefined;
const noCache = await P.modelBytes(V1, noop);
ck("no Cache API (insecure context): the model is still downloaded, never an error", noCache.ok && !noCache.kept && downloads === 3);
globalThis.caches = { open: async () => { throw new Error("SecurityError"); } };
ck("  ...and a blocked one reads as nothing kept, never a throw", (await keptModel(V1)) === null && (await keepModel(V1, GLB.buffer)) === false);
globalThis.caches = saved;

done("✅ the villa's model is downloaded once, then kept");
