// src/components/fm/PhotoLightbox.tsx
// Full-size viewer for evidence photos.
//
// Evidence only does its job if someone can actually LOOK at it. Until now a
// photo attached to a fault or a spend entry existed as a 44px thumbnail in
// the form that created it and nowhere else — the record said "3 photo(s)"
// and there was no way to see them, which makes the photo a claim rather than
// evidence.
//
// Deliberately minimal: no zoom, no gestures, no library. Arrow keys and two
// on-screen chevrons, Escape or a backdrop tap to leave. The photos are
// already downscaled on upload (fmApi.downscaleToJpeg), so "full size" here
// is a phone-sized JPEG, not something that needs a pan-and-zoom surface.

import { useCallback } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { evidenceUrl } from "@/fm/fmApi";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useArrowStep } from "@/hooks/useArrowStep";

export default function PhotoLightbox({
  photoIds, index, onIndexChange, onClose,
}: {
  photoIds: string[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  // Escape + Back + focus trap + focus restore. The ARROW keys are useArrowStep's
  // below: they are this surface's navigation, not a dismissal, and the modal
  // hook has no opinion about them.
  const dialogRef = useModalA11y(onClose);
  const count = photoIds.length;
  // Wraps, so holding the arrow key never dead-ends on a set of two or three.
  const step = useCallback((delta: number) => {
    if (count > 0) onIndexChange((index + delta + count) % count);
  }, [count, index, onIndexChange]);

  useArrowStep(step);

  if (count === 0) return null;
  const id = photoIds[Math.min(index, count - 1)];

  return (
    <div ref={dialogRef} className="fm-lightbox" onClick={onClose} role="dialog" aria-modal="true"
      aria-label={`Photo ${index + 1} of ${count}`}>
      <button className="fm-lightbox-close" onClick={onClose} aria-label="Close photo">
        <X size={20} />
      </button>
      {count > 1 && (
        <button
          className="fm-lightbox-nav prev"
          onClick={(e) => { e.stopPropagation(); step(-1); }}
          aria-label="Previous photo"
        ><ChevronLeft size={26} /></button>
      )}
      {/* Stops the backdrop's close handler: tapping the photo itself should
          not dismiss the thing you are trying to look at. */}
      <img src={evidenceUrl(id)} alt={`Evidence photo ${index + 1}`}
        onClick={(e) => e.stopPropagation()} />
      {count > 1 && (
        <button
          className="fm-lightbox-nav next"
          onClick={(e) => { e.stopPropagation(); step(1); }}
          aria-label="Next photo"
        ><ChevronRight size={26} /></button>
      )}
      {count > 1 && <div className="fm-lightbox-count">{index + 1} / {count}</div>}
    </div>
  );
}
