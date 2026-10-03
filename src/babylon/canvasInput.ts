// src/babylon/canvasInput.ts
// The listeners a camera controller owns while it is the active one — the
// canvas pointers and wheel, and the keyboard — attached and removed as ONE
// set (2.496.263). Only one controller (first-person OR overview) listens at
// a time, so there is never a setPointerCapture race between them.
//
// ⚠️ WRITTEN OUT TWICE, AND THE COPIES HAD DRIFTED. The overview released its
// held keys when the window lost focus; the walk camera did not — so a W held
// while switching to another app kept the walker walking until W was pressed
// and released again. Both now release on blur.

export interface CanvasInputHandlers {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  /** Up, cancel AND leave: the gesture is over however it ended. */
  onPointerUp: (e: PointerEvent) => void;
  /** Non-passive: the camera owns the wheel (zoom, or walking on a trackpad). */
  onWheel: (e: WheelEvent) => void;
  onKey: (e: KeyboardEvent) => void;
  /** The window lost focus: let go of every held key. */
  onBlur: () => void;
}

export interface CanvasInput {
  readonly attached: boolean;
  attach(): void;
  detach(): void;
}

export function canvasInput(canvas: HTMLElement, h: CanvasInputHandlers): CanvasInput {
  let attached = false;
  const pointer: [string, (e: PointerEvent) => void][] = [
    ["pointerdown", h.onPointerDown], ["pointermove", h.onPointerMove],
    ["pointerup", h.onPointerUp], ["pointercancel", h.onPointerUp], ["pointerleave", h.onPointerUp],
  ];
  return {
    get attached() { return attached; },
    attach() {
      if (attached) return;
      for (const [t, f] of pointer) canvas.addEventListener(t, f as EventListener);
      canvas.addEventListener("wheel", h.onWheel, { passive: false });
      window.addEventListener("keydown", h.onKey);
      window.addEventListener("keyup", h.onKey);
      window.addEventListener("blur", h.onBlur);
      attached = true;
    },
    detach() {
      if (!attached) return;
      for (const [t, f] of pointer) canvas.removeEventListener(t, f as EventListener);
      canvas.removeEventListener("wheel", h.onWheel);
      window.removeEventListener("keydown", h.onKey);
      window.removeEventListener("keyup", h.onKey);
      window.removeEventListener("blur", h.onBlur);
      attached = false;
    },
  };
}
