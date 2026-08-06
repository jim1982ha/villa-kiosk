// src/components/hud/LegendModal.tsx
// "What do these colours mean?" — the category filter icons already double as
// a colour legend (a lit icon uses the same gradient as that category's map
// badges — see HUD.tsx), and each device panel's status pill explains its OWN
// state colour, but nothing ties the whole colour language together in one
// place. A first-time user has to tap around and learn it by trial. This is
// that reference, one tap away, not shown by default.

import { CATEGORY_ORDER, CATEGORY_LABELS, categoryGradient } from "@/config/EntityCategories";
import { ALERT_RED_HEX } from "@/babylon/colors";
import { useModalA11y } from "@/hooks/useModalA11y";
import { STATUS_COLOR } from "@/utils/stateColors";

/** What the MAP badge actually does per state — mirrors EntityVisuals'
 *  BADGE_RING exactly (red ring for on/alert, no ring when off/idle, the whole
 *  badge dimmed when unavailable). Kept faithful to the code rather than
 *  describing the panel pill's palette, which is a different thing (below). */
const BADGE_ITEMS: { label: string; note: string; ring?: string; dim?: boolean }[] = [
  { label: "Active / alerting", ring: ALERT_RED_HEX,
    note: "Red outline — the device is on, or needs attention (unlocked door, leak…)" },
  { label: "Off / idle", note: "No outline — the device is off or resting" },
  { label: "Unavailable", dim: true,
    note: "The badge keeps its own category colour but fades — there's no separate "
      + "\"unavailable colour\" on the map the way the panel pill below has amber" },
];

/** The coloured status pill each device PANEL shows (a different vocabulary
 *  from the map badge above — panels have room for four distinct states). */
const STATUS_ITEMS: { label: string; swatch: string; note: string }[] = [
  { label: "On / active", swatch: STATUS_COLOR.active, note: "Device is on, unlocked-safe, or open" },
  { label: "Off / idle", swatch: STATUS_COLOR.idle, note: "Device is off or in its resting state" },
  { label: "Unavailable", swatch: STATUS_COLOR.unavailable, note: "Home Assistant has lost contact — state unknown" },
  { label: "Alert", swatch: STATUS_COLOR.alert, note: "Needs attention (e.g. unlocked door, leak, low battery)" },
];

export default function LegendModal({ onClose }: { onClose: () => void }) {
  // Focus trap + Escape + focus restore (see useModalA11y).
  const dialogRef = useModalA11y(onClose);
  return (
    // Same shell as every other full modal (Settings, Config Editor, group
    // panels) — .settings-modal's 780px width, not the narrow device-panel
    // card. It already reuses .settings-header/-body/-footer below; sharing
    // the outer width too means this is a genuine "same modal, different
    // content" reuse instead of its own one-off sizing.
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-modal legend-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Map colours"
      >
        <div className="settings-header">
          <h2>Map colours</h2>
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

          <div className="settings-section-title">On the map (badge outline)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            How a device's own badge shows its state in the 3D view — a
            different, simpler vocabulary than the panel pill below: the map
            only ever changes the RING colour and the badge's OPACITY, never
            its category colour.
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
                  <span className="muted" style={{ display: "block", fontSize: "var(--text-xs)" }}>{b.note}</span>
                </span>
              </div>
            ))}
          </div>

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
                  <span className="muted" style={{ display: "block", fontSize: "var(--text-xs)" }}>{s.note}</span>
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
