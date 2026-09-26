// src/babylon/frameScheduler.ts
// "Draw a frame now?" — answered in one place, every requestAnimationFrame tick.
//
// ⚠️ THIS WAS SIX FIELDS AND ONE CLOSURE IN SceneManager, REACHED THREE WAYS.
// SunController got a render hook through a setter with a no-op default;
// EntityVisuals and RoomHighlight got two positional callbacks and fell back
// with `requestAnimationRender ?? requestRender` — a fallback that silently
// removes the animation frame cap for anyone who forgets the second argument;
// the camera controllers got `onActivity`. Every one of those now holds the
// same small FrameRequests, and the rule deciding what they buy is `tick`.
//
// The rule, unchanged from SceneManager's render loop:
//  * MOTION (a pose change, a pointer) is recorded when it happens and SPENT
//    here, inside rAF: it un-sharpens, and it is what "still" is measured from.
//    Never un-sharpen from an input handler — it resizes the drawing buffer
//    during input dispatch (2.322.0's lost pointerup).
//  * A pinned stream, a repaint window or `renderOnDemand: false` renders at
//    the display's rate. Once still, the frame is sharp — and a SHARP frame is
//    a repaint, rate-capped and never sampled (2.322.0: sampling it would ease
//    the device down for having drawn a better picture).
//  * The end of such a burst flushes the frame samples to the resolution valve.
//  * A continuous animation (a fan) renders at the capped rate, and obeys the
//    same sharpness rule — a turning fan is not a moving camera (2.329.0).
//  * Otherwise nothing renders — except the one frame that sharpening buys.
//
// Pure apart from the resolution port: tests/oracles/frame_scheduler.mjs
// drives `tick` with a fake one and a clock it advances by hand.

/** What a module may ask of the render loop. The whole interface. */
export interface FrameRequests {
  /** Something changed: render at the display's rate for `ms`. */
  repaint(ms?: number): void;
  /** A continuous animation stepped: keep drawing, rate-capped, for `ms`. */
  animate(ms?: number): void;
}

/** The resolution valve, as the scheduler sees it. SceneManager is the adapter. */
export interface ResolutionPort {
  /** Raise to native resolution. True only if it changed anything. */
  sharpen(): boolean;
  /** Put the motion resolution back. Idempotent. */
  unsharpen(): void;
  /** Whether the scaling is currently overridden to native. */
  isSharp(): boolean;
}

export interface FrameDecision {
  /** Call scene.render() this tick. */
  render: boolean;
  /** Time this frame for the `frames` telemetry and the resolution valve. */
  sample: boolean;
  /** An interaction burst just ended: flush the samples to the valve. */
  flush: boolean;
}

const NOTHING: FrameDecision = { render: false, sample: false, flush: false };

export class FrameScheduler implements FrameRequests {
  private repaintUntil = 0;
  private animateUntil = 0;
  private pins = 0;
  private lastCappedAt = 0;
  private motionPending = false;
  private lastMotionAt = 0;
  private readonly stillMs: number;
  private readonly animationFrameMs: number;
  private readonly onDemand: () => boolean;
  private readonly now: () => number;

  constructor(opts: {
    /** How long the camera must be still before the picture sharpens. */
    stillMs: number;
    /** The rate cap for sharp repaints and animation frames. */
    animationFrameMs: number;
    /** config.renderOnDemand — false renders continuously. */
    onDemand: () => boolean;
    now?: () => number;
  }) {
    this.stillMs = opts.stillMs;
    this.animationFrameMs = opts.animationFrameMs;
    this.onDemand = opts.onDemand;
    this.now = opts.now ?? (() => performance.now());
  }

  repaint(ms = 350): void {
    this.repaintUntil = Math.max(this.repaintUntil, this.now() + ms);
  }

  animate(ms = 350): void {
    this.animateUntil = Math.max(this.animateUntil, this.now() + ms);
  }

  /** The camera moved. Spent by the next tick — see the header. */
  motion(): void {
    this.motionPending = true;
    this.repaint();
  }

  /** Render continuously until the returned function is called (a camera
   *  stream, a calibration burst). Ref-counted; the release is idempotent. */
  pin(): () => void {
    this.pins++;
    this.repaint();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pins = Math.max(0, this.pins - 1);
    };
  }

  get pinned(): boolean { return this.pins > 0; }

  tick(now: number, res: ResolutionPort): FrameDecision {
    if (this.motionPending) {
      this.motionPending = false;
      this.lastMotionAt = now;
      res.unsharpen();
    }
    const still = now - this.lastMotionAt >= this.stillMs;
    const capped = (): boolean => {
      if (now - this.lastCappedAt < this.animationFrameMs) return false;
      this.lastCappedAt = now;
      return true;
    };

    if (this.pins > 0 || now < this.repaintUntil || !this.onDemand()) {
      if (still) res.sharpen();
      if (res.isSharp()) return { render: capped(), sample: false, flush: false };
      this.lastCappedAt = now;
      return { render: true, sample: true, flush: false };
    }
    if (now < this.animateUntil) {
      if (still) res.sharpen();
      return { render: capped(), sample: false, flush: true };
    }
    // Idle: the one extra frame is drawn exactly when there is a sharper
    // picture to draw, never on the idle ticks that follow.
    return res.sharpen() ? { render: true, sample: false, flush: true } : { ...NOTHING, flush: true };
  }
}
