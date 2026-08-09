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
// .panel-header .title h2 in styles.css) instead of fighting a footer button
// for room.

import { useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { usePanelActions } from "./PanelActionsContext";
import { badgeImageDataUrl } from "@/babylon/badgeIcons";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useConfig } from "@/config/ConfigContext";
import BadgeColorModal from "./BadgeColorModal";

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
  onClose: () => void;
  children: ReactNode;
}

export default function BasePanel({ title, entityId, icon, className, headerActions, onClose, children }: Props) {
  const { onEdit, onReportFault, badge, onSetBadgeColor, linked, motion } = usePanelActions();
  const { resolvedRooms } = useConfig();
  const room = entityId ? resolvedRooms[entityId] : undefined;
  const [colorOpen, setColorOpen] = useState(false);
  // Escape + focus trap + focus restore, from one place (see useModalA11y).
  // This replaced a local Escape-only listener: behind every one of these
  // panels sits the live villa canvas and HUD, so a Tab out of an open panel
  // used to walk straight into controls the user couldn't see behind the
  // scrim.
  const dialogRef = useModalA11y(onClose);

  // The exact map badge for this device (glyph + colour), shown in the header.
  // Clickable — when the profile may edit config — to recolour just this badge.
  const canRecolor = badge && onSetBadgeColor;
  const badgeImg = badge && (
    <img
      className="panel-badge-img"
      src={badgeImageDataUrl(badge.category, badge.iconKey, badge.state, badge.color, 0)}
      alt=""
      draggable={false}
    />
  );
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
    <div className="modal-backdrop panel-modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`modal panel-modal${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={room ? `${title}, ${room}` : title}
      >
        <div className="panel-header">
          <div className="title">
            {headerIcon}
            <div style={{ minWidth: 0 }}>
              <h2 title={title}>{title}</h2>
              {room && <div className="room">{room}</div>}
            </div>
          </div>
          {headerActions && <div className="panel-header-actions">{headerActions}</div>}
        </div>
        <div className="panel-body">
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
                onClick={linked.toggle}
                role="switch"
                aria-checked={linked.isOn}
                aria-label={`${linked.label}: ${linked.isOn ? "on" : "off"}`}
                title={linked.isOn ? "Turn off" : "Turn on"}
              >
                <span className="knob" />
              </button>
              <div style={{ minWidth: 0 }}>
                <div className="panel-linked-label" title={linked.label}>{linked.label}</div>
                <div className="muted" style={{ fontSize: "var(--text-2xs)" }}>
                  {linked.isOn ? "On" : "Off"} · linked entity
                </div>
              </div>
            </div>
          )}
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
        </div>
        <div className="panel-footer"
          style={{ justifyContent: onEdit || onReportFault ? "space-between" : "flex-end" }}>
          <div className="panel-footer-left">
            {onEdit && <button className="btn ghost" onClick={onEdit}>Edit</button>}
            {/* Icon-only, sitting beside Edit: this is a shortcut for a
                device you are already looking at, not a primary action, and
                a second worded button next to "Edit" would compete with it.
                The title/aria-label carry the meaning. */}
            {onReportFault && (
              <button
                className="btn ghost icon-only"
                onClick={onReportFault}
                title="Report a fault for this device"
                aria-label="Report a fault for this device"
              ><Wrench size={16} /></button>
            )}
          </div>
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>

      {colorOpen && badge && onSetBadgeColor && (
        <BadgeColorModal
          current={badge.color}
          categoryColor={badge.categoryColor}
          onChange={onSetBadgeColor}
          onClose={() => setColorOpen(false)}
        />
      )}
    </div>
  );
}
