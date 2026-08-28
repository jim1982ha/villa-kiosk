// src/components/common/Loading.tsx
//
// "Loading…", the one way this app says it.
//
// ⚠️ SEVEN COMPONENTS WROTE THIS BLOCK BYTE-FOR-BYTE (found by /dry-audit,
// 2026-08-28): the Reason, To-Do List, Review and Proposals tabs, and the API
// key, People and flag-type panels. Not a shared rule anybody violated — there
// was nothing to violate, which is Part 4's whole point: duplication is
// introduced by ordinary work long before anyone names it.
//
// ⚠️ THE SIZE AND THE SPIN CLASS ARE THE REASON THIS IS A COMPONENT RATHER THAN
// A COPIED LINE. `size={14}` is a pixel constant in a codebase whose rule is
// that a dimension has one home, and `.spin` is the only animation the DOM
// layer runs — an eighth copy that reached for `size={16}` or a fresh keyframe
// would be a difference nobody chose, on a wall tablet, in the state the reader
// sees most often.
//
// ⚠️ `aria-hidden` ON THE ICON AND THE TEXT LEFT READABLE. A screen reader
// announcing "image" before "Loading" is noise; the word is the message.

import { Loader2 } from "lucide-react";

/** The standard in-panel loading line. `label` only for the rare surface that
 *  needs to say what it is waiting for. */
export default function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="muted body-text">
      <Loader2 size={14} className="spin" aria-hidden /> {label}
    </p>
  );
}
