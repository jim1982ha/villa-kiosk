// The render-resolution governor (src/babylon/resolutionGovernor.ts): which
// scaling level the engine draws at, from the device's own frames.
//
// ⚠️ ~380 LINES INSIDE SceneManager WITH NO TEST (to 2.496.92), and every rule
// in them was paid for on a field device. Replayed here with the numbers the
// comments quote: the four devices of the field dump for the one step up, the
// MacBook's 54–136 ms bursts for the valve down, the sharpened flag that
// latched at native and switched the valve off on every DPR<=2 machine
// (2.329.0), and a gate that must read RENDER time, never the frame gap.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { ResolutionGovernor, startingScale, VALVE_SAMPLE_MIN } = await import("@/babylon/resolutionGovernor");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
/** A device: its DPR and current level; `sets` records each engine write. */
function device(dpr, level = startingScale(dpr)) {
  const d = { dpr, level, sets: [] };
  d.gov = new ResolutionGovernor({ get: () => d.level, set: (l, loud) => { d.level = l; d.sets.push({ l, loud }); }, dpr: () => d.dpr });
  return d;
}
/** One burst: `n` frames `gapMs` apart, each costing `renderMs` to render. */
function burst(d, n, gapMs, renderMs) {
  let t = 1000;
  for (let i = 0; i <= n; i++) { d.gov.sample(t); d.gov.sampleRender(renderMs); t += gapMs; }
  return d.gov.flush();
}

console.log("  the start: up to 2x CSS, whatever the panel claims");
ck("DPR 3 starts at 1/2, DPR 2 at 1/2, DPR 1 at 1", startingScale(3) === 0.5 && startingScale(2) === 0.5 && startingScale(1) === 1);

console.log("\n  one step up, predicted from RENDER time (the field dump's devices, DPR 3):");
{
  const android = device(3); burst(android, 30, 16.7, 7);
  ck("Android Chrome, ~7 ms render → 15.8 predicted: raised to native (1/3)", near(android.level, 1 / 3) && android.sets[0]?.loud === true, android.level);
  const iphone = device(3); burst(iphone, 30, 16.7, 11.5);
  ck("iPhone Safari, ~11.5 ms → 25.9: refused", iphone.level === 0.5, iphone.level);
  const ipad = device(3); burst(ipad, 30, 36, 28);
  ck("iPad, ~28 ms → 63: refused", ipad.level === 0.5, ipad.level);
  const mac = device(2); burst(mac, 30, 16.7, 2);
  ck("a DPR-2 Mac is already native: nothing to win, never written", mac.sets.length === 0);
  const hz120 = device(3); burst(hz120, 30, 8.4, 11.5);
  ck("the gate reads render time, not the gap: a 120 Hz panel at 11.5 ms render is still refused", hz120.level === 0.5, hz120.level);
  burst(android, 30, 16.7, 7); android.level = 0.5; burst(android, 30, 16.7, 7);
  ck("ONE step a session: a second fast burst after a back-off does not raise again", android.level === 0.5, android.level);
}

console.log("\n  the valve down (the MacBook's first-person bursts):");
{
  const mac = device(2);
  burst(mac, 30, 54, 50);
  ck("p50 54 ms at 1/2 → 1/2·√(54/22) = 0.78, in one step", near(mac.level, 0.5 * Math.sqrt(54 / 22)), mac.level);
  const slow = device(2); burst(slow, 30, 136, 130);
  ck("p50 136 ms → floored at 1x CSS, never coarser (the rainbow speckle)", slow.level === 1, slow.level);
  const ok = device(2); burst(ok, 30, 38, 30);
  ck("p50 38 ms (≥25 fps) is left alone", ok.level === 0.5 && ok.sets.length === 0);
  // The ONE step up is allowed once a session even after easing — the doc's
  // "a bad guess costs a few seconds, not the session" — and from then on the
  // valve is monotonic. (I first asserted plain monotonic; the code, and its
  // comment, say otherwise.)
  const mono = device(2); burst(mono, 30, 54, 50);
  burst(mono, 30, 16.7, 3);
  ck("after easing, a burst whose render time predicts native gets the one step up", mono.level === 0.5, mono.level);
  burst(mono, 30, 54, 50); const eased = mono.level;
  burst(mono, 30, 16.7, 3);
  ck("  ...and then the valve is monotonic: never finer again", eased > 0.5 && mono.level === eased, [eased, mono.level]);
}

console.log("\n  the burst:");
{
  const d = device(2);
  const b19 = burst(d, VALVE_SAMPLE_MIN - 1, 60, 55);
  ck(`${VALVE_SAMPLE_MIN - 1} gaps: too few for the valve to act`, d.level === 0.5 && b19.gaps.length === VALVE_SAMPLE_MIN - 1, [d.level, b19.gaps.length]);
  burst(d, VALVE_SAMPLE_MIN, 60, 55);
  ck(`${VALVE_SAMPLE_MIN}: the valve acts — whatever the telemetry cap says (it used to gate it)`, d.level > 0.5, d.level);
  const g = device(2);
  g.gov.sample(1000); g.gov.sample(1016); g.gov.sample(3000); g.gov.sample(3016);
  ck("the first frame is no gap, and a resume (> 400 ms) is dropped", g.gov.sampleCount === 2, g.gov.sampleCount);
  const out = g.gov.flush();
  ck("the burst comes back sorted, for the telemetry", out.gaps.join() === "16,16");
  g.gov.sample(3300); // 284 ms after the last frame: a gap, if the clock had not restarted
  ck("  ...and the clock restarts: no gap measured across the idle", g.gov.sampleCount === 0);
  ck("an empty burst is null", g.gov.flush() === null);
}

console.log("\n  the sharp idle frame:");
{
  const d = device(3);
  ck("sharpen: to native, quietly (the caller is about to render)", d.gov.sharpen() === true && near(d.level, 1 / 3) && d.sets.at(-1).loud === false);
  burst(d, 30, 80, 70);
  ck("  ...and while sharp the valve does not decide from it", near(d.level, 1 / 3), d.level);
  d.gov.unsharpen();
  ck("unsharpen: back to the motion level", d.level === 0.5 && !d.gov.isSharp());
  const native = device(2);
  ck("at native already: nothing to override, and the flag does NOT latch (2.329.0)", native.gov.sharpen() === false && !native.gov.isSharp());
  burst(native, 30, 60, 55);
  ck("  ...so the valve still works on a DPR<=2 machine", native.level > 0.5, native.level);
}

console.log("\n  the caller:");
{
  const { readFileSync } = await import("node:fs");
  const sm = readFileSync(new URL("../../src/babylon/SceneManager.ts", import.meta.url), "utf8");
  ck("the scheduler's resolution port IS the governor", /this\.frames\.tick\(now, this\.governor\)/.test(sm));
  ck("every sampled frame reaches it, gap and render", /this\.governor\.sample\(now\);/.test(sm) && /this\.governor\.sampleRender\(performance\.now\(\) - t0\);/.test(sm));
  ck("a write reaches the badge layer and, when loud, asks for a frame",
     /this\.engine\.setHardwareScalingLevel\(level\);\s*this\.visuals\.notifyRenderScaleChanged\(loud\);\s*if \(loud\) this\.requestRender\(\);/.test(sm));
  ck("no valve rule is left in SceneManager", !/easeResolution|raiseResolution|FRAME_TARGET_MS|HW_SCALE_FLOOR|private sharpen/.test(sm));
}

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ the resolution governor, replayed");
process.exit(fail ? 1 : 0);
