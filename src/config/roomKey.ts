// src/config/roomKey.ts
// THE way two room names are compared.
//
// Room names are typed by hand in three different places — the Advanced
// Settings "Room" field, the SweetHome3D floor plan the pipeline reads, and
// Home Assistant's own Area names — and they have to line up for a device to
// glow in the right room, a teleport point to resolve, or a scene to know
// which rooms it touches. So every one of those comparisons is
// case-insensitive and whitespace-tolerant: "Master Bedroom", "master
// bedroom " and "MASTER BEDROOM" are one room.
//
// That rule was written out by hand at ~20 call sites as
// `name.trim().toLowerCase()`, spread across the Babylon layer, the config
// layer and the React components. Every one of them was correct, which is
// exactly why it was worth collecting: the danger is not the code that exists
// but the twenty-first site that reasonably decides to also strip a hyphen or
// collapse double spaces, and silently stops matching everything else.
//
// Deliberately NOT extended while collecting it — this is the existing rule,
// moved, not a new one. If normalisation should ever become smarter, this is
// now the one place it changes, and it changes for every consumer at once.

/** Normalise a room name for comparison. Never store this — it is a lookup
 *  key, not a display value; the name the operator typed is what gets shown. */
export function roomKey(name: string | undefined | null): string {
  return (name ?? "").trim().toLowerCase();
}

/** True when two room names refer to the same room. */
export function sameRoom(a: string | undefined | null, b: string | undefined | null): boolean {
  const key = roomKey(a);
  return key !== "" && key === roomKey(b);
}
