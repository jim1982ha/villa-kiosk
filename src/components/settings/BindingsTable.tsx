// src/components/settings/BindingsTable.tsx
// Unified editor for all 3D-object → entity bindings. Each row lets you
// change which entity the object controls AND edit its display metadata
// (type, label, room, requires-confirmation) — all in one place.

import { useMemo, useState } from "react";
import { Unlink, ChevronDown, ChevronRight, Link2 } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { upsertBinding, removeBinding } from "@/config/bindingUtils";
import { loadMeshCatalog } from "@/utils/meshCatalog";
import { CATEGORY_ORDER, CATEGORY_LABELS, categoryForEntity } from "@/config/EntityCategories";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";

const TYPES: EntityType[] = [
  "light", "climate", "lock", "camera", "cover", "fan",
  "binary_sensor", "sensor", "media_player", "switch", "input_boolean",
  "assist_satellite",
];

export default function BindingsTable() {
  const { config, update } = useConfig();
  const { entities } = useHA();
  const [showUnbound, setShowUnbound] = useState(false);

  const catalog = useMemo(() => loadMeshCatalog(), []);
  const bound = Object.keys(config.meshBindings);
  const unbound = useMemo(
    () => catalog.filter((m) => !config.meshBindings[m]),
    [catalog, config.meshBindings],
  );

  const bind = (mesh: string, entityId: string) =>
    update(upsertBinding(config, mesh, entityId, entities[entityId]));
  const unbind = (mesh: string) => update(removeBinding(config, mesh));

  const patchMeta = (entityId: string, change: Partial<EntityMapping>) => {
    update({
      entityMap: {
        ...config.entityMap,
        [entityId]: { ...config.entityMap[entityId], ...change },
      },
    });
  };

  return (
    <div>
      <p className="muted body-text">
        Each bound object controls a Home Assistant entity when tapped in the
        villa. Change the entity or its display settings without reloading the
        model.
      </p>

      {bound.length === 0 && (
        <p className="muted body-text mt">
          No objects bound yet. Go back to the villa, open{" "}
          <strong>Settings → Bind 3D objects</strong> and tap any object to link
          it to an entity.
        </p>
      )}

      {bound.map((mesh) => {
        const entityId = config.meshBindings[mesh];
        const meta = config.entityMap[entityId];
        return (
          <div
            key={mesh}
            style={{
              padding: "14px 0",
              borderTop: "1px solid var(--hairline)",
            }}
          >
            {/* Row 1 — object ↔ entity */}
            <div className="row spread" style={{ gap: 12 }}>
              <div
                style={{
                  flex: "0 0 34%",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  wordBreak: "break-all",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Link2 size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
                {mesh}
              </div>
              <div style={{ flex: 1 }}>
                <EntityPicker
                  value={entityId}
                  onChange={(id) => bind(mesh, id)}
                  allowCustom
                />
              </div>
              <button
                className="icon-btn"
                style={{ width: 36, height: 36 }}
                onClick={() => unbind(mesh)}
                title="Remove binding"
              >
                <Unlink size={15} />
              </button>
            </div>

            {/* Row 2 — display settings (only if entityMap entry exists) */}
            {meta && (
              <div
                className="row"
                style={{
                  gap: 10,
                  marginTop: 10,
                  paddingLeft: "calc(34% + 12px)",
                  flexWrap: "wrap",
                }}
              >
                <select
                  style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)", color: "var(--text-primary)", border: "none", cursor: "pointer" }}
                  value={meta.type}
                  onChange={(e) => patchMeta(entityId, { type: e.target.value as EntityType })}
                  title="Panel type"
                >
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)", color: "var(--text-primary)", border: "none", cursor: "pointer" }}
                  value={meta.category ?? categoryForEntity(entityId, meta.type)}
                  onChange={(e) => patchMeta(entityId, { category: e.target.value as Category })}
                  title="Which map filter group this device belongs to"
                >
                  {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
                <input
                  style={{ flex: 1, minWidth: 80, fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)", color: "var(--text-primary)", border: "none" }}
                  placeholder="Label"
                  value={meta.label}
                  onChange={(e) => patchMeta(entityId, { label: e.target.value })}
                  title="Display name"
                />
                <input
                  style={{ flex: 1, minWidth: 80, fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)", color: "var(--text-primary)", border: "none" }}
                  placeholder="Room"
                  value={meta.room}
                  onChange={(e) => patchMeta(entityId, { room: e.target.value })}
                  title="Room name"
                />
                {meta.type === "camera" && (
                  <div style={{ flex: "1 1 220px", minWidth: 180 }}>
                    <EntityPicker
                      value={meta.motionEntityId}
                      onChange={(id) => patchMeta(entityId, { motionEntityId: id })}
                      domains={["binary_sensor"]}
                      allowCustom
                      hideCurrentLabel
                      placeholder="Motion/occupancy sensor…"
                    />
                  </div>
                )}
                <label
                  className="row"
                  style={{ gap: 5, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}
                  title="Show a confirmation dialog before toggling (useful for locks)"
                >
                  <input
                    type="checkbox"
                    checked={!!meta.requiresConfirmation}
                    onChange={(e) => patchMeta(entityId, { requiresConfirmation: e.target.checked })}
                  />
                  Confirm
                </label>
              </div>
            )}
          </div>
        );
      })}

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
