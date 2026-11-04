// src/components/common/AddOnLine.tsx
// A list's title line with its "add" as one icon at the right, which opens IN PLACE on that line into the list's
// search box (its dropdown open), the title kept at the left (owner, 2026-11-04: Settings › Messages, "Who gets the
// messages" and "Full-screen announcements", each search box under its list became an icon on the line of the list's
// title). Escape, or leaving it with nothing typed, closes it back to the icon; a pick closes it too (`done`).
//
// ⚠️ ESCAPE IS THE BOX'S, NOT THE WINDOW'S: Settings is a dialog whose own Escape closes it (useModalA11y, a listener
// on the dialog); a native listener here, below it, takes an Escape pressed in the open box first.
// ⚠️ LEFT IS A TAP OUTSIDE OR THE FOCUS MOVED AWAY, NEVER A BLUR ALONE: Safari does not focus a tapped button, so a
// tap on one of the dropdown's rows blurred the box with nowhere to go, and closing then lost the pick.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useOutsideClose } from "@/hooks/useOutsideClose";
import Tip from "./Tip";

export default function AddOnLine({ title, label, children }: {
  /** The list's title, at the left of the line. */
  title: ReactNode;
  /** What the icon does, for a screen reader and its tip ("Add a chat or phone to Owner"). */
  label: string;
  /** The search box, drawn while open; `done` closes it (after a pick). */
  children: (done: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => button.current?.focus()); };
  const typed = () => !!field.current?.querySelector("input")?.value;
  useEffect(() => {
    const node = field.current;
    if (!open || !node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [open]);
  // a tap outside with nothing typed (the one outside-tap hook; its Escape never comes: the listener above takes it)
  useOutsideClose([field], open, () => { if (!typed()) setOpen(false); });
  return (
    <div className="add-line">
      <span className="add-line-title">{title}</span>
      {open ? (
        <div ref={field} className="add-line-field" role="group" aria-label={label}
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null;
            if (to && !e.currentTarget.contains(to) && !typed()) setOpen(false);
          }}>
          {children(close)}
        </div>
      ) : (
        <Tip text={label}>
          <button ref={button} type="button" className="btn ghost icon-btn-sm add-line-icon" aria-label={label}
            onClick={() => setOpen(true)}>
            <Plus size={16} aria-hidden />
          </button>
        </Tip>
      )}
    </div>
  );
}
