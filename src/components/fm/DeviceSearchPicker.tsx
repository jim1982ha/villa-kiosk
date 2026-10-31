// src/components/fm/DeviceSearchPicker.tsx
// A search-and-select device field, shared by the fault form and the Spend tab (a
// fault or a cost entry both want "which device is this about", with the same
// two requirements: search across every configured device without dumping the
// whole list, and accept free text when the device isn't in it — a spare part,
// a device not yet in Home Assistant, or a whole-villa expense with no single
// device behind it).
//
// Deliberately built against config.entityMap, NOT Settings' EntityPicker's
// live Home Assistant entity list: entityMap is already the villa's curated
// per-device table (the same one every other FM/Settings screen treats as
// "the devices"), while raw HA entities can run into the hundreds across an
// instance, most with nothing to do with this villa. Searching that would be
// exactly the "list becomes huge" problem this was asked to avoid. The two
// pickers also differ on free text: EntityPicker's allowCustom only accepts
// something shaped like a real entity_id (it's binding a HA entity that
// doesn't exist yet); this accepts ANY text, because "Spare pool pump" is a
// legitimate device description here, not an entity_id.
//
// ⚠️ THE SHARED PICKER'S LIST, IN ITS FREE-TEXT MODE (architecture review 2026-10-31 round 12 #2): this file built
// its own box, eight results and a list that opened only once something was typed, before common/SearchPicker
// existed; its search was its own too. It is now that picker's rows (deviceSearchRows: every device search's texts,
// the names starting with what is typed first) and its `text` mode, which keeps what was typed as the value.
//
// Fully controlled, no internal value state — mirrors the plain controlled
// <input>s already used for `title`/`label` elsewhere in these forms, so a
// quick-pick chip and this box can drive the exact same parent state without
// a resync problem.

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { EntityMapping } from "@/types/scene.types";
import { labelOf } from "@/config/EntityMap";
import type { VillaDevices } from "@/config/deviceGroups";
import { lostContact } from "@/utils/stateColors";
import { deviceRoom } from "@/config/devicePlace";
import type { HassEntity } from "@/types/ha.types";
import { deviceSearchTexts, matchesQuery, type SearchSource } from "@/config/deviceRecord";
import { useDeviceSearch } from "@/hooks/useDeviceSearch";
import SearchPicker, { type SearchRow } from "@/components/common/SearchPicker";

export interface DeviceOption {
  entityId: string;
  label: string;
  room?: string;
  /** True when Home Assistant currently reports this device as offline —
   *  surfaced in the dropdown because that is very often WHY someone is
   *  raising a fault against it. */
  offline?: boolean;
}

/** Every candidate a fault/cost entry could point at — one row per real
 *  device, sorted for a stable, scannable dropdown. Shared by both tabs so
 *  neither can build its candidate list a different way from the other.
 *
 *  WHICH devices those are is not decided here: selectableDeviceIds owns that
 *  rule for the whole app. This used to enumerate `entityMap` directly with
 *  only `disabled` filtered, which let three classes of non-device through —
 *  entries Home Assistant has never heard of, entries the owner had removed,
 *  and every member of a multi-entity device — none of which appear anywhere
 *  else in the UI. The result was a picker offering rows like "Bedroom 1"
 *  that named nothing anyone could find in the villa. */
export function buildDeviceOptions(
  devices: VillaDevices,
  entityMap: Record<string, EntityMapping>,
  entities: Record<string, HassEntity>,
  resolvedRooms: Record<string, string>,
): DeviceOption[] {
  return [...devices.ids]
    .map((id) => ({
      entityId: id,
      label: labelOf(id, entityMap, entities),
      room: deviceRoom(resolvedRooms, id),
      offline: lostContact(entities, id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The devices a typed search finds, by what every device search finds a device by (deviceSearchTexts); those whose
 *  name starts with it first, then the rest, each in the options' order. Everything for an empty search. Pure. */
export function deviceSearchRows(options: readonly DeviceOption[], query: string, src: SearchSource): DeviceOption[] {
  const q = query.trim().toLowerCase();
  const found = options.filter((o) => matchesQuery(q, ...deviceSearchTexts(o.entityId, src)));
  return [...found.filter((o) => o.label.toLowerCase().startsWith(q)), ...found.filter((o) => !o.label.toLowerCase().startsWith(q))];
}

function roomHint(room: string | undefined): string {
  return room?.trim() || "no room set";
}

/** A device as the shared picker's row: its name with the offline flag, then its id and room. */
function rowOf(o: DeviceOption): SearchRow {
  return {
    key: o.entityId,
    label: <span className="fm-picker-label">
      {o.label}
      {o.offline && <span className="fm-picker-flag offline">offline</span>}
    </span>,
    // The entity_id is shown, not just the friendly label: a row reading "Hallway" tells an operator nothing they can
    // act on, while "sensor.hallway_temperature" names it exactly. The room comes second, the weaker hint of the two.
    sub: <span className="fm-picker-meta"><code>{o.entityId}</code><span>{roomHint(o.room)}</span></span>,
  };
}

export default function DeviceSearchPicker({
  value, onChangeText, onSelect, onClear, options, placeholder, matchedEntityId,
}: {
  /** Current text in the box — either a free-typed description or the label
   *  of whichever device was last selected. */
  value: string;
  /** Every keystroke. Typing again after a selection is what starts a new
   *  search — the caller is expected to clear `matchedEntityId` alongside. */
  onChangeText: (text: string) => void;
  /** A suggestion was clicked — confirms both the device and its label. */
  onSelect: (opt: DeviceOption) => void;
  /** Explicit clear (the × button). */
  onClear: () => void;
  options: DeviceOption[];
  placeholder?: string;
  /** Set when `value` currently names a real, matched device — renders the
   *  clear affordance and a small "linked" hint instead of a bare textbox. */
  matchedEntityId?: string;
}) {
  const src = useDeviceSearch();
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(options.map((o) => [o.entityId, o])), [options]);
  return (
    <>
      <SearchPicker
        text={{ value, onChange: onChangeText }}
        rows={(query) => deviceSearchRows(options, query, src).map(rowOf)}
        onPick={(id) => { const o = byId.get(id); if (o) onSelect(o); }}
        onOpenChange={setOpen}
        placeholder={placeholder ?? "Search devices, or type a description…"}
        none={(q) => `No device matches "${q}", it will be saved as free text.`}
        trailing={value && (
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }}
            onClick={onClear} aria-label="Clear device">
            <X size={16} />
          </button>
        )}
      />
      {matchedEntityId && !open && (
        <div className="muted body-text field-hint">
          Linked to <strong>{matchedEntityId}</strong>
        </div>
      )}
      {!matchedEntityId && value.trim() && !open && (
        <div className="muted body-text field-hint">
          No matching device, this will be saved as free text.
        </div>
      )}
    </>
  );
}
