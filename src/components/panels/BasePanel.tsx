// src/components/panels/BasePanel.tsx
// Shared modal wrapper for device panels: centered dialog (not a bottom
// sheet), backdrop-dismiss + Escape, header with icon/title/room/entity id
// and a plain X dismiss button. Edit lives in the FOOTER, right-aligned —
// title truncates with an ellipsis (see .panel-header .title h2 in
// styles.css) instead of fighting a footer button for room.

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { usePanelActions } from "./PanelActionsContext";
import { badgeImageDataUrl } from "@/babylon/badgeIcons";
import BadgeColorModal from "./BadgeColorModal";

interface Props {
  title: string;
  room?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export default function BasePanel({ title, room, icon, onClose, children }: Props) {
  const { entityId, onEdit, badge, onSetBadgeColor } = usePanelActions();
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
      className="panel-badge-img"
      src={badgeImageDataUrl(badge.category, badge.iconKey, badge.color)}
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
      <div className="modal panel-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="title">
            {headerIcon}
            <div style={{ minWidth: 0 }}>
              <h2 title={title}>{title}</h2>
              {room && <div className="room">{room}</div>}
              {entityId && <div className="panel-entity-id" title={entityId}>{entityId}</div>}
            </div>
          </div>
          <button className="panel-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="panel-body">{children}</div>
        {onEdit && (
          <div className="panel-footer">
            <button className="btn ghost" onClick={onEdit}>Edit</button>
          </div>
        )}
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
