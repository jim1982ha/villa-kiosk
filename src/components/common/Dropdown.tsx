// src/components/common/Dropdown.tsx
// THE ONE DROPDOWN. A choice from a short list, drawn by the app in its own
// colours, type and corners — never the platform's picker.
//
// ⚠️ A NATIVE <select> OPENS THE OPERATING SYSTEM'S LIST (owner, 2026-10-04:
// "a lot of dropdown menus are badly rendered"). Android draws a grey Material
// sheet with radio buttons, iOS a wheel at the bottom of the screen, desktop
// browsers their own menu: none of them follows the theme, and CSS cannot
// reach them. Every <select> in src/ became this component in 2.496.275, and
// tests/oracles/dropdowns.mjs refuses a new one.
//
// The list is portalled to <body> and positioned `fixed` under the button (or
// above it when there is no room below): inside a scrolling modal body a
// fixed overlay can be clipped (the ChartTip lesson). It registers on the
// dismissal stack (useBackToClose), so Escape and a phone's Back close the
// list before the window under it. Keyboard: arrows, Home/End, Enter/Space,
// and typing a letter jumps to the next option starting with it.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { useBackToClose } from "@/hooks/useBackToClose";
import { useOutsideClose } from "@/hooks/useOutsideClose";
import { dropdownPlacement } from "./dropdownPlacement";

export interface DropdownOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Plain words for the button's accessible name and type-ahead, when the
   *  label is not a string. */
  text?: string;
}

export default function Dropdown<T extends string>({
  value, options, onChange, ariaLabel, title, style, className, disabled,
}: {
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  title?: string;
  /** The button's own look (BindingRow's compact inline controls). */
  style?: CSSProperties;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const chosen = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[chosen];
  const textOf = (o: DropdownOption<T> | undefined) => o ? (o.text ?? (typeof o.label === "string" ? o.label : String(o.value))) : "";

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  useBackToClose(() => close(), open);
  // A tap anywhere else closes it — the one outside-close every popover uses.
  useOutsideClose([button, list], open, () => close(false));

  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const p = dropdownPlacement(b, { width: window.innerWidth, height: window.innerHeight }, options.length);
    setPos({ position: "fixed", left: p.left, width: p.width, maxHeight: p.maxHeight, ...(p.above ? { bottom: p.bottom } : { top: p.top }) });
  }, [options.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    setActive(chosen);
    // The page under it moved: the list would float away from its button.
    const moved = (e: Event) => { if (!list.current?.contains(e.target as Node)) close(false); };
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", place);
    list.current?.focus();
    return () => {
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", place);
    };
    // `chosen` read once on opening: the highlight starts on the current value.
  }, [open, close, place]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    close();
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    const step: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: last, PageDown: active + 8, PageUp: active - 8 };
    if (e.key in step) { e.preventDefault(); setActive(Math.min(last, Math.max(0, step[e.key]))); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); return; }
    if (e.key === "Tab") { close(); return; }
    if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const n = options.length;
      for (let d = 1; d <= n; d++) {
        const i = (active + d) % n;
        if (textOf(options[i]).toLowerCase().startsWith(k)) { setActive(i); break; }
      }
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`dropdown${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        style={style}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel ? `${ariaLabel}: ${textOf(current)}` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }}
      >
        <span className="dropdown-value">{current?.label}</span>
        <ChevronDown size={16} className="dropdown-caret" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div
          ref={list}
          id={listId}
          className="dropdown-list"
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={`${listId}-${active}`}
          tabIndex={-1}
          style={pos}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${listId}-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === chosen}
              className={`dropdown-option${i === chosen ? " is-chosen" : ""}${i === active ? " is-active" : ""}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span>{o.label}</span>
              {i === chosen && <Check size={16} aria-hidden="true" />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
