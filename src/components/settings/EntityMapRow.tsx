// src/components/settings/EntityMapRow.tsx
// One device's card in ConfigEditor (Advanced Settings › Devices), split out and
// React.memo'd — see ConfigEditor's own comment on WHY. In short: every field
// here used to keep its "not-yet-committed" draft state
// in a flat Record<entityKey, T> living in ConfigEditor itself, so typing a
// single character in ONE row's Label field re-rendered ConfigEditor, which
// re-ran its ENTIRE entries.map() — recomputing every OTHER row's JSX (Type/
// Category selects, room dropdown options, motion-sensor picker) on every
// keystroke, not just the row being edited. ConfigEditor also reads live HA
// `entities` at the top level, so the same full-table re-render fired on
// every state_changed event for ANY device in the house, typing or not.
// Moving each row's draft state (and its own narrowly-scoped `entity` prop)
// down HERE means a keystroke, a drag, or someone else's sensor updating only
// re-renders THIS row — every other row's props stay referentially identical,
// so React.memo bails out on them without re-running their render function at
// all. This is the actual fix for the reported per-keystroke lag; the earlier
// debounce (still here) and SceneManager's frame-yielding (still there too)
// remain necessary for the HEAVY commit itself, but neither one touches this
// separate, purely-React cost.

import { memo, type RefObject } from "react";
import IdText from "@/components/common/IdText";
import EntityCard from "./EntityCard";
import CardField from "./CardField";
import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import MappingFields, { ConfirmToggle, OBJECT_FIELD, ObjectsField, useMappingDraft, type ObjectsFieldProps } from "./MappingFields";


interface Props {
  entryKey: string;
  /** Its stored mapping; absent for a device not on the map (no mapping yet: Devices' "not on the map" list), whose
   *  card is its "3D object" field alone, picking an object putting it on the map. */
  mapping?: EntityMapping;
  /** This row's OWN live entity — a narrow slice of useHA()'s entities map
   *  (which gets a new reference on every state_changed for ANY device),
   *  passed down already-extracted so this row's props only actually change
   *  when ITS entity changes, not the whole house's. */
  entity: HassEntity | undefined;
  /** Home Assistant has no such entity (renamed/removed there) — the row is
   *  dead config. Flagged rather than auto-deleted: the entry may still carry
   *  a label the owner wants to keep. See ConfigEditor's stale-cleanup banner. */
  stale?: boolean;
  /** Its "3D object" field: the objects that show it, every object of the model, its two edits. Each its own prop,
   *  each stable while nothing it says changes, so React.memo skips the other cards. */
  objects: ObjectsFieldProps["objects"];
  links: ObjectsFieldProps["links"];
  onAddObject: ObjectsFieldProps["onAdd"];
  onTakeObjectOff: ObjectsFieldProps["onTakeOff"];
  matchedRowRef?: RefObject<HTMLDivElement>;
  /** The device's name on every screen (useEntityLabel, read by the list: a row reads no live table of its own). */
  name: string;
  /** Absent for an object the 3D model names: it is never removed here (dismissedEntities). */
  onRemove?: (key: string) => void;
}

function EntityMapRow({
  entryKey, mapping, entity, stale, objects, links, onAddObject, onTakeObjectOff, matchedRowRef, name, onRemove,
}: Props) {
  const field: ObjectsFieldProps = { entityId: entryKey, name, objects, links, onAdd: onAddObject, onTakeOff: onTakeObjectOff };
  // ⚠️ THE COCKPIT'S CARD (owner, 2026-11-06: "the same card in Settings and Advanced Settings"): the device's name in
  // its strip; its first line of words the decided one (owner, 2026-11-05: the shown box, the id at most 2 lines, the
  // toggle at its right; on a phone the toggle on a line of its own under it: 04-modals.css); its fields always shown
  // under it, "3D object" the first (owner, 2026-11-06); its bin at its strip's right (owner, 2026-11-06), so it has no bar. A device the
  // villa's system no longer has says so as the card's state. ⚠️ NEVER FOLDED, NO ROOM LINE (owner, 2026-11-06: the
  // chevron hid its fields; its room under its name said nothing the name did not, "no added value"). A device not on
  // the map is the same card, its id alone on its first line, its "3D object" field empty.
  return (
    <EntityCard entityId={entryKey} idLine={!mapping} tone={mapping?.disabled ? "device-card-off" : undefined}
      status={stale ? { text: "No longer exists", tone: "tone-warn" } : undefined}
      body={mapping
        ? <DeviceFields entryKey={entryKey} mapping={mapping} entity={entity} stale={stale} matchedRowRef={matchedRowRef} objects={field} />
        : <CardField label={OBJECT_FIELD}><ObjectsField {...field} /></CardField>}
      // an object the 3D model names is never removed here
      remove={onRemove && { label: `Remove ${name}'s settings`, run: () => onRemove(entryKey) }} />
  );
}

/** A device on the map: its shown box, its id and Confirm before toggling on its first line, then its fields. */
function DeviceFields({ entryKey, mapping, entity, stale, matchedRowRef, objects }: {
  entryKey: string; mapping: EntityMapping; entity: HassEntity | undefined; stale?: boolean;
  matchedRowRef?: RefObject<HTMLDivElement>; objects: ObjectsFieldProps;
}) {
  // A change waits in the dialog's one pending store under this row's entity
  // id (MappingFields.useMappingDraft): only this row re-renders while it waits.
  // The show-in-3D toggle is this row's own field; every other field is MappingFields'.
  const { draftField, m } = useMappingDraft(entryKey, mapping);
  return (
    <div className="device-card" ref={matchedRowRef} title={stale ? `${m.entityId} no longer exists` : undefined}>
      <div className="device-first-line">
        <input
          type="checkbox"
          checked={!m.disabled}
          onChange={(e) => draftField({ disabled: !e.target.checked })}
          title="Show this device in the 3D view (badge, highlight, tap). Turn off for devices modelled but not yet installed."
          aria-label={`Show ${m.entityId} in the 3D view`}
        />
        <div className="entity-id-display">
          {/* ⚠️ ONE FIRST LINE (owner, 2026-11-05): the id, never more than 2 lines (its whole text on hover), the
              toggle at its right; its 3D objects are its "3D object" field (owner, 2026-11-06), never on this line */}
          <span className="entity-id-text" title={m.entityId}>
            <IdText id={m.entityId} />
          </span>
          <span className="entity-id-confirm">
            <ConfirmToggle m={m} draftField={draftField} />
          </span>
        </div>
      </div>
      <MappingFields entryKey={entryKey} entityId={m.entityId} mapping={m} entity={entity} objects={objects}
        cell={(key, label, field) => (
          <CardField key={key} label={label}>{field}</CardField>
        )} />
    </div>
  );
}

export default memo(EntityMapRow);
