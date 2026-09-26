// The model's bytes, one way (src/utils/modelPrefetch.modelBytes, round 10,
// 2.496.162). The profile screen's background download was a plain fetch +
// stall watchdog while the canvas used fetchModelWithRetry — two strategies
// for one file (9cd91cb3 fixed the stall on the path the failure was NOT on).
// Driven against a fake add-on.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);

const noop = () => {};
globalThis.window = { location: { origin: "http://localhost", pathname: "/", protocol: "http:", host: "localhost" }, addEventListener: noop, removeEventListener: noop };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

const GLB = new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0]);
let dropNext = 0; const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); calls.push(`${init.method ?? "GET"} ${u.replace(/^.*\//, "")}`);
  if (u.endsWith("addon-config")) return new Response(JSON.stringify({ model_path: "villa.glb" }), { status: 200 });
  if (u.includes("missing.glb")) return new Response("", { status: 404 });
  if (init.method === "HEAD") return new Response(null, { status: 200, headers: { ETag: '"e1"' } });
  if (dropNext > 0) { dropNext--; throw new TypeError("Failed to fetch"); }   // a network blip
  return new Response(GLB, { status: 200, headers: { "content-length": String(GLB.length) } });
};

const P = await import("@/utils/modelPrefetch");
const { versionedModelUrl } = await import("@/utils/centralModel");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const until = async (pred, ms = 8000) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); return pred(); };

// The profile screen starts the download; it hits a network blip first.
dropNext = 1;
P.startModelPrefetch();
const url = await versionedModelUrl("villa.glb");
await until(() => calls.filter((c) => c.startsWith("GET villa.glb")).length >= 1);
let retried = 0; const progress = [];
const got = await P.modelBytes(url, (f) => progress.push(f), () => { retried++; });
ck("the background download rides a network blip (it had no retry before) and is reused", got.ok && got.prefetched && got.data.byteLength === GLB.length, got);
ck("  ...the model was fetched ONCE after the blip — not again by the canvas", calls.filter((c) => c.startsWith("GET villa.glb")).length === 2, calls);
ck("  ...its progress reaches the canvas", progress.length > 0 && progress.at(-1) === 1, progress);

const fresh = await P.modelBytes(url, noop);
ck("claimed once: a second ask fetches afresh", fresh.ok && !fresh.prefetched);
const other = await P.modelBytes(`${url}&other`, noop);
ck("a different URL (the model was replaced) is fetched, never served the old bytes", other.ok && !other.prefetched);
const missing = await P.modelBytes("http://localhost/model/missing.glb", noop);
ck("an HTTP error comes back as it is, unretried (a real 'nothing there')", !missing.ok && missing.status === 404 && calls.filter((c) => c.includes("missing.glb")).length === 1);

const { readFileSync } = await import("node:fs");
const mp = readFileSync(new URL("../../src/utils/modelPrefetch.ts", import.meta.url), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
ck("ONE fetch strategy: the background download uses fetchModelWithRetry, never a bare fetch", /e\.promise = fetchModelWithRetry\(/.test(mp) && !/\bfetch\(/.test(mp));
const bc = readFileSync(new URL("../../src/components/canvas/BabylonCanvas.tsx", import.meta.url), "utf8");
ck("the canvas makes one call for the bytes", /await modelBytes\(/.test(bc) && !/claimPrefetch|fetchModelWithRetry\(/.test(bc));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one way to the model's bytes");
process.exit(0);
