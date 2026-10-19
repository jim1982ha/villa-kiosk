// src/babylon/badgeFrame.ts
// One layout pass's badges, before any grouping: which take part, where each stands on screen and in the world,
// which are behind a wall while walking, and which are finally drawn. EntityVisuals reads Babylon (the badge's mesh,
// its anchor's world position, the projection) and hands the values in; THE WIRING between them is here, where a
// check drives it by value.
//
// ⚠️ WHY IT IS ITS OWN MODULE (architecture review, 2026-10-19). The sweep, the walker, the focus and the
// placement pass were already pure; only the ORDER they ran in and WHAT they were given lived in the 5,600-line
// layer, pinned by regexes on its text. The defect this wiring already had was of that kind — the line of sight
// aimed at the badge, which floats above the device, instead of the device (2.496.311: 93 devices behind walls
// drawn while walking → 1) — and a regex on the right line could not show what it computed.
//
// ⚠️ HOT PATH: runs on every pass the layout gate lets through. The badges are POOLED (a slot per badge, reused
// every pass; only a badge count above the high-water mark allocates) — never a new object per frame.

import type { LabelControls } from "./EntityVisuals";
import type { ShownLabel } from "./placementPass";
import { type OcclusionSweep, type SweepPass, wallStep } from "./occlusionSweep";

export class BadgeFrame {
  /** This pass's badges, in label order; its objects are the pool's, alive across passes. */
  readonly shown: ShownLabel[] = [];
  private readonly pool: ShownLabel[] = [];
  private count = 0;

  /** A new pass: no badge yet. */
  begin(): void { this.count = 0; }

  /**
   * A badge that takes part this pass. `w*`: its anchor in the world; `p*`: that anchor projected (render pixels,
   * depth in [0,1] when in front of the camera); `drop`: how far its device's centre is below the anchor; `occluded`:
   * the sweep's last answer for it.
   *
   * The anchor's WORLD position is what grouping runs on; its projection is only needed to draw it. An anchor
   * projecting behind the camera has no screen position and is not drawn, but it still takes part in grouping —
   * so turning the camera cannot change how a room is presented.
   */
  add(id: string, lbl: LabelControls, wx: number, wy: number, wz: number, px: number, py: number, pz: number,
    drop: number, occluded: boolean): void {
    let s = this.pool[this.count];
    if (!s) {
      s = { id, lbl, x: 0, y: 0, wx: 0, wy: 0, wz: 0, sx: 0, sy: 0, sz: 0, inFront: false, occluded: false };
      this.pool[this.count] = s;
    }
    s.id = id;
    s.lbl = lbl;
    s.x = px;
    s.y = py;
    s.wx = wx;
    s.wy = wy;
    s.wz = wz;
    // the line of sight aims at the DEVICE, below its floating badge (occlusionSweep's `ty`)
    s.ty = wy - drop;
    s.inFront = pz >= 0 && pz <= 1;
    s.occluded = occluded;
    this.shown[this.count] = s;
    this.count++;
  }

  /** The pass's badges, cut to this pass's count (the pool keeps the rest for the next). */
  end(): ShownLabel[] {
    this.shown.length = this.count;
    return this.shown;
  }

  /**
   * Which badges are behind a wall, seen from the walker's eye — only while walking: in the bird's-eye view the
   * villa is seen through its own walls (a cut-away plan), so leaving the walk forgets every answer and nothing is
   * hidden. "off" when no sweep ran. A pass that owes the layout another pass (settling included: occlusionSweep's
   * owesLayout) marks it dirty through `markDirty`, the layout gate's.
   */
  walls(sweep: OcclusionSweep, on: { enabled: boolean; walking: boolean; eye: { x: number; y: number; z: number };
    budgetMs: number; markDirty: () => void }): SweepPass | "off" {
    const shown = this.shown;
    if (!on.enabled || !on.walking || shown.length === 0) {
      if (sweep.occluded.size) {
        sweep.reset(true);
        for (const s of shown) s.occluded = false;
      }
      return "off";
    }
    return wallStep(sweep, shown, on.eye, on.budgetMs, on.markDirty);
  }
}

/** Is this badge DRAWN this pass: in front of the camera, not behind a wall, and kept by the placement pass. Both
 *  gates sit on drawing a badge whose grouping is already decided, so neither moves one or changes its pile. The
 *  PASS is given, not its method: drawnBadge reads the pass's own state, and a method handed over alone loses it. */
export const drawnThisPass = (s: ShownLabel, pass: { drawnBadge(id: string): boolean }): boolean =>
  s.inFront && !s.occluded && pass.drawnBadge(s.id);
