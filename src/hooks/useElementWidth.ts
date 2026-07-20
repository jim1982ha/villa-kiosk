// src/hooks/useElementWidth.ts
// Measure an element's live pixel width so an SVG can use 1 unit = 1 px (no
// non-uniform preserveAspectRatio="none" stretch, which distorts axis/tooltip
// text). Returns [ref, width]; width starts at `initial` until first measure.

import { useLayoutEffect, useRef, useState } from "react";

export function useElementWidth<T extends HTMLElement>(
  initial = 320,
): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref as React.RefObject<T>, width];
}
