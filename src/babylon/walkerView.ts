// src/babylon/walkerView.ts
// The walker: whether the villa is being walked, and the room the walker stands in — ONE owner.
//
// ⚠️ ONE FACT, ONE PLACE (architecture review 10, 2026-10-09). "Walking or not" was kept in
// SceneManager, EntityVisuals, FloorManager and the structure set, re-synced by hand at two
// sites (a boot straight into the walk once missed one). And the walker's ROOM was worked out
// twice: the room banner by the FEET (CameraController, Storeys.roomStandingOn), the badge
// layer's "keep your own room whole" (2026-10-08) by the EYE (Storeys.roomAt) — two questions
// storeys.ts says must not be merged (2.437.0 broke the banner that way), so at a staircase or a
// split level the banner and the badges could name different rooms.
//
// Now SceneManager writes `walking` (setViewMode, a model load), CameraController writes `room`
// (every step, a teleport), and the badge layer READS both. A plain object: no Babylon, no
// events — the writers already call what must react; this only stops the readers keeping copies.
// Its plan room is a NAME: CameraController keeps its own Storeys, so room objects differ.

export class WalkerView {
  /** The villa is being walked (first-person), not seen from above. */
  walking = false;
  /** The plan room the walker STANDS in (the room banner's answer), or null outdoors, in the
   *  overview, or before the first step. */
  room: string | null = null;
}

/**
 * The rooms never grouped this frame (PlacementFrame.exempt): the `focus` (a tap), and while walking the room the
 * walker stands in — as the badges' own room keys. `planRoomName(id)`: the plan room a badge's device is in (by
 * name); `roomKeyOf(id)`: the badge's room key (HA's Area or the plan's, normalised). So no badge name has to
 * match the plan's: the badges standing in the walker's plan room carry the key. Returns `focus` itself when
 * nothing is added (no allocation on a frame that changes nothing).
 */
export function walkExemptRooms(
  focus: ReadonlySet<string>, walker: Pick<WalkerView, "walking" | "room">, shown: readonly { id: string }[],
  planRoomName: (id: string) => string | null, roomKeyOf: (id: string) => string,
): ReadonlySet<string> {
  if (!walker.walking || !walker.room) return focus;      // overview, outdoors, a stairwell: nothing to keep whole
  let out: Set<string> | null = null;
  for (const s of shown) {
    if (planRoomName(s.id) !== walker.room) continue;
    const k = roomKeyOf(s.id);
    if (focus.has(k) || out?.has(k)) continue;
    (out ??= new Set(focus)).add(k);
  }
  return out ?? focus;
}

