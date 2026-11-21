// src/config/breakpoints.ts
// THE SCREEN WIDTHS AT WHICH A LAYOUT CHANGES, in CSS px: the one table. The stylesheets use these literal values
// (CSS has no custom media queries; 01-base.css lists the set), and code that asks a width question reads it here.
// tests/oracles/breakpoints.mjs fails on a width in src/styles that is not one of them.
//
// Each value is the widest screen of its tier: `max-width: <v>px` is "this tier or narrower", `min-width: <v+1>px`
// the rest. `desktop` is the one floor: `min-width: 1024px`, and `max-width: 1023px` below it (an iPad held
// sideways, 1024 wide, is a desktop).
//
// Converged on 2026-11-21 (code-quality plan, phase 3): 480 and 560 joined `phone`, 1000 joined `desktop`.

export const BREAKPOINTS = {
  /** A phone held upright, or any screen this narrow: one column, the compact top bar. */
  phone: 640,
  /** A phone held sideways (667 to 720 wide): the camera's stacked bar, the bottom bar's phone tiles, the badges'
   *  phone cards. Kept apart from `phone`: moving it to 640 would change those screens. */
  largePhone: 720,
  /** A small tablet held upright: the villa's name leaves the top bar. */
  smallTablet: 860,
  /** The first desktop width: wider windows and side padding. */
  desktop: 1024,
  /** Below this the top bar's clock goes. An iPad held sideways (1180, 1194 wide) shows no clock today, and moving
   *  this down would put it back there. */
  clock: 1180,
} as const;
