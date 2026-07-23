// src/components/settings/BindingsTable.tsx
// Unified editor for all 3D-object → entity bindings. Each row lets you
// change which entity the object controls AND edit its display metadata
// (type, label, room, requires-confirmation) — all in one place.
//
// Each row is its own React.memo'd component (BindingRow) — see its docstring
// and EntityMapRow's (ConfigEditor.tsx's sibling table) for why: draft state
// used to live in a flat Record HERE, so typing in any one row's Label/Room
// field re-rendered every other bound row's JSX too, and this component reads
// live HA `entities` at the top level, so the same full-list re-render fired
// on every state_changed event for ANY device in the house, typing or not.
// bind/unbind/patchMeta are given a STABLE identity (read the latest config
// through a ref rather than closing over it) so React.memo's default shallow
// prop comparison actually has stable props to compare against.

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import EntityPicker from "./EntityPicker";
import BindingRow from "./BindingRow";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { upsertBinding, removeBinding } from "@/config/bindingUtils";
import { loadMeshCatalog } from "@/utils/meshCatalog";
import type { EntityMapping } from "@/types/scene.types";

export default function BindingsTable() {
  const { config, update } = useConfig();
  const { entities } = useHA();
  const [showUnbound, setShowUnbound] = useState(false);

  // The "Room" field below is free text matched EXACTLY (case/whitespace
  // aside) against a real room's name by RoomHighlight — a typo or a name
  // that doesn't match any actual room (sh3d polygon or Rooms-menu point)
  // silently does nothing, with no error anywhere. Suggest the real names as
  // a native <datalist> autocomplete so a mismatch is visible while typing,
  // without blocking a not-yet-created room name.
  const roomNames = useMemo(
    () => Array.from(new Set(config.teleportPoints.map((p) => p.name))).sort(),
    [config.teleportPoints],
  );

  const catalog = useMemo(() => loadMeshCatalog(), []);
  const bound = Object.keys(config.meshBindings);
  const unbound = useMemo(
    () => catalog.filter((m) => !config.meshBindings[m]),
    [catalog, config.meshBindings],
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

      <datalist id="bindings-room-names">
        {roomNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      {bound.length === 0 && (
        <p className="muted body-text mt">
          No objects bound yet. Expand <strong>unbound objects</strong> below
          and pick an entity for any 3D object you want to control.
        </p>
      )}

      {bound.map((mesh) => (
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
                fontSize: 12,
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
    </div>
  );
}
