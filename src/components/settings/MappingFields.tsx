// src/components/settings/MappingFields.tsx
// The editable fields of ONE device's mapping — type, category, label,
// "confirm before toggling", a light's intensity, the linked entity and a
// camera's motion sensor — for both Advanced Settings tables.
//
// ⚠️ TWO EDITORS FOR THE SAME RECORD, IN ONE MODAL (round 10, 2.496.156).
// BindingRow (bound objects) and EntityMapRow (the entity table) each rendered
// these seven fields themselves. ad68ef49 had to make "the two identical
// dropdowns in one modal stop disagreeing"; the label still committed two ways
// (a 500 ms debounce in one, on blur in the other), and the linked entity's
// hint said "ring only" in one table while the other, correctly, said it adds
// an on/off switch. The fields, their drafts and their words are here once;
// each table supplies only its layout — a cell per field (`cell`).

import type { ReactNode } from "react";
import EntityPicker from "./EntityPicker";
import { useDraftCommit } from "@/hooks/useDraftCommit";
import { CATEGORY_ORDER, CATEGORY_LABELS, effectiveCategory, subjectOf } from "@/config/EntityCategories";
import { CONFIRM_GATE_TYPES } from "@/utils/quickAction";
import { ENTITY_DOMAINS, type HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";

/** One field's place in the row's layout. */
export type FieldCell = (key: string, label: string, field: ReactNode, opts?: { wide?: boolean; pair?: boolean }) => ReactNode;

export default function MappingFields({ entityId, mapping, entity, onPatch, cell, selectStyle }: {
  entityId: string;
  mapping: EntityMapping;
  /** This row's own live entity (its device_class decides the category). */
  entity: HassEntity | undefined;
  onPatch: (change: Partial<EntityMapping>) => void;
  cell: FieldCell;
  /** The compact row's own control look (BindingRow's inline selects). */
  selectStyle?: React.CSSProperties;
}) {
  const label = useDraftCommit<string>((_k, value) => onPatch({ label: value }), 500);
  const intensity = useDraftCommit<number>((_k, ratio) => onPatch({ lightIntensityRatio: ratio }), 500);
  const field = useDraftCommit<Partial<EntityMapping>>((_k, change) => onPatch(change));
  const draftField = (change: Partial<EntityMapping>) => field.draft("v", { ...field.drafts.v, ...change });
  // Not-yet-committed edits show at once, even while the commit is pending.
  const m = field.drafts.v ? { ...mapping, ...field.drafts.v } : mapping;

  const ratio = intensity.drafts.v ?? m.lightIntensityRatio ?? 0;
  const pct = Math.round(ratio * 100);
  return (
    <>
      {cell("type", "Type", (
        <select style={selectStyle} value={m.type} title="Panel type"
          onChange={(e) => draftField({ type: e.target.value as EntityType })}>
          {ENTITY_DOMAINS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      ))}
      {cell("category", "Category", (
        <select style={selectStyle} value={effectiveCategory(subjectOf(entityId, m, entity))}
          // `categoryPicked` records that this was CHOSEN. Without it the pick
          // round-trips through the legacy-default discard and the dropdown
          // snaps straight back — six of the options were unselectable.
          onChange={(e) => draftField({ category: e.target.value as Category, categoryPicked: true })}
          title="Which map filter group this device belongs to">
          {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      ))}
      {cell("label", "Label", (
        // Saved half a second after typing stops, or at once on leaving the field.
        <input style={selectStyle ? { ...selectStyle, cursor: "text", flex: 1, minWidth: 80 } : undefined}
          placeholder="Label" title="Display name"
          value={label.drafts.v ?? m.label}
          onChange={(e) => label.draft("v", e.target.value)}
          onBlur={() => label.flush("v")} />
      ), { wide: true })}
      {CONFIRM_GATE_TYPES.has(m.type) && cell("confirm", "Confirm before toggling", (
        <label className="row" style={{ gap: 6, fontSize: "var(--text-xs)", color: "var(--text-secondary)", cursor: "pointer", flex: "0 0 auto" }}>
          <input type="checkbox" checked={!!m.requireConfirm}
            onChange={(e) => draftField({ requireConfirm: e.target.checked })}
            title="Ask before toggling — a tap on this device's map badge opens its panel instead of acting instantly, and its panel's own on/off button asks 'Turn on/off?' first. For a device where an accidental toggle has a real physical consequence, e.g. a door release or gate motor modelled as a plain switch." />
          Confirm before toggling
        </label>
      ))}
      {m.type === "light" && cell("intensity", "Intensity", (
        <div className="row" style={{ gap: 8, width: "100%", flex: "1 1 220px", minWidth: 180 }}>
          <input type="range" min={-100} max={100} step={5} value={pct} style={{ flex: 1 }}
            onChange={(e) => intensity.draft("v", Number(e.target.value) / 100)}
            onMouseUp={() => intensity.flush("v")}
            onTouchEnd={() => intensity.flush("v")}
            title="Per-light brightness override on top of this light's live Home Assistant brightness and the global Light effect strength setting. 0% = no change."
            aria-label={`Intensity override for ${entityId}`} />
          <span className="muted" style={{ fontSize: "var(--text-xs)", minWidth: 40, textAlign: "right" }}>
            {pct > 0 ? "+" : ""}{pct}%
          </span>
        </div>
      ))}
      {/* Two DISTINCT links — see EntityMapping. The linked entity is what the
          user toggles: it drives the red badge ring and gets an on/off switch in
          the device's panel (on a camera it is also the long-press target). The
          motion sensor is what HA reports — the detection beam — and exists only
          for a camera, so it is not offered for anything else. */}
      {cell("linked", "Linked entity", (
        <EntityPicker value={m.linkedEntityId}
          onChange={(id) => draftField({ linkedEntityId: id })}
          onClear={() => draftField({ linkedEntityId: undefined })}
          allowCustom hideCurrentLabel
          placeholder={m.type === "camera" ? "Linked entity — arms detection, long-press…" : "Linked entity — ring and an on/off switch…"} />
      ), { pair: true })}
      {m.type === "camera" && cell("motion", "Motion sensor", (
        <EntityPicker value={m.motionEntityId}
          onChange={(id) => draftField({ motionEntityId: id })}
          onClear={() => draftField({ motionEntityId: undefined })}
          domains={["binary_sensor"]} allowCustom hideCurrentLabel
          placeholder="Motion sensor — detection beam on the map…" />
      ), { pair: true })}
    </>
  );
}
