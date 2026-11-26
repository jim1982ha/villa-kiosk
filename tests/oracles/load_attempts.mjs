// tests/oracles/load_attempts.mjs
// Only a load whose page was killed counts towards "ran out of memory" (owner, 2026-11-12: a model the page refused
// itself, twice, was then called out of memory). Each attempt is ended by itself, once; the store is in memory here.
import { ck, done } from "../consistency/check.mjs";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const { startLoadAttempt, isCrashLooping, crashLoopInfo, clearCrashLoop } = await import("@/utils/diagnostics");
const fresh = () => { store.clear(); };

console.log("\n  a load the page ended itself never counts; one it never ended does:");
fresh();
startLoadAttempt().end("failed");   // WebGL refused
startLoadAttempt().end("failed");   // a broken model
ck("two loads that failed with their own error: the third opening loads normally", !isCrashLooping(), crashLoopInfo());
fresh();
startLoadAttempt().end("left");
startLoadAttempt().end("left");
ck("two loads left by the page (a reload, the app closed): no crash loop", !isCrashLooping(), crashLoopInfo());
fresh();
startLoadAttempt();
ck("one load that never ended (the page was killed): the next opening stops", isCrashLooping(), crashLoopInfo());
ck("  ...and says one load", crashLoopInfo().count === 1, crashLoopInfo());
clearCrashLoop();
ck("  ...\"Try once more\" lets the next one run", !isCrashLooping(), crashLoopInfo());

console.log("\n  each attempt ends itself, once:");
fresh();
const a = startLoadAttempt();
const b = startLoadAttempt();
a.end("left");
ck("ending one attempt leaves the other standing", crashLoopInfo().count === 1 && !b.ended, crashLoopInfo());
ck("  ...and the one standing stops the next opening", isCrashLooping(), crashLoopInfo());
fresh();
const c = startLoadAttempt();
ck("the first end ends it", c.end("failed") === true && c.ended);
const d = startLoadAttempt();
ck("  ...a second end of the same attempt does nothing to another", c.end("left") === false && crashLoopInfo().count === 1 && !d.ended,
   crashLoopInfo());
fresh();
startLoadAttempt();
startLoadAttempt().end("ready");
ck("a load that reached the villa clears what was standing", !isCrashLooping() && crashLoopInfo().count === 0, crashLoopInfo());

console.log("\n  what an older version stored still reads:");
const now = Date.now();
store.set("villa-kiosk:diag", JSON.stringify({ attempts: [now - 1000, now - 500], phase: "import-mesh" }));
ck("two starts stored as bare times: still two loads that never ended", isCrashLooping(), crashLoopInfo());
store.set("villa-kiosk:diag", JSON.stringify({ attempts: [now - 1000, "x", null, { id: 3 }] }));
ck("  ...unusable entries are skipped, not thrown on", crashLoopInfo().count === 1, crashLoopInfo());
store.set("villa-kiosk:diag", "{not json");
ck("  ...an unreadable value is no attempts", !isCrashLooping() && crashLoopInfo().count === 0, crashLoopInfo());
store.set("villa-kiosk:diag", JSON.stringify({ attempts: [now - 7 * 3600_000] }));
ck("  ...a load killed on another day does not count", !isCrashLooping(), crashLoopInfo());

done("Only a load whose page was killed counts towards the crash loop");
