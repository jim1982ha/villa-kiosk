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
  private startT = 0;

  /** Start tracking a potential tap (call on the first pointer down). */
  begin(x: number, y: number): void {
    this.candidate = true;
    this.startX = x;
    this.startY = y;
    this.startT = performance.now();
  }

  /** Abandon the candidate (second finger, modifier-drag, gesture cancel). */
  cancel(): void {
    this.candidate = false;
  }

  /** Feed pointer movement; drifting past the tolerance cancels the tap. */
  moved(x: number, y: number): void {
    if (this.candidate && Math.hypot(x - this.startX, y - this.startY) > TapRecognizer.MOVE_TOL) {
      this.candidate = false;
    }
  }

  /**
   * Resolve on pointer up. Returns "tap" for a brief stationary press,
   * "longpress" for a stationary press held past LONG_MS, or null otherwise; the
   * candidate is always reset. On a qualifying touch/pen gesture the trailing
   * ghost click is suppressed so it can't dismiss whatever the gesture opens.
   */
  complete(e: PointerEvent): TapKind {
    const kind: TapKind = !this.candidate
      ? null
      : performance.now() - this.startT >= TapRecognizer.LONG_MS
        ? "longpress"
        : "tap";
    this.candidate = false;
    if (kind && e.pointerType !== "mouse") suppressGhostClick(e.clientX, e.clientY);
    return kind;
  }
}
