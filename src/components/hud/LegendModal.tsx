// src/components/hud/LegendModal.tsx
// "What do these colours mean?" — the category filter icons already double as
// a colour legend (a lit icon uses the same gradient as that category's map
// badges — see HUD.tsx), and each device panel's status pill explains its OWN
// state colour, but nothing ties the whole colour language together in one
// place. A first-time user has to tap around and learn it by trial. This is
// that reference, one tap away, not shown by default.

import { X } from "lucide-react";
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_COLORS } from "@/config/EntityCategories";

const STATUS_ITEMS: { label: string; swatch: string; note: string }[] = [
  { label: "On / active", swatch: "var(--status-on)", note: "Device is on, unlocked-safe, or open" },
  { label: "Off / idle", swatch: "var(--bg-input)", note: "Device is off or in its resting state" },
  { label: "Unavailable", swatch: "var(--status-warning)", note: "Home Assistant has lost contact — state unknown" },
  { label: "Alert", swatch: "var(--status-danger)", note: "Needs attention (e.g. unlocked door, leak, low battery)" },
];

export default function LegendModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal legend-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Map colours</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-section-title">Device category (badge colour)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            Matches the category filter buttons in the top bar.
          </p>
          <div className="legend-grid">
            {CATEGORY_ORDER.map((c) => (
              <div className="legend-row" key={c}>
                <span
                  className="legend-swatch"
                  style={{ background: `linear-gradient(135deg, ${CATEGORY_COLORS[c].top}, ${CATEGORY_COLORS[c].bottom})` }}
                />
                <span>{CATEGORY_LABELS[c]}</span>
              </div>
            ))}
          </div>

          <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "20px 0" }} />

          <div className="settings-section-title">Device state (status pill / outline)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            Shown on each device's control panel and its map highlight.
          </p>
          <div className="legend-grid">
            {STATUS_ITEMS.map((s) => (
              <div className="legend-row" key={s.label}>
                <span className="legend-swatch legend-swatch-round" style={{ background: s.swatch }} />
                <span>
                  <strong>{s.label}</strong>
                  <span className="muted" style={{ display: "block", fontSize: 12 }}>{s.note}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="settings-footer">
          <span />
          <button className="btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
