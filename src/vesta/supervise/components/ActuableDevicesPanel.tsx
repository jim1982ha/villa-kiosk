// src/components/settings/ActuableDevicesPanel.tsx
//
// WHICH devices the villa may operate on its own. The second half of the
// actuation switch, and until v2.718.0 there was no way to fill it in.
//
// ⚠️ THE SWITCH AND THIS LIST ARE AND-ED, AND THAT IS THE WHOLE SAFETY MODEL.
// `agent/config.may_act` requires both, so turning actuation on with an empty
// list authorises exactly nothing — which is the correct default for a control
// somebody may flip to see what happens, and is why the empty state below says
// so out loud rather than reading as "not configured yet". An owner who turns
// the switch on and sees nothing happen deserves to know why on the same screen.
//
// ⚠️ IT STORES ENTITY IDS, AND STORING THE MODEL'S HANDLES WAS THE BUG THIS
// PANEL COULD NOT HAVE BEEN BUILT OVER. `agent/refs.py` mints `d1`, `d2` … per
// RUN and says in its own docstring that they are deliberately unstable — so a
// stored `["d1"]` authorised whichever device that run read first. Measured:
// the same stored line authorised a pool pump in one run and a front door in
// the next. There was nothing coherent to put in a picker until that was fixed.
//
// ⚠️ THE CANDIDATES COME FROM `selectableDeviceIds`, VIA THE SAME
// `buildDeviceOptions` THE FACILITY PICKER USES. "What counts as a device" is
// one rule for this whole app (CLAUDE.md), and a second list built here would
// offer rows no other screen shows — exactly the defect that function's own
// docstring records. Reusing the picker also means the search, the offline hint
// and the keyboard behaviour are the ones already tested.

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import DeviceSearchPicker, { buildDeviceOptions,
                             type DeviceOption } from "@/components/fm/DeviceSearchPicker";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";

export default function ActuableDevicesPanel({
  value, onChange, disabled, locked,
}: {
  /** The stored allow-list, as Home Assistant entity ids. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** True while the draft is being written. */
  disabled?: boolean;
  /** True when the master switch is off: the whole group is inert. */
  locked?: boolean;
}) {
  const { config, resolvedRooms } = useConfig();
  const { entities } = useHA();
  // ⚠️ NO `matchedEntityId` STATE. That prop renders the picker's "linked"
  // treatment for a box that currently NAMES one device; here the box is an
  // ADD control that empties on selection, so a linked state would be a badge
  // for a device already moved into the list above it.
  const [text, setText] = useState("");

  // ⚠️ AN EMPTY `mappedEntityIds`, DELIBERATELY AND NOT FOR CONVENIENCE. That
  // set is mesh-derived and only exists at the app root; threading it down
  // through two modals to reach here would widen this list with devices the
  // MODEL names but Home Assistant does not have — and a device Home Assistant
  // does not have is one no service call can reach. Narrower and real is the
  // right side to err on for an authorisation list. `selectableDeviceIds`
  // already requires `entities[id]` for anything not mesh-derived, so this is
  // its own rule with the one input that cannot help us removed.
  const options = useMemo(
    () => buildDeviceOptions(config.entityMap, entities, resolvedRooms,
                             config.deviceGroups, new Set<string>(),
                             config.dismissedEntityIds),
    [config.entityMap, entities, resolvedRooms, config.deviceGroups,
     config.dismissedEntityIds],
  );

  const labelOf = useMemo(() => {
    const byId = new Map(options.map((o) => [o.entityId, o]));
    return (entityId: string): DeviceOption | undefined => byId.get(entityId);
  }, [options]);

  const add = (opt: DeviceOption) => {
    setText("");
    // ⚠️ NO DUPLICATES, because two identical rows read as two grants and
    // removing one would look like it had failed.
    if (value.includes(opt.entityId)) return;
    onChange([...value, opt.entityId]);
  };

  // ⚠️ NO TITLE AND NO NOTE OF ITS OWN. This is the SECOND HALF of the control
  // above it — the switch says "allow it to control devices" and this says
  // which — so a heading between them announced a new section for something
  // that is one decision, and the owner reported the pair reading as two. The
  // safety rule moved into the switch's own hint for the same reason: it
  // qualifies the whole permission, not this list.
  //
  // ⚠️ AND IT GREYS OUT WITH THE SWITCH. An enabled picker under an unticked
  // box invites an owner to build a list that authorises nothing — the state
  // 2.718.0 shipped and nobody could see. `pointer-events` plus `disabled` on
  // every control, so it is unreachable by keyboard too rather than only dim.
  return (
    <div className="fm-stack" aria-disabled={locked || undefined}
         style={{ marginTop: 4, opacity: locked ? 0.45 : undefined,
                  pointerEvents: locked ? "none" : undefined }}>
      {/* ⚠️ A `div`, NOT A `label`, AND BOTH EXISTING CALLERS OF THIS PICKER
          AGREE. `DeviceSearchPicker` is a composite: an input with an absolutely
          positioned suggestion list beneath it. Wrapping that in a `label`
          makes every suggestion row part of the label's activation area, so a
          tap on a row also refocuses the input — on a touch screen that is the
          difference between choosing a device and reopening the keyboard over
          the list you were choosing from. The `span` still labels it visually
          through `.fm-field > span`. */}
      <div className="fm-field" style={{ marginTop: 0 }}>
        <DeviceSearchPicker
          value={text}
          onChangeText={setText}
          onSelect={add}
          onClear={() => setText("")}
          options={options}
          placeholder="Search and add devices to allow control"
        />
      </div>
      {value.length === 0 ? (
        // ⚠️ THE EMPTY STATE STATES THE CONSEQUENCE, NOT THE ABSENCE. "No
        // devices selected" would read as a form waiting to be filled; what an
        // owner needs to know is that the switch above is currently doing
        // nothing, which is a fact about the villa rather than about this form.
        <p className="muted body-text">
          Nothing added yet, so the villa still cannot change anything.
        </p>
      ) : (
        value.map((entityId) => {
          const opt = labelOf(entityId);
          return (
            <div key={entityId} className="editable-row-card">
              <div className="editable-row" style={{ marginTop: 8 }}>
                <div className="editable-row-fields editable-row-tight">
                  <div className="body-text">
                    {opt?.label ?? entityId}
                    {/* ⚠️ A DEVICE THAT NO LONGER EXISTS STILL SHOWS, and says
                        so. Dropping unknown ids from this list would quietly
                        edit an authorisation an owner made, and re-adding a
                        renamed entity is their decision, not this panel's. */}
                    {!opt && (
                      <span className="muted"> — not found in this villa</span>
                    )}
                    {opt?.room && <span className="muted"> · {opt.room}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn danger icon-only"
                  disabled={disabled || locked}
                  aria-label={`Stop the villa operating ${opt?.label ?? entityId}`}
                  onClick={() => onChange(value.filter((id) => id !== entityId))}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            </div>
          );
        })
      )}

    </div>
  );
}
