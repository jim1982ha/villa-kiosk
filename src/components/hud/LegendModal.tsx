// src/components/hud/LegendModal.tsx
// "What do these colours mean?" — the category filter icons already double as
// a colour legend (a lit icon uses the same gradient as that category's map
// badges — see HUD.tsx), and each device panel's status pill explains its OWN
// state colour, but nothing ties the whole colour language together in one
// place. A first-time user has to tap around and learn it by trial. This is
// that reference, one tap away, not shown by default.

import { CATEGORY_ORDER, CATEGORY_LABELS, categorySurface, type DeviceSurfaceState } from "@/config/EntityCategories";
import { badgeImage } from "@/babylon/badgeIcons";
import type { BadgeMark, LinkPill } from "@/utils/deviceActivity";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { STATUS_COLOR } from "@/utils/stateColors";
import { useConfig } from "@/config/ConfigContext";
import { overviewKeyHelp } from "@/babylon/overviewKeys";
import { healthPill } from "@/babylon/colors";
import type { RoomHealth } from "@/babylon/summaryLook";
import ModalFooter from "@/components/common/ModalFooter";
import DialogLayer from "@/components/common/DialogLayer";

/** What the MAP badge says — drawn by the badge renderer itself (babylon/badgeIcons.badgeImage), so this legend
 *  cannot describe a badge the app no longer draws. A representative category ("light") stands in for "whichever
 *  category this device belongs to".
 *
 *  ⚠️ THE SQUARE SAYS WHAT THE DEVICE DOES, THE CORNER MARK WHAT IS WRONG (owner, 2026-10-22: badge proposal 2,
 *  "Corner dot"): the face is off or on, never a problem colour; one mark at most, top-right, in the order below
 *  (deviceActivity.MARK_ORDER). ONE CORNER PER DEVICE (owner, 2026-10-22): the top-right pill is the device itself,
 *  the bottom-right one the device linked to it — its own problem with the same marks, else filled on / hollow off. */
const BADGE_ITEMS: { label: string; state: DeviceSurfaceState; mark?: BadgeMark; linkPill?: LinkPill; note: string }[] = [
  { label: "Off", state: "off", note: "Plain square, icon in the device's colour, resting" },
  { label: "On", state: "active", note: "Tinted in the device's colour, on, or working" },
  { label: "Bottom-right pill", state: "off", linkPill: "on",
    note: "The device linked to it, filled when on, hollow when off, or its own problem with the same marks" },
  { label: "Red \"?\"", state: "unavailable", mark: "critical", note: "A critical device has gone silent, act now" },
  { label: "Top-right dot", state: "active", mark: "active", note: "In use, motion seen, a door open, a lock unlocked" },
  { label: "Red \"!\"", state: "active", mark: "alarm", note: "Alarm, a leak, smoke, a low battery, a jammed lock" },
  { label: "Amber \"!\"", state: "off", mark: "fault", note: "An open fault, check soon" },
  { label: "Grey \"?\"", state: "unavailable", mark: "lost", note: "No contact, the square is faded" },
  { label: "Grey \"z\"", state: "off", mark: "asleep", note: "Asleep by design, its last report is shown" },
  { label: "Teal \"…\"", state: "off", mark: "moving", note: "Moving, locking, opening, closing" },
];

/** A room chip: its border says whether something is on; its number's colour
 *  is the room's health (summaryLook.roomHealth → colors.healthPill). */
const CHIP_RINGS: { label: string; frame: "active" | "rest"; note: string }[] = [
  { label: "Light border", frame: "active", note: "Something in the room is on" },
  { label: "No border", frame: "rest", note: "Everything in the room is off or resting" },
];
const CHIP_COUNTS: { label: string; health: RoomHealth; note: string }[] = [
  { label: "Green number", health: "ok", note: "All right, every device is reporting and nothing needs attention" },
  { label: "Grey number", health: "unavailable", note: "No contact with a device in the room" },
  { label: "Amber number", health: "fault", note: "A device in the room has an open fault, shown before grey" },
  { label: "Red number", health: "alert", note: "Act now: an alarm, or a critical device gone silent, shown first" },
];

/** The coloured status pill each device PANEL shows, and the colours of the
 *  history bar underneath it (both read utils/stateColors' STATUS_COLOR — a
 *  finer vocabulary than the map badge above, because a panel has room for
 *  the distinction and a history bar genuinely needs it). */
const STATUS_ITEMS: { label: string; swatch: string; note: string }[] = [
  { label: "On / active", swatch: STATUS_COLOR.active, note: "Device is on, locked-secure, or open, or a detector finding nothing wrong (no leak, no smoke, no motion), a door or window closed" },
  { label: "Off / idle", swatch: STATUS_COLOR.idle, note: "Device is off or in its resting state, or a door or window standing open" },
  { label: "In progress", swatch: STATUS_COLOR.transitional,
    note: "Moving between the two: opening, closing, locking, arming" },
  { label: "Unavailable", swatch: STATUS_COLOR.unavailable, note: "No contact" },
  // "unknown": the device answers with nothing to say (stateColors.contactOf "no-value") — idle, never "no contact"
  { label: "No value reported", swatch: STATUS_COLOR.idle, note: "The device is answering but has no value to give right now" },
  { label: "Alert", swatch: STATUS_COLOR.alert, note: "Needs attention (e.g. unlocked door, jammed lock, leak), or a detection (motion, occupancy), which is not a fault" },
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
    <DialogLayer className="modal-backdrop" onClick={onClose}>
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
          <div className="settings-section-title">Device category (badge colour when on)</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            A device's badge is plain at rest, its icon in its category
            colour, the whole square takes the colour once it is on.
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
            The square says what a device does. The top-right pill is the
            device itself: what is wrong with it, the most urgent first.
          </p>
          <div className="legend-grid">
            {BADGE_ITEMS.map((b) => (
              <div className="legend-row" key={b.label}>
                <img
                  className="legend-badge"
                  src={badgeImage({ category: "light", iconKey: "lightbulb", state: b.state, mark: b.mark, linkPill: b.linkPill, bakePx: 64 })}
                  alt=""
                  draggable={false}
                />
                <span>
                  <strong>{b.label}</strong>
                  <span className="muted legend-note">{b.note}</span>
                </span>
              </div>
            ))}
            <div className="legend-row">
              <span className="legend-badge" aria-hidden />
              <span className="muted legend-note">A device hidden in the villa's system has no badge.</span>
            </div>
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
                  <span className="muted legend-note">{r.note}</span>
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
                  <span className="muted legend-note">{n.note}</span>
                </span>
              </div>
            ))}
          </div>

          {/* The keyboard, as the current Natural Scroll setting makes it act
              (overviewKeys.overviewKeyHelp) — nowhere else says it. */}
          <div className="settings-section-title">Moving around with a keyboard</div>
          <p className="muted body-text" style={{ marginTop: 4 }}>
            Bird's-eye view, hold a key to keep moving{config.naturalScrolling ? " (Natural Scroll is on)" : " (Natural Scroll is off)"}:
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
                  <span className="muted legend-note">{s.note}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <ModalFooter onClose={onClose} />
      </div>
    </DialogLayer>
  );
}
