// src/components/settings/BindingRow.tsx
// One row of BindingsTable's bound-objects list, split out and React.memo'd —
// same reasoning as EntityMapRow (see its docstring): draft state used to live
// in a flat Record at BindingsTable's own level, so typing in any one row's
// Label/Room field re-rendered every other bound row too. Localizing it here
// means only the row actually being edited re-renders.

import { useDraftCommit } from "@/hooks/useDraftCommit";
import { Unlink, Link2 } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { CATEGORY_ORDER, CATEGORY_LABELS, categoryForEntity } from "@/config/EntityCategories";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";
import { memo } from "react";

const TYPES: EntityType[] = [
  "light", "climate", "lock", "camera", "cover", "fan",
  "binary_sensor", "sensor", "media_player", "switch", "input_boolean",
  "assist_satellite",
];

interface Props {
  mesh: string;
  entityId: string;
  meta: EntityMapping | undefined;
  onBind: (mesh: string, entityId: string) => void;
  onUnbind: (mesh: string) => void;
  /** Stable identity — see BindingsTable's patchMeta(). */
  onPatch: (entityId: string, change: Partial<EntityMapping>) => void;
}

function BindingRow({ mesh, entityId, meta: meta0, onBind, onUnbind, onPatch }: Props) {
  const intensity = useDraftCommit<number>((_k, ratio) => onPatch(entityId, { lightIntensityRatio: ratio }), 500);
  const field = useDraftCommit<Partial<EntityMapping>>((_k, change) => onPatch(entityId, change));
  const draftField = (change: Partial<EntityMapping>, delay?: number) =>
    field.draft("v", { ...field.drafts.v, ...change }, delay);

  // Merge in any not-yet-committed edit so fields reflect the click/keystroke
  // instantly, even while the commit is pending.
  const meta = meta0 && field.drafts.v ? { ...meta0, ...field.drafts.v } : meta0;

  return (
    <div style={{ padding: "14px 0", borderTop: "1px solid var(--hairline)" }}>
      {/* Row 1 — object ↔ entity */}
      <div className="row spread" style={{ gap: 12 }}>
        <div
          style={{
            flex: "0 0 34%", fontSize: 12, color: "var(--text-secondary)",
            wordBreak: "break-all", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <Link2 size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
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
          <Unlink size={15} />
        </button>
      </div>

      {/* Row 2 — display settings (only if entityMap entry exists) */}
      {meta && (
        <div className="row" style={{ gap: 10, marginTop: 10, paddingLeft: "calc(34% + 12px)", flexWrap: "wrap" }}>
          <select
            style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)", color: "var(--text-primary)", border: "none", cursor: "pointer" }}
            value={meta.type}
            onChange={(e) => draftField({ type: e.target.value as EntityType })}
            title="Panel type"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)", color: "var(--text-primary)", border: "none", cursor: "pointer" }}
            value={meta.category ?? categoryForEntity(entityId, meta.type)}
            onChange={(e) => draftField({ category: e.target.value as Category })}
            title="Which map filter group this device belongs to"
          >
            {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <input
            style={{ flex: 1, minWidth: 80, fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)", color: "var(--text-primary)", border: "none" }}
            placeholder="Label"
            value={meta.label}
            onChange={(e) => draftField({ label: e.target.value }, 500)}
            title="Display name"
          />
          <input
            style={{ flex: 1, minWidth: 80, fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--bg-input)", color: "var(--text-primary)", border: "none" }}
            placeholder="Room"
            value={meta.room}
            onChange={(e) => draftField({ room: e.target.value }, 500)}
            title="Room name — must match a Rooms-menu name exactly for motion-glow/teleport to find it"
            list="bindings-room-names"
          />
          {meta.type === "light" && (() => {
            const ratio = intensity.drafts.v ?? meta.lightIntensityRatio ?? 0;
            const pct = Math.round(ratio * 100);
            return (
              <div className="row" style={{ flex: "1 1 220px", minWidth: 180, gap: 8 }}>
                <input
                  type="range" min={-100} max={100} step={5}
                  value={pct}
                  onChange={(e) => intensity.draft("v", Number(e.target.value) / 100)}
                  onMouseUp={() => intensity.flush("v")}
                  onTouchEnd={() => intensity.flush("v")}
                  style={{ flex: 1 }}
                  title="Per-light brightness override on top of this light's live Home Assistant brightness and the global Light effect strength setting. 0% = no change."
                  aria-label={`Intensity override for ${entityId}`}
                />
                <span className="muted" style={{ fontSize: 12, minWidth: 36, textAlign: "right" }}>
                  {pct > 0 ? "+" : ""}{pct}%
                </span>
              </div>
            );
          })()}
          {meta.type === "camera" && (
            <div style={{ flex: "1 1 220px", minWidth: 180 }}>
              <EntityPicker
                value={meta.motionEntityId}
                onChange={(id) => draftField({ motionEntityId: id })}
                domains={["binary_sensor"]}
                allowCustom
                hideCurrentLabel
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(BindingRow);
