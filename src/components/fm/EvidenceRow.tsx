// src/components/fm/EvidenceRow.tsx
// Photo evidence capture + thumbnails, shared by every place that records work
// (a maintenance completion, a resolved fault).
//
// `capture="environment"` on the file input opens the rear camera directly on a
// phone while still allowing a normal file pick on desktop — one control, both
// contexts, no platform branching.
//
// Photos are downscaled client-side before upload (see fmApi.downscaleToJpeg):
// a raw phone photo would blow past the Supervisor's ingress body cap, and the
// villa's uplink is the slowest part of the round trip.

import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { evidenceUrl, uploadEvidence } from "@/fm/fmApi";
import PhotoLightbox from "./PhotoLightbox";

export default function EvidenceRow({
  photoIds, onChange, disabled,
}: {
  photoIds: string[];
  /** Omit on a read-only strip. Three call sites each declared their own
   *  do-nothing handler just to satisfy this prop, which is the component
   *  making every caller carry a workaround for its own signature. */
  onChange?: (next: string[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which photo the full-size viewer is showing, or null when closed. Lives
  // here rather than in each caller so EVERY surface that shows evidence —
  // the capture form, a saved fault, a spend entry — gets a working viewer
  // from the one component that already draws the thumbnails.
  const [viewing, setViewing] = useState<number | null>(null);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const added: string[] = [];
    for (const file of Array.from(files)) {
      try {
        added.push(await uploadEvidence(file));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that photo.");
      }
    }
    if (added.length) onChange?.([...photoIds, ...added]);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className={`fm-evidence${disabled ? " readonly" : ""}`}>
      <div className="fm-evidence-strip">
        {photoIds.map((id, i) => (
          <span key={id} className="fm-thumb">
            {/* A button, not a bare <img>: opening evidence is a real action
                and needs to be reachable by keyboard and announced as such. */}
            <button
              type="button"
              className="fm-thumb-open"
              onClick={() => setViewing(i)}
              aria-label={`View photo ${i + 1} of ${photoIds.length}`}
            >
              <img src={evidenceUrl(id)} alt="" loading="lazy" />
            </button>
            {!disabled && (
              <button
                className="fm-thumb-x"
                onClick={() => onChange?.(photoIds.filter((p) => p !== id))}
                aria-label="Remove photo"
              ><X size={12} /></button>
            )}
          </span>
        ))}
        {!disabled && (
          <button
            className="fm-thumb fm-thumb-add"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label="Add photo evidence"
          >
            <Camera size={18} />
            <span>{busy ? "Adding…" : "Photo"}</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => void pick(e.target.files)}
      />
      {error && <div className="fm-inline-error">{error}</div>}
      {viewing !== null && (
        <PhotoLightbox
          photoIds={photoIds}
          index={viewing}
          onIndexChange={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
