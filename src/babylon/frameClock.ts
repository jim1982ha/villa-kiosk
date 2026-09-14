// src/babylon/frameClock.ts
//
// THE clock every stepped animation in the scene reads.
//
// ⚠️ `engine.getDeltaTime()` IS BANNED HERE, AND THIS FILE IS WHY THAT RULE CAN
// BE KEPT. Babylon sets its delta in `beginFrame()`, which its render loop
// calls on every `requestAnimationFrame` tick — BEFORE the loop body decides
// whether to actually render. So it reports tick-to-tick (~16.7ms at 60Hz)
// rather than render-to-render, and the moment continuous animation became
// rate-capped (`SceneManager.ANIMATION_FRAME_MS`) every animation was told
// 16.7ms had passed when 33ms really had: running at half speed while idle and
// snapping to full speed during interaction, which reads as a fan surging.
//
// ⚠️ THE RULE HAD NO CODE OWNER, ONLY A DOCSTRING — so it was implemented twice,
// identically, magic constants and all, each under its own ten-line comment
// re-deriving the reasoning, while a THIRD animation went on calling the banned
// function. A fourth animation would have been a third copy. There is nothing
// else to call now.
//
// Imports nothing, so it runs under plain `node` — see
// tests/oracles/frame_clock.mjs.

/** Longest step any animation is handed. The on-demand render loop can idle for
 *  seconds, and a raw delta after such a gap makes everything jump at once. */
const MAX_STEP_MS = 100;
/** What the FIRST step is worth, having no predecessor to measure against.
 *  One frame at 60Hz — close enough that nothing visibly pops on the first
 *  frame, and it is only ever used once per clock. */
const FIRST_STEP_MS = 16;

export class FrameClock {
  private last = 0;

  /**
   * Real milliseconds since this clock was last stepped, clamped.
   *
   * `now` is passed in rather than read from `performance.now()` so the clock
   * is a pure function of its inputs and can be exercised without a browser —
   * the callers all pass `performance.now()`.
   */
  step(now: number): number {
    const dtMs = this.last ? Math.min(now - this.last, MAX_STEP_MS) : FIRST_STEP_MS;
    this.last = now;
    return dtMs;
  }

  /** Forget the previous frame, so the next `step` is treated as a first one.
   *  For a scene that has been torn down and rebuilt. */
  reset(): void {
    this.last = 0;
  }
}
