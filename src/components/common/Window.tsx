// src/components/common/Window.tsx
// THE frame of every window that opens over the villa (architecture review O, 2026-10-27): the layer it is drawn in
// (DialogLayer), its backdrop (a tap on it closes), the card that keeps a tap inside it, its dialog role and name, and
// Escape / Back with the focus kept in (useModalA11y). Its HEIGHT is its kind's, one rule each in 04-modals and
// 05-layout:
//   * "content": a window of content (the Cockpit, Settings, a device list, a form) — the ONE height of every window
//     (owner, 2026-10-20: "all the modal to keep the same height whatever the content is");
//   * "device": a window about ONE device (its own window, "Open a ticket") — as tall as what it shows (owner, same
//     day: "keep an adjusted height");
//   * "question": a question box or the colour picker — its own size;
//   * "screen": the whole screen, over every other window (an announcement the owner picked for full screen, ticket 16
//     of "One inbox").
//
// ⚠️ EACH WINDOW BUILT ITS FRAME BY HAND (to 2.496.548): the same five lines in eleven files, and a height chosen by a
// list of exceptions each new window had to remember to join — "every window drawn over the whole screen" was the same
// edit in twelve files. A window says what it is; what that means is decided here.
//
// ⚠️ A HALF-FILLED FORM WAS LOST TO A TOUCH OUTSIDE (owner, 2026-11-10: "Report a problem", "Open a ticket" and the
// Cockpit's forms): the backdrop, Escape and Back closed the window with what was typed. A form says it is one
// (`useTypedForm` on its frame, `FormBody` when the window's body is the form); once something is typed in it, those
// three ways out, and the footer's Close, ask "Discard what you typed?" first. A form's own Cancel is an answer: it
// asks nothing. Nothing typed: the window closes at once, as before.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import AskDialog from "./AskDialog";
import DialogLayer from "./DialogLayer";
import { useModalA11y } from "@/hooks/useModalA11y";

/** The window a form is drawn in: its forms holding something typed, and a way out that asks first while there is one. */
export const TypedForms = createContext<{ held: Set<object>; guard: (leave: () => void) => () => void } | null>(null);

/** A form's frame: spread on it. Once a word, a number or a photo is put in, the window asks before it is lost. */
export function useTypedForm(): { onChange: () => void } {
  const held = useContext(TypedForms)?.held;
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (!typed || !held) return;
    const form = {};
    held.add(form);
    return () => { held.delete(form); };
  }, [typed, held]);
  return { onChange: () => setTyped(true) };
}

/** ⚠️ A WINDOW'S HEADER, WRITTEN ONCE (UI scan, 2026-11-11; the rules: "controls that do the same job look the same and
 *  are one definition"): thirteen windows each wrote the header's markup, in two shapes (the title alone, or in a
 *  `.title` row that keeps a long one on one line). Its title, what stands before it (a device's badge), the eyebrow
 *  under it (a device's room), and its buttons at the right (`children`). A title too long for its line is cut with "…"
 *  and says itself whole under the mouse (the TipLayer shows a text marked with itself only when it IS cut).
 *  `focus`: the title takes the window's first focus (useModalA11y's data-autofocus), for a window whose first button
 *  would otherwise take it: a device's badge is the Owner's recolour BUTTON, and focusing it on open drew the phone's
 *  own focus ring round it, an amber border that read as a device state (owner, 2026-10-05); an (i) would pop its
 *  card on open. tabIndex={-1} keeps the title out of Tab. */
export function WindowHeader({ title, icon, under, focus, children }: {
  title: ReactNode; icon?: ReactNode; under?: ReactNode; focus?: boolean; children?: ReactNode;
}) {
  return (
    <div className="modal-header">
      <div className="title">
        {icon}
        <div className="title-words">
          <h2 data-tip={typeof title === "string" ? title : undefined} {...(focus ? { tabIndex: -1, "data-autofocus": true } : {})}>{title}</h2>
          {under && <div className="eyebrow">{under}</div>}
        </div>
      </div>
      {children && <div className="modal-header-actions">{children}</div>}
    </div>
  );
}

/** A window's body that is a form ("Report a problem", "Open a ticket"). */
export function FormBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`modal-body${className ? ` ${className}` : ""}`} {...useTypedForm()}>{children}</div>;
}

/** A way out of the window this is drawn in that is no answer to its form (the footer's Close): asks first, as a
 *  touch outside does. Outside a window: the way out itself. */
export function useWindowLeave(): (leave: () => void) => () => void {
  const guard = useContext(TypedForms)?.guard;
  return guard ?? ((leave) => leave);
}

type WindowKind = "content" | "device" | "question" | "screen";

/** The window's side of it, with nothing drawn (tests/oracles/typed_form.mjs drives it): `guard` wraps a way out that
 *  is no answer to the form; `asking` while the question is up, answered by `keep` or `discard`. */
export function useFormGuard() {
  const [held] = useState(() => new Set<object>());
  /** The way out a person took while a form held something typed: taken once they answer Discard. */
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const guard = useCallback((leave: () => void) => () => {
    if (held.size > 0) setLeaving(() => leave); else leave();
  }, [held]);
  const forms = useMemo(() => ({ held, guard }), [held, guard]);
  return { forms, guard, asking: leaving !== null, keep: () => setLeaving(null), discard: () => { setLeaving(null); leaving?.(); } };
}

export default function Window({ kind, label, onClose, onEscape, className, layer, zIndex, style, frameKey, outside, children }: {
  kind: WindowKind;
  /** Its name, as a screen reader says it. */
  label: string;
  /** A tap on the backdrop; and Escape / Back unless `onEscape` says otherwise. */
  onClose: () => void;
  /** Escape / Back, when it is not `onClose` (a device window opened from another goes back to it). */
  onEscape?: () => void;
  /** The card's own classes besides `modal` and its kind ("settings-modal cockpit-modal"). */
  className?: string;
  /** The backdrop's own classes besides `modal-backdrop` ("panel-modal-backdrop"). */
  layer?: string;
  /** Over another window (a question over a device window). */
  zIndex?: number;
  style?: CSSProperties;
  /** Remounts the card when it changes (the Legend redraws on a theme change). */
  frameKey?: string;
  /** Drawn in the same layer, beside the card (a picker the window opens). */
  outside?: ReactNode;
  children: ReactNode;
}) {
  const { forms, guard, asking, keep, discard } = useFormGuard();
  const ref = useModalA11y(guard(onEscape ?? onClose));
  return (
    <TypedForms.Provider value={forms}>
      <DialogLayer className={`modal-backdrop${kind === "screen" ? " backdrop-screen" : ""}${layer ? ` ${layer}` : ""}`} onClick={guard(onClose)}
        style={zIndex !== undefined ? { zIndex } : undefined}>
        <div key={frameKey} ref={ref} className={`modal window-${kind}${className ? ` ${className}` : ""}`} style={style}
          onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={label}>
          {children}
        </div>
        {outside}
      </DialogLayer>
      {asking && (
        <AskDialog title="Discard what you typed?" message="What you typed here will be lost." confirmLabel="Discard" cancelLabel="Keep"
          danger onConfirm={discard} onCancel={keep} />
      )}
    </TypedForms.Provider>
  );
}
