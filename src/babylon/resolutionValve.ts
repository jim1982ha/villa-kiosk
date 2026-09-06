// src/babylon/resolutionValve.ts
//
// THE RESOLUTION CONTROL LAW — numbers in, one number out.
//
// ⚠️ EXTRACTED BECAUSE SIX INVARIANTS WERE DOCUMENTED AND NONE WAS EXECUTABLE,
// and two of them had already shipped broken. This ran as ~60 lines interleaved
// with a 20-field telemetry payload inside SceneManager, a 4,600-line Babylon
// class that cannot be loaded without a GPU context, so its only validation
// channel was field telemetry from four devices — while it silently gates every
// wall tablet's frame rate.
//
// The two that shipped broken:
//   • The upward gate was fed the frame GAP instead of RENDER time. On a device
//     holding vsync the gap is the refresh period and nothing else, so a 120Hz
//     panel read as twice as capable as the same silicon behind a 60Hz one.
//     The whole second ring buffer exists because of that bug.
//   • The valve sat BELOW a telemetry counter that capped at 8 records per
//     session, so after eight bursts it stopped working entirely. A field iPad
//     sat at 13fps indefinitely; it was found by reading dumps, because every
//     instrument agreed and none was measuring whether the valve had opened.
//
// ⚠️ IMPORTS NOTHING AT RUNTIME so `npm run test:resolution-valve` can replay
// the four measured devices the docstring already tabulates. Keep it that way.

/** What the engine and the session currently are. */
export interface ValveState {
  /** `engine.getHardwareScalingLevel()` — higher is coarser. */
  current: number;
  /** `1 / devicePixelRatio` — the finest this panel can usefully go. */
  native: number;
  /** The idle sharpen is a temporary override, not this device's measured
   *  operating point, so neither step may fire while it is on. */
  sharpened: boolean;
  /** The upward step is one-shot per session (see `raise` below). */
  alreadyRaised: boolean;
}

/** What the two ring buffers measured. */
export interface ValveSamples {
  /** Median gap BETWEEN frames. Feeds the DOWNWARD step only. */
  gapP50: number;
  /** Median RENDER time — the work actually done per frame, the only thing
   *  that scales with pixel count. Feeds the UPWARD step only. */
  renderP50: number;
  gapCount: number;
  renderCount: number;
}

export interface ValveLimits {
  /** Below this many samples the valve does not act. */
  sampleMin: number;
  /** A gap p50 above this means "comfortably missing frame budget". */
  slowMs: number;
  /** What the valve aims for once it has decided to act (~45fps). */
  targetMs: number;
  /** Coarsest the valve may ever go. */
  scaleFloor: number;
}

export interface ValveDecision {
  /** The scaling to set, or null to leave the engine alone. */
  nextScaling: number | null;
  /** Which way it moved — for the log, and for a test to read. */
  direction: "ease" | "raise" | null;
}

const NONE: ValveDecision = { nextScaling: null, direction: null };

/**
 * Decide this pass's hardware scaling level.
 *
 * ⚠️ THE SIX INVARIANTS, ALL NOW EXECUTABLE:
 *
 *  1. MONOTONIC DOWN. `ease` only ever coarsens. A controller that could go
 *     both ways would hunt around the threshold and the resolution would
 *     visibly pulse.
 *  2. NEVER BELOW 1× CSS. Its single-sample minification of tile textures
 *     showed as rainbow speckle around lit floors — reported, and removed.
 *  3. RAISE IS ONE-SHOT PER SESSION. It is a prediction, not a controller; a
 *     bad guess costs a few seconds because the ordinary downward valve keeps
 *     sampling and can back the device off again.
 *  4. EASE READS THE GAP, RAISE READS RENDER TIME. These two are one line apart
 *     in the caller and swapping them compiles. See the header.
 *  5. NEITHER FIRES WHILE SHARPENED.
 *  6. Both must be followed by `visuals.notifyRenderScaleChanged()` — badge
 *     geometry is authored in CSS px and converted through this exact value.
 *     That one cannot live here, which is why the caller now performs all
 *     three side effects from ONE place instead of two.
 *
 * ⚠️ DOWN FIRST, THEN UP, AND THE ORDER IS LOAD-BEARING. An earlier version of
 * this comment said the two guards are "mutually exclusive … so the order is
 * documentation rather than logic". They are not: a slow GAP with a fast
 * RENDER is routine — it is invariant 4's own bug story, a 60Hz panel whose
 * silicon is idle. What keeps them from both firing is the `return` in the
 * downward branch, not the shape of the guards. Reorder these and a device
 * that needs coarsening can be sharpened instead.
 */
export function resolutionValve(
  state: ValveState, samples: ValveSamples, limits: ValveLimits,
): ValveDecision {
  if (state.sharpened) return NONE;                              // invariant 5
  if (samples.gapCount < limits.sampleMin) return NONE;

  // ── Down: the device is comfortably missing frame budget ────────────────
  if (samples.gapP50 > limits.slowMs && state.current < limits.scaleFloor) {
    const next = Math.min(
      limits.scaleFloor,                                          // invariant 2
      state.current * Math.sqrt(samples.gapP50 / limits.targetMs),
    );
    if (next > state.current) {                                   // invariant 1
      return { nextScaling: next, direction: "ease" };
    }
  }

  // ── Up: one predicted step towards native, at most once per session ─────
  if (state.alreadyRaised) return NONE;                           // invariant 3
  if (samples.renderCount < limits.sampleMin) return NONE;
  // Already at (or finer than) the panel — nothing to win. This is every
  // DPR<=2 device, so they never reach the prediction below at all.
  if (state.current <= state.native + 1e-6) return NONE;
  // Pixel count scales with the SQUARE of the linear scaling change.
  const costRatio = (state.current / state.native) ** 2;
  if (samples.renderP50 * costRatio > limits.targetMs) return NONE;
  return { nextScaling: state.native, direction: "raise" };
}
