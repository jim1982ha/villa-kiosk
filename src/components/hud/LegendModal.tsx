// src/components/hud/LegendModal.tsx
// "What do these colours mean?" — the category filter icons already double as
// a colour legend (a lit icon uses the same gradient as that category's map
// badges — see HUD.tsx), and each device panel's status pill explains its OWN
// state colour, but nothing ties the whole colour language together in one
// place. A first-time user has to tap around and learn it by trial. This is
// that reference, one tap away, not shown by default.

import { CATEGORY_ORDER, CATEGORY_LABELS, categorySurface, type DeviceSurfaceState } from "@/config/EntityCategories";
import { useModalA11y } from "@/hooks/useModalA11y";
import ModalFooter from "@/components/common/ModalFooter";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { STATUS_COLOR } from "@/utils/stateColors";

/** What the MAP badge actually does per state — mirrors config/
 *  EntityCategories.categorySurface exactly (VESTA-DESIGN.md §0): neutral by
 *  default, coloured only when active or alerting, a dashed amber ring for
 *  unavailable. A representative category ("light") stands in for "whichever
 *  category this device belongs to" — the row is illustrating the STATE
 *  vocabulary, not any one category.
 *
 *  "Neutral by default" is a rule about the SURFACE, and since 2.251.0 the
 *  wording here has to say so: the fill and the ring still go quiet at rest,
 *  but the PICTOGRAM always carries its category's hue, because what kind of
 *  device something is stays true whether or not it is switched on. Keep this
 *  copy in step with that function — a legend that describes a badge the app
 *  no longer draws is worse than no legend. */
const BADGE_ITEMS: { label: string; state: DeviceSurfaceState; note: string }[] = [
  { label: "Active / alerting", state: "active",
    note: "Filled with the device's own category colour — the device is on, or doing something" },
  { label: "Off / idle", state: "off",
    note: "Neutral square, category-coloured icon — the device is off or resting (the default look for most of the map)" },
  { label: "Needs attention", state: "alert",
    note: "Filled red — the device needs attention (an unlocked door, a leak, low battery…)" },
  { label: "Unavailable", state: "unavailable",
    note: "Neutral square, dashed amber ring — Home Assistant has lost contact with this device" },
];

/** The coloured status pill each device PANEL shows, and the colours of the
 *  history bar underneath it (both read utils/stateColors' STATUS_COLOR — a
 *  finer vocabulary than the map badge above, because a panel has room for
 *  the distinction and a history bar genuinely needs it). */
const STATUS_ITEMS: { label: string; swatch: string; note: string }[] = [
  { label: "On / active", swatch: STATUS_COLOR.active, note: "Device is on, locked-secure, or open" },
  { label: "Off / idle", swatch: STATUS_COLOR.idle, note: "Device is off or in its resting state" },
  { label: "In progress", swatch: STATUS_COLOR.transitional,
    note: "Moving between the two — opening, closing, locking, arming" },
  { label: "Unavailable", swatch: STATUS_COLOR.unavailable, note: "Home Assistant has lost contact — state unknown" },
  { label: "Alert", swatch: STATUS_COLOR.alert, note: "Needs attention (e.g. unlocked door, jammed lock, leak)" },
];

export default function LegendModal({ onClose }: { onClose: () => void }) {
  // Focus trap + Escape + focus restore (see useModalA11y).
  const dialogRef = useModalA11y(onClose);
  // Every swatch below is a colour composited in JS from the theme's tokens,
  // not a CSS variable the cascade would re-evaluate — so this legend has to
  // re-render when the theme changes or it documents the wrong colours.
  const theme = useResolvedTheme();
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
        key={theme}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Map colours"
      >
        <div className="settings-header">
          <h2>Map colours</h2>
        </div>
        <div className="settings-body">
          <div className="settings-section-title">Device category (badge colour when active)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            A device's badge is plain and neutral at rest — its category
            colour only appears once it's active or alerting (see below).
          </p>
          <div className="legend-grid">
            {CATEGORY_ORDER.map((c) => (
              <div className="legend-row" key={c}>
                <span
                  className="legend-swatch"
                  style={{ background: categorySurface(c, "active").fill, border: `1.5px solid ${categorySurface(c, "active").ring}` }}
                />
                <span>{CATEGORY_LABELS[c]}</span>
              </div>
            ))}
          </div>

          <div className="settings-section-title">On the map (badge state)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            How a device's own badge shows its state in the 3D view — neutral
            by default, colour only when something's actually happening.
          </p>
          <div className="legend-grid">
            {BADGE_ITEMS.map((b) => {
              const surface = categorySurface("light", b.state);
              return (
                <div className="legend-row" key={b.label}>
                  <span
                    className="legend-swatch"
                    style={{
                      background: surface.fill,
                      border: surface.ring
                        ? `1.5px ${surface.ringDashed ? "dashed" : "solid"} ${surface.ring}`
                        : undefined,
                    }}
                  />
                  <span>
                    <strong>{b.label}</strong>
                    <span className="muted" style={{ display: "block", fontSize: "var(--text-xs)" }}>{b.note}</span>
                  </span>
                </div>
              );
            })}
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
        <ModalFooter onClose={onClose} />
      </div>
    </div>
  );
}
