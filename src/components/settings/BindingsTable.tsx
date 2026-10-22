// src/components/settings/BindingsTable.tsx
// Unified editor for all 3D-object → entity bindings. Each row lets you
// change which entity the object controls AND edit its display metadata
// (type, label, requires-confirmation) — all in one place. Room is NOT
// editable here (or anywhere in the kiosk) any more — see config/devicePlace.ts's
// resolveEntityRoom docstring for why.
//
// Each row is its own React.memo'd component (BindingRow) — see its docstring
// and EntityMapRow's (ConfigEditor.tsx's sibling table) for why: draft state
// used to live in a flat Record HERE, so typing in any one row's Label field
// re-rendered every other bound row's JSX too, and this component reads
// live HA `entities` at the top level, so the same full-list re-render fired
// on every state_changed event for ANY device in the house, typing or not.
// bind/unbind/patchMeta are given a STABLE identity (read the latest config
// through a ref rather than closing over it) so React.memo's default shallow
// prop comparison actually has stable props to compare against.

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import EntityPicker from "./EntityPicker";
import Fold from "./Fold";
import BindingRow from "./BindingRow";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { addMapping, bindMesh, unbindMesh } from "@/config/mappingEdits";
import { loadMeshCatalog } from "@/utils/meshCatalog";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import { unshownEntities } from "@/config/deviceGroups";
import { useDeviceIdentity } from "@/config/VillaModel";
import { ShowAll, useTruncated } from "@/components/common/TruncatedList";
import { countOf } from "@/utils/countOf";

export default function BindingsTable() {
  // THE name a device is shown by (useEntityLabel) — this list printed HA's raw friendly_name.
  const entityLabel = useEntityLabel();
  const { config, update } = useConfig();
  const { entities, suppressedEntityIds, entityAreaNames } = useHA();
  const [showBound, setShowBound] = useState(false);
  const [showUnbound, setShowUnbound] = useState(false);
  const [showUnmappedHa, setShowUnmappedHa] = useState(false);
  // "Pre-configure a new entity" — moved here from ConfigEditor.tsx (Auto-
  // detected entity settings): sets label/room/panel type for an entity_id
  // whose 3D object doesn't exist YET, so it's ready the moment a matching
  // model is uploaded. Lives here now since it's the same "add something new
  // to the entity↔object map" action this whole section is about.
  const [newId, setNewId] = useState<string | undefined>(undefined);
  const addEntity = (id: string) => {
    if (!id) return;
    update(addMapping(id, entities[id]));
    setNewId(undefined);
  };

  const catalog = useMemo(() => loadMeshCatalog(), []);
  const bound = Object.keys(config.meshBindings);
  const unbound = useMemo(
    () => catalog.filter((m) => !config.meshBindings[m]),
    [catalog, config.meshBindings],
  );

  // The INVERSE audit: real HA entities this kiosk has no way to show
  // anywhere, because no 3D object in the model resolves to them (the
  // "unbound objects" list above answers the opposite question — meshes
  // with no entity). Scoped to domains this app actually knows how to
  // render (inferTypeFromEntityId's known list — the same gate auto-detect
  // itself uses) so this isn't every one of HA's hundreds of sensors, and
  // excludes anything already hidden/diagnostic in HA (suppressedEntityIds
  // — the same filter the summary tiles use), since those are entities the
  // installer already told HA don't belong on a main dashboard.
  // deviceGroups.unshownEntities (2.496.260): NOT one that belongs to a placed
  // device — a pump plug's energy meter is shown, under the pump's panel. This
  // list offered it as lost.
  const { folding } = useDeviceIdentity();
  const unmappedHaEntities = useMemo(
    () => unshownEntities({
      entities, entityMap: config.entityMap, folding, suppressed: suppressedEntityIds,
      knownType: (id) => !!inferTypeFromEntityId(id),
    }),
    [entities, config.entityMap, folding, suppressedEntityIds],
  );
  const unmappedShown = useTruncated(unmappedHaEntities);

  // Latest entities via a ref, read inside the stable callbacks below (the
  // config edits read the latest config themselves, inside update()) — see
  // the module docstring for why identity stability matters here.
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const bind = useCallback((mesh: string, entityId: string) =>
    update(bindMesh(mesh, entityId, entitiesRef.current[entityId])), [update]);
  const unbind = useCallback((mesh: string) => update(unbindMesh(mesh)), [update]);

  return (
    <div>
      {/* ONE section, one voice (owner, 2026-10-12): "Pre-configure a new
          entity" sat under its own smaller heading and finer print, as if it
          were another section — it is this section's way to add an entity. */}
      <p className="muted body-text">
        Each bound 3D object controls a device's entity when tapped in the
        villa: change which entity here, without reloading the model, its name
        and display settings are with the device, in Devices. To prepare an entity whose 3D object is not in the model yet,
        add it below, its settings apply as soon as a model with an object
        named after its entity ID is uploaded.
      </p>

      <Fold summary={`${bound.length} bound · ${unbound.length} unbound · ${unmappedHaEntities.length} not shown`}>

      <div style={{ marginBottom: 20 }}>
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
              <div className="muted body-text field-hint">
                Selected: <strong style={{ color: "var(--accent)" }}>{newId}</strong>
                {config.entityMap[newId] && (
                  <span style={{ marginLeft: 8, color: "var(--status-danger)" }}>
                    already configured
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            className="btn primary"
            onClick={() => newId && addEntity(newId)}
            disabled={!newId || !!config.entityMap[newId]}
            style={{ flexShrink: 0 }}
          >
            <Plus size={18} /> Add
          </button>
        </div>
      </div>

      {bound.length === 0 && (
        <p className="muted body-text mt">
          No objects bound yet. Expand <strong>unbound objects</strong> below
          and pick an entity for any 3D object you want to control.
        </p>
      )}

      {/* ⚠️ THE THREE LISTS' BUTTONS ON ONE LINE (owner, 2026-10-14), each list opening under them; the unmapped
          list is the inverse audit — informational only, there is no mesh here to bind those TO. */}
      <div className="row mt" style={{ gap: 8, flexWrap: "wrap" }}>
        {bound.length > 0 && (
          <button className="btn ghost" onClick={() => setShowBound((s) => !s)}>
            {showBound ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {countOf(bound.length, "bound object")}
          </button>
        )}
        {catalog.length > 0 && (
          <button className="btn ghost" onClick={() => setShowUnbound((s) => !s)}>
            {showUnbound ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {countOf(unbound.length, "unbound object")}
          </button>
        )}
        {unmappedHaEntities.length > 0 && (
          <button className="btn ghost" onClick={() => setShowUnmappedHa((s) => !s)}>
            {showUnmappedHa ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {countOf(unmappedHaEntities.length, "entity", "entities")} not shown
          </button>
        )}
      </div>

      {showBound && bound.map((mesh) => (
        <BindingRow
          key={mesh}
          mesh={mesh}
          entityId={config.meshBindings[mesh]}
          onBind={bind}
          onUnbind={unbind}
        />
      ))}

      {showUnbound &&
        unbound.map((mesh) => (
          <div
            key={mesh}
            className="row spread"
            style={{
              gap: 12,
              padding: "10px 0",
              borderTop: "1px solid var(--hairline)",
            }}
          >
            <div
              style={{
                flex: "0 0 34%",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                wordBreak: "break-all",
              }}
            >
              {mesh}
            </div>
            <div style={{ flex: 1 }}>
              <EntityPicker
                onChange={(id) => bind(mesh, id)}
                placeholder="Bind to entity…"
                allowCustom
              />
            </div>
            <span style={{ width: 36 }} />
          </div>
        ))}

      {catalog.length === 0 && (
        <p className="muted body-text mt">
          Load a 3D model first, its object list will appear here for binding.
        </p>
      )}

      {showUnmappedHa && (
        <>
          <p className="muted body-text mt">
            These entities exist but no 3D object resolves to them, so
            they have no badge, panel or place on the map, add an object for
            one in the 3D model (or bind an existing unbound object above) to
            make it controllable from the villa.
          </p>
          {unmappedShown.visible.map((id) => (
            <div
              key={id}
              className="row spread"
              style={{ gap: 12, padding: "8px 0", borderTop: "1px solid var(--hairline)" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-sm)" }}>{entityLabel(id)}</div>
                <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-secondary)", wordBreak: "break-all" }}>
                  {id}
                </div>
              </div>
              {entityAreaNames[id] && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", flex: "0 0 auto" }}>
                  {entityAreaNames[id]}
                </div>
              )}
            </div>
          ))}
          <ShowAll list={unmappedShown} noun="entity" plural="entities" />
        </>
      )}
      </Fold>
    </div>
  );
}
