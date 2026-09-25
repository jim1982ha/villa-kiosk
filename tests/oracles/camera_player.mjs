// The camera's fallback chain, driven through its own interface.
//
// ⚠️ IT USED TO BE A REACT COMPONENT'S STATE, AND NOTHING TESTED IT. Four tiers
// were three states, eight refs and five effects in CameraPanel; reordering a
// tier meant rewiring eight call sites, the cancellation guard was applied at
// two of five fail sites, and a camera change fired a request for the new
// camera through the OLD tier. cameraPlayer owns the chain now; this drives it
// with fake tiers and a fake clock, so each rule is checked by behaviour.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
const { createCameraPlayer } = await import("@/components/panels/cameraPlayer");

let fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `  →  ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

/** A clock the test advances by hand. */
function clock() {
  let now = 0, seq = 0;
  const due = new Map();
  return {
    setTimeout: (fn, ms) => { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { due.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
    pending: () => due.size,
  };
}
/** A tier that records its life and hands its report out for the test to use. */
function tier(mode, extra = {}) {
  const t = { mode, element: mode === "stream" || mode === "snapshot" ? "img" : "video",
    started: 0, stopped: 0, report: null, ...extra };
  t.start = (el, report) => {
    t.started++; t.report = report;
    extra.onStart?.(report);
    return () => { t.stopped++; };
  };
  return t;
}
/** A player plus the "React" that mounts an element for each mode. */
function rig(tiers) {
  const c = clock();
  const log = [];
  const p = createCameraPlayer(tiers, { timers: c, log: (l) => log.push(l) });
  let mounted = null;
  const render = () => { // mount a fresh element whenever the mode changes
    const m = p.getState().mode;
    if (mounted === m) return;
    if (mounted !== null) p.detach();
    mounted = m;
    if (m !== "failed") p.attach({ kind: m });
  };
  p.subscribe(render);
  render();
  return { p, c, log, mode: () => p.getState().mode, ready: () => p.getState().frameReady };
}

console.log("  falling through:");
{
  const [a, b] = [tier("webrtc"), tier("hls")];
  const r = rig([a, b]);
  eq("it starts on the first tier", [r.mode(), a.started], ["webrtc", 1]);
  a.report.fail("no route");
  eq("a failure moves to the next tier, and tears the first down", [r.mode(), a.stopped, b.started], ["hls", 1, 1]);
  eq("  ...saying why", r.log[0], "camera: webrtc unavailable, falling back to hls — no route");
  b.report.fail("fatal");
  eq("the last tier's failure is final", r.mode(), "failed");
}
{
  const a = tier("stream", { watchdogMs: 6000 });
  const b = tier("snapshot");
  const r = rig([a, b]);
  r.c.advance(5999);
  eq("silence inside the watchdog is allowed", r.mode(), "stream");
  r.c.advance(1);
  eq("silence past it moves on", r.mode(), "snapshot");
  eq("  ...and says so", r.log[0].endsWith("no frame within watchdog window"), true);
  eq("a tier with no watchdog is never abandoned for silence",
     (r.c.advance(60_000), r.mode()), "snapshot");
}
{
  const a = tier("webrtc", { watchdogMs: 5000, afterConnectMs: 8000 });
  const b = tier("hls");
  const r = rig([a, b]);
  r.c.advance(4000); a.report.connected();
  r.c.advance(7999);
  eq("connected() swaps to the frame window, measured from then", r.mode(), "webrtc");
  a.report.frame();
  eq("a frame is ready", r.ready(), true);
  r.c.advance(60_000);
  eq("  ...and nothing times out after it", [r.mode(), r.c.pending()], ["webrtc", 0]);
  a.report.connected();
  r.c.advance(60_000);
  eq("a late connected() cannot re-arm a watchdog on a playing feed", r.mode(), "webrtc");
}

console.log("\n  late and stray reports:");
{
  const [a, b, c] = [tier("webrtc"), tier("hls"), tier("stream")];
  const r = rig([a, b, c]);
  const stale = a.report;
  stale.fail("first");
  eq("moved to hls", r.mode(), "hls");
  stale.fail("second, from the torn-down tier");
  stale.frame();
  eq("a torn-down tier's reports change nothing", [r.mode(), r.ready()], ["hls", false]);
}
{
  const a = tier("webrtc", { onStart: (rep) => rep.fail("RTCPeerConnection missing") });
  const b = tier("hls");
  const r = rig([a, b]);
  eq("a tier that fails inside start() is still torn down, once", [r.mode(), a.stopped], ["hls", 1]);
}
{
  const a = tier("hls", { watchdogMs: 1000 });
  const r = rig([a, tier("stream")]);
  r.p.detach();
  r.c.advance(5000);
  eq("detach() ends the attempt and its watchdog, and stays on the tier",
     [r.mode(), a.stopped, r.c.pending()], ["hls", 1, 0]);
  r.p.attach({ kind: "hls" });
  eq("  ...and the next attach starts it afresh", a.started, 2);
}
{
  const a = tier("hls", { watchdogMs: 1000 });
  const r = rig([a, tier("stream")]);
  r.p.dispose();
  a.report.fail("after dispose");
  r.c.advance(5000);
  eq("dispose() tears down and ignores everything after", [a.stopped, r.mode(), r.c.pending()], [1, "hls", 0]);
}

console.log("\n  the order is data:");
{
  const [x, y] = [tier("snapshot"), tier("webrtc")];
  const r = rig([x, y]);
  x.report.fail("reordered");
  eq("the same player runs any order it is given", [r.mode(), y.started], ["webrtc", 1]);
}
eq("no tiers at all is simply failed", createCameraPlayer([]).getState().mode, "failed");

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ the fallback chain holds, tier by tier");
process.exit(fail ? 1 : 0);
