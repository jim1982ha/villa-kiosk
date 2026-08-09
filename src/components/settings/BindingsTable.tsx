// src/components/settings/BindingsTable.tsx
// Unified editor for all 3D-object → entity bindings. Each row lets you
// change which entity the object controls AND edit its display metadata
// (type, label, requires-confirmation) — all in one place. Room is NOT
// editable here (or anywhere in the kiosk) any more — see config/EntityMap.ts's
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
import EntityPicker from "./EntityPicker";
import BindingRow from "./BindingRow";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { upsertBinding, removeBinding } from "@/config/bindingUtils";
import { loadMeshCatalog } from "@/utils/meshCatalog";
import { inferTypeFromEntityId, createDefaultMapping } from "@/config/EntityMap";
import type { EntityMapping } from "@/types/scene.types";

export default function BindingsTable() {
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
    if (!id || config.entityMap[id]) return;
    update({
      entityMap: {
        ...config.entityMap,
        [id]: createDefaultMapping(id, { friendlyName: entities[id]?.attributes.friendly_name }),
      },
    });
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
  const unmappedHaEntities = useMemo(
    () => Object.keys(entities)
      .filter((id) => inferTypeFromEntityId(id) && !config.entityMap[id] && !suppressedEntityIds.has(id))
      .sort(),
    [entities, config.entityMap, suppressedEntityIds],
  );

  // Latest config/entities via refs, read inside the stable callbacks below —
  // see the module docstring for why identity stability matters here.
  const configRef = useRef(config);
  configRef.current = config;
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const bind = useCallback((mesh: string, entityId: string) =>
    update(upsertBinding(configRef.current, mesh, entityId, entitiesRef.current[entityId])), [update]);
  const unbind = useCallback((mesh: string) =>
    update(removeBinding(configRef.current, mesh)), [update]);
  const patchMeta = useCallback((entityId: string, change: Partial<EntityMapping>) => {
    update({
      entityMap: {
        ...configRef.current.entityMap,
        [entityId]: { ...configRef.current.entityMap[entityId], ...change },
      },
    });
  }, [update]);

  return (
    <div>
      <p className="muted body-text">
        Each bound object controls a Home Assistant entity when tapped in the
        villa. Change the entity or its display settings without reloading the
        model.
      </p>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: "var(--text-sm)", fontWeight: 500 }}>
          Pre-configure a new entity
        </label>
        <p className="muted body-text" style={{ fontSize: "var(--text-2xs)", marginBottom: 10 }}>
          Sets the label and panel type for an entity whose 3D object is named
          after its entity ID. Useful to configure in advance — it activates
          automatically when the matching model is uploaded.
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
              <div className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-xs)" }}>
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

      {/* Bound objects — collapsed by default, same as unbound/unmapped below. */}
      {bound.length > 0 && (
        <button
          className="btn ghost mt"
          onClick={() => setShowBound((s) => !s)}
        >
          {showBound ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {bound.length} bound object{bound.length === 1 ? "" : "s"}
        </button>
      )}

      {showBound && bound.map((mesh) => (
        <BindingRow
          key={mesh}
          mesh={mesh}
          entityId={config.meshBindings[mesh]}
          meta={config.entityMap[config.meshBindings[mesh]]}
          onBind={bind}
          onUnbind={unbind}
          onPatch={patchMeta}
        />
      ))}

      {/* Unbound objects — collapsed by default */}
      {catalog.length > 0 && (
        <button
          className="btn ghost mt"
          onClick={() => setShowUnbound((s) => !s)}
        >
          {showUnbound ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {unbound.length} unbound object{unbound.length === 1 ? "" : "s"} in this model
        </button>
      )}

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
          Load a 3D model first — its object list will appear here for binding.
        </p>
      )}

      {/* The inverse audit — collapsed by default, informational only: there's
          no mesh here to bind these TO, so unlike "unbound objects" above
          there's no action to offer, just visibility into what's missing. */}
      {unmappedHaEntities.length > 0 && (
        <button
          className="btn ghost mt"
          onClick={() => setShowUnmappedHa((s) => !s)}
        >
          {showUnmappedHa ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {unmappedHaEntities.length} HA entit{unmappedHaEntities.length === 1 ? "y" : "ies"} not shown anywhere in the model
        </button>
      )}

      {showUnmappedHa && (
        <>
          <p className="muted body-text mt">
            These exist in Home Assistant but no 3D object resolves to them, so
            they have no badge, panel or place on the map — add an object for
            one in the 3D model (or bind an existing unbound object above) to
            make it controllable from the villa.
          </p>
          {unmappedHaEntities.map((id) => (
            <div
              key={id}
              className="row spread"
              style={{ gap: 12, padding: "8px 0", borderTop: "1px solid var(--hairline)" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-sm)" }}>{entities[id]?.attributes.friendly_name || id}</div>
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
        </>
      )}
    </div>
  );
}
