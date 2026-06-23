// src/babylon/TapRecognizer.ts
// Shared tap-vs-drag gesture detector for the first-person and overview camera
// controllers. A "tap" is a brief, near-stationary single-pointer press. On
// touch/pen it also swallows the synthesized ghost click so the UI the tap
// opens (e.g. an entity panel) isn't instantly dismissed. Each controller keeps
// its own pinch/pan logic but shares this one tap state machine — so the tap
// thresholds and the ghost-click fix live in exactly one place.

import { suppressGhostClick } from "@/utils/ghostClick";

export class TapRecognizer {
  private static readonly MOVE_TOL = 14; // px — generous for fat-finger touch
  private static readonly TIME = 400; // ms — longer than this is a press/hold

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
   * Resolve on pointer up. Returns true if the gesture qualified as a tap (still
   * a candidate and brief); the candidate is always reset. On a qualifying
   * touch/pen tap the trailing ghost click is suppressed.
   */
  complete(e: PointerEvent): boolean {
    const isTap = this.candidate && performance.now() - this.startT < TapRecognizer.TIME;
    this.candidate = false;
    if (isTap && e.pointerType !== "mouse") suppressGhostClick(e.clientX, e.clientY);
    return isTap;
  }
}
