// src/components/settings/BindDialog.tsx
// Opens when an object is tapped in bind mode: assign it to a live HA entity.

import { useState } from "react";
import { X, Link2, Unlink } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { upsertBinding, removeBinding } from "@/config/bindingUtils";

interface Props {
  meshName: string;
  onClose: () => void;
}

export default function BindDialog({ meshName, onClose }: Props) {
  const { config, update } = useConfig();
  const { entities } = useHA();
  const existing = config.meshBindings[meshName];
  const [entityId, setEntityId] = useState<string | undefined>(existing);

  const save = () => {
    if (!entityId) return;
    update(upsertBinding(config, meshName, entityId, entities[entityId]));
    onClose();
  };

  const unbind = () => {
    update(removeBinding(config, meshName));
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2><Link2 size={22} /> Bind object</h2>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <p className="sub">
          3D object: <strong style={{ color: "var(--text-primary)" }}>{meshName}</strong>
        </p>

        <label>Assign to Home Assistant entity</label>
        <EntityPicker value={entityId} onChange={setEntityId} allowCustom />
        <p className="muted body-text" style={{ marginTop: 6 }}>
          Not connected to HA yet? You can still type an exact entity_id
          (e.g. <code>light.living_room</code>) — it'll activate when HA connects.
        </p>

        <div className="modal-actions">
          {existing && (
            <button className="btn ghost danger" onClick={unbind}>
              <Unlink size={16} /> Unbind
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!entityId}>Save binding</button>
        </div>
      </div>
    </div>
  );
}
