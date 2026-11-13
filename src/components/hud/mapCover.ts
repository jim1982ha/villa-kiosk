// src/components/hud/mapCover.ts
//
// What the HUD lays over the 3D map — the top bar, the floor and presence rail, the bottom bar and the summary
// tiles — as the page draws them, so the map keeps its room chips clear of them (owner, 2026-11-14: a merged chip
// ran up under the top bar, a one-room chip sat under the floor rail in the top-left corner).
//
// ⚠️ READ FROM THE PAGE, NEVER TYPED. The bars' heights follow the safe areas, the rail its floors and the tiles
// their count and the screen, so no number here could say where they end: their own boxes do, measured again
// whenever one changes size and on a window resize or a turn of the phone.

import { useEffect, useRef } from "react";

/** A HUD piece's box, client CSS px. */
export interface CoverRect { left: number; top: number; right: number; bottom: number }

/** The HUD pieces drawn over the map, each a container whose box is what it covers. */
const MAP_COVER = [".hud-topbar", ".hud-left-col", ".bottom-bar", ".summary-bar"];

function measure(): CoverRect[] {
  const out: CoverRect[] = [];
  for (const sel of MAP_COVER) {
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

const same = (a: CoverRect[], b: CoverRect[]) => a.length === b.length && a.every((r, i) =>
  Math.round(r.left) === Math.round(b[i].left) && Math.round(r.top) === Math.round(b[i].top)
  && Math.round(r.right) === Math.round(b[i].right) && Math.round(r.bottom) === Math.round(b[i].bottom));

/** Calls `onCover` with the HUD's boxes over the map now, and again whenever they change. Run where the HUD is
 *  mounted (the effect runs after its children are in the page). */
export function useMapCover(onCover: (cover: CoverRect[]) => void): void {
  const cb = useRef(onCover);
  cb.current = onCover;
  useEffect(() => {
    let last: CoverRect[] = [];
    const sync = () => {
      const now = measure();
      if (same(now, last)) return;
      last = now;
      cb.current(now);
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    for (const sel of MAP_COVER) {
      const el = document.querySelector(sel);
      if (el) watch?.observe(el);
    }
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      watch?.disconnect();
    };
  }, []);
}
