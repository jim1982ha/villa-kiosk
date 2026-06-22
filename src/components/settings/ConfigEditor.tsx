// src/components/settings/ConfigEditor.tsx
// Map mesh names / entity IDs to panel types & labels at runtime (no code edit).
// Also lets you add a brand-new mapping for an entity that was added to HA.

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import type { EntityMapping, EntityType } from "@/types/scene.types";

const TYPES: EntityType[] = [
  "light", "climate", "lock", "camera", "cover", "fan",
  "binary_sensor", "sensor", "media_player", "switch", "assist_satellite",
];

export default function ConfigEditor() {
  const { config, update } = useConfig();
  const entries = Object.entries(config.entityMap);
  const [newId, setNewId] = useState("");

  const patch = (key: string, change: Partial<EntityMapping>) => {
    const next = { ...config.entityMap, [key]: { ...config.entityMap[key], ...change } };
    update({ entityMap: next });
  };

  const remove = (key: string) => {
    const next = { ...config.entityMap };
    delete next[key];
    update({ entityMap: next });
  };

  const add = () => {
    const id = newId.trim();
    if (!id || config.entityMap[id]) return;
    const type = inferTypeFromEntityId(id) ?? "sensor";
    update({
      entityMap: {
        ...config.entityMap,
        [id]: { entityId: id, type, label: id.split(".")[1] ?? id, room: "Unmapped" },
      },
    });
    setNewId("");
  };

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <input
          style={{ flex: 1, padding: 10, borderRadius: 8, background: "var(--bg-input)", color: "var(--text-primary)", border: "none" }}
          placeholder="new entity_id e.g. switch.pool_pump"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
        />
        <button className="btn primary" onClick={add}><Plus size={18} /> Add</button>
      </div>

      <table className="config-table">
        <thead>
          <tr>
            <th>Entity ID</th>
            <th>Type</th>
            <th>Label</th>
            <th>Room</th>
            <th>Confirm</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, m]) => (
            <tr key={key}>
              <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{m.entityId}</td>
              <td>
                <select value={m.type} onChange={(e) => patch(key, { type: e.target.value as EntityType })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td><input value={m.label} onChange={(e) => patch(key, { label: e.target.value })} /></td>
              <td><input value={m.room} onChange={(e) => patch(key, { room: e.target.value })} /></td>
              <td className="center">
                <input
                  type="checkbox"
                  checked={!!m.requiresConfirmation}
                  onChange={(e) => patch(key, { requiresConfirmation: e.target.checked })}
                />
              </td>
              <td>
                <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => remove(key)}>
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
