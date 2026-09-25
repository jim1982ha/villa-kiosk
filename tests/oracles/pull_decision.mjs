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
const fmReload = fm.slice(fm.indexOf("const reload = useCallback"), fm.indexOf("}, [reportSync]);", fm.indexOf("const reload = useCallback")));
const fetchAt = fmReload.indexOf("await fetchFmData()"), decideAt = fmReload.indexOf("decidePull(");
ck("the Facility store decides AFTER its fetch", fetchAt > 0 && decideAt > fetchAt, { fetchAt, decideAt });
ck("  ...counting a write that began during it", /writes\.current !== writesBefore/.test(fmReload));
ck("  ...and every write is counted", /writes\.current \+= 1/.test(fm));
ck("the device-config sync asks the same rule", /decidePull\(/.test(dc) && /action === "repush"/.test(dc));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ a refresh never overwrites work this device has not saved");
process.exit(fail ? 1 : 0);
