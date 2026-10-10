// src/components/fm/RecordMeta.tsx
// The line right under a Facility card's title: its pills (room, category,
// "by VESTA Agent", the device…) then when it happened, on ONE line that wraps
// on a phone (owner, 2026-10-11: "the pills and the time on the same line,
// right below the title — consistent for all cards"). One component, so every
// list — faults, spend, tasks, work done, saved documents — reads the same.

import type { ReactNode } from "react";

export default function RecordMeta({ children, when }: { children?: ReactNode; when?: ReactNode }) {
  return (
    <div className="fm-meta">
      {children}
      {when ? <span className="fm-meta-when muted">{when}</span> : null}
    </div>
  );
}

/** A card's notes — "Check: …", "Cleared: …", "Done, …" — each its own line, in one style
 *  (owner, 2026-10-11: the same style as "Check: …" for every note of the card). */
export function RecordNotes({ notes }: { notes: (string | undefined | null)[] }) {
  const lines = notes.map((n) => (n ?? "").trim()).filter(Boolean);
  if (!lines.length) return null;
  return <>{lines.map((n, i) => <div key={i} className="fm-timeline-note">{n}</div>)}</>;
}
