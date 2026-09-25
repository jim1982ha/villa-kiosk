// src/babylon/roomFocus.ts
// A FOCUSED ROOM: the room(s) the user asked to see — tapped its chip, picked
// it from the radial menu — and the two things that grants, which expire
// differently:
//   * the EXEMPTION: the room's own badges take no part in grouping, so they
//     are drawn individually — kept while the camera stays at least as close
//     as when the focus began (zooming IN never takes it away);
//   * the SUPPRESSION: every OTHER room held at its chip — only while the
//     camera is at or wider than that zoom.
//
// ⚠️ BOTH EXPIRY RULES ARE REPORTED BUGS, FIXED INLINE IN cullLabels: `!==`
// where `<` belonged (zoom in one rung and the pool collapsed back to the chip
// just tapped), and a suppression that shared the exemption's lifetime (pan to
// another room and it stayed a chip at every zoom). Pure now, and
// tests/oracles/room_focus.mjs replays both. EntityVisuals asks `step` once a
// pass, before any grouping, with the quantised zoom in CSS px.
//
/*
 * The rooms the user asked to SEE, as roomKeys.
 *
 * ── Why an exemption exists at all ────────────────────────────────────────
 * "Tap a room, see its devices" was implemented four times as a search for a
 * zoom at which that room's badges happen not to collide, and it kept coming
 * back as "I still see the chip". The last of those attempts is why: two
 * devices mounted at ONE 3D point (a ceiling fan and its own light kit) are
 * separated by no zoom level that exists, so for those rooms the promise is
 * unkeepable by construction — no amount of solving finds a distance that
 * is not there.
 *
 * The requirement is not "try hard to declutter". It is: tapping a room ALWAYS
 * shows that room's badges, never a summary of them. So the focused room is
 * simply exempt from grouping: its badges take no part in the pile-building
 * at all (see groupBadges), which makes them individually drawn as a matter
 * of fact rather than as an outcome the camera has to earn. The zoom solve
 * still runs and still picks the tightest shot that separates them where one
 * exists — it just no longer decides WHETHER the user gets what they asked
 * for.
 *
 * The trade-off is explicit: for a room whose devices genuinely cannot be
 * separated, its two badges will overlap at the chosen zoom. That is the
 * honest presentation of "these two things are in the same place", and it is
 * what was asked for over a chip that hides both.
 */
export class RoomFocus {
  private keys = new Set<string>();
  /** The quantised zoom the focus was granted at; 0 until the first pass
   *  after the grant stamps it. */
  private atZoom = 0;

  /** The focused rooms (roomKey form). */
  get rooms(): ReadonlySet<string> { return this.keys; }
  get size(): number { return this.keys.size; }

  /**
   * Focus these rooms (none: drop the focus). Returns whether anything
   * changed. The zoom is stamped on the NEXT pass, once the camera has
   * actually been moved to the solved pose — reading it here would capture
   * the pre-flight zoom and clear the focus on arrival.
   */
  grant(keys: readonly string[]): boolean {
    if (keys.length === this.keys.size && keys.every((k) => this.keys.has(k))) return false;
    this.keys = new Set(keys);
    this.atZoom = 0;
    return true;
  }

  /**
   * One layout pass at quantised zoom `z` (CSS px per world unit). Returns
   * whether the OTHER rooms are held at their chips this pass; the exemption
   * is `rooms`, which this may clear.
   *
   * ── The focus lasts as long as you stay at least as close ──
   * No camera-event plumbing, and nothing that has
   * to tell "the user zoomed" from "we flew there": the exemption is stamped
   * with the quantised zoom of the first pass after it was granted, and
   * dropped once the view gets FARTHER than that. Panning keeps it (the zoom
   * is unchanged, and looking around a room you asked to see should not
   * collapse it); zooming out ends it, which is exactly when a summary
   * becomes the right answer again.
   *
   * ⚠️ `z < atZoom`, NOT `z !== atZoom`, and the difference is
   * a reported bug. Tapping the Swimming Pool chip expanded the room; zooming
   * IN by one rung changed z, dropped the exemption, and the room collapsed
   * straight back to the very chip that had just been tapped — then expanded
   * again a rung later, once the badges genuinely separated. Zooming in
   * strictly increases the distance between anchors: it is the one direction
   * that can never make a room less legible, so it must never be the thing
   * that takes it away. The original stamp stays the floor rather than
   * re-stamping on the way in, which is what makes "at least as close as when
   * you asked" the literal rule.
   *
   * ⚠️ CSS PIXELS, and that is the second half of the same rule. This is the
   * only place the measure is compared BETWEEN frames, so it is the only
   * place the resolution valve can forge a zoom change — see
   * quantisedPixelsPerWorldUnit for the full symptom. Grouping keeps render
   * pixels because it compares within one frame against boxes in the same
   * units; this must not.
   * ── The focus has TWO consequences and they expire differently ─────────
   * The EXEMPTION — the focused room's own badges drawn individually — keeps
   * the rule above: it survives zooming in, because coming closer can never
   * make a room less legible.
   *
   * The SUPPRESSION added in 2.368.0 — every OTHER room held at its chip —
   * must not. It exists to stop the neighbours competing for the frame at the
   * moment you ask for a room, and that is all it is for. Left to share the
   * exemption's lifetime it became sticky: focus a room, pan across to
   * another, and that one stayed a chip at every zoom, because the pass was
   * still forcing it clustered. Reported as "the other room badge never
   * declutters into entity icons".
   *
   * So it holds only while the camera is AT OR WIDER THAN the zoom the focus
   * was granted at. Zoom in from there and every room is back under the
   * ordinary rules, decluttering by zoom exactly as it did before — which is
   * the property being asked for, expressed as the one condition that already
   * means "you have not yet earned the space to draw these".
   */
  step(z: number): boolean {
    if (this.keys.size === 0) return false;
    if (this.atZoom === 0) this.atZoom = z;
    else if (z < this.atZoom) { this.keys.clear(); this.atZoom = 0; }
    return this.keys.size > 0 && z <= this.atZoom;
  }
}
