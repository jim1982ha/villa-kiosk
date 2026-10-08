// src/babylon/layoutGate.ts
// Whether the badge layout runs this frame: the view changed, or something marked it dirty.
//
// The layout (EntityVisuals.cullLabels) is skipped when nothing that can move a badge has changed:
// the view-projection matrix is the honest test for the camera (pan, orbit, zoom, fov in one
// comparison), and a DIRTY mark covers everything else — a setter, a state change, an occlusion
// sweep that owes its answers. Allocation-free: the last matrix is copied into one Float32Array.
//
// ⚠️ ITS OWN MODULE SO ITS CALLERS CAN BE TESTED (architecture review 10, 2026-10-09). On
// 2026-10-08 the occlusion sweep was right and its CALLER was not: a camera that had stopped kept
// the view unchanged, nothing marked the layout dirty, and the sweep never ran — badges behind
// walls stayed drawn. The sweep's oracle stepped every frame and could not see this gate; now
// tests/oracles/occlusion_sweep.mjs drives the real gate and the real wall step together.

export class LayoutGate {
  private dirty = true;
  private last: Float32Array | null = null;
  private w = -1;
  private h = -1;

  /** Something that can change where or whether a badge draws has happened: run on the next frame. */
  markDirty(): void { this.dirty = true; }

  /** Must the layout run for this view? True when dirty or the view changed; it then records the
   *  view and clears the mark. `m`: the 16 numbers of the view-projection matrix; `w`, `h`: the
   *  viewport in pixels. */
  open(m: ArrayLike<number>, w: number, h: number): boolean {
    if (!this.dirty && this.last && this.w === w && this.h === h) {
      let same = true;
      for (let i = 0; i < 16; i++) if (this.last[i] !== m[i]) { same = false; break; }
      if (same) return false;
    }
    if (!this.last) this.last = new Float32Array(16);
    for (let i = 0; i < 16; i++) this.last[i] = m[i];
    this.w = w;
    this.h = h;
    this.dirty = false;
    return true;
  }
}
