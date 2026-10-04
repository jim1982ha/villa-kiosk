// src/components/hud/LegendModal.tsx
// "What do these colours mean?" — the category filter icons already double as
// a colour legend (a lit icon uses the same gradient as that category's map
// badges — see HUD.tsx), and each device panel's status pill explains its OWN
// state colour, but nothing ties the whole colour language together in one
// place. A first-time user has to tap around and learn it by trial. This is
// that reference, one tap away, not shown by default.

import { CATEGORY_ORDER, CATEGORY_LABELS, categorySurface, categorySurfaceRinged, type DeviceSurfaceState } from "@/config/EntityCategories";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { STATUS_COLOR } from "@/utils/stateColors";
import { useConfig } from "@/config/ConfigContext";
import { overviewKeyHelp } from "@/babylon/overviewKeys";
import { healthPill } from "@/babylon/colors";
import ModalFooter from "@/components/common/ModalFooter";

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
const BADGE_ITEMS: { label: string; state: DeviceSurfaceState; ringState?: DeviceSurfaceState; note: string }[] = [
  { label: "Active / alerting", state: "active",
    note: "Filled with the device's own category colour — the device is on, or doing something" },
  { label: "Off / idle", state: "off",
    note: "Neutral square, category-coloured icon — the device is off or resting (the default look for most of the map)" },
  // The ring a LINKED entity draws (deviceActivity.badgeFaceAndRing): the
  // badge's own colour since 2.496.239 — it was the "Needs attention" red.
  { label: "Linked device on", state: "off", ringState: "active",
    note: "A ring in the device's own colour — the switch linked to it is on (a pump's relay, a camera's detection)" },
  { label: "Needs attention", state: "alert",
    note: "Filled red — the device needs attention (an unlocked door, a leak, low battery…)" },
  { label: "Unavailable", state: "unavailable",
    note: "Neutral square, dashed amber ring — Home Assistant has lost contact with this device" },
];

/** A room chip: its border says whether something is on; its number's colour
 *  is the room's health (summaryLook.roomHealth → colors.healthPill). */
const CHIP_RINGS: { label: string; frame: "active" | "rest"; note: string }[] = [
  { label: "Light border", frame: "active", note: "Something in the room is on" },
  { label: "No border", frame: "rest", note: "Everything in the room is off or resting" },
];
const CHIP_COUNTS: { label: string; health: "alert" | "unavailable" | "ok"; note: string }[] = [
  { label: "Green number", health: "ok", note: "All right — every device is reporting and nothing needs attention" },
  { label: "Amber number", health: "unavailable", note: "Home Assistant has lost contact with a device in the room" },
  { label: "Red number", health: "alert", note: "Something in the room needs attention (an unlocked door, a leak…) — shown before amber" },
];

/** The coloured status pill each device PANEL shows, and the colours of the
 *  history bar underneath it (both read utils/stateColors' STATUS_COLOR — a
 *  finer vocabulary than the map badge above, because a panel has room for
 *  the distinction and a history bar genuinely needs it). */
const STATUS_ITEMS: { label: string; swatch: string; note: string }[] = [
  { label: "On / active", swatch: STATUS_COLOR.active, note: "Device is on, locked-secure, or open — or a detector finding nothing wrong (no leak, no smoke)" },
  { label: "Off / idle", swatch: STATUS_COLOR.idle, note: "Device is off or in its resting state" },
  { label: "In progress", swatch: STATUS_COLOR.transitional,
    note: "Moving between the two — opening, closing, locking, arming" },
  { label: "Unavailable", swatch: STATUS_COLOR.unavailable, note: "Home Assistant has lost contact — state unknown" },
  { label: "Alert", swatch: STATUS_COLOR.alert, note: "Needs attention (e.g. unlocked door, jammed lock, leak)" },
];

export default function LegendModal({ onClose }: { onClose: () => void }) {
  const { config } = useConfig();
  // Focus trap + Escape + focus restore (see useModalA11y).
  const dialogRef = useModalA11y(onClose);
  // Every swatch below is a colour composited in JS from the theme's tokens,
  // not a CSS variable the cascade would re-evaluate — so this legend has to
  // re-render when the theme changes or it documents the wrong colours.
  const theme = useResolvedTheme();
  return (
    // Same shell as every other full modal (Settings, Config Editor, group
    // panels) — .settings-modal's 780px width, not the narrow device-panel
    // card. It already reuses .modal-header/-body/-footer below; sharing
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
        aria-label="Map colours and keys"
      >
        <div className="modal-header">
          <h2>Map colours &amp; keys</h2>
        </div>
        <div className="modal-body">
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
              const surface = categorySurfaceRinged("light", b.state, b.ringState ?? b.state);
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

          {/* Drawn from the same owners as the chip: categorySurface("others", …)
              for the border, healthPill for the number. */}
          <div className="settings-section-title">Room chips (zoomed out)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            A room's name with its number of devices. The number's colour says
            whether the room is all right; the border, whether something is on.
          </p>
          <div className="legend-grid">
            {CHIP_RINGS.map((r) => (
              <div className="legend-row" key={r.label}>
                <span className="legend-swatch" style={{
                  background: categorySurface("others", "off").fill,
                  border: `1.5px solid ${r.frame === "rest" ? "var(--hairline)" : categorySurface("others", r.frame).ring}`,
                }} />
                <span>
                  <strong>{r.label}</strong>
                  <span className="muted" style={{ display: "block", fontSize: "var(--text-xs)" }}>{r.note}</span>
                </span>
              </div>
            ))}
            {CHIP_COUNTS.map((n) => (
              <div className="legend-row" key={n.label}>
                <span className="legend-swatch legend-swatch-round legend-count" style={{
                  background: healthPill(n.health).fill, color: healthPill(n.health).ink,
                }}>3</span>
                <span>
                  <strong>{n.label}</strong>
                  <span className="muted" style={{ display: "block", fontSize: "var(--text-xs)" }}>{n.note}</span>
                </span>
              </div>
            ))}
          </div>

          {/* The keyboard, as the current Natural Scroll setting makes it act
              (overviewKeys.overviewKeyHelp) — nowhere else says it. */}
          <div className="settings-section-title">Moving around with a keyboard</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            Bird's-eye view — hold a key to keep moving{config.naturalScrolling ? " (Natural Scroll is on)" : " (Natural Scroll is off)"}:
          </p>
          <div className="legend-keys">
            {overviewKeyHelp(config.naturalScrolling).map((k) => (
              <div className="legend-row" key={k.keys}><kbd>{k.keys}</kbd><span>{k.does}</span></div>
            ))}
          </div>
          <p className="muted body-text">
            Walking: ↑ ↓ or W S walk, ← → or A D turn, Q / E step sideways, Shift + ↑ ↓ look up or down.
          </p>

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
