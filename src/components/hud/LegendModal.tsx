// src/components/hud/LegendModal.tsx
// "What do these colours mean?" — the category filter icons already double as
// a colour legend (a lit icon uses the same gradient as that category's map
// badges — see HUD.tsx), and each device panel's status pill explains its OWN
// state colour, but nothing ties the whole colour language together in one
// place. A first-time user has to tap around and learn it by trial. This is
// that reference, one tap away, not shown by default.

import { X } from "lucide-react";
import { CATEGORY_ORDER, CATEGORY_LABELS, categoryGradient } from "@/config/EntityCategories";
import { ALERT_RED_HEX } from "@/babylon/colors";

/** What the MAP badge actually does per state — mirrors EntityVisuals'
 *  BADGE_RING exactly (red ring for on/alert, no ring when off/idle, the whole
 *  badge dimmed when unavailable). Kept faithful to the code rather than
 *  describing the panel pill's palette, which is a different thing (below). */
const BADGE_ITEMS: { label: string; note: string; ring?: string; dim?: boolean }[] = [
  { label: "Active / alerting", ring: ALERT_RED_HEX,
    note: "Red outline — the device is on, or needs attention (unlocked door, leak…)" },
  { label: "Off / idle", note: "No outline — the device is off or resting" },
  { label: "Unavailable", dim: true,
    note: "The badge fades — Home Assistant has lost contact, so its state is unknown" },
];

/** The coloured status pill each device PANEL shows (a different vocabulary
 *  from the map badge above — panels have room for four distinct states). */
const STATUS_ITEMS: { label: string; swatch: string; note: string }[] = [
  { label: "On / active", swatch: "var(--status-on)", note: "Device is on, unlocked-safe, or open" },
  { label: "Off / idle", swatch: "var(--bg-input)", note: "Device is off or in its resting state" },
  { label: "Unavailable", swatch: "var(--status-warning)", note: "Home Assistant has lost contact — state unknown" },
  { label: "Alert", swatch: "var(--status-danger)", note: "Needs attention (e.g. unlocked door, leak, low battery)" },
];

export default function LegendModal({ onClose }: { onClose: () => void }) {
  return (
    // panel-modal-backdrop/panel-modal: short content → the same small centered
    // rounded card as the device panel on mobile, instead of the base
    // top-anchored full-screen sheet meant for long Settings forms. See
    // FirstRunTips for the same fix.
    <div className="modal-backdrop panel-modal-backdrop" onClick={onClose}>
      <div className="modal panel-modal legend-modal" onClick={(e) => e.stopPropagation()}>
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
                  style={{ background: categoryGradient(c) }}
                />
                <span>{CATEGORY_LABELS[c]}</span>
              </div>
            ))}
          </div>

          <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "20px 0" }} />

          <div className="settings-section-title">On the map (badge outline)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            How a device's own badge shows its state in the 3D view.
          </p>
          <div className="legend-grid">
            {BADGE_ITEMS.map((b) => (
              <div className="legend-row" key={b.label}>
                <span
                  className="legend-swatch"
                  style={{
                    background: categoryGradient("light"),
                    boxShadow: b.ring ? `0 0 0 3px ${b.ring}` : undefined,
                    opacity: b.dim ? 0.5 : 1,
                  }}
                />
                <span>
                  <strong>{b.label}</strong>
                  <span className="muted" style={{ display: "block", fontSize: 12 }}>{b.note}</span>
                </span>
              </div>
            ))}
          </div>

          <hr style={{ border: "none", borderTop: "1px solid var(--hairline)", margin: "20px 0" }} />

          <div className="settings-section-title">On a device panel (status pill)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            Shown when you open a device's controls.
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
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
