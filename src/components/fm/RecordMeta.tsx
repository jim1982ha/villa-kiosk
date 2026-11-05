// src/components/fm/RecordMeta.tsx
// A Facility card's notes, one style for every list (RecordCard). Its line of tags became the card's quiet line
// (RecordCard `.fm-record-meta`, the "Status on top" card, owner 2026-11-05).

/** A card's notes — "Check: …", "Cleared: …", "Done, …" — each its own line, in one style
 *  (owner, 2026-10-11: the same style as "Check: …" for every note of the card). */
export function RecordNotes({ notes }: { notes: (string | undefined | null)[] }) {
  const lines = notes.map((n) => (n ?? "").trim()).filter(Boolean);
  if (!lines.length) return null;
  return <>{lines.map((n, i) => <div key={i} className="fm-timeline-note">{n}</div>)}</>;
}
