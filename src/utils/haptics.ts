// src/utils/haptics.ts
// Short vibration feedback for touch actions, in one place.
//
// This kiosk's primary interaction is tapping a badge on a 3D map to move
// something PHYSICAL — a lock, a gate, a light in another room. The result of
// that tap is frequently not visible from where the user is standing, and the
// on-screen confirmation is a small pill or a toast that may be a second or
// two behind the device itself. A short haptic closes that gap immediately,
// which is why native home-control apps use one and why its absence is part
// of what reads as "web app" rather than "product".
//
// Three intents, deliberately few — a vocabulary anyone can distinguish by
// feel without being taught:
//   tap     — acknowledgment: your press registered and a call went out.
//   success — a consequential action completed (a door unlocked, a scene ran).
//   warn    — refused or failed; look at the screen.
//
// Support and etiquette:
//   * navigator.vibrate is Android/Chromium and (recent) iOS Safari. Absent
//     elsewhere, so every call is a no-op behind one capability check rather
//     than a try/catch at each site.
//   * NEVER call this on a state change the user didn't initiate. A villa
//     kiosk sees constant background HA traffic; buzzing on someone else's
//     light turning on would be indefensible on a device sitting on a
//     bedside table. Every caller here is inside a user gesture handler.
//   * Durations are short by design. iOS in particular collapses long or
//     rapid patterns, and a kiosk that buzzes noticeably is worse than one
//     that doesn't buzz at all.

type Intent = "tap" | "success" | "warn";

/** Milliseconds per intent. A pattern (array) alternates vibrate/pause. */
const PATTERN: Record<Intent, number | number[]> = {
  tap: 10,
  success: [14, 40, 14],
  warn: [26, 50, 26],
};

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** Fire a haptic for `intent`. Safe to call anywhere: a no-op on devices
 *  without the API, and never throws (a browser may reject the call outside a
 *  user gesture, which is not an error worth surfacing). */
export function haptic(intent: Intent = "tap"): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(PATTERN[intent]);
  } catch {
    /* Rejected (no user gesture, or vibration disabled OS-side) — ignore. */
  }
}

/** The common case, named for its call site: acknowledge a control tap. */
export function tapFeedback(): void { haptic("tap"); }

/** A consequential action landed — an unlock, a scene, a confirmed delete. */
export function successFeedback(): void { haptic("success"); }
