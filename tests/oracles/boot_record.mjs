// The load record and the freeze gate, as values (src/utils/bootTimeline.ts,
// 2.496.262). The figures speed decisions rest on came out of a function that
// read performance/document directly and was pinned by one regex: field
// records showed "mountMs: 21001" on a 2.2 s load, a bootMs that grew forever
// after a sign-in cycle, and a 5,469 ms "freeze" that was the load's own paint.
// Replayed through the pure halves; the browser adapter is pinned.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
globalThis.window ??= globalThis;
globalThis.location ??= { pathname: "/", href: "http://localhost/", search: "" };
const { loadRecord, freezeVerdict } = await import("@/utils/bootTimeline");

const nav = { type: "navigate", workerStart: 0, requestStart: 10, responseStart: 60, responseEnd: 70 };
const first = loadRecord({ total: 5000, loadSeq: 1, sinceLoadStart: 4800, nav,
  marks: { js: 300, react: 320, gate: 400, auth: 2400, scene: 2500 }, extra: { jsKb: 3487 } });
ck("a first load: the phases from the navigation entry and the marks",
   first.ttfbMs === 50 && first.htmlMs === 10 && first.bundleMs === 230 && first.reactMs === 20 && first.navType === "navigate" && first.jsKb === 3487, first);
ck("  ...the person typing a PIN is waitMs, and activeMs is the load WITHOUT it",
   first.gated === true && first.pinned === false && first.waitMs === 2000 && first.activeMs === 3000 && first.mountMs === 100, first);
ck("  ...swMs only when a service worker served the page", first.swMs === undefined
   && loadRecord({ total: 1, loadSeq: 1, sinceLoadStart: 1, nav: { ...nav, workerStart: 20 }, marks: {} }).swMs === 40);

const reload = loadRecord({ total: 40_000, loadSeq: 2, sinceLoadStart: 2200, nav,
  marks: { js: 300, react: 320, scene: 21_321 } });
ck("a RELOAD after sign-out/in: its own span (reloadMs), and no figure 'since the page opened'",
   reload.reloadMs === 2200 && reload.loadSeq === 2 && reload.activeMs === undefined, reload);
ck("  ...and NO mountMs measured from the page's React mount (that was the 'mountMs: 21001')",
   reload.mountMs === undefined, reload);
ck("  ...a reload WITH a sign-in measures mount from it",
   loadRecord({ total: 0, loadSeq: 3, sinceLoadStart: 0, marks: { react: 320, auth: 21_000, scene: 21_150 } }).mountMs === 150);

const bf = loadRecord({ total: 1, loadSeq: 1, sinceLoadStart: 1, marks: {},
  nav: { ...nav, notRestoredReasons: { reasons: [{ reason: "unload-listener" }], children: [{ reasons: [{ reason: "broadcastchannel" }, { reason: "unload-listener" }] }] } } });
ck("why the back-forward cache did not restore: the reason codes, flattened, deduped, sorted", bf.bfBlocked === "broadcastchannel,unload-listener", bf.bfBlocked);
ck("a negative or missing figure is never written", loadRecord({ total: 1, loadSeq: 1, sinceLoadStart: 1, marks: { js: 50 }, nav }).bundleMs === undefined);

console.log("\n  is it a freeze?");
const f = (o) => freezeVerdict({ durationMs: 2000, startedAt: 10_000, now: 12_000, loadReportedAt: 5000, lastReportAt: -Infinity, reports: 0, ...o });
ck("a 2 s block on a running villa: a freeze", f({}) === "report");
ck("before the load record exists: load cost", f({ loadReportedAt: 0 }) === "loading");
ck("  ...a block that STARTED before the record, reported after it: load cost (the 5,469 ms 'freeze')", f({ startedAt: 4000 }) === "loading");
ck("under a second: jank, not a freeze", f({ durationMs: 999 }) === "short");
ck("rate-limited: 30 s apart, 20 a session", f({ lastReportAt: 0, now: 29_000 }) === "cooldown" && f({ reports: 20 }) === "cap" && f({ lastReportAt: 0, now: 31_000 }) === "report");

const src = readFileSync(new URL("../../src/utils/bootTimeline.ts", import.meta.url), "utf8");
ck("the browser adapter only gathers: it hands loadRecord the marks, the nav entry and the measured extras",
   /return loadRecord\(\{/.test(src) && /marks: Object\.fromEntries\(marks\)/.test(src) && /extra: \{ \.\.\.scriptWeight\(\), \.\.\.stallSummary\(\) \}/.test(src));
ck("reading the stall summary no longer moves the freeze line; it is set ONCE per load",
   /if \(!loadReportedAt\) loadReportedAt = performance\.now\(\);/.test(src) && !/function stallSummary\(\)[^}]*loadReportedAt =/.test(src));
ck("the freeze reporter asks freezeVerdict, not its own copy of the gates",
   /if \(freezeVerdict\(\{ durationMs, startedAt, now, loadReportedAt,/.test(src) && (src.match(/durationMs < FREEZE_MIN_MS/g) ?? []).length === 1
   && !/now - lastFreezeReportAt < FREEZE_COOLDOWN_MS/.test(src));

done("✅ the load record and the freeze gate, by value");
