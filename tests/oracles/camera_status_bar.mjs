// The camera window's status bar (src/components/panels/cameraStatusBar.ts):
// the camera's reachability layered with its motion sensor's on/off into ONE
// state history — offline / online / motion / motion-unavailable.
//
// ⚠️ THE RULE WAS AN INLINE CLOSURE IN CameraPanel.tsx and the merge under it
// (chartUtils.mergeStateHistories) had no test at all. 2.496.179 found the
// rule painting a lost motion sensor as "online" — green — the one thing this
// bar exists to report, shown as all-clear. Driven by value now.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { cameraBarState, cameraBarHistory } = await import("@/components/panels/cameraStatusBar");
const { mergeStateHistories } = await import("@/components/panels/chartUtils");

console.log("  one instant:");
ck("a camera Home Assistant cannot reach is offline, whatever the sensor says",
   cameraBarState("unavailable", "on", true) === "offline" && cameraBarState(undefined, "on", true) === "offline");
ck("motion on a reachable camera is motion", cameraBarState("idle", "on", true) === "motion");
ck("a LOST motion sensor is not 'online' (2.496.179)",
   cameraBarState("idle", "unavailable", true) === "motion-unavailable" && cameraBarState("idle", undefined, true) === "motion-unavailable");
ck("no motion sensor configured: reachable is online", cameraBarState("idle", undefined, false) === "online");

console.log("\n  the merge:");
{
  const p = (t, state) => ({ t, state });
  const merged = mergeStateHistories(
    { a: [p(0, "x"), p(10, "y")], b: [p(5, "1"), p(10, "1"), p(20, "2")] },
    (cur) => `${cur.a}/${cur.b}`);
  ck("every change of either series, each series' state as of that instant",
     JSON.stringify(merged) === JSON.stringify([p(0, "x/undefined"), p(5, "x/1"), p(10, "y/1"), p(20, "y/2")]), merged);
  const flat = mergeStateHistories({ a: [p(0, "x"), p(5, "x")], b: [p(3, "1")] }, () => "same");
  ck("  ...a point only where the COMPOSITE changes", flat.length === 1 && flat[0].t === 0, flat);
}

console.log("\n  the bar over a day:");
{
  const p = (t, state) => ({ t, state });
  const cam = [p(0, "idle"), p(100, "unavailable"), p(200, "idle")];
  const motion = [p(0, "off"), p(50, "on"), p(60, "off"), p(150, "unavailable"), p(250, "off")];
  const bar = cameraBarHistory(cam, motion).map((x) => `${x.t}:${x.state}`).join(" ");
  ck("online, motion, online, offline, motion-unavailable once the camera is back, then online",
     bar === "0:online 50:motion 60:online 100:offline 200:motion-unavailable 250:online", bar);
  ck("without a motion sensor the sensor's absence is not an outage",
     cameraBarHistory(cam, undefined).map((x) => x.state).join() === "online,offline,online");
}

done("✅ the camera bar says offline, motion and a lost sensor honestly");
