// src/components/settings/ConfigEditor.tsx
// Metadata for entities that are auto-detected from GLB mesh names (the mesh is
// already named after the entity_id), plus a form to pre-configure entities for
// a future model upload. Entities bound via tap mode are NOT shown here — they
// appear (with inline settings) in the Bound 3D objects section below.
//
// Each row is its own React.memo'd component (EntityMapRow) with its own
// localized draft state — see that file's docstring for why: this used to be
// one flat draft Record per field living HERE, which meant a keystroke in any
// one row's Label field (or literally any HA state_changed event anywhere in
// the house, since `entities` below is read at this level) re-rendered the
// WHOLE table. Every callback passed down to rows (patch/remove/toggleExpanded/
// remap handlers) is given a STABLE identity — via useCallback reading the
// latest config through a ref, never closing over `config` directly — because
// React.memo's default shallow prop comparison only pays off if the props
// rows receive are actually referentially stable when nothing relevant to
// THEM changed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { createDefaultMapping } from "@/config/EntityMap";
import EntityPicker from "./EntityPicker";
import EntityMapRow from "./EntityMapRow";
import type { EntityMapping } from "@/types/scene.types";

export default function ConfigEditor({ initialSearch }: { initialSearch?: string } = {}) {
  const { config, update } = useConfig();
  const { entities } = useHA();
  const [newId, setNewId] = useState<string | undefined>(undefined);
  // Seed the filter when opened from a device panel's edit shortcut, so that
  // entity's row is shown immediately.
  const [search, setSearch] = useState(initialSearch ?? "");
  // Remap: which row's entity ID is currently being edited, and what new ID was picked.
  const [remapKey, setRemapKey] = useState<string | null>(null);
  const [remapNewId, setRemapNewId] = useState<string | undefined>(undefined);

  // Cards are collapsed by default (there can be a LOT of auto-detected
  // entities — no one wants to scroll past every field of every device just
  // to reach the next one). A card opened via a device panel's edit shortcut
  // starts expanded, since the whole point of that shortcut is to land right
  // on its fields.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set(initialSearch ? [initialSearch] : []),
  );
  const toggleExpanded = useCallback((key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    }), []);

  // Opened via a device panel's edit shortcut: scroll the modal straight to
  // THIS entity's card instead of leaving it at the top (Villa location / 3D
  // model source), which is what the surrounding modal scrolls to by default.
  // Ref'd on the matched row below; only fires once, and only for that entry
  // point — a manual search shouldn't yank the scroll position around.
  const matchedRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (initialSearch) matchedRowRef.current?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Stable-identity commit path: reads the LATEST config through a ref rather
  // than closing over `config` directly, so `patch`'s own function identity
  // never changes — every row receives the exact same `onPatch` reference on
  // every ConfigEditor render, which is what lets React.memo actually skip
  // re-rendering rows that a given edit doesn't touch (patch()'s shallow
  // spread also preserves reference equality for every OTHER entry in
  // entityMap, so their `mapping` prop stays stable too).
  const configRef = useRef(config);
  configRef.current = config;
  const patch = useCallback((key: string, change: Partial<EntityMapping>) =>
    update({
      entityMap: {
        ...configRef.current.entityMap,
        [key]: { ...configRef.current.entityMap[key], ...change },
      },
    }), [update]);

  const remove = useCallback((key: string) => {
    const next = { ...configRef.current.entityMap };
    delete next[key];
    update({ entityMap: next });
  }, [update]);

  /**
   * Redirect a GLB mesh (named oldKey) to a different HA entity (newId) without
   * rebuilding the model. Works by:
   *  1. Adding a mesh binding: meshBindings[oldKey] = newId
   *  2. Renaming the entityMap entry to newId
   *  3. Removing the old entityMap entry
   * The 3D mesh stays in the scene — only the entity it controls changes.
   */
  const remapEntity = useCallback((oldKey: string, newId: string) => {
    if (!newId || newId === oldKey) return;
    const oldEntry = configRef.current.entityMap[oldKey];
    if (!oldEntry) return;
    const { [oldKey]: _removed, ...restMap } = configRef.current.entityMap;
    update({
      entityMap: { ...restMap, [newId]: { ...oldEntry, entityId: newId } },
      meshBindings: { ...configRef.current.meshBindings, [oldKey]: newId },
    });
    setRemapKey(null);
    setRemapNewId(undefined);
  }, [update]);

  const startRemap = useCallback((key: string) => { setRemapKey(key); setRemapNewId(undefined); }, []);
  const cancelRemap = useCallback(() => { setRemapKey(null); setRemapNewId(undefined); }, []);

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
              <th>Shown</th>
              <th>Entity ID</th>
              <th>Type</th>
              <th>Category</th>
              <th>Label</th>
              <th>Room</th>
              <th>Linked entity</th>
              <th>Motion sensor</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, m0]) => (
              <EntityMapRow
                key={key}
                entryKey={key}
                mapping={m0}
                entity={entities[key]}
                expanded={expandedKeys.has(key)}
                editing={remapKey === key}
                remapNewId={remapKey === key ? remapNewId : undefined}
                roomNames={roomNames}
                matchedRowRef={key === initialSearch ? matchedRowRef : undefined}
                onToggleExpanded={toggleExpanded}
                onStartRemap={startRemap}
                onRemapChange={setRemapNewId}
                onRemapApply={remapEntity}
                onRemapCancel={cancelRemap}
                onRemove={remove}
                onPatch={patch}
              />
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
