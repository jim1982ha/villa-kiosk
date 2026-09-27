// src/components/settings/BindingRow.tsx
// One row of BindingsTable's bound-objects list, split out and React.memo'd —
// same reasoning as EntityMapRow (see its docstring): draft state used to live
// in a flat Record at BindingsTable's own level, so typing in any one row's
// Label field re-rendered every other bound row too. Localizing it here means
// only the row actually being edited re-renders.

import type { HassEntity } from "@/types/ha.types";
import { Unlink, Link2 } from "lucide-react";
import EntityPicker from "./EntityPicker";
import type { EntityMapping } from "@/types/scene.types";
import MappingFields from "./MappingFields";
import { memo } from "react";

/** BindingRow's compact control look (its selects sit inline in a row). */
const COMPACT: React.CSSProperties = {
  fontSize: "var(--text-xs)", padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)",
  color: "var(--text-primary)", border: "none", cursor: "pointer",
};

interface Props {
  mesh: string;
  entityId: string;
  meta: EntityMapping | undefined;
  /** This row's OWN live entity — the same narrow slice EntityMapRow takes, so
   *  the row re-renders when ITS entity changes rather than on every state in
   *  the house. Required: the category dropdown below cannot be resolved
   *  without the `device_class` it carries, and this row used to omit it and
   *  disagree with the identical dropdown one scroll away in the same modal. */
  entity: HassEntity | undefined;
  onBind: (mesh: string, entityId: string) => void;
  onUnbind: (mesh: string) => void;
  /** Stable identity — see BindingsTable's patchMeta(). */
  onPatch: (entityId: string, change: Partial<EntityMapping>) => void;
}

function BindingRow({ mesh, entityId, meta, entity, onBind, onUnbind, onPatch }: Props) {
  return (
    <div style={{ padding: "14px 0", borderTop: "1px solid var(--hairline)" }}>
      {/* Row 1 — object ↔ entity */}
      <div className="row spread" style={{ gap: 12 }}>
        <div
          style={{
            flex: "0 0 34%", fontSize: "var(--text-xs)", color: "var(--text-secondary)",
            wordBreak: "break-all", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <Link2 size={16} style={{ flexShrink: 0, opacity: 0.5 }} />
          {mesh}
        </div>
        <div style={{ flex: 1 }}>
          <EntityPicker value={entityId} onChange={(id) => onBind(mesh, id)} allowCustom />
        </div>
        <button
          className="icon-btn"
          style={{ width: 36, height: 36 }}
          onClick={() => onUnbind(mesh)}
          title="Remove binding"
        >
          <Unlink size={16} />
        </button>
      </div>

      {/* Row 2 — display settings (only if entityMap entry exists): the
          fields both Advanced Settings tables share (MappingFields). */}
      {meta && (
        <div className="row" style={{ gap: 10, marginTop: 10, paddingLeft: "calc(34% + 12px)", flexWrap: "wrap" }}>
          <MappingFields entityId={entityId} mapping={meta} entity={entity} selectStyle={COMPACT}
            onPatch={(change) => onPatch(entityId, change)}
            cell={(key, _label, field, opts) => (opts?.pair
              ? <div key={key} style={{ flex: "1 1 220px", minWidth: 180 }}>{field}</div>
              : <span key={key} style={{ display: "contents" }}>{field}</span>)} />
        </div>
      )}
    </div>
  );
}

export default memo(BindingRow);
