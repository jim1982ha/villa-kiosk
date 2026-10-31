// src/components/hud/barRoom.ts
//
// "Ask VESTA" beside the phone's gear, when the top bar has room for it (owner, 2026-10-31: "When there is space,
// show the microphone icon to 'Ask VESTA' directly on the left of the settings icon, in the top bar").
//
// ⚠️ ROOM IS READ FROM THE BAR, NEVER FROM THE DEVICE. How wide the right-hand side is depends on the screen, the
// profile's category count and whether the maintenance mark is up, so no breakpoint can say it: the bar's own grid
// says it. One more button fits when the two side tracks together hold the app icon, the right-hand side and it: the
// grid then widens the right track to the button and narrows the left one, so the category row keeps its whole width
// and moves a few pixels left of centre, never under anything.
//
// ⚠️ NOT "INSIDE ITS EQUAL SHARE" (2.496.627, owner 2026-10-31: not shown on a portrait phone with visibly room
// beside the gear). That rule kept the row exactly centred, so the right track only had its half of the spare width:
// on a 390px phone with six categories, 26px free where the button needs 36. And the row's own 44px touch areas (the
// buttons' ::after, wider than the 32px buttons) reach past its last button, so `scrollWidth > clientWidth` read every
// row as already scrolling: the button was never drawn at any width. The row is squeezed only when its buttons, laid
// end to end, are wider than its box.
//
// ⚠️ THE READING MUST NOT CHANGE WHEN THE BUTTON APPEARS, or it would flicker. The right-hand side is measured WITHOUT
// the microphone, and the two side tracks' SUM is the same with it or without it while the row keeps its width; a
// button that did not fit squeezes the row instead, which says no.

import { useEffect, useState, type RefObject } from "react";

export interface BarRoom {
  /** The bar's two side tracks together, as its grid laid them out (px). */
  sides: number;
  /** The app icon's side (px). */
  brand: number;
  /** What the right-hand side holds, the microphone left out (px). */
  held: number;
  /** One more button and the gap before it: the gear's own size, 0 where the gear is not drawn (px). */
  mic: number;
  /** The category row is narrower than its buttons laid end to end: it scrolls. */
  squeezed: boolean;
}

/** Sub-pixel layout rounding: a button that fits to the hundredth of a pixel fits. */
const SLACK = 0.5;

/** Whether one more button fits on the right of the top bar without squeezing or moving anything. Pure. */
export function micFits(room: BarRoom | null): boolean {
  return !!room && !room.squeezed && room.mic > 0 && room.brand + room.held + room.mic <= room.sides + SLACK;
}

/** The top bar's "Ask VESTA" beside the gear: while VESTA runs (the reading every other way to ask VESTA uses), and
 *  only with room for it. Pure. */
export function barMicShown(vestaRuns: boolean, room: BarRoom | null): boolean {
  return vestaRuns && micFits(room);
}

/** The gear menu's "Ask VESTA" row: while VESTA runs and only where the top bar does not already show its microphone
 *  (owner, 2026-10-31: "Since the 'Ask VESTA' icon is appearing directly in the top bar, it shall not appear in the
 *  dropdown menu"). It reads the bar's own decision, never a room check of its own, so the two can never both show
 *  or both hide; and that decision holds while the menu is open (the dropdown floats, the reading leaves the
 *  microphone out). Pure. */
export function menuAskShown(vestaRuns: boolean, barMic: boolean): boolean {
  return vestaRuns && !barMic;
}

/** The classes the measurement finds its pieces by (HUD.tsx draws them). */
export const BAR_PARTS = {
  brand: "hud-brand",
  right: "hud-right",
  gearGroup: "hud-overflow",
  gear: "hud-gear",
  mic: "hud-bar-mic",
  categories: "hud-group-scroll",
} as const;

const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const width = (el: Element | null) => (el ? el.getBoundingClientRect().width : 0);

/** A row's buttons laid end to end, with its gaps, padding and border: its width when nothing scrolls (px). What the
 *  row hides (display: none) has no box and takes no gap. */
function naturalWidth(row: HTMLElement): number {
  const st = getComputedStyle(row);
  const shown = Array.from(row.children).map(width).filter((w) => w > 0);
  return shown.reduce((a, w) => a + w, 0) + px(st.columnGap) * Math.max(0, shown.length - 1)
    + px(st.paddingLeft) + px(st.paddingRight) + px(st.borderLeftWidth) + px(st.borderRightWidth);
}

/** The bar's room, read from its laid-out boxes; null when its grid gives no three tracks. */
export function measureBarRoom(bar: HTMLElement): BarRoom | null {
  const tracks = getComputedStyle(bar).gridTemplateColumns.trim().split(/\s+/).map(parseFloat);
  if (tracks.length !== 3 || tracks.some((t) => !Number.isFinite(t))) return null;
  const find = (c: string) => bar.querySelector<HTMLElement>(`.${c}`);
  const group = find(BAR_PARTS.gearGroup);
  // the gap the group puts between its buttons: "normal" in a flex row is 0
  const gap = group ? px(getComputedStyle(group).columnGap) : 0;
  const gear = width(find(BAR_PARTS.gear));
  const mic = find(BAR_PARTS.mic);
  const cats = find(BAR_PARTS.categories);
  return {
    sides: tracks[0] + tracks[2],
    brand: width(find(BAR_PARTS.brand)),
    held: width(find(BAR_PARTS.right)) - (mic ? width(mic) + gap : 0),
    mic: gear > 0 ? gear + gap : 0,
    squeezed: !!cats && naturalWidth(cats) > width(cats) + 1,
  };
}

const same = (a: BarRoom | null, b: BarRoom | null) =>
  a === b || (!!a && !!b && micFits(a) === micFits(b)
    && (Object.keys(a) as (keyof BarRoom)[]).every((k) => Math.round(Number(a[k])) === Math.round(Number(b[k]))));

/** The bar's room, read again whenever the bar, its category row or its right-hand side changes size. Where the
 *  browser has no ResizeObserver (Safari before 13.1), on a window resize or a turn of the phone instead. */
export function useBarRoom(bar: RefObject<HTMLElement | null>): BarRoom | null {
  const [room, setRoom] = useState<BarRoom | null>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const sync = () => setRoom((was) => { const now = measureBarRoom(el); return same(was, now) ? was : now; });
    sync();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      window.addEventListener("orientationchange", sync);
      return () => {
        window.removeEventListener("resize", sync);
        window.removeEventListener("orientationchange", sync);
      };
    }
    const watch = new ResizeObserver(sync);
    watch.observe(el);
    for (const c of [BAR_PARTS.right, BAR_PARTS.categories]) {
      const part = el.querySelector(`.${c}`);
      if (part) watch.observe(part);
    }
    return () => watch.disconnect();
  }, [bar]);
  return room;
}
