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
import { ShieldCheck } from "lucide-react";
import SegmentedGroup from "@/components/common/SegmentedGroup";
import Dropdown from "@/components/common/Dropdown";
import EntityPicker from "./EntityPicker";
import { useDraftCommit } from "@/hooks/useDraftCommit";
import { CATEGORY_ORDER, CATEGORY_LABELS, effectiveCategory, subjectOf } from "@/config/EntityCategories";
import { CONFIRM_GATE_TYPES } from "@/utils/quickAction";
import { labelField } from "@/config/EntityMap";
import { ENTITY_DOMAINS, type HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";

/** One field's place in the row's layout. */
export type FieldCell = (key: string, label: string, field: ReactNode, opts?: { wide?: boolean }) => ReactNode;

/**
 * A mapping row's pending edits: `draftField` stages a change (committed after
 * the draft delay) and `m` is the mapping WITH those edits, so a control
 * reflects a click at once while the commit is pending. Shared by this table
 * and the entity map's own row (written out in both until 2.496.263).
 */
export function useMappingDraft(mapping: EntityMapping, onPatch: (change: Partial<EntityMapping>) => void) {
  const field = useDraftCommit<Partial<EntityMapping>>((_k, change) => onPatch(change));
  const draftField = (change: Partial<EntityMapping>) => field.draft("v", { ...field.drafts.v, ...change });
  const m = field.drafts.v ? { ...mapping, ...field.drafts.v } : mapping;
  return { field, draftField, m };
}

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
  const { draftField, m } = useMappingDraft(mapping, onPatch);

  // The owner's own name, or empty with the name actually shown in grey (EntityMap.labelField)
  const named = labelField(entityId, m.label, entity?.attributes.friendly_name as string | undefined);
  const ratio = intensity.drafts.v ?? m.lightIntensityRatio ?? 0;
  const pct = Math.round(ratio * 100);
  return (
    <>
      {cell("type", "Type", (
        <Dropdown<EntityType> style={selectStyle} value={m.type} title="Panel type" ariaLabel="Panel type"
          onChange={(type) => draftField({ type })}
          options={ENTITY_DOMAINS.map((t) => ({ value: t, label: t }))} />
      ))}
      {cell("category", "Category", (
        <Dropdown<Category> style={selectStyle} value={effectiveCategory(subjectOf(entityId, m, entity))}
          // `categoryPicked` records that this was CHOSEN. Without it the pick
          // round-trips through the legacy-default discard and the dropdown
          // snaps straight back — six of the options were unselectable.
          onChange={(category) => draftField({ category, categoryPicked: true })}
          title="Which map filter group this device belongs to" ariaLabel="Category"
          options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
      ))}
      {cell("label", "Label", (
        // Saved half a second after typing stops, or at once on leaving the field.
        <input style={selectStyle ? { ...selectStyle, cursor: "text", flex: 1, minWidth: 80 } : undefined}
          placeholder={named.placeholder} title="Display name, leave empty to use the device's own name"
          value={label.drafts.v ?? named.value}
          onChange={(e) => label.draft("v", e.target.value)}
          onBlur={() => label.flush("v")} />
      ), { wide: true })}
      {m.type === "light" && cell("intensity", "Intensity", (
        <div className="row" style={{ gap: 8, width: "100%", flex: "1 1 220px", minWidth: 180 }}>
          <input type="range" min={-100} max={100} step={5} value={pct} style={{ flex: 1 }}
            onChange={(e) => intensity.draft("v", Number(e.target.value) / 100)}
            onMouseUp={() => intensity.flush("v")}
            onTouchEnd={() => intensity.flush("v")}
            title="Per-light brightness override on top of this light's live brightness and the global Light effect strength setting. 0% = no change."
            aria-label={`Intensity override for ${entityId}`} />
          <span className="muted" style={{ fontSize: "var(--text-xs)", minWidth: 40, textAlign: "right" }}>
            {pct > 0 ? "+" : ""}{pct}%
          </span>
        </div>
      ))}
      {/* ONE link for every type (owner, 2026-10-22: a camera's "Motion sensor" merged into it) — see
          EntityMapping.linkedEntityId. What it drives follows what it is: a switch gets an on/off in the device's
          window, a motion sensor linked to a camera drives its beam; every one is the badge's bottom-right pill. */}
      {cell("linked", "Linked entity", (
        <EntityPicker value={m.linkedEntityId}
          onChange={(id) => draftField({ linkedEntityId: id })}
          onClear={() => draftField({ linkedEntityId: undefined })}
          allowCustom hideCurrentLabel
          placeholder={m.type === "camera" ? "Linked entity, its motion sensor or a switch…" : "Linked entity, a switch or a sensor…"} />
      ), { wide: true })}
    </>
  );
}

/**
 * "Confirm before toggling", on the device card's own line, at its right (owner, 2026-10-22: no checkbox among the
 * fields; one button, pressed while it is on). Only for the types where a tap can act at once (CONFIRM_GATE_TYPES).
 */
export function ConfirmToggle({ m, draftField }: { m: EntityMapping; draftField: (change: Partial<EntityMapping>) => void }) {
  if (!CONFIRM_GATE_TYPES.has(m.type)) return null;
  return (
    <SegmentedGroup ariaLabel="Confirm before toggling" className="config-confirm"
      active={m.requireConfirm ? "on" : null} onChange={() => draftField({ requireConfirm: !m.requireConfirm })}
      options={[{ key: "on", title: "Confirm before toggling: a tap on its badge opens its window, and its on/off asks first",
        label: <><ShieldCheck size={16} /> Confirm</> }]} />
  );
}
