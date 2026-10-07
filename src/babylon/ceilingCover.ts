// src/babylon/ceilingCover.ts
// Is the walker indoors — under a ceiling — or outdoors? The answer decides
// whether the ceilings are drawn while walking (StructureSet.followEye).
//
// ⚠️ INDOORS IS "A CEILING IS OVER ME", NOT A ROOM NAME (owner, 2026-10-07: "I see
// the sky above the visitor on 2F indoors … the roof must not appear in overview,
// nor when the person is outdoors on 2F"). A ceiling the model ships is a lid the
// villa's author drew over a room (SweetHome's "Display ceiling"); a terrace left
// open has none. So the walker is indoors exactly when a ceiling of the storeys
// shown is straight above the eye — nothing here knows a room, a name or a villa.
//
// ⚠️ OUTDOORS ONLY AFTER A HOLD. A ceiling stops at the wall's inner face, so
// walking through a doorway passes a strip with no ceiling over it; flipping on
// that strip would blink every lid in the villa at each door. Indoors is taken at
// once (stepping in shows the lid immediately); outdoors only once no ceiling has
// been over the eye for OUTDOOR_DELAY_MS.

/** How long the eye must be clear of every ceiling before the walker is outdoors. */
export const OUTDOOR_DELAY_MS = 450;

/** How far the eye must move, or how long must pass, before the ray is cast again. */
export const RECHECK_MOVE_M = 0.2;
export const RECHECK_MS = 250;

export interface CoverState {
  indoors: boolean;
  /** When the eye was first seen with no ceiling over it, while still indoors. */
  clearSince: number | null;
}

export const START_COVER: CoverState = { indoors: true, clearSince: null };

/** The next state, from whether a ceiling is over the eye now. Pure. */
export function nextCover(prev: CoverState, underCeiling: boolean, now: number,
                          delayMs: number = OUTDOOR_DELAY_MS): CoverState {
  if (underCeiling) return { indoors: true, clearSince: null };
  if (!prev.indoors) return prev;
  const since = prev.clearSince ?? now;
  return now - since >= delayMs ? { indoors: false, clearSince: null } : { indoors: true, clearSince: since };
}

/** Whether the ceilings are drawn: never in the overview, and while walking only indoors. */
export function ceilingsShown(view: "first-person" | "overview", cover: CoverState): boolean {
  return view === "first-person" && cover.indoors;
}

/** Whether to cast the ray again: the eye moved far enough, or long enough has passed. */
export function shouldRecheck(last: { x: number; z: number; at: number } | null,
                              eye: { x: number; z: number }, now: number): boolean {
  if (!last) return true;
  return Math.hypot(eye.x - last.x, eye.z - last.z) >= RECHECK_MOVE_M || now - last.at >= RECHECK_MS;
}
