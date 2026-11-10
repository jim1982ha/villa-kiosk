// src/components/settings/MappingFields.tsx
// The editable fields of ONE device's mapping — the 3D objects that show it,
// type, category, label, "confirm before toggling", a light's intensity and the
// linked entity — for its card in Advanced Settings › Devices.
//
// ⚠️ TWO EDITORS FOR THE SAME RECORD, IN ONE MODAL (round 10, 2.496.156).
// The bound-objects table and the entity table each rendered these fields
// themselves. ad68ef49 had to make "the two identical dropdowns in one modal
// stop disagreeing"; the label still committed two ways (a 500 ms debounce in
// one, on blur in the other), and the linked entity's hint said "ring only" in
// one table while the other, correctly, said it adds an on/off switch. The
// fields, their drafts and their words are here once; the card supplies only
// its layout — a cell per field (`cell`).

import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import OnOffToggle from "@/components/common/OnOffToggle";
import Dropdown from "@/components/common/Dropdown";
import EntityPicker from "./EntityPicker";
import RemovablePill from "@/components/common/RemovablePill";
import SearchPicker from "@/components/common/SearchPicker";
import IdText from "@/components/common/IdText";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { objectOffers, type ObjectLinks } from "@/config/deviceRecord";
import { usePendingField } from "@/hooks/usePendingField";
import { patchMapping } from "@/config/mappingEdits";
import { CATEGORY_ORDER, CATEGORY_LABELS, effectiveCategory, subjectOf } from "@/config/EntityCategories";
import { CONFIRM_GATE_TYPES } from "@/utils/quickAction";
import { labelField } from "@/config/EntityMap";
import { ENTITY_DOMAINS, type HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";

/** One field's place in the row's layout. */
type FieldCell = (key: string, label: string, field: ReactNode, opts?: { wide?: boolean }) => ReactNode;

/** How long a click on a device's field waits before it is written (a run of clicks is one write). */
const FIELD_COMMIT_MS = 350;
/** How long a device's label or intensity waits after the last key or drag step. */
const TYPED_COMMIT_MS = 500;

/**
 * A mapping row's pending edits: `draftField` stages a change (written after
 * the pause) and `m` is the mapping WITH those edits, so a control
 * reflects a click at once while the write is pending. Shared by this table
 * and the entity map's own row (written out in both until 2.496.263). The
 * changes wait in the dialog's one pending store (usePendingField, 2.496.500),
 * under the device's entity id: Save lights while they wait, and closing the
 * dialog writes them rather than dropping them.
 */
export function useMappingDraft(entryKey: string, mapping: EntityMapping) {
  const field = usePendingField<Partial<EntityMapping>>(`device:${entryKey}:fields`, FIELD_COMMIT_MS);
  const draftField = (change: Partial<EntityMapping>) => {
    const merged = { ...field.shown, ...change };
    field.draft(merged, patchMapping(entryKey, merged));
  };
  const m = field.shown ? { ...mapping, ...field.shown } : mapping;
  return { draftField, m };
}

export default function MappingFields({ entryKey, entityId, mapping, entity, cell, objects }: {
  /** The device's key in the map: what its changes are written to. */
  entryKey: string;
  entityId: string;
  mapping: EntityMapping;
  /** This row's own live entity (its device_class decides the category). */
  entity: HassEntity | undefined;
  cell: FieldCell;
  /** Its "3D object" field: the objects that show it. */
  objects: ObjectsFieldProps;
}) {
  const label = usePendingField<string>(`device:${entryKey}:label`, TYPED_COMMIT_MS);
  const intensity = usePendingField<number>(`device:${entryKey}:intensity`, TYPED_COMMIT_MS);
  const { draftField, m } = useMappingDraft(entryKey, mapping);

  // The owner's own name, or empty with the name actually shown in grey (EntityMap.labelField)
  const named = labelField(entityId, m.label, entity?.attributes.friendly_name as string | undefined);
  const ratio = intensity.shown ?? m.lightIntensityRatio ?? 0;
  const pct = Math.round(ratio * 100);
  return (
    <>
      {/* ⚠️ "3D OBJECT" FIRST (owner, 2026-11-06): right under the card's first line, above Type; a device not on the
          map shows it alone, so the field is at the same place on both lists' cards */}
      {cell("objects", OBJECT_FIELD, <ObjectsField {...objects} />, { wide: true })}
      {cell("type", "Type", (
        <Dropdown<EntityType> value={m.type} title="Panel type" ariaLabel="Panel type"
          onChange={(type) => draftField({ type })}
          options={ENTITY_DOMAINS.map((t) => ({ value: t, label: t }))} />
      ))}
      {cell("category", "Category", (
        <Dropdown<Category> value={effectiveCategory(subjectOf(entityId, m, entity))}
          // `categoryPicked` records that this was CHOSEN. Without it the pick
          // round-trips through the legacy-default discard and the dropdown
          // snaps straight back — six of the options were unselectable.
          onChange={(category) => draftField({ category, categoryPicked: true })}
          title="Which map filter group this device belongs to" ariaLabel="Category"
          options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
      ))}
      {cell("label", "Label", (
        // Saved half a second after typing stops, or at once on leaving the field.
        <input placeholder={named.placeholder} title="Display name, leave empty to use the device's own name"
          value={label.shown ?? named.value}
          onChange={(e) => label.draft(e.target.value, patchMapping(entryKey, { label: e.target.value }))}
          onBlur={label.flush} />
      ), { wide: true })}
      {m.type === "light" && cell("intensity", "Intensity", (
        <div className="row" style={{ gap: 8, width: "100%", flex: "1 1 220px", minWidth: 180 }}>
          <input type="range" min={-100} max={100} step={5} value={pct} style={{ flex: 1 }}
            onChange={(e) => {
              const r = Number(e.target.value) / 100;
              intensity.draft(r, patchMapping(entryKey, { lightIntensityRatio: r }));
            }}
            onMouseUp={intensity.flush}
            onTouchEnd={intensity.flush}
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
          allowCustom
          placeholder={m.type === "camera" ? "Linked entity, its motion sensor or a switch…" : "Linked entity, a switch or a sensor…"} />
      ), { wide: true })}
    </>
  );
}

/** The "3D object" field's name: a device's card in Devices, on the map or not. */
export const OBJECT_FIELD = "3D object";

export interface ObjectsFieldProps {
  entityId: string;
  /** The device's name on every screen (its ✕'s words). */
  name: string;
  /** The objects that show it (deviceRecord.objectLinks' byDevice). */
  objects: readonly string[];
  /** Every object of the model and what it shows: the search's rows. */
  links: ObjectLinks;
  onAdd: (object: string, entityId: string) => void;
  onTakeOff: (object: string, entityId: string) => void;
}

/**
 * ⚠️ ONE PLACE FOR A DEVICE'S 3D OBJECTS (owner, 2026-11-06): the objects that show it, linked by their name or bound,
 * each a pill with its ✕ (the same for every object: one linked by its name then shows nothing, mappingEdits.
 * takeObjectOff), then a compact "Add a 3D object…" search, as a group's Members. The search lists the model's
 * objects, those showing nothing first, each saying what it shows; picking one shows this device on it (bindMesh).
 * It replaced Villa's "Bound 3D objects" lists and Devices' "· 3D object: …" with its pencil.
 */
export function ObjectsField({ entityId, name, objects, links, onAdd, onTakeOff }: ObjectsFieldProps) {
  const nameOf = useEntityLabel();
  return (
    <div className="group-members">
      {objects.map((o) => (
        <RemovablePill key={o} label={o} removeLabel={`Take ${o} off ${name}`} onRemove={() => onTakeOff(o, entityId)} />
      ))}
      <div className="group-members-add">
        <SearchPicker compact placeholder="Add a 3D object…" onPick={(o) => onAdd(o, entityId)}
          empty={links.shows.size === 0 ? "No 3D model loaded yet." : undefined}
          rows={(q) => objectOffers(q, links, entityId).map(({ object, shows }) => ({
            key: object, label: <IdText id={object} />,
            side: shows === null ? "shows nothing yet" : `shows ${nameOf(shows)}, moves it here`,
          }))} />
      </div>
    </div>
  );
}

/**
 * "Confirm before toggling", on the device card's own line, at its right (owner, 2026-10-22: no checkbox among the
 * fields; owner, 2026-11-03: On | Off, as every on/off setting). Only for the types where a tap can act at once (CONFIRM_GATE_TYPES).
 */
export function ConfirmToggle({ m, draftField }: { m: EntityMapping; draftField: (change: Partial<EntityMapping>) => void }) {
  if (!CONFIRM_GATE_TYPES.has(m.type)) return null;
  return (
    <OnOffToggle ariaLabel="Confirm before toggling" className="config-confirm" on={!!m.requireConfirm}
      onChange={(requireConfirm) => draftField({ requireConfirm })}
      title="Confirm before toggling: a tap on its badge opens its window, and its on/off asks first"
      icon={<ShieldCheck size={16} />} label="Confirm before toggling" />
  );
}
