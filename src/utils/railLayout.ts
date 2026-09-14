// src/utils/railLayout.ts
//
// "Is the camera panel in side-rail layout?" — asked of the STYLESHEET, which
// is the half that owns it.
//
// ⚠️ ONE RULE, TWO LANGUAGES, AND THEY DRIFTED. The condition was written twice:
// once as an `@media` query in `styles.css` and once as a `matchMedia` string
// in `CameraPanel`. v2.81.1 fixed the CSS half — "fix iPad camera landscape
// layout" — changing `(max-height: 560px)` to `(pointer: coarse)`, because an
// iPad in landscape is never under 560px tall and was silently keeping the
// portrait chrome. The TypeScript half was never touched.
//
// So on a tablet in landscape the stylesheet switched the panel into rail
// layout and the TypeScript did not: `StateTimeline` laid its segments along
// the X axis inside a ten-pixel-wide vertical strip, and the deliberate
// close-top/fullscreen-second button order silently did not apply. The CSS
// comment even names the dependency out loud — "a genuinely vertical bar
// (StateTimeline's `vertical` lays its segments on the Y axis)" — and nothing
// in the repo could notice when only one half moved.
//
// ⚠️ THE STYLESHEET ANSWERS, RATHER THAN BOTH GUESSING. A CSS custom property
// set inside that same `@media` block is the one source: the query exists once,
// in the language that owns breakpoints, and this reads the result. Copying the
// query string into a shared TypeScript constant would still leave two copies —
// one of them in a file CSS cannot see.

import { useEffect, useState } from "react";

/** The property the rail media query sets. Declared `0` at `:root` and `1`
 *  inside the block — see `--cam-rail-layout` in styles.css. */
const RAIL_PROPERTY = "--cam-rail-layout";

export function railLayoutActive(): boolean {
  if (typeof window === "undefined") return false;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(RAIL_PROPERTY).trim();
  return raw === "1";
}

/**
 * Re-read on anything that can change the answer.
 *
 * ⚠️ NOT `matchMedia`, DELIBERATELY. Subscribing to a query here would mean
 * writing the query here, which is the whole defect. `resize` fires on an
 * orientation change, a window resize and a soft-keyboard open; re-reading one
 * computed property on those is cheap, and the panel re-renders on far less.
 */
export function useRailLayout(): boolean {
  const [rail, setRail] = useState(railLayoutActive);
  useEffect(() => {
    const sync = () => setRail(railLayoutActive());
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);
  return rail;
}
