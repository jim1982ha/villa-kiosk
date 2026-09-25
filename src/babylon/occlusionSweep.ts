// src/babylon/occlusionSweep.ts
// Which badges are behind a wall, seen from where the walker stands.
//
// ⚠️ THE ANSWERS COULD OUTLIVE THE QUESTION. The sweep re-tested badges only
// when the EYE moved (or on leaving first-person). Once every shown badge had
// been answered it stopped — so a floor switch while standing still (which
// also changes which slabs occlude), or a badge appearing because its category
// was switched on, kept the old answers until the next step: a badge behind a
// wall stayed drawn, and a stale id could hide a visible one or a whole room's
// chip. It had happened once already the other way (d0b3e9d4, `occl=52/16`:
// 52 remembered ids against 16 shown badges after walking upstairs).
//
// So the sweep restarts on any of three things: the eye moving, the SET of
// shown badges changing, or `invalidate()` (the occluders changed). The rules
// it already had stay exactly as they were, and are carried here with it:
//  * a moving eye casts NO rays — answers lag a step, a 100 ms hitch would not;
//  * the budget is TIME (the same rays cost 7 ms in a corridor, 121 ms down
//    the villa), with at least one ray a pass so it can never stall;
//  * a badge within arm's reach is in the room with you;
//  * a ray stops short of its anchor, which usually hangs ON a wall.
//
// The ray cast is the seam: EntityVisuals' adapter tests the structure meshes
// with Babylon's intersectsMesh; tests/oracles/occlusion_sweep.mjs uses a fake.

export interface OcclusionTarget { id: string; wx: number; wy: number; wz: number; occluded?: boolean }

/** Is the segment from `o` along unit `d` for `len` metres blocked? The
 *  blocker's name, or null. Must skip occluders that are not visible. */
export type RayCast = (
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number,
) => string | null;

/** What a pass did — the caller keeps frames coming unless it is `idle`. */
export type SweepPass = "idle" | "settling" | "sweeping" | "complete";

export class OcclusionSweep {
  private readonly ids = new Set<string>();
  private readonly blockers = new Map<string, string>();
  private readonly live = new Set<string>();
  private from = { x: NaN, y: NaN, z: NaN };
  private liveKey = "";
  private dirty = false;
  private cursor = 0;
  private movingSince = -Infinity;
  /** How many shown badges have been answered since the last restart. */
  swept = 0;
  lastRays = 0;
  lastMs = 0;
  private readonly settleMs: number;
  private readonly nearM: number;
  private readonly slackM: number;
  private readonly cast: RayCast;
  private readonly now: () => number;

  constructor(opts: { settleMs: number; nearM: number; slackM: number; cast: RayCast; now?: () => number }) {
    this.settleMs = opts.settleMs;
    this.nearM = opts.nearM;
    this.slackM = opts.slackM;
    this.cast = opts.cast;
    this.now = opts.now ?? (() => performance.now());
  }

  /** The badges currently judged behind a wall. */
  get occluded(): ReadonlySet<string> { return this.ids; }
  /** Which mesh blocks each occluded badge — a name, because a count cannot
   *  answer "why is THAT badge missing". */
  get blockedBy(): ReadonlyMap<string, string> { return this.blockers; }

  isMoving(now = this.now()): boolean { return now - this.movingSince < this.settleMs; }

  /** The occluders changed (a storey shown or hidden): re-test everything,
   *  without the settle delay — the walker has not moved. */
  invalidate(): void { this.dirty = true; }

  /** Start over; `forget` also drops every answer (leaving first-person —
   *  the overview has no notion of occlusion). */
  reset(forget: boolean): void {
    this.swept = 0;
    this.cursor = 0;
    this.liveKey = "";
    if (forget) { this.ids.clear(); this.blockers.clear(); }
  }

  step(shown: OcclusionTarget[], eye: { x: number; y: number; z: number }, budgetMs: number): SweepPass {
    const now = this.now();
    const still = Math.abs(this.from.x - eye.x) <= 1e-4
      && Math.abs(this.from.y - eye.y) <= 1e-4 && Math.abs(this.from.z - eye.z) <= 1e-4;
    let key = "";
    for (const s of shown) key += s.id + "\u0001";
    if (!still || key !== this.liveKey || this.dirty) {
      if (!still) {
        this.from = { x: eye.x, y: eye.y, z: eye.z };
        this.movingSince = now;
      }
      this.swept = 0;
      this.dirty = false;
      this.liveKey = key;
      this.prune(shown);
    } else if (this.swept >= shown.length) {
      this.lastRays = 0;
      this.lastMs = 0;
      return "idle";
    }
    if (now - this.movingSince < this.settleMs) {
      this.lastRays = 0;
      this.lastMs = 0;
      return "settling";
    }
    const t0 = this.now();
    let rays = 0;
    while (this.swept < shown.length && (rays < 1 || this.now() - t0 < budgetMs)) {
      const s = shown[this.cursor % shown.length];
      this.cursor++;
      this.swept++;
      rays++;
      const dx = s.wx - eye.x, dy = s.wy - eye.y, dz = s.wz - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist <= this.nearM) { this.answer(s, null); continue; }
      this.answer(s, this.cast(eye.x, eye.y, eye.z, dx / dist, dy / dist, dz / dist, dist - this.slackM));
    }
    this.lastRays = rays;
    this.lastMs = this.now() - t0;
    return this.swept < shown.length ? "sweeping" : "complete";
  }

  private answer(s: OcclusionTarget, blocker: string | null): void {
    s.occluded = blocker !== null;
    if (blocker !== null) { this.ids.add(s.id); this.blockers.set(s.id, blocker); }
    else { this.ids.delete(s.id); this.blockers.delete(s.id); }
  }

  /** Forget answers for badges no longer shown — they are what a stale id
   *  hides a room's chip with. */
  private prune(shown: OcclusionTarget[]): void {
    if (this.ids.size === 0) return;
    this.live.clear();
    for (const s of shown) this.live.add(s.id);
    for (const id of this.ids) {
      if (this.live.has(id)) continue;
      this.ids.delete(id);
      this.blockers.delete(id);
    }
  }
}
