// src/babylon/pointerRoster.ts
// The pointers a camera controller is currently tracking — ONE roster for the
// walk camera (CameraController) and the bird's-eye camera (OverviewController).
//
// Every gesture decision in both controllers is a COUNT: one pointer arms the
// tap and pans or looks, two rotate/tilt or pinch/walk, zero fires the tap. So
// a pointer the browser stopped reporting without a `pointerup` or a
// `pointercancel` breaks two things at once — the tap never arms and never
// fires, and a one-finger drag reads as the second finger of a two-finger
// gesture ("the camera tilts as if ctrl were held", "the room badge does
// nothing when tapped"). WebKit does lose sequences that way — a drawing-buffer
// resize during an active touch was one reproduced cause (2.322.0).
//
// ⚠️ THE SELF-HEAL LIVED IN ONE CONTROLLER (2.496.195). 2.323.0 added
// `dropLostPointers` — forget any pointer whose capture we KNOW we took and
// the browser no longer holds — to the bird's-eye controller only; the walk
// controller kept the identical Map with no liveness check at all. One roster,
// one rule; both controllers ask it.
//
// `hasPointerCapture` is the exact question, because the roster captures every
// pointer it tracks: losing capture without an up or a cancel means the browser
// ended that pointer and did not say so. Only entries we KNOW we captured are
// eligible — if `setPointerCapture` threw, absent capture proves nothing, and
// pruning on it would turn a live two-finger gesture into a pan mid-stroke.

export interface TrackedPointer {
  x: number;
  y: number;
  /** PointerEvent.pointerType: "mouse" | "touch" | "pen". */
  type: string;
  /** setPointerCapture succeeded, so hasPointerCapture is a valid liveness read. */
  captured: boolean;
}

/** The surface pointers are captured on — an HTMLCanvasElement, or a stub. */
export interface CaptureSurface {
  setPointerCapture(id: number): void;
  releasePointerCapture(id: number): void;
  hasPointerCapture(id: number): boolean;
}

export class PointerRoster {
  private readonly map = new Map<number, TrackedPointer>();
  private readonly surface: CaptureSurface;

  // No parameter property: Node's type stripping (the oracles) refuses them.
  constructor(surface: CaptureSurface) { this.surface = surface; }

  get size(): number { return this.map.size; }

  /** Track a pointer that just went down — after forgetting any the browser
   *  has silently lost — and capture it. Returns how many were forgotten. */
  down(id: number, x: number, y: number, type: string): number {
    const lost = this.dropLost();
    let captured = true;
    try { this.surface.setPointerCapture(id); } catch { captured = false; }
    this.map.set(id, { x, y, type, captured });
    return lost;
  }

  /** Record a move. The pointer's PREVIOUS position and the delta, or null
   *  for a pointer that is not tracked (a mouse moving with no button held). */
  move(id: number, x: number, y: number): { oldX: number; oldY: number; dx: number; dy: number } | null {
    const p = this.map.get(id);
    if (!p) return null;
    const out = { oldX: p.x, oldY: p.y, dx: x - p.x, dy: y - p.y };
    p.x = x; p.y = y;
    return out;
  }

  /** Forget a pointer that went up or was cancelled, releasing its capture. */
  up(id: number): void {
    this.map.delete(id);
    try { this.surface.releasePointerCapture(id); } catch { /* never captured */ }
  }

  clear(): void { this.map.clear(); }

  /** Forget pointers the browser has stopped telling us about. Returns how
   *  many were dropped, so a caller can reset a gesture baseline. */
  dropLost(): number {
    let dropped = 0;
    for (const [id, p] of this.map) {
      if (!p.captured) continue;
      let live = true;
      try { live = this.surface.hasPointerCapture(id); } catch { live = false; }
      if (!live) { this.map.delete(id); dropped++; }
    }
    return dropped;
  }

  values(): TrackedPointer[] { return [...this.map.values()]; }

  touchCount(): number {
    let n = 0;
    for (const p of this.map.values()) if (p.type === "touch") n++;
    return n;
  }

  /** The two touch pointers of a pinch, in tracking order, or null. */
  touchPair(): [TrackedPointer, TrackedPointer] | null {
    const t = this.values().filter((p) => p.type === "touch");
    return t.length === 2 ? [t[0], t[1]] : null;
  }
}
