// src/components/fm/DeviceSearchPicker.tsx
// A search-and-select device field, shared by the Faults and Spend tabs (a
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
// Fully controlled, no internal value state — mirrors the plain controlled
// <input>s already used for `title`/`label` elsewhere in these forms, so a
// quick-pick chip and this box can drive the exact same parent state without
// a resync problem.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { EntityMapping } from "@/types/scene.types";
import { displayLabelFor } from "@/config/EntityMap";
import { selectableDeviceIds } from "@/config/deviceGroups";
import { isUnavailable } from "@/utils/stateColors";
import type { DeviceGroup } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";

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
  entityMap: Record<string, EntityMapping>,
  entities: Record<string, HassEntity>,
  resolvedRooms: Record<string, string>,
  deviceGroups: DeviceGroup[] = [],
  mappedEntityIds: ReadonlySet<string> = new Set(),
  dismissedEntityIds: readonly string[] = [],
): DeviceOption[] {
  return selectableDeviceIds(entityMap, deviceGroups, mappedEntityIds, entities,
                             dismissedEntityIds)
    .map((id) => ({
      entityId: id,
      label: displayLabelFor(id, entityMap[id]?.label, entities[id]?.attributes.friendly_name),
      room: resolvedRooms[id],
      offline: isUnavailable(entities[id]),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const MAX_RESULTS = 8;

function roomHint(room: string | undefined): string {
  return room?.trim() || "no room set";
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const results = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const starts: DeviceOption[] = [];
    const contains: DeviceOption[] = [];
    for (const o of options) {
      const hay = `${o.label} ${o.room ?? ""} ${o.entityId}`.toLowerCase();
      if (!hay.includes(q)) continue;
      (o.label.toLowerCase().startsWith(q) ? starts : contains).push(o);
    }
    return [...starts, ...contains].slice(0, MAX_RESULTS);
  }, [value, options]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div className="config-search" style={{ marginBottom: 0 }}>
        <Search size={16} />
        <input
          value={value}
          placeholder={placeholder ?? "Search devices, or type a description…"}
          onFocus={() => setOpen(true)}
          onChange={(e) => { onChangeText(e.target.value); setOpen(true); }}
        />
        {value && (
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }}
            onClick={() => { onClear(); setOpen(false); }} aria-label="Clear device">
            <X size={16} />
          </button>
        )}
      </div>

      {matchedEntityId && !open && (
        <div className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-xs)" }}>
          Linked to <strong>{matchedEntityId}</strong>
        </div>
      )}
      {!matchedEntityId && value.trim() && !open && (
        <div className="muted body-text" style={{ marginTop: 6, fontSize: "var(--text-xs)" }}>
          No matching device — this will be saved as free text.
        </div>
      )}

      {open && value.trim() && (
        <div
          style={{
            position: "absolute", zIndex: 20, left: 0, right: 0, marginTop: 6,
            maxHeight: 260, overflowY: "auto", background: "var(--bg-overlay)",
            border: "1px solid var(--hairline-strong)", borderRadius: 10,
          }}
        >
          {results.length === 0 && (
            <div className="muted body-text" style={{ padding: 12, fontSize: "var(--text-sm)" }}>
              No device matches "{value.trim()}" — it will be saved as free text.
            </div>
          )}
          {results.map((o) => (
            <button
              key={o.entityId}
              type="button"
              className="row"
              style={{ width: "100%", padding: "10px 12px", justifyContent: "flex-start", gap: 10, borderBottom: "1px solid var(--hairline)" }}
              // Fires before the input's onBlur, so the click registers
              // instead of the dropdown closing out from under it first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(o); setOpen(false); }}
            >
              {/* The entity_id is shown, not just the friendly label. A label
                  alone is frequently not enough to know what you are picking —
                  a row reading "Hallway" tells an operator nothing they can
                  act on, while "sensor.hallway_temperature" names the thing
                  exactly. The
                  room comes second because it is the weaker hint of the two
                  and is often not set at all. */}
              <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                <span className="fm-picker-label">
                  {o.label}
                  {o.offline && <span className="fm-picker-flag offline">offline</span>}
                </span>
                <span className="fm-picker-meta muted">
                  <code>{o.entityId}</code>
                  <span>{roomHint(o.room)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
