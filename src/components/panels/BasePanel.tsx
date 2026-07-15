// src/components/panels/BasePanel.tsx
// Shared bottom-sheet wrapper: backdrop, drag-to-dismiss handle, header.

import { useRef, type ReactNode } from "react";
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
  const startY = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { entityId, onEdit } = usePanelActions();

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div
        className="panel"
        ref={panelRef}
        onPointerDown={(e) => {
          // Only start a drag from the handle area (top 40px).
          if (e.nativeEvent.offsetY < 40) startY.current = e.clientY;
        }}
        onPointerMove={(e) => {
          if (startY.current === null || !panelRef.current) return;
          const dy = Math.max(0, e.clientY - startY.current);
          panelRef.current.style.transform = `translateY(${dy}px)`;
        }}
        onPointerUp={(e) => {
          if (startY.current === null || !panelRef.current) return;
          const dy = e.clientY - startY.current;
          panelRef.current.style.transform = "";
          startY.current = null;
          if (dy > 110) onClose();
        }}
      >
        <div className="panel-handle" />
        <div className="panel-header">
          <div className="title">
            {icon && <div className="panel-icon">{icon}</div>}
            <div>
              <h2>{title}</h2>
              {room && <div className="room">{room}</div>}
              {entityId && <div className="panel-entity-id" title={entityId}>{entityId}</div>}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {onEdit && (
              <button
                className="icon-btn"
                onClick={onEdit}
                title="Edit this device in Advanced Settings"
                aria-label="Edit this device in Advanced Settings"
              >
                <Pencil size={18} />
              </button>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </>
  );
}
