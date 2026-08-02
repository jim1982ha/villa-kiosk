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

import { useEffect, useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { usePanelActions } from "./PanelActionsContext";
import { badgeImageDataUrl } from "@/babylon/badgeIcons";
import BadgeColorModal from "./BadgeColorModal";

interface Props {
  title: string;
  room?: string;
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

export default function BasePanel({ title, room, icon, className, headerActions, onClose, children }: Props) {
  const { onEdit, onReportFault, badge, onSetBadgeColor, linked } = usePanelActions();
  const [colorOpen, setColorOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The exact map badge for this device (glyph + colour), shown in the header.
  // Clickable — when the profile may edit config — to recolour just this badge.
  const canRecolor = badge && onSetBadgeColor;
  const badgeImg = badge && (
    <img
      // .is-alert draws the same red ring the map badge gets for an
      // active/alerting device (see badge.alertRing's docstring in
      // PanelActionsContext) — a camera whose linked motion sensor is
      // currently on, so far the only producer of this flag.
      className={`panel-badge-img${badge.alertRing ? " is-alert" : ""}`}
      src={badgeImageDataUrl(badge.category, badge.iconKey, badge.color, 0, badge.unavailable)}
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
      <div className={`modal panel-modal${className ? ` ${className}` : ""}`} onClick={(e) => e.stopPropagation()}>
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
                <div className="muted" style={{ fontSize: 11 }}>
                  {linked.isOn ? "On" : "Off"} · linked entity
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
