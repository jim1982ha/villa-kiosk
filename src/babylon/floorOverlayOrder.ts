// src/babylon/floorOverlayOrder.ts
// The draw order of the see-through layers that lie FLAT ON A FLOOR.
//
// ⚠️ THE CAMERA MUST NOT DECIDE THIS. Babylon draws transparent meshes far to
// near by the distance from the camera to each mesh's bounding-sphere CENTRE,
// unless `alphaIndex` says otherwise — and nothing here said otherwise. The
// presence glow is ONE mesh the size of its room; a light pool is a small mesh
// under one fixture. Both sat at the same 0.02m above the floor, and both
// wrote depth. So as the camera tilted, each pool flipped between "nearer than
// the room's centre" and "further": drawn after the glow it showed, drawn
// before it the glow's depth — at the pool's own height — rejected it. Reported
// as the patio's light pools disappearing one by one as the view tilted, only
// while the room was red for presence, all four back the moment it cleared.
//
// Hence both halves, and neither alone is enough:
//  * an ORDER that does not move — the glow first, then the pools, so a lit
//    floor reads as lit whether or not someone is standing on it;
//  * no DEPTH WRITE from either — a translucent film on the floor must never
//    hide anything. Without this, a fixed order still lets two coplanar layers
//    reject each other wherever their triangulations round differently.
//
// Small indices draw before every other transparent mesh (Babylon's default
// alphaIndex is Number.MAX_VALUE). That is correct for anything lying ON the
// floor: whatever is behind it along a ray is the opaque floor itself, so
// every transparent mesh that can cover it — glass, a fan's blades — is in
// front and belongs later.

/** The presence glow (RoomHighlight): first, underneath everything else. */
export const ROOM_GLOW_ALPHA_INDEX = 1;
/** A light pool (LightPools): after the glow, so light shows on a red floor. */
export const LIGHT_POOL_ALPHA_INDEX = 2;
