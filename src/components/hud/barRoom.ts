// src/components/hud/barRoom.ts
//
// "Ask VESTA" beside the phone's gear, when the top bar has room for it (owner, 2026-10-31: "When there is space,
// show the microphone icon to 'Ask VESTA' directly on the left of the settings icon, in the top bar").
//
// ⚠️ ROOM IS READ FROM THE BAR, NEVER FROM THE DEVICE. How wide the right-hand side is depends on the screen, the
// profile's category count and whether the maintenance mark is up, so no breakpoint can say it: the bar's own grid
// says it. Its side tracks are equal shares (`1fr`) around a centred category row; one more button fits when it
// keeps the right-hand side inside its share, so the category row keeps its whole width and stays centred.
//
// ⚠️ THE READING MUST NOT CHANGE WHEN THE BUTTON APPEARS, or it would flicker. What the right-hand side holds is
// measured WITHOUT the microphone, and the share is the SMALLER side track: a button that did not fit would widen its
// own track past the other one (the grid grows a track to its content), so the smaller one is the fair share whether
// the button is drawn or not. A category row that already scrolls means the bar has no width to spare at all.

import { useEffect, useState, type RefObject } from "react";

export interface BarRoom {
  /** The bar's two side tracks, as its grid laid them out (px). */
  left: number;
  right: number;
  /** What the right-hand side holds, the microphone left out (px). */
  held: number;
  /** One more button and the gap before it: the gear's own size, 0 where the gear is not drawn (px). */
  mic: number;
  /** The category row scrolls: it is already narrower than its buttons. */
  squeezed: boolean;
}

/** Sub-pixel layout rounding: a button that fits to the hundredth of a pixel fits. */
const SLACK = 0.5;

/** Whether one more button fits on the right of the top bar without squeezing or moving anything. Pure. */
export function micFits(room: BarRoom | null): boolean {
  return !!room && !room.squeezed && room.mic > 0 && room.held + room.mic <= Math.min(room.left, room.right) + SLACK;
}

/** The top bar's "Ask VESTA" beside the gear: while VESTA runs (the reading every other way to ask VESTA uses), and
 *  only with room for it. Pure. */
export function barMicShown(vestaRuns: boolean, room: BarRoom | null): boolean {
  return vestaRuns && micFits(room);
}

/** The classes the measurement finds its pieces by (HUD.tsx draws them). */
export const BAR_PARTS = {
  right: "hud-right",
  gearGroup: "hud-overflow",
  gear: "hud-gear",
  mic: "hud-bar-mic",
  categories: "hud-group-scroll",
} as const;

const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const width = (el: Element | null) => (el ? el.getBoundingClientRect().width : 0);

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
    left: tracks[0],
    right: tracks[2],
    held: width(find(BAR_PARTS.right)) - (mic ? width(mic) + gap : 0),
    mic: gear > 0 ? gear + gap : 0,
    squeezed: !!cats && cats.scrollWidth > cats.clientWidth + 1,
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
