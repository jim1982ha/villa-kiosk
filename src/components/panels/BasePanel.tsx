// src/components/panels/BasePanel.tsx
// Shared modal wrapper for device panels: centered dialog (not a bottom
// sheet), backdrop-dismiss + Escape, header with icon/title/room/entity id.
// Edit/Close live in a FOOTER (not the header) so a long device name always
// gets the header's full width instead of fighting two buttons for room.

import { useEffect, type ReactNode } from "react";
import { X, Pencil } from "lucide-react";
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
              <h2>{title}</h2>
              {room && <div className="room">{room}</div>}
              {entityId && <div className="panel-entity-id" title={entityId}>{entityId}</div>}
            </div>
          </div>
        </div>
        <div className="panel-body">{children}</div>
        <div className="panel-footer">
          {onEdit && (
            <button className="btn ghost" onClick={onEdit}>
              <Pencil size={16} /> Edit
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            <X size={16} /> Close
          </button>
        </div>
      </div>
    </div>
  );
}
