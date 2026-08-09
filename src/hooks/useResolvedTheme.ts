// src/hooks/useResolvedTheme.ts
// Subscribe to the RESOLVED theme — the `data-theme` attribute ConfigContext
// writes on <html>, i.e. light/dark/night after "auto" has been resolved
// against the real sun position (utils/themeTime).
//
// Why a hook and not `config.theme`: they answer different questions. A
// component that paints a theme-dependent colour needs to re-render whenever
// the colour changes, and `config.theme` does not move at all for two of the
// three ways that happens — an "auto" kiosk crossing into night at dusk, and
// the OS light/dark switch. All three DO end at the same attribute write, so
// watching the attribute catches every path by construction.
//
// Why it matters even though the colours come from CSS custom properties:
// these consumers do not use the properties in a stylesheet, where the cascade
// would re-evaluate them for free. They read the computed values in JS
// (config/EntityCategories.categorySurface, babylon/badgeIcons) to composite
// an opaque fill or bake a PNG, so the result is frozen at render time and
// only a re-render can refresh it. That is the DOM half of the bug reported as
// light-theme badges scattered across a dark-theme map; the 3D half is
// SceneManager.handleThemeChange.

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

function getSnapshot(): string {
  return document.documentElement.getAttribute("data-theme") ?? "";
}

/**
 * The active theme name ("light" | "dark" | "night", or "" before the first
 * resolve). Components that compute a colour in JS should USE the returned
 * value somewhere React can see — the simplest honest place is a `key`, since
 * a baked badge image genuinely IS a different image per theme.
 */
export function useResolvedTheme(): string {
  // getSnapshot returns a plain string read straight from the DOM, so it is
  // stable between changes and cannot loop — the usual useSyncExternalStore
  // hazard (a fresh object every call) does not apply here.
  return useSyncExternalStore(subscribe, getSnapshot, () => "");
}
