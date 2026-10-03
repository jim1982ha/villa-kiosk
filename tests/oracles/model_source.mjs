// Which model this load shows, and what each failure means
// (src/utils/modelSource.ts) — driven with fakes. It was inline in
// BabylonCanvas's load effect, tested only by a regex (round 11, 2.496.172).
//
// 2.496.254: no answer from the add-on is NOT "no model" (a 502 while it
// restarted showed the upload screen on a villa that had a model), and the
// per-browser model is gone.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
globalThis.window = { location: { origin: "http://localhost", pathname: "/", protocol: "http:", host: "localhost" }, addEventListener() {}, removeEventListener() {} };
const { acquireModel, ADDON_RETRY_MS } = await import("@/utils/modelSource");

const bytes = new ArrayBuffer(8);
const CFG = { model_path: "villa.glb", model_version: "65f0-1a2b", rooms_version: "65f0-2c" };
/** `answers`: what successive /addon-config reads return (the last repeats). */
const fake = (answers, o = {}) => {
  const calls = { reads: 0, forgot: 0, waits: [], fetched: [] };
  const deps = {
    readAddonConfig: async () => answers[Math.min(calls.reads++, answers.length - 1)],
    modelBytes: async (url, onProgress, onRetrying) => { calls.fetched.push(url); onRetrying?.(); onProgress(1); return o.http ? { ok: false, status: o.http } : { ok: true, data: bytes, prefetched: !!o.prefetched }; },
    forgetBrowserModel: async () => { calls.forgot++; },
    wait: async (ms) => { calls.waits.push(ms); },
  };
  return { deps, calls };
};
const hooks = (log, extra = {}) => ({ onProgress: (f) => log.push(`p${f}`), onRetrying: () => log.push("retry"), onCentral: (c) => log.push(`central:${c.model_path}`), ...extra });

{
  const { deps, calls } = fake([{ ok: true, cfg: CFG }], { prefetched: true }), log = [];
  const r = await acquireModel(deps, hooks(log));
  ck("the add-on's model is fetched by the VERSION it reported", r.ok && r.source.endsWith("model/villa.glb?v=65f0-1a2b") && calls.fetched[0] === r.source, r);
  ck("  ...the caller gets the add-on's answer (for the room data) BEFORE any bytes",
     r.cfg === CFG && log.join() === "central:villa.glb,retry,p1", log);
  ck("  ...and a model an older version kept in this browser is forgotten", calls.forgot === 1);
}
{
  const { deps, calls } = fake([{ ok: true, cfg: CFG }], { http: 404 });
  const r = await acquireModel(deps, hooks([]));
  ck("an HTTP status for the model is an ANSWER: MODEL_FETCH_HTTP_404, with the re-upload fix",
     !r.ok && r.reason === "http" && r.code === "MODEL_FETCH_HTTP_404" && /Re-upload/.test(r.message) && calls.fetched.length === 1, r);
}
{
  const { deps, calls } = fake([{ ok: true, cfg: { model_path: "" } }]);
  const r = await acquireModel(deps, hooks([]));
  ck("the add-on holds no model: 'none' (the upload screen), and nothing is fetched",
     !r.ok && r.reason === "none" && calls.fetched.length === 0 && calls.reads === 1, r);
}
{
  const { deps, calls } = fake([{ ok: false, status: 502 }, { ok: false }, { ok: false, status: 401 }, { ok: true, cfg: CFG }]), log = [];
  const r = await acquireModel(deps, hooks(log));
  ck("NO ANSWER IS NOT 'NO MODEL': a 502, a dropped request and a 401 are retried, then the model loads",
     r.ok && calls.reads === 4 && calls.fetched.length === 1, { r, calls });
  ck("  ...with the reconnecting notice each time, and a growing wait",
     log.slice(0, 3).join() === "retry,retry,retry" && calls.waits.join() === ADDON_RETRY_MS.slice(0, 3).join(), { log, waits: calls.waits });
}
{
  const { deps, calls } = fake([{ ok: false }]);
  let n = 0;
  const r = await acquireModel(deps, hooks([], { cancelled: () => ++n > 12 }));
  ck("  ...for as long as the screen is open (the wait settles at its longest), never 'none'",
     !r.ok && r.reason === "cancelled" && calls.fetched.length === 0
     && calls.waits.at(-1) === ADDON_RETRY_MS.at(-1) && calls.waits.length >= ADDON_RETRY_MS.length, { r, waits: calls.waits });
}

console.log("\n  asking the add-on (centralModel.readAddonConfig):");
{
  let replies = [];
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const r = replies.shift();
    if (r === "drop") throw new TypeError("Failed to fetch");
    return new Response(r.body ?? "", { status: r.status });
  };
  const C = await import("@/utils/centralModel");
  replies = [{ status: 502 }];
  const a502 = await C.readAddonConfig();
  ck("a 502 is no answer, with its status — returned at once, not retried", !a502.ok && a502.status === 502 && seen.length === 1, a502);
  replies = ["drop", "drop", "drop"];
  const aNet = await C.readAddonConfig();
  ck("three dropped requests are no answer (no status)", !aNet.ok && aNet.status === undefined && seen.length === 4, aNet);
  replies = [{ status: 502 }];
  ck("  ...the callers to whom no answer means nothing to show still read 'no model'", (await C.fetchAddonConfig()).model_path === "");
  replies = [{ status: 200, body: JSON.stringify(CFG) }];
  const a200 = await C.readAddonConfig();
  ck("a 200 is the answer, and is kept for the page", a200.ok && a200.cfg.model_version === CFG.model_version && (await C.readAddonConfig()).ok && seen.length === 6, seen);
  ck("the room data's URL is its own file, with its own version",
     C.centralRoomsUrl(CFG).endsWith("model/villa.rooms.json?v=65f0-2c") && C.centralRoomsUrl({ model_path: "" }) === "");
}

const bc = readFileSync(new URL("../../src/components/canvas/BabylonCanvas.tsx", import.meta.url), "utf8");
ck("BabylonCanvas asks acquireModel, with the real dependencies, and fetches no model itself",
   /await acquireModel\(\{\s*readAddonConfig, modelBytes, forgetBrowserModel,/.test(bc)
   && (bc.match(/await modelBytes\(|fetchAddonConfig\(/g) ?? []).length === 0);
ck("  ...it stops when the screen goes, and starts the room data from the add-on's answer",
   /cancelled: \(\) => cancelled/.test(bc) && /roomsSync\.promise = fetchRoomData\(centralRoomsUrl\(cfg\)\)/.test(bc));
ck("  ...and an HTTP answer still sets the error code and the owner's re-upload action",
   /if \(!got\.ok && got\.reason === "http"\) \{\s*setAddonError\(true\);\s*loadErrorCode = got\.code;/.test(bc));

done("✅ one answer to where the model comes from");
