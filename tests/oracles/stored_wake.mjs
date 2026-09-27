// Two small shared seams (2.496.196):
//   utils/storedJson — the one way a value is kept in localStorage: absent,
//     corrupt, wrong shape and storage-disabled all read as null, a refused
//     write is false. localModel.getModelMeta had a bare JSON.parse on the
//     boot path; five other files each carried their own guard.
//   utils/deviceWake — the one "device woke up" signal (visible, focus,
//     online) the HA socket and the store refresh both subscribe to; each
//     used to listen for a different two of the three.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";


// A localStorage stub that can be corrupted, disabled, or full.
const store = new Map(); let disabled = false, full = false;
globalThis.localStorage = {
  getItem: (k) => { if (disabled) throw new Error("SecurityError"); return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { if (disabled) throw new Error("SecurityError"); if (full) throw new Error("QuotaExceeded"); store.set(k, String(v)); },
  removeItem: (k) => { if (disabled) throw new Error("SecurityError"); store.delete(k); },
};
const { readJson, writeJson, readString, writeString, removeStored } = await import("@/utils/storedJson");
const { getModelMeta } = await import("@/utils/localModel");
const { loadMeshCatalog } = await import("@/utils/meshCatalog");

console.log("  stored JSON:");
ck("absent reads as null", readJson("k") === null && readString("k") === null);
ck("a written value reads back", writeJson("k", { a: 1 }) === true && readJson("k").a === 1);
store.set("k", "{not json");
ck("corrupt reads as null, not a throw", readJson("k") === null);
store.set("k", JSON.stringify({ a: "no" }));
ck("the wrong shape reads as null when a check is given", readJson("k", (v) => typeof v?.a === "number") === null && readJson("k") !== null);
disabled = true;
ck("storage disabled: null and false, no throw", readJson("k") === null && writeJson("k", 1) === false && writeString("k", "1") === false && (removeStored("k"), true));
disabled = false; full = true;
ck("storage full: the write says so", writeJson("k", 1) === false);
full = false;
store.set("villa-kiosk:model-meta", "{corrupt");
ck("the model metadata (the boot path) reads a corrupt value as 'no stored model'", getModelMeta() === null);
store.set("villa-kiosk:mesh-catalog", JSON.stringify([1, 2]));
ck("a mesh catalogue of the wrong shape is empty, not a crash later", loadMeshCatalog().length === 0);

console.log("\n  who keeps values:");
{
  const SRC = new URL("../../src/utils/", import.meta.url);
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const bare = ["localModel.ts", "meshCatalog.ts", "viewPrefs.ts", "tapDebug.ts", "autoReload.ts"]
    .filter((f) => /localStorage\.(getItem|setItem|removeItem)\(/.test(strip(readFileSync(new URL(f, SRC), "utf8")).replace(/function storageWorks[\s\S]*?\n}/, "")));
  ck("no util reads or writes localStorage itself any more", bare.length === 0, bare);
}

console.log("\n  the wake signal:");
{
  const docL = new Map(), winL = new Map();
  globalThis.document = { hidden: false, addEventListener: (t, f) => docL.set(t, f), removeEventListener: (t) => docL.delete(t) };
  globalThis.window = { addEventListener: (t, f) => winL.set(t, f), removeEventListener: (t) => winL.delete(t) };
  const { onWake } = await import("@/utils/deviceWake");
  let n = 0;
  const stop = onWake(() => n++);
  ck("visible, focus and online each wake", (docL.get("visibilitychange")(), winL.get("focus")(), winL.get("online")(), n === 3), n);
  globalThis.document.hidden = true; docL.get("visibilitychange")();
  ck("  ...but becoming HIDDEN does not", n === 3);
  stop();
  ck("unsubscribe removes all three", docL.size === 0 && winL.size === 0);
  const ws = readFileSync(new URL("../../src/ha/HAWebSocket.ts", import.meta.url), "utf8");
  const sr = readFileSync(new URL("../../src/hooks/useStoreRefresh.ts", import.meta.url), "utf8");
  ck("the HA socket and the store refresh both subscribe to it, and to nothing of their own",
     /this\.wakeUnsubscribe = onWake\(\(\) => this\.checkHealth\(\)\)/.test(ws) && /const stopWake = onWake\(refresh\);/.test(sr)
     && !/addEventListener\("(visibilitychange|focus|online)"/.test(ws + sr));
}

done("✅ one stored-JSON seam; one wake signal");

