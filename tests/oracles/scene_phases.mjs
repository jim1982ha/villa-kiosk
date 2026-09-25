// The scene's startup phases, heard through ONE subscription.
//
// ⚠️ THE ORDERING LIVED IN THE CALLERS. Dashboard wrote `if (isReady()) cb();
// onReady(cb); onCalibrated(cb)` three times, and a fourth effect told the
// scene to go to overview on ready — a call that returned at once, because
// the scene starts there. Two production bugs came from startup ordering
// (b9763abd, bce48122). ScenePhases is the rule; this drives it, then checks
// the callers use it and nothing else.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { ScenePhases } = await import("@/babylon/scenePhases");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };

console.log("  the phases:");
{
  const p = new ScenePhases();
  const early = [];
  p.subscribe((ph) => early.push(ph));
  ck("nothing is heard before the model is shown", early.length === 0);
  p.shown(); p.calibrated(); p.calibrated();
  ck("an early subscriber hears shown, then every fit", JSON.stringify(early) === '["shown","calibrated","calibrated"]', early);
  const late = [];
  p.subscribe((ph) => late.push(ph));
  ck("a LATE subscriber is told the model is shown, at once", JSON.stringify(late) === '["shown"]', late);
  const quiet = [];
  p.subscribe((ph) => quiet.push(ph), false);
  ck("  ...unless it asks not to be (it has just done the work itself)", quiet.length === 0);
  const off = p.subscribe(() => { throw new Error("heard after unsubscribing"); }, false);
  off();
  let threw = false;
  try { p.calibrated(); } catch { threw = true; }
  ck("an unsubscribed listener hears nothing", !threw);
  const selfOff = []; let offSelf = () => {};
  offSelf = p.subscribe((ph) => { selfOff.push(ph); offSelf(); }, false);
  const other = []; p.subscribe((ph) => other.push(ph), false);
  p.calibrated();
  ck("a listener may unsubscribe while hearing a phase without costing another its turn",
     selfOff.length === 1 && other.length === 1, { selfOff, other });
  const afterClear = []; p.subscribe((ph) => afterClear.push(ph), false);
  p.clear(); p.calibrated();
  ck("clear() (dispose) leaves no listener", afterClear.length === 0 && p.shownYet);
}

console.log("\n  the callers:");
const dash = readFileSync(new URL("../../src/pages/Dashboard.tsx", import.meta.url), "utf8");
const sm = readFileSync(new URL("../../src/babylon/SceneManager.ts", import.meta.url), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
ck("Dashboard hears the scene through onScene only",
   /manager\.onScene\(/.test(code(dash)) && !/manager\.(onReady|onCalibrated)\(/.test(code(dash)));
ck("  ...and no longer re-tells it a view mode on ready", !/goOverview/.test(code(dash)));
ck("SceneManager keeps no second listener list", !/readyCallbacks|calibrateCallbacks/.test(code(sm)));
ck("the two methods nothing called are gone", !/\breindex\(config|getLoadedMeshes\(\)/.test(code(sm)));

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one subscription, and the scene decides its own start");
process.exit(fail ? 1 : 0);
