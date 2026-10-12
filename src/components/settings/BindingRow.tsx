// src/components/settings/BindingRow.tsx
// One row of BindingsTable's bound-objects list: the 3D object, the entity it
// shows, and Unlink — the LINK only. The device's name and display settings
// are edited in ONE place, its row in Devices (config/deviceRecord; architecture
// review 2026-10-12): this row used to carry the same fields (MappingFields), a
// second editor for the same record. React.memo'd, as EntityMapRow.

import { Unlink, Link2 } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { memo } from "react";

interface Props {
  mesh: string;
  entityId: string;
  onBind: (mesh: string, entityId: string) => void;
  onUnbind: (mesh: string) => void;
}

function BindingRow({ mesh, entityId, onBind, onUnbind }: Props) {
  return (
    <div style={{ padding: "14px 0", borderTop: "1px solid var(--hairline)" }}>
      {/* Row 1 — object ↔ entity */}
      <div className="row spread" style={{ gap: 12 }}>
        <div
          style={{
            flex: "0 0 34%", fontSize: "var(--text-xs)", color: "var(--text-secondary)",
            wordBreak: "break-all", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <Link2 size={16} style={{ flexShrink: 0, opacity: 0.5 }} />
          {mesh}
        </div>
        <div style={{ flex: 1 }}>
          <EntityPicker value={entityId} onChange={(id) => onBind(mesh, id)} allowCustom />
        </div>
        <button
          className="icon-btn"
          style={{ width: 36, height: 36 }}
          onClick={() => onUnbind(mesh)}
          title="Remove binding"
        >
          <Unlink size={16} />
        </button>
      </div>

    </div>
  );
}

export default memo(BindingRow);
