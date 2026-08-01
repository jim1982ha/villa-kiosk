// src/utils/countBadge.ts
// The "small red pill showing a count" convention this app uses everywhere a
// number needs to read as an alert/attention signal — the HUD's unavailable-
// devices and facility icons (DOM, .icon-btn-count) and the 3D map's room-
// cluster chip (Babylon GUI) both show one. Framework-free on purpose: a
// Babylon GUI control can't consume CSS, so the one thing genuinely shareable
// across both rendering paths is this formatting rule, not markup or styles.

/** Above this, show "99+" rather than an ever-widening exact number — a pill
 *  is a glance-at-a-corner UI, not a precise counter. */
const COUNT_BADGE_CAP = 99;

/** Format a count for a small badge/pill: capped at COUNT_BADGE_CAP. */
export function formatCountBadge(n: number): string {
  return n > COUNT_BADGE_CAP ? "99+" : String(n);
}
