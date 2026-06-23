// src/components/settings/ConfigEditor.tsx
// Metadata for entities that are auto-detected from GLB mesh names (the mesh is
// already named after the entity_id), plus a form to pre-configure entities for
// a future model upload. Entities bound via tap mode are NOT shown here — they
// appear (with inline settings) in the Bound 3D objects section below.

import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import EntityPicker from "./EntityPicker";
import type { EntityMapping, EntityType } from "@/types/scene.types";

const TYPES: EntityType[] = [
  "light", "climate", "lock", "camera", "cover", "fan",
  "binary_sensor", "sensor", "media_player", "switch", "input_boolean",
  "assist_satellite",
];

export default function ConfigEditor() {
  const { config, update } = useConfig();
  const { entities } = useHA();
  const [newId, setNewId] = useState<string | undefined>(undefined);
  // Remap: which row's entity ID is currently being edited, and what new ID was picked.
  const [remapKey, setRemapKey] = useState<string | null>(null);
  const [remapNewId, setRemapNewId] = useState<string | undefined>(undefined);

  // Only show entities that are NOT already handled by a mesh binding.
  const boundEntityIds = useMemo(
    () => new Set(Object.values(config.meshBindings)),
    [config.meshBindings],
  );
  const entries = useMemo(
    () => Object.entries(config.entityMap).filter(([key]) => !boundEntityIds.has(key)),
    [config.entityMap, boundEntityIds],
  );

  const patch = (key: string, change: Partial<EntityMapping>) =>
    update({ entityMap: { ...config.entityMap, [key]: { ...config.entityMap[key], ...change } } });

  const remove = (key: string) => {
    const next = { ...config.entityMap };
    delete next[key];
    update({ entityMap: next });
  };

  /**
   * Redirect a GLB mesh (named oldKey) to a different HA entity (newId) without
   * rebuilding the model. Works by:
   *  1. Adding a mesh binding: meshBindings[oldKey] = newId
   *  2. Renaming the entityMap entry to newId
   *  3. Removing the old entityMap entry
   * The 3D mesh stays in the scene — only the entity it controls changes.
   */
  const remapEntity = (oldKey: string, newId: string) => {
    if (!newId || newId === oldKey) return;
    const oldEntry = config.entityMap[oldKey];
    if (!oldEntry) return;
    const { [oldKey]: _removed, ...restMap } = config.entityMap;
    update({
      entityMap: { ...restMap, [newId]: { ...oldEntry, entityId: newId } },
      meshBindings: { ...config.meshBindings, [oldKey]: newId },
    });
  };

  const add = (id: string) => {
    if (!id || config.entityMap[id]) return;
    const type = inferTypeFromEntityId(id) ?? "sensor";
    const entity = entities[id];
    update({
      entityMap: {
        ...config.entityMap,
        [id]: {
          entityId: id,
          type,
          label: entity?.attributes.friendly_name ?? id.split(".")[1]?.replace(/_/g, " ") ?? id,
          room: "",
        },
      },
    });
    setNewId(undefined);
  };

  return (
    <div>
      <p className="muted body-text" style={{ marginBottom: 16 }}>
        Entities listed here are auto-detected because their 3D object in the
        model is already named with the entity ID (e.g.{" "}
        <code style={{ fontSize: 11 }}>camera.patio_1f_cam</code>). Edit the
        display name, room or panel type without reloading the model.
      </p>

      {entries.length === 0 && (
        <p className="muted body-text mt">
          No auto-detected entities yet. Upload a GLB whose objects are named
          after HA entity IDs, or pre-configure one below.
        </p>
      )}

      {entries.length > 0 && (
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
                <td data-label="Entity ID" style={{ fontSize: 12, wordBreak: "break-all" }}>
                  {remapKey === key ? (
                    /* ── inline remap picker ── */
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200 }}>
                      <EntityPicker
                        value={remapNewId}
                        onChange={setRemapNewId}
                        allowCustom
                        hideCurrentLabel
                        placeholder="New entity ID…"
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn primary"
                          style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
                          disabled={!remapNewId || remapNewId === key}
                          onClick={() => {
                            if (remapNewId) remapEntity(key, remapNewId);
                            setRemapKey(null);
                            setRemapNewId(undefined);
                          }}
                        >
                          <Check size={13} /> Apply
                        </button>
                        <button
                          className="btn ghost"
                          style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
                          onClick={() => { setRemapKey(null); setRemapNewId(undefined); }}
                        >
                          <X size={13} /> Cancel
                        </button>
                      </div>
                      <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                        Mesh stays, entity ID changes — no model rebuild needed.
                      </span>
                    </div>
                  ) : (
                    <span
                      style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                      title="Click the pencil to redirect this mesh to a different entity ID"
                    >
                      {m.entityId}
                      <button
                        className="icon-btn"
                        style={{ width: 24, height: 24, flexShrink: 0 }}
                        title="Redirect this 3D mesh to a different entity ID"
                        onClick={() => { setRemapKey(key); setRemapNewId(undefined); }}
                      >
                        <Pencil size={12} />
                      </button>
                    </span>
                  )}
                </td>
                <td data-label="Type">
                  <select
                    value={m.type}
                    onChange={(e) => patch(key, { type: e.target.value as EntityType })}
                  >
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td data-label="Label"><input value={m.label} onChange={(e) => patch(key, { label: e.target.value })} /></td>
                <td data-label="Room"><input value={m.room} onChange={(e) => patch(key, { room: e.target.value })} /></td>
                <td data-label="Confirm" className="center">
                  <input
                    type="checkbox"
                    checked={!!m.requiresConfirmation}
                    onChange={(e) => patch(key, { requiresConfirmation: e.target.checked })}
                  />
                </td>
                <td data-label="">
                  <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => remove(key)}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pre-configure a new entity */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
          Pre-configure a new entity
        </label>
        <p className="muted body-text" style={{ fontSize: 11, marginBottom: 10 }}>
          Sets the label, room and panel type for an entity whose 3D object is
          named after its entity ID. Useful to configure in advance — it
          activates automatically when the matching model is uploaded.
        </p>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <EntityPicker
              value={newId}
              onChange={(id) => setNewId(id)}
              allowCustom
              hideCurrentLabel
              placeholder="Search or type entity_id…"
            />
            {newId && (
              <div className="muted body-text" style={{ marginTop: 6, fontSize: 12 }}>
                Selected: <strong style={{ color: "var(--accent)" }}>{newId}</strong>
                {config.entityMap[newId] && (
                  <span style={{ marginLeft: 8, color: "var(--status-danger, #c0504d)" }}>
                    already configured
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            className="btn primary"
            onClick={() => newId && add(newId)}
            disabled={!newId || !!config.entityMap[newId]}
            style={{ flexShrink: 0 }}
          >
            <Plus size={18} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
