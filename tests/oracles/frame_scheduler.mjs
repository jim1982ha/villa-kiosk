// "Draw a frame now?" — the render loop's whole rule, driven by hand.
//
// ⚠️ IT WAS A CLOSURE OVER SIX FIELDS, AND ITS HISTORY IS ALL REGRESSIONS:
// 2.322.0 an HA state push dropped the settled picture to motion resolution
// (a sharp repaint must stay sharp, and must never be SAMPLED), 2.329.0 a fan
// left on held the whole villa soft (an animation obeys the stillness rule),
// 2.124.0 the animation cap. Nothing could run it without a live engine.
// FrameScheduler.tick is now that rule; this drives it with a fake resolution
// valve and a clock that only moves when told to.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { FrameScheduler } = await import("@/babylon/frameScheduler");

let fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `  →  ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};
const STILL = 350, CAP = 33;
function rig({ onDemand = true } = {}) {
  let t = 1000;
  const res = {
    sharp: false, sharpens: 0, unsharpens: 0,
    sharpen() { if (this.sharp) return false; this.sharp = true; this.sharpens++; return true; },
    unsharpen() { if (this.sharp) { this.sharp = false; this.unsharpens++; } },
    isSharp() { return this.sharp; },
  };
  const f = new FrameScheduler({ stillMs: STILL, animationFrameMs: CAP, onDemand: () => onDemand, now: () => t });
  const tick = () => f.tick(t, res);
  /** Tick every 16ms for `ms`; count renders and sampled renders. */
  const run = (ms) => {
    let renders = 0, sampled = 0, flushes = 0;
    for (const end = t + ms; t < end; t += 16) {
      const d = tick();
      if (d.render) renders++;
      if (d.render && d.sample) sampled++;
      if (d.flush) flushes++;
    }
    return { renders, sampled, flushes };
  };
  return { f, res, tick, run, at: () => t, wait: (ms) => { t += ms; } };
}

console.log("  idle:");
{
  const r = rig();
  r.wait(STILL);
  const first = r.tick();
  eq("an idle villa draws the one frame sharpening buys", [first.render, r.res.sharp], [true, true]);
  eq("  ...and nothing on the idle ticks after it", r.run(1000).renders, 0);
}

console.log("\n  interaction:");
{
  const r = rig();
  r.f.motion();
  const d = r.tick();
  eq("motion is spent inside the tick, and un-sharpens", [r.res.unsharpens, r.res.sharp], [0, false]);
  eq("  ...and the frame after it is drawn at full rate and timed", [d.render, d.sample], [true, true]);
  r.res.sharp = true;           // settle, then move again
  r.f.motion();
  r.tick();
  eq("a move after settling drops the sharp override", [r.res.unsharpens, r.res.sharp], [1, false]);
}
{
  const r = rig();
  r.wait(STILL);                // the camera has been still for a while
  r.f.repaint();                // an HA state push
  const burst = r.run(300);
  eq("a repaint on a still camera stays SHARP (2.322.0)", r.res.sharp, true);
  eq("  ...is never sampled", burst.sampled, 0);
  eq("  ...and is rate-capped", burst.renders <= Math.ceil(300 / CAP) + 1 && burst.renders > 0, true);
}
{
  const r = rig();
  r.f.repaint(200);
  r.run(200);
  eq("the end of a burst flushes the samples", r.tick().flush, true);
}

console.log("\n  animation:");
{
  const r = rig();
  r.wait(STILL);
  r.f.animate(1000);
  const a = r.run(1000);
  eq("a fan left on does not hold the villa soft (2.329.0)", r.res.sharp, true);
  eq("  ...and renders at the capped rate, not the display's",
     a.renders <= Math.ceil(1000 / CAP) + 1 && a.renders >= Math.floor(1000 / 48), true);
  eq("  ...never sampled", a.sampled, 0);
}

console.log("\n  pins and settings:");
{
  const r = rig();
  const release = r.f.pin();
  r.f.motion();
  eq("a pin renders every tick while the camera moves", r.run(160).renders, 10);
  const other = r.f.pin();
  release(); release();         // a double release must not free the other pin
  eq("a release is idempotent — the other pin still holds", r.f.pinned, true);
  other();
  eq("  ...until it too is released", r.f.pinned, false);
}
{
  const r = rig({ onDemand: false });
  r.f.motion();
  eq("renderOnDemand off renders continuously", r.run(160).renders, 10);
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ one rule decides every frame");
process.exit(fail ? 1 : 0);
