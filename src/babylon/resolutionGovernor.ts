// src/babylon/resolutionGovernor.ts
// THE RENDER-RESOLUTION GOVERNOR: which hardware scaling level the engine
// draws at, decided from the device's own measured frames — and nothing else.
//   * the VALVE, once per burst of interactive frames: give back supersampling
//     on a device that measured slow (easeResolution, monotonic, floored at 1x
//     CSS), or take ONE step up to the panel's native resolution on a device
//     whose render time predicts it can afford it (raiseResolution);
//   * the SHARP IDLE FRAME: the settled picture at native resolution, undone
//     the moment the camera moves (sharpen / unsharpen — FrameScheduler's
//     ResolutionPort, which this class is).
//
// ⚠️ IT LIVED INSIDE SceneManager, ~380 LINES WITH NO TEST, and every rule in
// it is one a field device paid for: the valve that never opened on the iPad
// because a telemetry cap gated it, a sharpened flag that latched at native
// and switched the valve off on every DPR<=2 machine (2.329.0), a gate fed the
// frame GAP that read a 60 Hz panel as half as capable as the same GPU at 120.
// Behind this seam, tests/oracles/resolution_governor.mjs replays the numbers
// those comments quote. SceneManager keeps the engine; this owns the decision.
//
// PURE — no Babylon import. The engine is two functions (ScalingPort).

import type { ResolutionPort } from "./frameScheduler";

// ── Frame-time sampling (see sample) ────────────────────────────────────────
// A gap above this is the render loop RESUMING — the app went idle, the tab
// was throttled, a modal held the thread — not one frame that took a second.
// Well clear of even a 10fps frame, so a genuinely terrible frame is still
// recorded as the bad news it is rather than filtered out as a resume.
const FRAME_GAP_MAX_MS = 400;
// ~10s of interaction at 60fps. Bounds both the array and, with the report
// cap, how much a pathological session can send.
const FRAME_SAMPLE_MAX = 600;
/** Frames the RESOLUTION VALVE needs before it may act — see flush
 *  for why this is separate from, and lower than, the telemetry minimum. About
 *  a third of a second at 60fps and over a second at 13fps, which is enough to
 *  be sure of a device's frame budget and short enough that a single pan on a
 *  struggling tablet is sufficient. */
export const VALVE_SAMPLE_MIN = 20;
// Below ~25fps interaction stops feeling like direct manipulation — that is
// the point at which supersampling is no longer worth what it costs.
const FRAME_SLOW_MS = 40;
// What easeResolution aims for once it has decided to act (~45fps). Not 60:
// overshooting to the resolution floor on one marginal burst would spend the
// whole quality budget to chase frames the display may not even present.
const FRAME_TARGET_MS = 22;
// 1.0 = one backbuffer pixel per CSS pixel. Never coarser than this — see
// easeResolution for the rainbow-speckle regression that sets this floor.
const HW_SCALE_FLOOR = 1;
// The starting cap: up to 2x CSS, whatever the panel claims. On a DPR-3 phone
// that is TWO THIRDS of native pixel density, and the compositor upscales the
// finished frame by 1.5x on its way to the screen. Icon strokes and hairline
// rings are the highest-frequency thing this app draws, so they are where that
// shows first — reported as "the glyphs look very pixelised", correctly.
const HW_START_CAP = 2;

/** The engine, as the governor needs it. `set` writes the hardware scaling
 *  level and tells the badge layer (its geometry is authored in CSS px and
 *  converted through this value); `loud` also asks for a frame — the valve's
 *  steps do, the sharp frame's do not (their caller is about to render). */
export interface ScalingPort {
  get(): number;
  set(level: number, loud: boolean): void;
  /** The panel's device pixel ratio, read when needed (it can change). */
  dpr(): number;
}

/** One burst of interactive frames, sorted, for the `frames` telemetry. */
export interface FrameBurst {
  /** Gaps between frames, ms, ascending. */
  gaps: number[];
  /** Cost of scene.render() itself, ms, ascending. */
  renders: number[];
}

/** The starting scaling level: up to 2x CSS (see HW_START_CAP). */
export function startingScale(dpr: number): number {
  return 1 / Math.min(dpr, HW_START_CAP);
}

export class ResolutionGovernor implements ResolutionPort {
  private readonly port: ScalingPort;
  private gaps: number[] = [];
  private renders: number[] = [];
  private lastFrameAt = 0;
  private resolutionRaised = false;
  private sharpMotionHw = 0;
  private sharpened = false;

  constructor(port: ScalingPort) { this.port = port; }

  /** Gaps collected in the current burst. */
  get sampleCount(): number { return this.gaps.length; }

  /**
   * Measure how long INTERACTIVE frames actually take, and report a summary.
   *
   * ── Why this exists (2.221.0) ────────────────────────────────────────────
   * "Safari on the MacBook is very laggy, I can barely orbit or walk" was
   * unanswerable from the telemetry, because nothing in this app has ever
   * measured a frame. The load record covers getting TO the first frame and
   * stops there; `freeze` covers a main thread blocked long enough to notice
   * as a hang. A steady low frame rate is neither — it is every frame costing
   * 40ms instead of 8 — and it was invisible.
   *
   * That gap is worst exactly where it hurts. The long-task observer behind
   * `freeze` is Chromium-only; Safari falls back to a timer watchdog
   * (bootTimeline.installFreezeWatchdog) which detects blocks but not slow
   * frames. Safari duly reported no freezes at all in the field dump — which
   * is not "Safari is fine", it is "Safari is slow in the one way we cannot
   * see". Guessing a cause from there is the failure mode this codebase has
   * already paid for repeatedly, so: measure first.
   *
   * Only INTERACTIVE frames are sampled — the branch above that renders at
   * the display's rate. Animation-only frames are deliberately rate-capped to
   * ANIMATION_FRAME_MS, so including them would report the cap as if it were
   * a performance ceiling. A gap longer than FRAME_GAP_MAX_MS is the loop
   * resuming after idle rather than one slow frame, and is dropped.
   *
   * The record carries what a frame's cost is a function of — active meshes,
   * active indices, backbuffer size, hardware scaling, and whether the two
   * optional render passes are on — so the next question can be answered from
   * the data instead of from another hypothesis.
   *
   * ── What renderMs / drawCalls / evalMs are for, and what they answered ───
   * Three numbers, each falsifying a different family of cause. All three have
   * reported, and between them plus the ablation probe (babylon/perfProbe.ts)
   * the question is CLOSED — do not re-derive any of this from scratch:
   *
   *   evalMs is ~2ms on every engine        -> culling is not the cost
   *   drawCalls/activeMeshes has been 1.00
   *     since 2.265.0                       -> multi-pass lighting is not it
   *   identical triangle counts either side  -> geometry is not the gap
   *   an EMPTY scene costs the iPad 67ms at
   *     3.4Mpx and 19ms at a quarter of that,
   *     while both Chrome engines pay the
   *     same at either                       -> on WebKit it is PIXELS, and
   *                                             almost nothing else
   *
   * Two readings that look like answers and are not. "us per draw call" is
   * renderMs/drawCalls — an average that divides a large fixed cost by the
   * draw count, so it falls as draws rise whether or not draws cost anything;
   * it is what made "the only lever is fewer draw calls" look true for a
   * release. And merging meshes to reduce draws would save nothing here
   * anyway: the villa's 204 mergeable meshes carry 204 distinct materials.
   *
   * Keep these three fields. They are how any future change gets checked, and
   * they are what calibrateResolution's decision is visible in.
   */
  sample(now: number): void {
    const prev = this.lastFrameAt;
    this.lastFrameAt = now;
    if (prev === 0) return;
    const dt = now - prev;
    if (dt > FRAME_GAP_MAX_MS) return;
    this.gaps.push(dt);
  }

  /** Whether the burst is full — the caller flushes (FRAME_SAMPLE_MAX). */
  get full(): boolean { return this.gaps.length >= FRAME_SAMPLE_MAX; }

  /** The cost of the scene.render() call of a sampled frame. Bounded here:
   *  `sample` drops the first frame of a burst and any resume gap, so this
   *  runs slightly ahead of the gaps and cannot rely on their cap. */
  sampleRender(ms: number): void {
    if (this.renders.length < FRAME_SAMPLE_MAX) this.renders.push(ms);
  }

  /**
   * The burst ended: run the valve on it, and hand it back sorted for the
   * telemetry — or null when it kept no gaps. Resets the clock, so the next
   * burst never measures across the gap.
   */
  flush(): FrameBurst | null {
    const s = this.gaps;
    if (s.length === 0) {
      // Stops the two arrays drifting apart in the case `sample` kept none of
      // the burst's gaps. The length check keeps the idle path (this runs on
      // every non-interactive tick) down to a comparison.
      if (this.renders.length > 0) this.renders = [];
      return null;
    }
    this.gaps = [];
    const r = this.renders;
    this.renders = [];
    this.lastFrameAt = 0;
    s.sort((a, b) => a - b);
    r.sort((a, b) => a - b);

    // ── THE RESOLUTION VALVE RUNS FIRST, AND ON ITS OWN TERMS ──────────────
    // It used to sit below the telemetry gate, which meant a *reporting* rule
    // decided whether the device was allowed to protect its own frame rate:
    // FRAME_REPORT_MAX caps the dump at 8 records per session, so after eight
    // bursts the valve stopped working for the rest of the session, and the
    // 45-frame minimum meant a device running at 13fps had to be dragged
    // CONTINUOUSLY for three and a half seconds before it could react at all.
    //
    // The iPad is the case that exposed it: not one `frames` record in any
    // field dump, so the valve had never opened on it — and the frame-cost
    // probe then measured that same iPad at 76ms a frame, of which 67ms was an
    // EMPTY scene at 3.4 megapixels. On WebKit that floor is per-pixel (a
    // quarter of the pixels took it 67ms -> 19ms), so resolution is exactly
    // the lever, and the thing holding it shut was a telemetry counter.
    //
    // Its own minimum is lower because it is answering an easier question than
    // the telemetry is: "is this device comfortably missing frame budget",
    // not "characterise this burst". Still monotonic, still floored at 1x CSS.
    if (s.length >= VALVE_SAMPLE_MIN) {
      // Down first, then up. Their guards are mutually exclusive (one needs a
      // slow p50, the other a fast one), so the order is documentation rather
      // than logic — but stating it means a future edit to either guard cannot
      // quietly make both fire on one sample.
      this.easeResolution(s[Math.floor(s.length * 0.5)]);
      // ⚠️ The UPWARD step reads RENDER time, not the frame gap. `at(0.5)` is
      // the median gap BETWEEN frames, and on any device holding vsync that is
      // the refresh period and nothing else: this phone reports p50 16.7ms at
      // 60Hz and 8.4ms at 120Hz while its render cost is 4-9ms either way. A
      // gate fed that number would refuse to sharpen an idle GPU because its
      // display happened to be running at 60Hz, and would read a 120Hz panel
      // as twice as capable as the same silicon behind a 60Hz one.
      // `renderSamples` is the work actually done per frame, which is the only
      // thing that scales with pixel count.
      if (r.length >= VALVE_SAMPLE_MIN) this.raiseResolution(r[Math.floor(r.length * 0.5)]);
    }
    return { gaps: s, renders: r };
  }

  /**
   * Give back supersampling when the measured frame rate cannot afford it.
   *
   * ── The measurement this exists because of (2.222.0) ──────────────────────
   * Safari on a MacBook reported 7-19 fps in first person (p50 54-136ms). The
   * frames records ruled out geometry outright: the FASTEST burst had the MOST
   * on screen (428 meshes / 1.9M triangles at 54ms) and the slowest had half
   * that (209 / 1.2M at 136ms). Cost that does not track object count is
   * per-PIXEL, and the two per-pixel costs here are fill — 2880x1476, i.e.
   * 4.25 megapixels of 2x supersampling with MSAA — and up to
   * MAX_SIMULTANEOUS_LIGHTS lights per fragment.
   *
   * This addresses the first and DISCRIMINATES them. Frame cost is linear in
   * pixels and pixels go as 1/scale², so the scale that would hit the target
   * is a closed form — one step, not a slow crawl. If the next frames records
   * show hw at 1.0 with fps up roughly 4x, it was fill. If fps barely moves,
   * fill is eliminated and the lights are the remaining candidate (`lights`
   * and `litOn` are in the record for exactly that reading).
   *
   * Deliberate limits:
   * - **Never below 1x CSS.** The old iOS tier rendered under CSS resolution
   *   and its single-sample minification of tile textures showed as rainbow
   *   speckle around lit floors — reported, and removed. 1.0 is the floor.
   * - **Monotonic.** Scaling only ever gets coarser, never finer again. A
   *   controller that could go both ways would hunt around the threshold and
   *   the resolution would visibly pulse; giving up supersampling once, on a
   *   device that has demonstrated it cannot pay for it, does not.
   * - **Only on a device that measured slow.** A machine holding 60fps never
   *   reaches this and keeps the full 2x. Nothing to configure: the setting
   *   the user asked for ("as nice as possible by default") is still the
   *   default, and 7fps is not "nice" by any reading of it.
   */
  /**
   * The one chance a device gets to render at its panel's real resolution.
   *
   * The engine starts at HW_START_CAP (2x CSS), which is native on a DPR-2
   * screen and two thirds of native on a DPR-3 one. Every modern phone is
   * DPR 3, so the default ships a 1.5x upscale to every one of them.
   *
   * ── Why this is safe to attempt, and why it is measured rather than
   *    detected ────────────────────────────────────────────────────────────
   * Resolution is free on ANGLE and IS the frame cost on WebKit: measured with
   * an empty scene and one draw call, Android Chrome paid 2.8ms at full
   * resolution and 2.8ms at a quarter of it, while the iPad paid 67ms and
   * 19ms. Sniffing which of those a device is would be a heuristic, and this
   * file has no business owning one.
   *
   * So the gate is a WORST-CASE PREDICTION instead: assume the frame is
   * entirely per-pixel — the WebKit case — and require that the measured
   * RENDER time, multiplied by the exact pixel-count increase the change would
   * cause, still lands inside FRAME_TARGET_MS. A device where resolution is
   * actually free clears that easily and gets sharpened; one where it is not
   * cannot clear it even in principle. No device string is read.
   *
   * Against the four devices in the field dump, at their measured render times
   * and a DPR-3 phone's 2.25x pixel increase:
   *
   *   Android Chrome  ~7ms  -> 15.8  UPGRADES   (ANGLE: resolution is free)
   *   iPhone Safari  ~11.5ms -> 25.9  refused
   *   iPad (HA app)    ~28ms -> 63    refused
   *   Mac (DPR 1.6/2)               never reaches the test — already native
   *
   * ── And why it cannot hunt ───────────────────────────────────────────────
   * easeResolution is deliberately monotonic ("never finer again") because a
   * two-way controller oscillates around its threshold and the resolution
   * visibly pulses. This is not a controller: it is ONE step, taken at most
   * once per session, guarded by a flag. Afterwards the ordinary downward
   * valve keeps sampling and can back the device off again if the prediction
   * was wrong — so a bad guess costs a few seconds, not the session, and the
   * monotonic invariant holds from that point on exactly as before.
   */
  private raiseResolution(p50: number): void {
    if (this.resolutionRaised) return;
    // Never decide from the sharp idle frame's scaling — that is a temporary
    // override, not this device's measured operating point.
    if (this.sharpened) return;
    const cur = this.port.get();
    const native = this.native();
    // Already at (or finer than) the panel — nothing to win. This is every
    // DPR<=2 device, so they never reach the prediction below at all.
    if (cur <= native + 1e-6) return;
    // Pixel count scales with the SQUARE of the linear scaling change.
    const costRatio = (cur / native) ** 2;
    if (p50 * costRatio > FRAME_TARGET_MS) return;
    this.resolutionRaised = true;
    this.port.set(native, true);
  }

  private easeResolution(p50: number): void {
    if (p50 <= FRAME_SLOW_MS) return;
    if (this.sharpened) return;   // see raiseResolution
    const cur = this.port.get();
    if (cur >= HW_SCALE_FLOOR) return;
    const next = Math.min(HW_SCALE_FLOOR, cur * Math.sqrt(p50 / FRAME_TARGET_MS));
    if (next <= cur) return;
    this.port.set(next, true);
  }

  /**
   * Draw the settled image once at the device's NATIVE resolution.
   *
   * ── Why this is worth a frame ────────────────────────────────────────────
   * The resolution valve holds a slow device below its panel's real pixel
   * density because it cannot shade that many fragments at an interactive
   * rate — measured, and true: the iPad renders 1180px wide on a 2360px panel
   * and still only manages 22fps, and Safari on the MacBook is 4-8x Chrome's
   * render cost on identical hardware. That is the right call WHILE THE CAMERA
   * IS MOVING, and it is the wrong one the instant it stops, which is when
   * someone is actually reading a badge. Reported as the entity glyphs looking
   * low-resolution on iPad, correctly, and chased through the bake twice
   * before the canvas turned out to be the thing that was short of pixels.
   *
   * This scene renders ON DEMAND, so "nothing is moving" is not a guess — it
   * is the branch the loop already takes when the interaction burst has ended
   * and no animation is pending. One expensive frame lands there, with nothing
   * animating to judge it against, and every frame after it is free because
   * nothing asks for one.
   *
   * ⚠️ NOT SAMPLED, and it must never be. The sharp frame is deliberately
   * more expensive than an interactive one; feeding it to the valve would have
   * the device conclude it is slow and ease itself down — a loop where making
   * the picture better makes the picture worse. It is drawn from the idle
   * branch, which does not sample, and `unsharpen` runs before the interactive
   * branch measures anything.
   *
   * Cheap to leave and cheap to undo: since 2.321.0 the badge bake targets the
   * best-case resolution, so both directions cost a container re-scale and no
   * re-bake.
   */
  /**
   * Raise to the panel's own resolution. Draws NOTHING — every caller is about
   * to render anyway, and the idle branch renders on the `true` return.
   *
   * ⚠️ `sharpened` means "we are currently OVERRIDING the scaling", and only
   * that. Until 2.329.0 it latched even when the device was already at native
   * and there was nothing to override, which quietly disabled the whole
   * resolution valve on every DPR<=2 machine: `easeResolution` and
   * `raiseResolution` both bail while sharpened, so a flag set on the first
   * idle tick and never cleared meant the valve could not act for the rest of
   * the session. Latching only on a real change keeps the flag honest and costs
   * two float comparisons per idle tick.
   */
  sharpen(): boolean {
    if (this.sharpened) return false;
    const cur = this.port.get();
    const native = this.native();
    if (cur <= native + 1e-6) return false;
    this.sharpMotionHw = cur;
    this.sharpened = true;
    // Quiet: the caller's render IS the redraw, and asking for another would
    // re-arm the interactive branch for no reason.
    this.port.set(native, false);
    return true;
  }

  /**
   * Put the motion resolution back. Idempotent; safe to call every frame — the
   * flag check is the whole cost when there is nothing to undo.
   *
   * ⚠️ ONE CALLER, AT THE TOP OF THE RENDER LOOP, AND THAT IS THE DESIGN.
   * Since 2.329.0 the only thing that un-sharpens is the camera moving, so
   * this is called in exactly one place — where FrameScheduler spends a
   * recorded motion —
   * and never again. Two independent reasons it must stay there:
   *
   *   * `sharpened` means "the scaling is currently overridden", and the
   *     interactive branch reads it to tell a repaint from motion. Widen the
   *     caller list and every HA state push starts dropping the settled
   *     picture back to motion resolution (2.322.0's fix), and
   *   * this RESIZES THE DRAWING BUFFER, so calling it from an event handler
   *     mutates the canvas during input dispatch (2.322.0's regression).
   *
   * Motion signals intent through FrameScheduler.motion(); the tick spends it.
   */
  unsharpen(): void {
    if (!this.sharpened) return;
    this.sharpened = false;
    if (this.sharpMotionHw <= 0) return;
    const back = this.sharpMotionHw;
    this.sharpMotionHw = 0;
    if (this.port.get() === back) return;
    // Quiet for the same reason: both callers run immediately before a render.
    this.port.set(back, false);
  }

  isSharp(): boolean { return this.sharpened; }

  /** Forget the burst in progress (teardown). */
  reset(): void { this.gaps = []; this.renders = []; this.lastFrameAt = 0; }

  private native(): number { return 1 / Math.max(1, this.port.dpr() || 1); }
}
