// Where the villa's model comes from, and what each failure means
// (src/utils/modelSource.ts, round 11, 2.496.172) — driven with fakes. It was
// inline in BabylonCanvas's load effect, tested only by a regex.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { acquireModel } = await import("@/utils/modelSource");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const bytes = new ArrayBuffer(8);
const fake = (o = {}) => {
  const calls = { idb: 0, cleared: 0, fetched: [] };
  const deps = {
    versionedModelUrl: async (p) => `${p}?v=1`,
    modelBytes: async (url, onProgress, onRetrying) => { calls.fetched.push(url); onRetrying?.(); onProgress(1); return o.http ? { ok: false, status: o.http } : { ok: true, data: bytes, prefetched: !!o.prefetched }; },
    fromIndexedDB: async () => { calls.idb++; return o.idb ?? null; },
    hasStoredMeta: () => !!o.meta,
    clearStoredModel: async () => { calls.cleared++; },
  };
  return { deps, calls };
};
const hooks = (log) => ({ onProgress: (f) => log.push(`p${f}`), onRetrying: () => log.push("retry"), onCentral: (p) => log.push(`central:${p}`) });

{
  const { deps, calls } = fake({ prefetched: true, idb: bytes }), log = [];
  const r = await acquireModel("/model/villa.glb", deps, hooks(log));
  ck("a central model is fetched by its VERSIONED url, from the add-on", r.ok && r.fromAddon && r.source === "/model/villa.glb?v=1" && calls.fetched[0] === "/model/villa.glb?v=1", r);
  ck("  ...and the browser's own upload is never consulted (no fallback)", calls.idb === 0);
  ck("  ...the prefetch flag, the progress and the retry notice all reach the caller", r.prefetched && log.join() === "central:/model/villa.glb,retry,p1", log);
}
{
  const { deps, calls } = fake({ http: 404, idb: bytes });
  const r = await acquireModel("/model/villa.glb", deps, hooks([]));
  ck("an HTTP status is an ANSWER: MODEL_FETCH_HTTP_404, with the re-upload fix — and no fallback",
     !r.ok && r.reason === "http" && r.code === "MODEL_FETCH_HTTP_404" && /Re-upload/.test(r.message) && calls.idb === 0, r);
}
{
  const { deps } = fake({ idb: bytes });
  const r = await acquireModel(undefined, deps, hooks([]));
  ck("no central model: this browser's upload", r.ok && !r.fromAddon && r.source === "(per-browser IndexedDB upload)", r);
}
{
  const { deps, calls } = fake({ meta: true });
  const r = await acquireModel("", deps, hooks([]));
  ck("nothing anywhere: 'none' (the no-model screen), and a STALE meta record is cleared", !r.ok && r.reason === "none" && calls.cleared === 1, calls);
  const f2 = fake({});
  await acquireModel(null, f2.deps, hooks([]));
  ck("  ...no meta, nothing to clear", f2.calls.cleared === 0);
}

const bc = readFileSync(new URL("../../src/components/canvas/BabylonCanvas.tsx", import.meta.url), "utf8");
ck("BabylonCanvas asks acquireModel, with the real dependencies, and fetches no model itself",
   /await acquireModel\(addonCfg\.model_path, \{/.test(bc) && /fromIndexedDB: loadModelFromIndexedDB/.test(bc)
   && (bc.match(/await modelBytes\(|await loadModelFromIndexedDB\(\)/g) ?? []).length === 0);
ck("  ...and an HTTP answer still sets the error code and the owner's re-upload action",
   /if \(!got\.ok && got\.reason === "http"\) \{\s*setAddonError\(true\);\s*loadErrorCode = got\.code;/.test(bc));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one answer to where the model comes from");
