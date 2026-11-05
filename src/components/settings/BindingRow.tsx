// src/components/settings/BindingRow.tsx
// One row of BindingsTable's bound-objects list: the 3D object, the entity it
// shows, and Unlink — the LINK only. The device's name and display settings
// are edited in ONE place, its row in Devices (config/deviceRecord; architecture
// review 2026-10-12): this row used to carry the same fields (MappingFields), a
// second editor for the same record. React.memo'd, as EntityMapRow.

import { Unlink, Link2 } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { memo } from "react";
import IdText from "@/components/common/IdText";
import Tip from "@/components/common/Tip";

interface Props {
  mesh: string;
  entityId: string;
  onBind: (mesh: string, entityId: string) => void;
  onUnbind: (mesh: string) => void;
}

function BindingRow({ mesh, entityId, onBind, onUnbind }: Props) {
  return (
    // ⚠️ ONE ROW SHAPE WITH THE UNBOUND OBJECTS' (.binding-row): the object, its entity, its small icon; on a phone the
    // object's name over the other two, never a picker pushed past the window's edge (owner, 2026-11-06)
    <div className="binding-row">
      <div className="binding-row-object">
        <Link2 size={16} style={{ flexShrink: 0, opacity: 0.5 }} />
        <span style={{ minWidth: 0 }}><IdText id={mesh} /></span>
      </div>
      <div className="binding-row-entity">
        <EntityPicker value={entityId} onChange={(id) => onBind(mesh, id)} allowCustom />
      </div>
      <Tip text="Remove binding">
        <button type="button" className="icon-btn-sm danger" onClick={() => onUnbind(mesh)} aria-label="Remove binding">
          <Unlink size={16} aria-hidden />
        </button>
      </Tip>
    </div>
  );
}

export default memo(BindingRow);
