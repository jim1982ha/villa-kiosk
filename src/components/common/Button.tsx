// src/components/common/Button.tsx
// THE button, one module (architecture review, owner approved 2026-11-20; RULES: "Controls that do the same job look
// the same and are one definition"). A call site says what its button does: its icon and its words (none: the icon
// alone, named by `label`), whether its words hide on a phone, what it is among its neighbours (`look`), a count on
// its corner, its progress on its icon, that a command is on its way (`busy`), that what it opens is open (`lit`),
// where it is drawn (`on`, `quiet`). Which classes that is, is this module's alone (buttonClass); a place's class only
// places it.
//
// ⚠️ FOUR DRAWINGS, KEPT ON PURPOSE (owner, 2026-11-10: one definition each, 01-base.css): the worded button of a
// window (.btn, without its words .btn.icon-only), the lone icon of a window (.icon-quiet, `quiet`), the plate over
// the map (.icon-btn, `on="map"`) and the dark scrim over a photo or a video (.media-btn, `on="photo"`): a picture's
// colours and the map's are not a window's. A tool of a tool group (`on="tools"`, common/ToolGroup) is a segment of
// its track, drawn by the group (owner, 2026-11-06: the Settings header's theme control's look). Before, call sites
// typed the classes by hand ("btn icon-only" in six places, a count's span in three).

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** What a button is among its neighbours: the main answer (the accent), an action that moves a device (tinted and
 *  outlined in the colour of the state it leads to, `--leads`: stateColors.leadsTo; owner, 2026-11-22). None: the
 *  plain button, also what cannot be taken back (asked first, never painted). */
export type ButtonLook = "main" | "action";

export interface ButtonShape {
  look?: ButtonLook;
  /** No words: the icon alone. */
  wordless?: boolean;
  /** Where it is drawn: in a window (unless said), over the map, over a photo or a video, in a tool group, as a row of
   *  a menu (the top bar's menu draws its rows: .hud-menu-item). */
  on?: "map" | "photo" | "tools" | "menu";
  /** The lone icon of a window (a card's remove, a field's clear, the (i)): no plate, a soft disc under the mouse. */
  quiet?: boolean;
  /** Beside words (quiet), on a thumbnail or a card's corner (over a photo). */
  small?: boolean;
  /** What it opens is open. */
  lit?: boolean;
  /** A word under its icon (over the map: the top bar's captions for the Guest profile). */
  captioned?: boolean;
}

/** The classes of a button of this shape, then its place's: the one place they are written. */
export function buttonClass({ look, wordless, on, quiet, small, lit, captioned }: ButtonShape, place?: string): string | undefined {
  const c: string[] = captioned ? ["captioned"] : [];
  if (on === "tools") c.push(lit ? "active" : "");
  else if (on === "menu") c.push("hud-menu-item", lit ? "active" : "");
  else if (on === "map") c.push("icon-btn", lit ? "active" : "");
  else if (on === "photo") {
    c.push("media-btn", small ? "small" : "", wordless ? "" : "worded", lit ? "on" : "");
  } else if (quiet) return [`icon-quiet${small ? " small" : ""}`, place].filter(Boolean).join(" ");
  else c.push("btn", look === "main" ? "primary" : (look ?? ""), wordless ? "icon-only" : "", lit ? "active" : "");
  if (place) c.push(place);
  return c.filter(Boolean).join(" ") || undefined;
}

export interface ButtonProps extends Omit<ButtonShape, "wordless" | "captioned">,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label" | "children"> {
  /** Its words; none: its icon alone, named by `label`. */
  children?: ReactNode;
  /** Its icon, before its words. */
  icon?: ReactNode;
  /** One word under its icon, shown with it (the top bar for a guest); its `label` still names it. */
  caption?: string;
  /** Its words hide on a phone, where its icon alone stays (a footer's, a header's tool). */
  shortOnPhone?: boolean;
  /** Its name for a screen reader, with what it acts on ("Remove Generator service"); its words name it otherwise. */
  label?: string;
  /** What a mouse over it reads (the app's tip, common/Tip): its `label` when it has no words; null: none. */
  tip?: string | null;
  /** A number on its corner (the updates available, the devices offline); none: no mark. */
  count?: ReactNode;
  /** Its progress on its icon, shown where its words are hidden (an upload's "42%" on a phone). */
  mark?: string | null;
  /** A command on its way: the waiting sign (button[aria-busy], 03-panels.css). */
  busy?: boolean;
  /** It opens a menu: a caret after its words, at every width (aria-haspopup). */
  menu?: boolean;
  /** Where it sits (a place's own class), never how it looks. */
  className?: string;
}

/** Whether `children` holds words (an empty or blank text is none). */
const hasWords = (children: ReactNode): boolean =>
  children !== undefined && children !== null && children !== false && children !== ""
  && !(typeof children === "string" && !children.trim());

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children, icon, caption, shortOnPhone = false, label, tip, look, count, mark, busy, menu, lit, on, quiet, small,
  className, type = "button", ...rest
}, ref) {
  const wordless = !hasWords(children);
  const shownTip = tip === undefined ? (wordless ? label : undefined) : tip;
  return (
    <button type={type} className={buttonClass({ look, wordless, on, quiet, small, lit, captioned: !!caption }, className)}
      aria-label={label} data-tip={shownTip || undefined} aria-busy={busy || undefined}
      aria-haspopup={menu ? "menu" : undefined} ref={ref} {...rest}>
      {icon}
      {caption && <span className="btn-caption" aria-hidden="true">{caption}</span>}
      {!wordless && (shortOnPhone ? <span className="btn-label">{children}</span> : children)}
      {menu && <ChevronDown size={14} aria-hidden />}
      {count !== undefined && count !== null && count !== false && <span className="icon-btn-count" aria-hidden="true">{count}</span>}
      {mark && <span className="icon-btn-count btn-mark" aria-hidden="true">{mark}</span>}
    </button>
  );
});

export default Button;
