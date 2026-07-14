// src/components/settings/ConfigEditor.tsx
// Metadata for entities that are auto-detected from GLB mesh names (the mesh is
// already named after the entity_id), plus a form to pre-configure entities for
// a future model upload. Entities bound via tap mode are NOT shown here — they
// appear (with inline settings) in the Bound 3D objects section below.

import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Check, X, Search } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { createDefaultMapping } from "@/config/EntityMap";
import { CATEGORY_ORDER, CATEGORY_LABELS, categoryForEntity } from "@/config/EntityCategories";
import EntityPicker from "./EntityPicker";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";

const TYPES: EntityType[] = [
  "light", "climate", "lock", "camera", "cover", "fan",
  "binary_sensor", "sensor", "media_player", "switch", "input_boolean",
  "assist_satellite",
];

export default function ConfigEditor() {
  const { config, update } = useConfig();
  const { entities } = useHA();
  const [newId, setNewId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  // Remap: which row's entity ID is currently being edited, and what new ID was picked.
  const [remapKey, setRemapKey] = useState<string | null>(null);
  const [remapNewId, setRemapNewId] = useState<string | undefined>(undefined);

  // Only show entities that are NOT already handled by a mesh binding.
  const boundEntityIds = useMemo(
    () => new Set(Object.values(config.meshBindings)),
    [config.meshBindings],
  );
  const allEntries = useMemo(
    () => Object.entries(config.entityMap).filter(([key]) => !boundEntityIds.has(key)),
    [config.entityMap, boundEntityIds],
  );
  // Live filter by entity id, label or room — the auto-detected list is long.
  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter(([key, m]) =>
      key.toLowerCase().includes(q)
      || (m.label ?? "").toLowerCase().includes(q)
      || (m.room ?? "").toLowerCase().includes(q));
  }, [allEntries, search]);

  // The "Room" field is matched EXACTLY (case/whitespace aside) against a real
  // room's name by RoomHighlight. Offer the real rooms as a proper dropdown so
  // there's nothing to mistype — sourced from BOTH the calibrated viewpoints
  // (teleportPoints) AND the parsed .sh3d rooms, so the list is populated even
  // before calibration has run. A row's current value is always kept in the
  // list even if it no longer matches a known room, so editing it never drops
  // an existing binding.
  const roomNames = useMemo(
    () => Array.from(new Set([
      ...config.teleportPoints.map((p) => p.name),
      ...(config.sh3dRooms ?? []).map((r) => r.name),
    ].filter(Boolean))).sort(),
    [config.teleportPoints, config.sh3dRooms],
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
    update({
      entityMap: {
        ...config.entityMap,
        [id]: createDefaultMapping(id, { friendlyName: entities[id]?.attributes.friendly_name }),
      },
    });
    setNewId(undefined);
  };

  return (
    <div>
      <p className="muted body-text" style={{ marginBottom: 12 }}>
        Entities listed here are auto-detected because their 3D object in the
        model is already named with the entity ID (e.g.{" "}
        <code style={{ fontSize: 11 }}>camera.patio_1f_cam</code>). Edit the
        display name, room or panel type without reloading the model.
      </p>

      {allEntries.length > 0 && (
        <div className="config-search">
          <Search size={16} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by entity ID, label or room…"
            aria-label="Filter entities"
          />
        </div>
      )}

      {allEntries.length === 0 && (
        <p className="muted body-text mt">
          No auto-detected entities yet. Upload a GLB whose objects are named
          after HA entity IDs, or pre-configure one below.
        </p>
      )}

      {allEntries.length > 0 && entries.length === 0 && (
        <p className="muted body-text mt">No entities match “{search}”.</p>
      )}

      {entries.length > 0 && (
        <table className="config-table">
          <thead>
            <tr>
              <th>Entity ID</th>
              <th>Type</th>
              <th>Category</th>
              <th>Label</th>
              <th>Room</th>
              <th>Motion sensor</th>
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
                    <span className="entity-id-display" title="Use the pencil to redirect this mesh to a different entity ID">
                      <span className="entity-id-text">{m.entityId}</span>
                      <span className="entity-id-actions">
                        <button
                          className="icon-btn"
                          title="Redirect this 3D mesh to a different entity ID"
                          onClick={() => { setRemapKey(key); setRemapNewId(undefined); }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-btn icon-btn-danger"
                          title="Remove this entity"
                          onClick={() => remove(key)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
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
                <td data-label="Category">
                  <select
                    value={m.category ?? categoryForEntity(m.entityId, m.type)}
                    onChange={(e) => patch(key, { category: e.target.value as Category })}
                    title="Which map filter group this device belongs to"
                  >
                    {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                </td>
                <td data-label="Label"><input value={m.label} onChange={(e) => patch(key, { label: e.target.value })} /></td>
                <td data-label="Room">
                  <select
                    value={m.room ?? ""}
                    onChange={(e) => patch(key, { room: e.target.value })}
                    title="Room this device is in — used for motion-glow and teleport. Pick from the villa's detected rooms."
                  >
                    <option value="">— none —</option>
                    {/* Keep the current value selectable even if it's not (or
                        no longer) a known room, so editing never silently drops
                        an existing binding. */}
                    {m.room && !roomNames.includes(m.room) && (
                      <option value={m.room}>{m.room} (custom)</option>
                    )}
                    {roomNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td data-label="Motion sensor" style={{ minWidth: 180 }}>
                  {m.type === "camera" ? (
                    <EntityPicker
                      value={m.motionEntityId}
                      onChange={(id) => patch(key, { motionEntityId: id })}
                      domains={["binary_sensor"]}
                      allowCustom
                      hideCurrentLabel
                    />
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pre-configure a new entity */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
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
