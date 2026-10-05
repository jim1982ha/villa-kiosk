// tests/oracles/sw_lifecycle.mjs
//
// The service worker's UPDATE lifecycle — the one failure in this repo whose
// symptom is a kiosk that needs physical access.
//
// ⚠️ THE TWO HALVES ONLY WORK TOGETHER, WHICH IS WHY THEY ARE PINNED TOGETHER.
//   · The cache name was a hand-edited literal no release bumped, so `activate`
//     evicted nothing and every release added ~5 MB to one cache forever.
//   · `skipWaiting` + `clients.claim` seized an ALREADY-OPEN page.
// Fix the first alone and you convert a slow storage leak into an immediate
// brick: the new worker deletes the cache holding the running page's chunks,
// the image they came from has been replaced wholesale, and the next lazy
// import() 404s. The unbounded growth was load-bearing.
//
// The eviction logic is executed here, not described: `generationRank` and the
// keep-set are lifted out of the source and run over real cache-key sets.
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const SW = readFileSync(ROOT + "public/sw.js", "utf8");
const VITE = readFileSync(ROOT + "vite.config.ts", "utf8");
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};
const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

console.log("  the cache name is the build, not a literal:");
eq("sw.js carries the placeholder", SW.includes('const BUILD = "__SW_BUILD__"'), true);
eq("...and derives the cache from it", /const CACHE = `villa-kiosk-\$\{BUILD\}`/.test(code), true);
eq("no hand-edited version literal survives",
   /const CACHE = "villa-kiosk-v\d/.test(code), false);
eq("the build FAILS if the placeholder goes missing",
   /__SW_BUILD__[\s\S]{0,400}?throw new Error/.test(VITE), true);
eq("...and the stamp is written into the emitted worker",
   /sw\.split\("__SW_BUILD__"\)\.join\(pkgVersion\)/.test(VITE), true);

console.log("\n  and no running page is ever seized:");
// Either one alone re-arms the brick, so both are asserted absent — from the
// worker's OWN initiative. Since 2.496.256 the page may ASK it to skip waiting
// (src/utils/swUpdate.switchToWaiting), and reloads at once when it does; that
// page is not seized mid-run, it is restarting into the new build.
const installSrc = /self\.addEventListener\("install"[\s\S]*?\n\}\);/.exec(code)?.[0] ?? "";
eq("the install handler was found", installSrc.length > 0, true);
eq("install does not skipWaiting", /skipWaiting\s*\(/.test(installSrc), false);
eq("the worker skips waiting ONLY when the page asks (one call, in the message handler)",
   (code.match(/skipWaiting\s*\(/g) ?? []).length === 1
   && /addEventListener\("message"[\s\S]{0,200}?"SKIP_WAITING"\)\s*self\.skipWaiting\(\)/.test(code), true);
eq("activate does not claim clients", /clients\.claim\s*\(/.test(code), false);

console.log("\n  what activate actually evicts:");
// The real functions, lifted from the source so this cannot drift from it.
const rankSrc = /function generationRank\(name\) \{[\s\S]*?\n\}/.exec(code)?.[0] ?? "";
eq("generationRank was found in the source", rankSrc.length > 0, true);
const generationRank = new Function(`${rankSrc}; return generationRank;`)();
const KEEP = Number(/const KEEP_GENERATIONS = (\d+)/.exec(code)?.[1] ?? 0);
eq("KEEP_GENERATIONS is at least 2 — one generation is the brick",
   KEEP >= 2, true);

// ⚠️ THE REAL FUNCTION, LIFTED WHOLE — NOT A COPY OF IT. This block used to
// re-implement the keep-set here, so removing the model cache's exemption in
// sw.js changed nothing it asserted. Caught by mutating the source and watching
// this file stay green: the replica defect, in the oracle written against it.
const MODEL = /const MODEL_CACHE = "([^"]+)"/.exec(code)?.[1] ?? "";
eq("the model cache name was found", MODEL.length > 0, true);
const evictSrc = /function cachesToEvict\(keys, current\) \{[\s\S]*?\n\}/.exec(code)?.[0] ?? "";
eq("cachesToEvict was found in the source", evictSrc.length > 0, true);
const evictReal = new Function(
  "MODEL_CACHE", "KEEP_GENERATIONS", "generationRank",
  `${evictSrc}; return cachesToEvict;`,
)(MODEL, KEEP, generationRank);
const evict = (keys, current) => evictReal(keys, current).slice().sort();

// ⚠️ THE MODEL CACHE ALSO STARTS WITH "villa-kiosk-". It holds tens of MB of
// GLB that survives app updates on purpose, and a prefix match that swept it
// would re-download the whole villa on every release.
eq("the model cache is never evicted",
   evict([MODEL, "villa-kiosk-2.496.39"], "villa-kiosk-2.496.39"), []);
eq("the previous generation SURVIVES — an open page's chunks live there",
   evict(["villa-kiosk-2.496.38", "villa-kiosk-2.496.39"], "villa-kiosk-2.496.39"), []);
eq("the one before that does not",
   evict(["villa-kiosk-2.496.37", "villa-kiosk-2.496.38", "villa-kiosk-2.496.39"],
         "villa-kiosk-2.496.39"), ["villa-kiosk-2.496.37"]);
eq("growth is bounded however many pile up",
   evict(["villa-kiosk-2.496.30", "villa-kiosk-2.496.31", "villa-kiosk-2.496.32",
          "villa-kiosk-2.496.33", "villa-kiosk-2.496.39"], "villa-kiosk-2.496.39").length, 3);
// The hand-edited literal this replaced does not parse as a version, so it
// ranks last and is the first thing the new scheme clears out.
eq("the legacy villa-kiosk-v10 cache is evicted",
   evict(["villa-kiosk-v10", "villa-kiosk-2.496.39"], "villa-kiosk-2.496.39"),
   ["villa-kiosk-v10"]);
eq("...and ordering is by version, not lexicographic (39 > 9)",
   generationRank("villa-kiosk-2.496.39") > generationRank("villa-kiosk-2.496.9"), true);
eq("our own cache survives even on a first activate",
   evict(["villa-kiosk-2.496.39"], "villa-kiosk-2.496.39"), []);
// ⚠️ AND IN DEV, WHERE THE NAME DOES NOT PARSE. `npm run dev` serves public/
// unprocessed, so the cache is literally `villa-kiosk-__SW_BUILD__` — rank -1,
// excluded from the generations list, and deleted by the final filter unless
// `keep.add(current)` protects it. A worker that evicts its own cache on every
// activate re-downloads the shell every time, and the first mutation of that
// line went unnoticed because every fixture here used a parseable name.
eq("a dev build does not evict its own cache",
   evict(["villa-kiosk-__SW_BUILD__"], "villa-kiosk-__SW_BUILD__"), []);
eq("...while still clearing a real generation it is not using",
   evict(["villa-kiosk-__SW_BUILD__", "villa-kiosk-2.496.1", "villa-kiosk-2.496.2",
          "villa-kiosk-2.496.3"], "villa-kiosk-__SW_BUILD__"),
   ["villa-kiosk-2.496.1"]);

console.log("\n  and the escape hatch still matches its client:");
// ⚠️ THE RECOVERY MECHANISM FOR A BRICKED PWA, spelled in two modules and
// linked by nothing but a comment. If the two literals drift the hatch stops
// escaping, and the failure it guards against becomes unrecoverable.
const FP = readFileSync(ROOT + "src/utils/fetchProgress.ts", "utf8");
eq("sw.js knows the bypass header", code.includes("vk-sw-bypass"), true);
eq("...and the client sends the same one", FP.includes("vk-sw-bypass"), true);

console.log("\n  what happens to each request (swRoute, the real function):");
// Lifted whole, like cachesToEvict (2.496.233). tests/routes.py runs it over
// every proxy route; this pins the ORDER of its answers.
const routeSrc = [
  /const SW_BYPASS_PARAM = [^;]+;/, /const NEVER_CACHE = \[[\s\S]*?\];/,
  /const NEVER_CACHE_FRAGMENTS = \[[\s\S]*?\];/, /function swRoute\(url, mode, destination, origin\) \{[\s\S]*?\n\}/,
].map((re) => re.exec(code)?.[0] ?? "").join("\n");
eq("swRoute and its lists were found in the source", /function swRoute/.test(routeSrc) && /NEVER_CACHE_FRAGMENTS/.test(routeSrc), true);
const swRoute = new Function(`${routeSrc}; return swRoute;`)();
const O = "http://localhost";
const r = (path, mode = "cors", dest = "") => swRoute(new URL(O + path), mode, dest, O);
eq("the escape hatch wins over everything", r("/model/villa.glb?vk-sw-bypass=1"), "bypass");
eq("a model file is the model — even behind Ingress's /api/ prefix", r("/api/hassio_ingress/tok/model/villa.glb"), "model");
eq("  ...and its room sidecar", r("/model/villa.rooms.json"), "model");
eq("a camera snapshot ending in .glb is NOT a model", r("/api/camera_proxy/x.glb"), "network");
eq("the add-on's live endpoints go to the network, bare (the standalone hostname)", r("/device-config"), "network");
eq("  ...and behind Ingress", r("/api/hassio_ingress/tok/fm-data"), "network");
eq("another origin is not ours", swRoute(new URL("http://127.0.0.1:9/x.js"), "cors", "", O), "foreign");
eq("a navigation is a page (this worker's own saved shell first)", r("/index.html", "navigate", "document"), "page");
eq("a hashed asset is cache-first", r("/assets/index-abc.js"), "asset");

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ the worker updates without stranding a page"}`);
process.exit(fail ? 1 : 0);
