// src/components/settings/MarkerDialog.tsx
// Opens after tapping a spot in place mode: drop a floating control marker there,
// bound to an HA entity (existing OR an entity_id that will exist later).

import { useState } from "react";
import { X, MapPin } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { addMarker } from "@/config/markerUtils";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import type { EntityType, Vec3 } from "@/types/scene.types";

const TYPES: EntityType[] = [
  "light", "climate", "lock", "camera", "cover", "fan",
  "binary_sensor", "sensor", "media_player", "switch", "assist_satellite",
];

interface Props {
  point: Vec3;
  floor: number;
  onClose: () => void;
}

export default function MarkerDialog({ point, floor, onClose }: Props) {
  const { config, update } = useConfig();
  const { entities } = useHA();
  const [entityId, setEntityId] = useState<string>("");
  const [type, setType] = useState<EntityType | "">("");

  const effectiveType = (type || (entityId ? inferTypeFromEntityId(entityId) : null) || "") as EntityType | "";

  const save = () => {
    if (!entityId) return;
    update(addMarker(config, point, entityId, floor, effectiveType || undefined, entities[entityId]));
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2><MapPin size={22} /> Drop a control marker</h2>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <p className="sub">
          A floating control will be placed here and linked to an entity. Use this for
          devices that aren't separate objects in the model.
        </p>

        <label>Home Assistant entity</label>
        <EntityPicker value={entityId} onChange={setEntityId} allowCustom />
        <p className="muted body-text" style={{ marginTop: 6 }}>
          Tip: you can type an entity_id that doesn't exist yet (e.g. <code>light.kitchen</code>) —
          the marker activates automatically once that entity appears in HA.
        </p>

        <label>Behaviour (control type)</label>
        <select value={effectiveType} onChange={(e) => setType(e.target.value as EntityType)}>
          <option value="">{entityId ? "Auto from entity" : "Select…"}</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!entityId}>Place marker</button>
        </div>
      </div>
    </div>
  );
}
