// src/components/panels/BasePanel.tsx
// Shared modal wrapper for device panels: centered dialog (not a bottom
// sheet), backdrop-dismiss + Escape, header with icon/title/room (the raw
// entity_id used to show as a third header line — dropped for a slicker
// header; still available via Advanced Settings' Edit, and every title is
// human-readable now — see displayLabelFor). Edit and Close both live in the
// FOOTER, right-aligned — same "no header close icon, footer Close button
// instead" chrome every other modal in the app uses (Settings, Advanced
// Settings, Facility, Legend…), so this is the ONE shared place that
// convention comes from — title truncates with an ellipsis (see
// .modal-header .title h2 in styles.css) instead of fighting a footer button
// for room.

import { useState, type ReactNode } from "react";
import { ChevronLeft, Wrench } from "lucide-react";
import { linkedSwitchProps, usePanelActions } from "./PanelActionsContext";
import { linkedStateWords } from "./panelHeader";
import { badgeImage } from "@/babylon/badgeIcons";
import { useModalA11y } from "@/hooks/useModalA11y";
import DeviceReadings from "./DeviceReadings";
import { useConfig } from "@/config/ConfigContext";
import { categorySurface } from "@/config/EntityCategories";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import BadgeColorModal from "./BadgeColorModal";
import LastDayTimeline from "./LastDayTimeline";
import LinkedSensorRow from "./LinkedSensorRow";
import ModalFooter from "@/components/common/ModalFooter";
import { useHA } from "@/ha/HAStateStore";
import { missingFromHa } from "@/utils/stateColors";
import { deviceRoom } from "@/config/devicePlace";
import DialogLayer from "@/components/common/DialogLayer";

interface Props {
  title: string;
  /** The device's own entity_id — its room (live-resolved, see ConfigContext's
   *  resolvedRooms) is looked up here rather than passed in, so every panel
   *  reads it the same way instead of each one re-deriving it. Omit for a
   *  panel that isn't about one specific device (e.g. a group/category view). */
  entityId?: string;
  icon?: ReactNode;
  /** Extra class on the modal card, for a panel that needs one of the app's
   *  OTHER standard widths (e.g. the group panel uses the Settings width). */
  className?: string;
  /** Small header-row action(s) — e.g. SummaryGroupPanel's "Turn all on/off"
   *  — right-aligned. Same idea as Settings' theme buttons sitting in ITS
   *  header instead of buried in the body: a panel's one or two most-used
   *  actions belong where they're always visible, not scrolled past. */
  headerActions?: ReactNode;
  /** The footer's leading action — Settings' "Advanced Settings" pattern
   *  (ModalFooter's `leading`): a way elsewhere that must stay visible
   *  however far the body scrolls. The Weather window's "History and trends". */
  footerLeading?: ReactNode;
  /** The history section: ONE slot, drawn by this chrome after the panel's
   *  own content and ABOVE "Also on this device", so every window orders them
   *  the same. Omitted → the shared on/off band (LastDayTimeline); a panel
   *  whose history the band cannot express passes its own chart HERE (a
   *  sensor's numbers, a group's series, a palette legend), never in its
   *  children — that is how the lock window came to show its readings above
   *  its chart while the sensor window showed them below (2.496.440). false
   *  only for a window with no single device (WindowPieces). The default is
   *  what guarantees a new panel type can't quietly ship without history. */
  history?: false | ReactNode;
  /** Opt OUT of "Also on this device" (PanelActions.readings) — only for a
   *  panel that already shows every reading of the device (DeviceGroupPanel). */
  deviceReadings?: false;
  onClose: () => void;
  children: ReactNode;
}

export default function BasePanel({ title, entityId, icon, className, headerActions, footerLeading, history, deviceReadings, onClose, children }: Props) {
  const { may, onEdit, onReportFault, badge, onSetBadgeColor, linked, linkedSensor, motion, back } = usePanelActions();
  const { resolvedRooms } = useConfig();
  const { entities } = useHA();
  const room = entityId ? deviceRoom(resolvedRooms, entityId) : "";
  const [colorOpen, setColorOpen] = useState(false);
  // Escape + focus trap + focus restore, from one place (see useModalA11y).
  // This replaced a local Escape-only listener: behind every one of these
  // panels sits the live villa canvas and HUD, so a Tab out of an open panel
  // used to walk straight into controls the user couldn't see behind the
  // scrim.
  // With somewhere to go back to, Escape and the phone's back gesture go back
  // (one step), as the Back button does; Close and a tap outside close.
  const dialogRef = useModalA11y(back ? back.go : onClose);
  // The header badge is a PNG baked from the theme's tokens and the tint below
  // is composited in JS, so neither re-themes through the cascade — a panel
  // left open across a dusk theme flip would keep its old-theme colours.
  const theme = useResolvedTheme();

  // The exact map badge for this device (glyph + colour), shown in the header.
  // Clickable — when the profile may edit config — to recolour just this badge.
  const canRecolor = badge && may.edit;
  const badgeImg = badge && (
    <img
      className="panel-badge-img"
      src={badgeImage({ category: badge.category, iconKey: badge.iconKey, state: badge.state, color: badge.color, ringState: badge.ringState })}
      key={theme}
      alt=""
      draggable={false}
    />
  );
  // Every control in this panel that expresses THIS DEVICE'S current state —
  // the big On button, the fan's selected speed, a climate mode chip — is
  // painted in the device's own category colour, from the same
  // categorySurface() call that paints the header badge above and its badge
  // out on the 3D map. Published once here rather than read per component:
  // the panel is the thing that knows which device is open, so a panel type
  // that grows another stateful control inherits the colour for free.
  //
  // It has to be a custom property rather than a class per category, because
  // `badge.color` is an arbitrary #rrggbb the user picked in the badge colour
  // editor — no fixed stylesheet could enumerate it. Absent (a group panel,
  // or a profile that can't see the badge) the CSS falls back to the accent.
  const deviceTint = badge && categorySurface(badge.category, "active", badge.color);

  const headerIcon = badge
    ? canRecolor
      ? (
        <button
          className="panel-badge-btn"
          onClick={() => setColorOpen(true)}
          title="Change icon colour"
          aria-label="Change icon colour"
        >
          {badgeImg}
        </button>
      )
      : <div className="panel-icon">{badgeImg}</div>
    : icon && <div className="panel-icon">{icon}</div>;

  return (
    <DialogLayer className="modal-backdrop panel-modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        // `device-details`: a window about ONE device fits its content (owner, 2026-10-20: the one height of 2.496.447
        // "wrongly applied to the Entity details ones … keep an adjusted height"); a list of devices keeps the one height
        className={`modal panel-modal${entityId ? " device-details" : ""}${className ? ` ${className}` : ""}`}
        style={deviceTint ? {
          ["--device-fill" as string]: deviceTint.fill,
          ["--device-ink" as string]: deviceTint.ink,
          ["--device-ring" as string]: deviceTint.ring,
        } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={room ? `${title}, ${room}` : title}
      >
        <div className="modal-header">
          <div className="title">
            {headerIcon}
            <div style={{ minWidth: 0 }}>
              {/* The window's first focus (useModalA11y's data-autofocus), not the
                  badge: the badge is the Owner's recolour BUTTON, and focusing it on
                  open drew the phone's own focus ring round it — an amber border
                  that read as a device state (owner, 2026-10-05). The heading is the
                  conventional dialog-open target; tabIndex={-1} keeps it out of Tab. */}
              <h2 title={title} tabIndex={-1} data-autofocus>{title}</h2>
              {room && <div className="room">{room}</div>}
            </div>
          </div>
          {(headerActions || back) && (
            <div className="modal-header-actions">
              {headerActions}
              {back && (
                <button type="button" className="btn panel-back" onClick={back.go}
                  title={`Back to ${back.label}`} aria-label={`Back to ${back.label}`}>
                  <ChevronLeft size={18} aria-hidden /> Back
                </button>
              )}
            </div>
          )}
        </div>
        <div className="modal-body">
          {/* The device's linked entity, if one is configured (Advanced
              Settings). Rendered HERE, in the shared chrome, so every panel
              type gets it identically the moment that field is set — this is
              what replaced the old camera-only long-press toggle. Reuses the
              same switch as the group modal's per-device rows rather than a
              second bespoke control. */}
          {linked && (
            <div className="panel-linked-row">
              <button
                className={`summary-entity-toggle${linked.isOn ? " on" : ""}`}
                {...linkedSwitchProps(linked)}
                title={linked.isOn ? "Turn off" : "Turn on"}
              >
                <span className="knob" />
              </button>
              <div style={{ minWidth: 0 }}>
                <div className="panel-linked-label" title={linked.label}>{linked.label}</div>
                <div className="muted" style={{ fontSize: "var(--text-2xs)" }}>
                  {linkedStateWords(linked)} · linked entity
                </div>
              </div>
            </div>
          )}
          {/* A linked SENSOR has nothing to switch: the same row, its band instead of a toggle (owner, 2026-10-21). */}
          {linkedSensor && <LinkedSensorRow entityId={linkedSensor.entityId} label={linkedSensor.label} />}
          {/* The camera's motion sensor, if one is configured (Advanced
              Settings' "Motion sensor" field) — read-only, unlike the linked-
              entity switch above: this reports HA's own state, it isn't
              something this panel can flip. Reuses the same plain status dot
              the connection indicator uses (.conn-dot) rather than the
              toggle control, so it doesn't read as tappable when it isn't. */}
          {motion && (
            <div className="panel-linked-row">
              <span className={`conn-dot${motion.isOn ? " online" : ""}`} style={{ marginRight: 10 }}>
                <span className="dot" />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="panel-linked-label" title={motion.label}>{motion.label}</div>
                <div className="muted" style={{ fontSize: "var(--text-2xs)" }}>
                  {motion.isOn ? "Motion detected" : "Clear"} · motion sensor
                </div>
              </div>
            </div>
          )}
          {children}
          {/* The "last N hours" history section — rendered HERE, in the shared
              chrome, for the same reason the linked-entity switch above is:
              so every panel about a device gets it identically and a NEW panel
              type cannot ship without it.

              It used to be opt-in, added per panel, and that is exactly how
              climate and media ended up as the only two device panels with no
              history at all — reported from a screenshot of an AC panel. The
              range-picker work that touched this area twice could not have
              caught it either, because it audited the panels that already HAD
              a timeline; a panel with none is invisible to that check. Made
              structural rather than fixed twice. A panel's own chart comes in
              through the same slot (the `history` prop), so it sits at the
              same place. */}
          {/* Not for an entity Home Assistant does not have: it has no history to wait for (its notice says why). */}
          {history !== false && entityId && !missingFromHa(entities, entityId)
            && (history ?? <LastDayTimeline entityId={entityId} />)}
          {/* The device's other readings — the same physical device, one place
              (2.496.260), always UNDER the history. A grouped lock kept only a
              read-only summary, and a pump plug's energy meter had no panel of
              its own to be found in. */}
          {deviceReadings !== false && <DeviceReadings />}
        </div>
        {/* The shared footer (ModalFooter): the left group is always there,
            empty or not, so Close sits right as in every dialog. */}
        <ModalFooter onClose={onClose} leading={
          <div className="modal-footer-group">
            {footerLeading}
            {may.edit && <button className="btn ghost" onClick={onEdit}>Edit</button>}
            {/* Icon-only, sitting beside Edit: this is a shortcut for a
                device you are already looking at, not a primary action, and
                a second worded button next to "Edit" would compete with it.
                The title/aria-label carry the meaning. */}
            {may.reportFault && (
              <button
                className="btn ghost icon-only"
                onClick={onReportFault}
                title="Report a fault for this device"
                aria-label="Report a fault for this device"
              ><Wrench size={16} /></button>
            )}
          </div>
        } />
      </div>

      {colorOpen && badge && may.edit && (
        <BadgeColorModal
          current={badge.color}
          categoryColor={badge.categoryColor}
          onChange={onSetBadgeColor}
          onClose={() => setColorOpen(false)}
        />
      )}
    </DialogLayer>
  );
}
