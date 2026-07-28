// src/babylon/TapRecognizer.ts
// Shared tap-vs-drag gesture detector for the first-person and overview camera
// controllers. A "tap" is a brief, near-stationary single-pointer press; a
// near-stationary press held past LONG_MS resolves as a "longpress" instead
// (used to open an entity's full panel while a plain tap does the fast on/off).
// On touch/pen it also swallows the synthesized ghost click so the UI the
// gesture opens isn't instantly dismissed. Each controller keeps its own
// pinch/pan logic but shares this one tap state machine — so the tap thresholds
// and the ghost-click fix live in exactly one place.

import { suppressGhostClick } from "@/utils/ghostClick";

export type TapKind = "tap" | "longpress" | null;

export class TapRecognizer {
  private static readonly MOVE_TOL = 14; // px — generous for fat-finger touch
  private static readonly LONG_MS = 500; // ms — stationary press held this long = long-press

  private candidate = false;
  private startX = 0;
  private startY = 0;
  /** Set once the hold timer has already delivered this gesture's long-press,
   *  so the eventual pointerup resolves to null instead of double-firing. */
  private fired = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param onLongPress Fired the INSTANT the hold passes LONG_MS, while the
   *  finger/button is still down — not on release. Long-press used to resolve
   *  only inside complete(), so nothing happened until the user let go:
   *  holding for two seconds meant two seconds of silence and then everything
   *  at once, which reads as lag ("did that register?") rather than as a
   *  deliberate hold. Firing on the threshold lets the caller acknowledge the
   *  gesture immediately AND starts the Home Assistant round-trip at the
   *  earliest moment it possibly could, instead of at release.
   */
  constructor(private readonly onLongPress?: (x: number, y: number) => void) {}

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Start tracking a potential tap (call on the first pointer down). */
  begin(x: number, y: number): void {
    this.clearTimer();
    this.candidate = true;
    this.fired = false;
    this.startX = x;
    this.startY = y;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.candidate) return;
      this.fired = true;
      this.onLongPress?.(this.startX, this.startY);
    }, TapRecognizer.LONG_MS);
  }

  /** Abandon the candidate (second finger, modifier-drag, gesture cancel). */
  cancel(): void {
    this.candidate = false;
    this.clearTimer();
  }

  /** Feed pointer movement; drifting past the tolerance cancels the tap. */
  moved(x: number, y: number): void {
    if (this.candidate && Math.hypot(x - this.startX, y - this.startY) > TapRecognizer.MOVE_TOL) {
      this.cancel();
    }
  }

  /**
   * Resolve on pointer up. Returns "tap" for a brief stationary press, or null
   * — either because this was never a tap candidate, or because the hold timer
   * ALREADY delivered the long-press mid-gesture. ("longpress" stays in
   * TapKind for callers that still switch on it; it is simply never returned
   * from here any more.) The candidate is always reset. On a qualifying
   * touch/pen gesture the trailing ghost click is suppressed so it can't
   * dismiss whatever the gesture opened — including a long-press that already
   * fired before release, which is exactly when a stray ghost click would
   * otherwise land on the freshly-opened panel.
   */
  complete(e: PointerEvent): TapKind {
    this.clearTimer();
    const consumed = this.fired;
    const kind: TapKind = !this.candidate || consumed ? null : "tap";
    this.candidate = false;
    this.fired = false;
    if ((kind || consumed) && e.pointerType !== "mouse") {
      suppressGhostClick(e.clientX, e.clientY);
    }
    return kind;
  }
}
