// src/hooks/useMediaZoom.ts
// Client-side (screen-space) zoom + pan for a fixed-size media element — used by
// the camera panel, whose live feed the camera hardware can't zoom itself. This
// zooms the pixels the browser already has: pinch (touch), wheel (desktop),
// drag-to-pan while zoomed, and double-tap / double-click to reset. Purely a CSS
// transform, so it costs nothing until the user actually interacts.

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface MediaZoom<T extends HTMLElement> {
  ref: React.RefObject<T>;
  /** transform to spread on the media wrapper. */
  style: React.CSSProperties;
  zoomed: boolean;
  reset: () => void;
}

export function useMediaZoom<T extends HTMLElement>(): MediaZoom<T> {
  const ref = useRef<T>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  // Live snapshot of the transform for the native (non-React) gesture handlers,
  // so they never read a stale closure value.
  const live = useRef({ scale: 1, tx: 0, ty: 0 });
  live.current = { scale, tx, ty };

  const reset = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Pan is clamped so the scaled image edge can never cross the viewport
    // centre (you can't fling it entirely off-screen).
    const applyClamped = (s: number, x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      const maxX = (rect.width * (s - 1)) / 2;
      const maxY = (rect.height * (s - 1)) / 2;
      setScale(s);
      setTx(clamp(x, -maxX, maxX));
      setTy(clamp(y, -maxY, maxY));
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0, pinchScale = 1, pinchTx = 0, pinchTy = 0;
    let panning = false, panFromX = 0, panFromY = 0, panTx = 0, panTy = 0;
    let lastTap = 0;

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchScale = live.current.scale;
        pinchTx = live.current.tx; pinchTy = live.current.ty;
        panning = false;
      } else if (pointers.size === 1) {
        // Double-tap (≤300ms) resets — the touch equivalent of dblclick.
        const now = Date.now();
        if (now - lastTap < 300) { reset(); lastTap = 0; return; }
        lastTap = now;
        if (live.current.scale > 1) {
          panning = true;
          panFromX = e.clientX; panFromY = e.clientY;
          panTx = live.current.tx; panTy = live.current.ty;
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchDist > 0) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        applyClamped(clamp(pinchScale * (dist / pinchDist), MIN_SCALE, MAX_SCALE), pinchTx, pinchTy);
        e.preventDefault();
      } else if (panning) {
        applyClamped(live.current.scale, panTx + (e.clientX - panFromX), panTy + (e.clientY - panFromY));
        e.preventDefault();
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) panning = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = clamp(live.current.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_SCALE, MAX_SCALE);
      if (next <= MIN_SCALE) { setScale(1); setTx(0); setTy(0); }
      else applyClamped(next, live.current.tx, live.current.ty);
    };

    const onDblClick = () => reset();

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDblClick);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDblClick);
    };
  }, [reset]);

  return {
    ref: ref as React.RefObject<T>,
    style: {
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      transformOrigin: "center center",
      // Always "none" so a two-finger pinch is delivered as pointer events
      // instead of being hijacked by the browser's own page zoom/scroll.
      touchAction: "none",
      cursor: scale > 1 ? "grab" : "default",
    },
    zoomed: scale > 1,
    reset,
  };
}
