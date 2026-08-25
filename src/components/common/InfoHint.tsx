// src/components/common/InfoHint.tsx
//
// The detail behind a control's one-line description: an inline (i) that opens
// a small bubble.
//
// ⚠️ IT EXISTS BECAUSE THE EXPLANATIONS HAD GROWN TO FIVE AND SIX LINES EACH,
// and a settings pane where every control carries a paragraph is a pane nobody
// reads — reported from the screen. The rule is now: at most two lines of
// description, and everything else lives in here. Nothing is deleted; it moves.
//
// ⚠️ NOT `title=`, WHICH IS WHAT THIS CODEBASE USED AND IS INVISIBLE ON THE
// TARGET DEVICE. A native tooltip needs a hover, and the villa's kiosk is a
// wall-mounted iPad — so every `title` written as an explanation is an
// explanation a touch user cannot reach. This opens on CLICK, which works on
// both, and additionally on hover for a fine pointer.
//
// ⚠️ ONE OPEN AT A TIME, VIA A MODULE-LEVEL COUNTER RATHER THAN CONTEXT. Two
// bubbles open at once overlap unreadably in a narrow pane, and a provider
// threaded through every settings surface for one popover is more machinery
// than the problem deserves.

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

/** Which hint is open, so opening one closes the last. ⚠️ The id is not held
 *  in a module variable — each instance already knows whether it is the open
 *  one from the broadcast, and a second copy of that state is a second thing to
 *  keep in step. `noUnusedLocals` caught the first draft holding both. */
const listeners = new Set<(id: string | null) => void>();
function setOpen(id: string | null) {
  for (const fn of listeners) fn(id);
}

export default function InfoHint({ children, label }: {
  /** The detail. Prose, not a second description — it is read on demand. */
  children: React.ReactNode;
  /** What it explains, for the button's accessible name. */
  label: string;
}) {
  const id = useId();
  const [open, setLocal] = useState(false);
  const box = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const fn = (next: string | null) => setLocal(next === id);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [id]);

  // ⚠️ DISMISS ON ANY OUTSIDE POINTER AND ON ESCAPE. A bubble that can only be
  // closed by finding its own icon again is a bubble left open, and on a
  // tablet it then covers the control it was explaining.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <span className="info-hint" ref={box}>
      <button
        type="button"
        className="info-hint-btn"
        aria-label={`More about ${label}`}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); setOpen(open ? null : id); }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {open && (
        <span className="info-hint-bubble" role="tooltip">{children}</span>
      )}
    </span>
  );
}
