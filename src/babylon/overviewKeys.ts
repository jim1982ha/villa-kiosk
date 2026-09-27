// src/babylon/overviewKeys.ts
// The bird's-eye view from the keyboard — the same four movements the touch
// screen has, as keys held down (owner, 2026-09-27):
//
//   Arrows / W A S D     pan          (a one-finger drag)
//   Shift + ← →, Q / E   rotate       (a two-finger twist)
//   Shift + ↑ ↓          tilt         (a two-finger vertical drag)
//   + / −  (PgUp / PgDn) zoom         (a pinch)
//
// ⚠️ THE ARROW IS THE GESTURE'S DIRECTION, and Natural Scroll decides what
// that gesture does — exactly as it does for a finger or a trackpad. With it
// ON, → is a swipe to the right: the villa follows it, moving right. With it
// OFF, → moves the VIEW right (the villa goes left). The same for ↑/↓ and for
// tilt; rotation and zoom are unaffected, as the twist and the pinch are.
//
// Rates are per SECOND (a held key moves as far on a 120 Hz iPad as on a
// 60 Hz screen — the walk camera's keyLook rule). Pure: tests/oracles/
// overview_keys.mjs.

export type OverviewKeyAction =
  | "left" | "right" | "up" | "down"
  | "rotateLeft" | "rotateRight" | "tiltUp" | "tiltDown"
  | "zoomIn" | "zoomOut";

/** The action a key stands for, or null. Shift turns the arrows into rotate
 *  (←/→) and tilt (↑/↓), as Shift+drag does with the mouse. */
export function overviewKeyAction(code: string, key: string, shift: boolean): OverviewKeyAction | null {
  switch (code) {
    case "ArrowLeft": return shift ? "rotateLeft" : "left";
    case "ArrowRight": return shift ? "rotateRight" : "right";
    case "ArrowUp": return shift ? "tiltUp" : "up";
    case "ArrowDown": return shift ? "tiltDown" : "down";
    case "KeyA": return "left";
    case "KeyD": return "right";
    case "KeyW": return "up";
    case "KeyS": return "down";
    case "KeyQ": return "rotateLeft";
    case "KeyE": return "rotateRight";
    case "PageUp": case "NumpadAdd": return "zoomIn";
    case "PageDown": case "NumpadSubtract": return "zoomOut";
  }
  // By CHARACTER for + and −: their key codes differ across layouts ("=" is
  // Shift-less "+" on a US keyboard, a key of its own on others).
  if (key === "+" || key === "=") return "zoomIn";
  if (key === "-" || key === "_") return "zoomOut";
  return null;
}

/** Drag pixels per second a held pan key is worth. */
export const KEY_PAN_PX_PER_S = 700;
/** Radians per second, rotate and tilt. */
export const KEY_ROTATE_RAD_PER_S = 1.2;
export const KEY_TILT_RAD_PER_S = 0.7;
/** How much a held zoom key scales the distance per second (in: ×1/1.9). */
export const KEY_ZOOM_PER_S = 1.9;

/**
 * One step of held keys, in the gestures' own units: `dragX/dragY` are a
 * finger drag in screen pixels (already signed by Natural Scroll, as the
 * pointer path signs it), `rotate` and `tilt` radians, `zoom` the factor the
 * distance is multiplied by.
 */
export function overviewKeyStep(
  held: ReadonlySet<OverviewKeyAction>, natural: boolean, dtSec: number,
): { dragX: number; dragY: number; rotate: number; tilt: number; zoom: number } {
  const on = (a: OverviewKeyAction) => (held.has(a) ? 1 : 0);
  const s = natural ? 1 : -1;
  const px = KEY_PAN_PX_PER_S * dtSec;
  return {
    // A swipe right is dx > 0; the pointer path hands the pan dx·s.
    dragX: (on("right") - on("left")) * px * s,
    dragY: (on("down") - on("up")) * px * s,
    rotate: (on("rotateLeft") - on("rotateRight")) * KEY_ROTATE_RAD_PER_S * dtSec,
    // As the TOUCH gesture (the owner's reference), not the mouse's Shift+drag,
    // which is signed the other way on purpose: two fingers moving UP push the
    // far side away and tip the villa towards the horizon (beta grows, ·s).
    tilt: (on("tiltUp") - on("tiltDown")) * KEY_TILT_RAD_PER_S * dtSec * s,
    zoom: Math.pow(KEY_ZOOM_PER_S, (on("zoomOut") - on("zoomIn")) * dtSec),
  };
}

/** The keys as a person reads them, for the current Natural Scroll setting. */
export function overviewKeyHelp(natural: boolean): { keys: string; does: string }[] {
  return [
    { keys: "← → ↑ ↓  or  W A S D", does: natural ? "Pan — the villa moves the way the arrow points" : "Pan — the view moves the way the arrow points" },
    { keys: "Shift + ← →  or  Q / E", does: "Rotate" },
    { keys: "Shift + ↑ ↓", does: natural ? "Tilt — ↑ tips the far side away, towards the horizon" : "Tilt — ↑ looks more straight down" },
    { keys: "+ / −  (or Page Up / Page Down)", does: "Zoom in / out" },
  ];
}

/** Keys typed into a field, or pressed while a dialog is open, are not for
 *  the camera — both cameras ask this. */
export function keyIsForCamera(target: EventTarget | null): boolean {
  const el = target as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.closest !== "function") return true;
  if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
  return !el.closest(".modal, [role='dialog']");
}
