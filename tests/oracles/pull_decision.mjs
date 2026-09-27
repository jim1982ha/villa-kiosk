// A shared store never lets a fetched copy overwrite this device's own work.
//
// ⚠️ THE FACILITY STORE ASKED ONLY BEFORE ITS FETCH. A completion logged while
// a refresh was in flight, whose save finished first, left `inFlight` at 0 —
// and the stale copy then replaced it on screen until a later refresh. The
// device-config sync had always asked AFTER the fetch, for exactly this window.
// Both now ask utils/pullDecision. This checks the rule, replays the race
// through it, and pins that both stores ask it after the await.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { decidePull } = await import("@/utils/pullDecision");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const base = { writeInFlight: false, reached: true, serverEmpty: false, localAhead: false, wouldChange: true };
const d = (over) => decidePull({ ...base, ...over });

console.log("  the rule, in order:");
ck("a write in flight waits — its answer is newer than any fetch", d({ writeInFlight: true, reached: false }) === "wait");
ck("nothing came back: keep what we have", d({ reached: false }) === "unreachable");
ck("an empty store is seeded (an EMPTY baseline, pushed normally)", d({ serverEmpty: true, localAhead: true }) === "seed");
ck("work the server has not got is re-sent, never overwritten", d({ localAhead: true }) === "repush");
ck("nothing new: touch nothing (no fresh objects, no re-index)", d({ wouldChange: false }) === "noop");
ck("otherwise the server's copy is taken", d({}) === "apply");

console.log("\n  the Facility race:");
// A refresh starts; a completion is logged and SAVED while it fetches; the stale copy arrives.
const staleArrives = { writeInFlight: false, reached: true, serverEmpty: false, wouldChange: true };
const oldRule = decidePull({ ...staleArrives, localAhead: false /* only `unsaved`, checked before the fetch */ });
const newRule = decidePull({ ...staleArrives, localAhead: true /* a write STARTED during the fetch */ });
ck("the old before-the-fetch rule would APPLY the stale copy", oldRule === "apply", oldRule);
ck("  ...asked after the fetch, it is not applied", newRule === "repush", newRule);

console.log("\n  the callers:");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const fm = strip(readFileSync(new URL("../../src/fm/FmDataContext.tsx", import.meta.url), "utf8"));
const dc = strip(readFileSync(new URL("../../src/config/DeviceConfigSync.tsx", import.meta.url), "utf8"));
// Since 2.496.154 both stores run ONE machine, utils/syncedDocument, which
// decides after its fetch and counts every write started during it — driven
// by value in synced_document.mjs. Here: both stores are that machine.
const sd = strip(readFileSync(new URL("../../src/utils/syncedDocument.ts", import.meta.url), "utf8"));
const pullBody = sd.slice(sd.indexOf("async pull("), sd.indexOf("async push("));
const fetchAt = pullBody.indexOf("await this.spec.fetch()"), decideAt = pullBody.indexOf("decidePull(");
ck("the one machine decides AFTER its fetch", fetchAt > 0 && decideAt > fetchAt, { fetchAt, decideAt });
ck("  ...counting a write that began during it", /localAhead: this\.writes !== writesBefore/.test(pullBody) && /this\.writes \+= 1;/.test(sd));
ck("the Facility store and the device-config sync are both that machine, and neither decides for itself",
   /new SyncedDocument\(/.test(fm) && /new SyncedDocument\(/.test(dc) && !/decidePull\(/.test(fm + dc) && /await doc\.pull\(/.test(fm) && /await doc\.pull\(/.test(dc));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a refresh never overwrites work this device has not saved");
process.exit(fail ? 1 : 0);
