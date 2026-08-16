// src/components/panels/BadgeColorModal.tsx
// Small picker for a single device's map-badge background colour. Opened by
// tapping the badge in a device panel's header (see BasePanel). Offers a set of
// preset swatches + a native colour input for anything else, and a "category
// default" reset. Commits on choice (one config write / re-index per pick — the
// same cost as a label edit), so there's no live-drag re-index storm.

import { RotateCcw } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";

// A spread of distinct, pleasant badge colours. Identity swatches (not a data
// scale), so no ramp/validator needed — just visibly different from each other.
const SWATCHES = [
  "#E5573E", "#F0A93A", "#F4C543", "#4CAF6A", "#2E9C6E",
  "#2E8FD6", "#4C6EF5", "#7048E8", "#9450C9", "#E64980",
  "#E6A0C4", "#8794A5",
];

interface Props {
  /** Current override colour (#rrggbb), or undefined when on the category default. */
  current?: string;
  /** A representative swatch for the "category default" chip. */
  categoryColor: string;
  /** Apply a colour live (null = reset to category default). Does NOT close —
   *  the header badge + map badge update immediately (cheap repaint), so the
   *  custom picker previews as you drag without the modal dismissing itself. */
  onChange: (hex: string | null) => void;
  onClose: () => void;
}

export default function BadgeColorModal({ current, categoryColor, onChange, onClose }: Props) {
  // Escape + Back + focus trap + focus restore, from ONE hook. This used to
  // be useBackToClose plus a hand-rolled keydown listener, which is how the
  // app reached 13 separate Escape handlers — and it still had no focus trap
  // and no focus restore, so a keyboard user could Tab out of the picker and
  // landed at the top of the document on close.
  const dialogRef = useModalA11y(onClose);
  // Swatches are a decision → apply and dismiss. The custom picker and "default"
  // reset apply live but leave the modal open for further tweaking.
  const pickAndClose = (hex: string | null) => { onChange(hex); onClose(); };

  return (
    // Same panel-modal-backdrop/panel-modal treatment as the device panel
    // underneath it (BasePanel) — without these, mobile fell through to the
    // BASE .modal-backdrop/.modal rules, meant for long full-screen sheets
    // (Settings/Config Editor): top-anchored, edge-to-edge, square corners.
    // This is a short picker, same category as the device panel itself, so it
    // should get the same small centered rounded card on phones.
    <div className="modal-backdrop panel-modal-backdrop" onClick={onClose} style={{ zIndex: 80 }}>
      <div
        ref={dialogRef}
        className="modal panel-modal badge-color-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Badge colour"
      >
        <div className="panel-header">
          <div className="title"><h2>Icon colour</h2></div>
        </div>

        <div className="panel-body">
          <div className="badge-swatch-grid">
            {SWATCHES.map((hex) => (
              <button
                key={hex}
                className={`badge-swatch${current?.toLowerCase() === hex.toLowerCase() ? " selected" : ""}`}
                style={{ background: hex }}
                onClick={() => pickAndClose(hex)}
                aria-label={`Set colour ${hex}`}
                title={hex}
              />
            ))}
          </div>

          <div className="row" style={{ gap: 12, marginTop: 16, alignItems: "center" }}>
            <label className="badge-swatch custom" title="Custom colour">
              <input
                type="color"
                value={current ?? categoryColor}
                onChange={(e) => onChange(e.target.value)}
                aria-label="Custom colour"
              />
              <span>Custom…</span>
            </label>
            <button className="btn ghost" onClick={() => pickAndClose(null)} style={{ marginLeft: "auto" }}>
              <RotateCcw size={16} /> Category default
            </button>
          </div>
        </div>

        <div className="panel-footer">
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
