// src/components/panels/BasePanel.tsx
// Shared modal wrapper for device panels: centered dialog (not a bottom
// sheet), backdrop-dismiss + Escape, header with icon/title/room/entity id
// and a plain X dismiss button. Edit lives in the FOOTER, right-aligned —
// title truncates with an ellipsis (see .panel-header .title h2 in
// styles.css) instead of fighting a footer button for room.

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { usePanelActions } from "./PanelActionsContext";

interface Props {
  title: string;
  room?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export default function BasePanel({ title, room, icon, onClose, children }: Props) {
  const { entityId, onEdit } = usePanelActions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop panel-modal-backdrop" onClick={onClose}>
      <div className="modal panel-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="title">
            {icon && <div className="panel-icon">{icon}</div>}
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
    </div>
  );
}
