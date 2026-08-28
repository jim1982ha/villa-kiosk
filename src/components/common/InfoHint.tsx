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
//
// ⚠️ IT IS A PORTAL WITH `position: fixed`, AND THE FIRST VERSION WAS NEITHER.
// As an absolutely-positioned child it lived inside `.modal`, which sets
// `overflow: hidden`, and inside a pane that scrolls — so the bubble was CLIPPED
// by the dialog edge and by the footer, and a hint near the bottom of a pane
// showed two lines and a cut. Reported from the screen. No amount of z-index
// fixes a clip; the element has to leave the clipping ancestor entirely.
//
// ⚠️ AND IT ANCHORS TO THE PARAGRAPH, NOT TO THE ICON. The (i) sits at the END
// of a sentence, so aligning the bubble to it put a 42ch block starting at the
// right-hand edge of the text and hanging off the dialog — the second thing
// visible in that report. It now takes the icon's VERTICAL position and the
// text block's LEFT edge, which is where a reader's eye already is.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

/** Which hint is open, so opening one closes the last. ⚠️ The id is not held
 *  in a module variable — each instance already knows whether it is the open
 *  one from the broadcast, and a second copy of that state is a second thing to
 *  keep in step. `noUnusedLocals` caught the first draft holding both. */
const listeners = new Set<(id: string | null) => void>();
function setOpen(id: string | null) {
  for (const fn of listeners) fn(id);
}

interface Spot { top: number; left: number; width: number; above: boolean; }

export default function InfoHint({ children, label, trigger }: {
  /** The detail. Prose, not a second description — it is read on demand. */
  children: React.ReactNode;
  /** What it explains, for the button's accessible name. */
  label: string;
  /** ⚠️ AN ALTERNATIVE TO THE (i), FOR SOMETHING ALREADY ON SCREEN THAT IS
   *  ITSELF THE THING NEEDING EXPLANATION (2026-08-28). A source chip is a word
   *  a reader does not know yet; putting an (i) BESIDE it doubles the ink and
   *  asks them to find a second target for the first one's meaning. When this
   *  is given, the caller's own element becomes the button and no icon is
   *  drawn — the bubble, the placement, the one-open-at-a-time and the Escape
   *  handling are all unchanged, which is the whole reason this is a prop here
   *  rather than a second popover somewhere else. */
  trigger?: React.ReactNode;
}) {
  const id = useId();
  const [open, setLocal] = useState(false);
  const [spot, setSpot] = useState<Spot | null>(null);
  const box = useRef<HTMLSpanElement | null>(null);
  const bubble = useRef<HTMLDivElement | null>(null);

  /** Where to put it, in viewport coordinates. */
  const place = useCallback(() => {
    const btn = box.current?.getBoundingClientRect();
    if (!btn) return;
    // ⚠️ THE PARAGRAPH, NOT THE ICON, decides the left edge and the width — see
    // the header. Falls back to the icon when the hint is not inside a block,
    // which is the case a future caller will hit before this comment is read.
    const host = box.current?.closest("p, label, div")?.getBoundingClientRect();
    const pad = 8;
    const width = Math.min(host?.width ?? 320, window.innerWidth - pad * 2, 420);
    const left = Math.max(pad, Math.min(
      host?.left ?? btn.left, window.innerWidth - width - pad));
    // Flip above when the space below cannot hold a few lines. Measured against
    // the real bubble once it exists, estimated before that.
    const need = bubble.current?.offsetHeight ?? 96;
    const below = window.innerHeight - btn.bottom - pad;
    return setSpot({
      top: below < need && btn.top > need ? btn.top - need - 6 : btn.bottom + 6,
      left, width, above: below < need && btn.top > need,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  // ⚠️ RE-PLACE ON SCROLL AND RESIZE, AND CLOSE IS NOT ENOUGH. These panes
  // scroll; a fixed bubble left behind while its icon moves is worse than one
  // that vanishes, because it still looks anchored to something.
  useEffect(() => {
    if (!open) return;
    const on = () => place();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [open, place]);

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
        className={trigger ? "info-hint-bare" : "info-hint-btn"}
        aria-label={`More about ${label}`}
        aria-expanded={open}
        // ⚠️ `stopPropagation` AS WELL AS `preventDefault`. With a `trigger` this
        // button sits inside rows that carry their own click handlers, and
        // asking what a label means must never also perform the row's action.
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation();
          setOpen(open ? null : id);
        }}
      >
        {trigger ?? <Info size={14} aria-hidden="true" />}
      </button>
      {open && spot && createPortal(
        <div ref={bubble} role="tooltip" className="info-hint-bubble"
             style={{ top: spot.top, left: spot.left, width: spot.width }}>
          {children}
        </div>,
        document.body)}
    </span>
  );
}
