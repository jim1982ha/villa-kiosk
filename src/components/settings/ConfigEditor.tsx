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
// WHOLE table. Every callback passed down to rows (remove/toggleExpanded/
// remap handlers) is given a STABLE identity — via useCallback reading the
// latest config through a ref, never closing over `config` directly — because
// React.memo's default shallow prop comparison only pays off if the props
// rows receive are actually referentially stable when nothing relevant to
// THEM changed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShowAll, useTruncated } from "@/components/common/TruncatedList";
import { Search } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { forgetMappings, repointDevice } from "@/config/mappingEdits";
import { matchesQuery, rowMatches } from "@/config/deviceRecord";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useHA } from "@/ha/HAStateStore";
import { useVillaModel } from "@/config/VillaModel";
import EntityMapRow from "./EntityMapRow";
import EntityPicker from "./EntityPicker";
import { deviceRoom } from "@/config/devicePlace";
import { countOf } from "@/utils/countOf";

export default function ConfigEditor({ initialSearch }: { initialSearch?: string } = {}) {
  const { update, resolvedRooms } = useConfig();
  const { entities } = useHA();
  const villa = useVillaModel();
  const { sceneEntityIds } = villa;
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

  // EVERY stored device, one row each (config/deviceRecord), and what is missing — the villa model's ONE answer
  // (dismissedEntities.inventoryGaps): `staleIds` are rows Home Assistant does not have and the model does not name
  // ("Remove N"); `orphanIds` objects the model names whose entity Home Assistant does not have (never removable,
  // listed below with "Point it there"). Both empty until Home Assistant's list is loaded. This screen wrote that
  // rule itself until 2.496.351 — a third copy beside the dismissal and the orphan list.
  const { rows: allRows, stale: staleIds, orphans: orphanIds } = villa.settings;
  const staleSet = useMemo(() => new Set(staleIds), [staleIds]);

  // Both Remove buttons on this screen go through the ONE operation — see
  // dismissedEntities.forgetEntities. The decision is recorded alongside the
  // deletion because these ids are also derived from the model (a mesh named
  // after the entity), so deleting alone regenerated every one of them: the
  // reported "I press Remove and they come straight back, on this device and
  // the others".
  const removeStale = useCallback(() => update(forgetMappings(staleIds)), [staleIds, update]);

  // Live filter by entity id, the NAME THE MAP SHOWS, room, or a linked object (deviceRecord.rowMatches):
  // it filtered on the stored label, entity-id fallbacks included, which nobody sees.
  const entityLabel = useEntityLabel();
  const entries = useMemo(
    () => allRows.filter((r) => rowMatches(r, search, entityLabel(r.id), deviceRoom(resolvedRooms, r.id))),
    [allRows, search, entityLabel, resolvedRooms],
  );

  // ⚠️ THE FIRST FEW, NOT A COLLAPSE, and applied AFTER the filter above — so
  // typing narrows the list and the top of the RESULTS is what shows. This
  // table used to sit behind a collapse toggle, so the section opened on a
  // heading and nothing else, and the number of entities was invisible until
  // you clicked.
  const shown = useTruncated(entries);

  // Stable-identity commit path: every edit is computed from the LATEST
  // config inside update() (config/mappingEdits.ts), so these callbacks close
  // over nothing that changes — every row receives the exact same callbacks
  // on every ConfigEditor render, which is what lets React.memo skip
  // re-rendering rows a given edit doesn't touch (the edit's shallow spread
  // also keeps every OTHER entry's `mapping` prop reference-equal). A row's
  // own field edits wait in the dialog's pending store (MappingFields).

  // ⚠️ THE SAME OPERATION AS THE BANNER ABOVE, AND IT USED NOT TO BE. This
  // deleted the row and recorded nothing, so it could not deliver the removal
  // it offered: a live entity's row is rebuilt by auto-detection on the next
  // model load, and a stale one merely disappeared from THIS table while
  // staying in the fault picker, the offline count and readiness.
  const remove = useCallback((key: string) => update(forgetMappings([key])), [update]);

  /** "Change entity": the device's objects and settings move to another entity, without rebuilding
   *  the model — mappingEdits.repointDevice, the one edit for it. */
  // Latest entities for the stable callback below (its HA name seeds a device made from nothing).
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const remapEntity = useCallback((oldKey: string, newId: string) => {
    if (!newId || newId === oldKey) return;
    update(repointDevice(oldKey, newId, entitiesRef.current[newId]));
    setRemapKey(null);
    setRemapNewId(undefined);
  }, [update]);

  // EVERY 3D object whose entity Home Assistant does not have and that has no row of its own (auto-detection adopts
  // only entities HA has): one card each, with the one thing to do here — point it at another entity
  // (dismissedEntities.orphanObjects). It used to appear only when its exact id was typed in the search (owner,
  // 2026-10-14). The search narrows the cards like the rows. Only while HA's list is loaded.
  const orphans = useMemo(() => orphanIds.filter((id) => matchesQuery(search, id)), [orphanIds, search]);
  const [repointTo, setRepointTo] = useState<Record<string, string | undefined>>({});
  const repoint = useCallback((id: string) => {
    const to = repointTo[id];
    if (!to || to === id) return;
    update(repointDevice(id, to, entities[to]));
    setRepointTo((m) => ({ ...m, [id]: undefined }));
  }, [repointTo, update, entities]);

  const startRemap = useCallback((key: string) => { setRemapKey(key); setRemapNewId(undefined); }, []);
  const cancelRemap = useCallback(() => { setRemapKey(null); setRemapNewId(undefined); }, []);

  return (
    <div>
      {/* what this section does is its title's (i) (ConfigEditorModal, owner 2026-10-22: no visible description) */}

      {staleIds.length > 0 && (
        <div className="config-stale-notice">
          <div>
            <strong>{countOf(staleIds.length, "entity", "entities")} no longer exist{staleIds.length === 1 ? "s" : ""}.</strong>
            <div className="muted body-text" style={{ marginTop: 2 }}>
              These entities no longer exist and the 3D model no longer
              names them (they came from an earlier model, or were added by hand).
              They do nothing except clutter this list.
            </div>
          </div>
          <button className="btn ghost" onClick={removeStale}>
            Remove {staleIds.length}
          </button>
        </div>
      )}

      {allRows.length > 0 && (
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

      {allRows.length === 0 && (
        <p className="muted body-text mt">No auto-detected entities yet.</p>
      )}

      {orphans.map((id) => (
        <div key={id} className="config-stale-notice config-repoint">
          <div>
            <strong>No entity {id} exists.</strong>
            <div className="muted body-text" style={{ marginTop: 2 }}>
              A 3D object in the model is named after it, so it shows as missing everywhere. If the
              entity was renamed, point the object at its new name; otherwise rename or remove the object in the model.
            </div>
            <div className="remap-row" style={{ marginTop: 8 }}>
              <div className="remap-picker">
                <EntityPicker value={repointTo[id]} onChange={(v) => setRepointTo((m) => ({ ...m, [id]: v }))}
                  hideCurrentLabel placeholder="The entity this 3D object is now…" />
              </div>
              <div className="remap-actions">
                <button className="btn primary" disabled={!repointTo[id] || repointTo[id] === id} onClick={() => repoint(id)}>
                  Point it there
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
      {allRows.length > 0 && entries.length === 0 && orphans.length === 0 && (
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
              <th>Linked entity</th>
            </tr>
          </thead>
          <tbody>
            {shown.visible.map(({ id: key, mapping: m0, objects }) => (
              <EntityMapRow
                key={key}
                entryKey={key}
                mapping={m0}
                objects={objects}
                entity={entities[key]}
                stale={staleSet.has(key)}
                expanded={expandedKeys.has(key)}
                editing={remapKey === key}
                remapNewId={remapKey === key ? remapNewId : undefined}
                matchedRowRef={key === initialSearch ? matchedRowRef : undefined}
                onToggleExpanded={toggleExpanded}
                onStartRemap={startRemap}
                onRemapChange={setRemapNewId}
                onRemapApply={remapEntity}
                onRemapCancel={cancelRemap}
                onRemove={sceneEntityIds.has(key) ? undefined : remove}
              />
            ))}
          </tbody>
        </table>
      )}
      <ShowAll list={shown} noun="entity" plural="entities" />

    </div>
  );
}
