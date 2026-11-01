// src/hooks/useInView.ts
// What a tap opened brings itself into view as it opens: a form, an Inbox card. One gesture, so nothing opens off screen.

import { useEffect, useRef } from "react";

/** The ref of what scrolls into view whenever `active` turns true. */
export function useInView<T extends HTMLElement>(active = true, block: ScrollLogicalPosition = "start") {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView?.({ block, behavior: reduce ? "auto" : "smooth" });
  }, [active, block]);
  return ref;
}
