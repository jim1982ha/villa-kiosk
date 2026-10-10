// src/fm/faultNotes.ts
// Which of a fault's update notes its card shows. Pure, so the oracle drives it.

/** The VESTA Agent's record of a fault's new title ("Now: …"). */
function isTitleChange(note?: string): boolean {
  return (note ?? "").startsWith("Now: ");
}

/** A fault's update notes with only its LAST "Now: …" kept, where it stands: the earlier ones are what the fault
 *  said before (owner, 2026-10-11: "only show the latest one"). Every other note is kept, in order. */
export function latestTitleChangeOnly(notes: (string | undefined)[]): (string | undefined)[] {
  const last = notes.map(isTitleChange).lastIndexOf(true);
  return notes.filter((n, i) => !isTitleChange(n) || i === last);
}
