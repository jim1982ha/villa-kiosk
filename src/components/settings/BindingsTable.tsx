// src/components/settings/BindingsTable.tsx
// Review/edit every mesh->entity binding without tapping. Lists current bindings
// and (collapsed) the remaining bindable meshes discovered in the loaded model.

import { useMemo, useState } from "react";
import { Unlink, ChevronDown, ChevronRight } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { upsertBinding, removeBinding } from "@/config/bindingUtils";
import { loadMeshCatalog } from "@/utils/meshCatalog";

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

  return (
    <div>
      <p className="muted body-text">
        Bindings link a 3D object to a Home Assistant entity. Entity names can change
        anytime — just re-point the binding here, no model reload or rebuild.
      </p>

      {bound.length === 0 && (
        <p className="muted body-text mt">
          No bindings yet. Either your meshes are already named after entity IDs (auto-matched),
          or use <strong>Settings → Bind 3D objects (tap mode)</strong> in the villa.
        </p>
      )}

      {bound.map((mesh) => (
        <div key={mesh} className="row spread" style={{ gap: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ flex: "0 0 38%", fontSize: 13, wordBreak: "break-all" }}>{mesh}</div>
          <div style={{ flex: 1 }}>
            <EntityPicker value={config.meshBindings[mesh]} onChange={(id) => bind(mesh, id)} />
          </div>
          <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => unbind(mesh)} title="Unbind">
            <Unlink size={16} />
          </button>
        </div>
      ))}

      {catalog.length > 0 && (
        <button className="btn ghost mt" onClick={() => setShowUnbound((s) => !s)}>
          {showUnbound ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {unbound.length} unbound object{unbound.length === 1 ? "" : "s"} in this model
        </button>
      )}

      {showUnbound &&
        unbound.map((mesh) => (
          <div key={mesh} className="row spread" style={{ gap: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ flex: "0 0 38%", fontSize: 13, wordBreak: "break-all" }}>{mesh}</div>
            <div style={{ flex: 1 }}>
              <EntityPicker onChange={(id) => bind(mesh, id)} placeholder="Bind to entity…" />
            </div>
            <span style={{ width: 36 }} />
          </div>
        ))}

      {catalog.length === 0 && (
        <p className="muted body-text mt">
          Load a model first — its object list will appear here for binding.
        </p>
      )}
    </div>
  );
}
