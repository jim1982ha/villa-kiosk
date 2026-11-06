// src/components/settings/EntityMapRow.tsx
// One row of ConfigEditor's auto-detected-entities table, split out and
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

import InfoTip from "@/components/common/InfoTip";
import { memo, type RefObject } from "react";
import { Pencil, Check, X } from "lucide-react";
import EntityPicker from "./EntityPicker";
import IdText from "@/components/common/IdText";
import RecordCard from "@/components/fm/RecordCard";
import CardField from "./CardField";
import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import MappingFields, { ConfirmToggle, useMappingDraft } from "./MappingFields";


interface Props {
  entryKey: string;
  mapping: EntityMapping;
  /** This row's OWN live entity — a narrow slice of useHA()'s entities map
   *  (which gets a new reference on every state_changed for ANY device),
   *  passed down already-extracted so this row's props only actually change
   *  when ITS entity changes, not the whole house's. */
  entity: HassEntity | undefined;
  /** Home Assistant has no such entity (renamed/removed there) — the row is
   *  dead config. Flagged rather than auto-deleted: the entry may still carry
   *  a label/room the user wants to re-point at the renamed entity via
   *  "Change entity ID". See ConfigEditor's stale-cleanup banner. */
  stale?: boolean;
  /** 3D objects linked to this device by name (by hand, or by "change entity") — said under its id,
   *  since this one list now holds hand-linked devices too (config/deviceRecord). */
  objects?: readonly string[];
  editing: boolean;
  /** Only meaningful when `editing` — the parent always passes undefined for
   *  every non-editing row so their props stay stable while the one row being
   *  remapped re-renders on its own picker's every keystroke. */
  remapNewId: string | undefined;
  matchedRowRef?: RefObject<HTMLDivElement>;
  /** The device's name on every screen (useEntityLabel, read by the list: a row reads no live table of its own). */
  name: string;
  onStartRemap: (key: string) => void;
  onRemapChange: (id: string | undefined) => void;
  onRemapApply: (key: string, newId: string) => void;
  onRemapCancel: () => void;
  /** Absent for an object the 3D model names: it is never removed here (dismissedEntities). */
  onRemove?: (key: string) => void;
}

function EntityMapRow({
  entryKey, mapping, entity, stale, objects, editing, remapNewId, matchedRowRef, name,
  onStartRemap, onRemapChange, onRemapApply, onRemapCancel, onRemove,
}: Props) {
  // A change waits in the dialog's one pending store under this row's entity
  // id (MappingFields.useMappingDraft): only this row re-renders while it waits.
  // The show-in-3D toggle is this row's own field; every other field is
  // MappingFields', shared with the bound-objects table.
  // Not-yet-committed edits show at once (MappingFields.useMappingDraft).
  const { draftField, m } = useMappingDraft(entryKey, mapping);

  // ⚠️ THE COCKPIT'S CARD (owner, 2026-11-06: "the same card in Settings and Advanced Settings"): the device's name in
  // its strip; its first line of words the decided one (owner, 2026-11-05: the shown box, the id at most 2 lines, the
  // toggle and the pencil at its right; on a phone the toggle on a line of its own under it: 04-modals.css); its fields
  // always shown under it; its bin at its strip's right (owner, 2026-11-06), so it has no bar. A device the villa's system no longer has says so as the
  // card's state. ⚠️ NEVER FOLDED, NO ROOM LINE (owner, 2026-11-06: the chevron hid its fields; its room under its name
  // said nothing the name did not, "no added value").
  return (
    <RecordCard title={name} tone={m.disabled ? "device-card-off" : undefined}
      status={stale ? { text: "No longer exists", tone: "tone-warn" } : undefined}
      body={
        <div className="device-card" ref={matchedRowRef} title={stale ? `${m.entityId} no longer exists` : undefined}>
          <div className="device-first-line">
            <input
              type="checkbox"
              checked={!m.disabled}
              onChange={(e) => draftField({ disabled: !e.target.checked })}
              title="Show this device in the 3D view (badge, highlight, tap). Turn off for devices modelled but not yet installed."
              aria-label={`Show ${m.entityId} in the 3D view`}
            />
            {editing ? (
              /* ── inline remap picker — one line on desktop, wraps on mobile ── */
              <div className="remap-row">
                <div className="remap-picker">
                  <EntityPicker
                    value={remapNewId}
                    onChange={onRemapChange}
                    allowCustom
                    hideCurrentLabel
                    placeholder="New entity ID…"
                  />
                </div>
                <div className="remap-actions">
                  <button
                    className="btn primary"
                    style={{ padding: "5px 8px", fontSize: "var(--text-xs)" }}
                    disabled={!remapNewId || remapNewId === entryKey}
                    onClick={() => remapNewId && onRemapApply(entryKey, remapNewId)}
                  >
                    <Check size={16} /> Apply
                  </button>
                  <button
                    className="btn ghost"
                    style={{ padding: "5px 8px", fontSize: "var(--text-xs)" }}
                    onClick={onRemapCancel}
                  >
                    <X size={16} /> Cancel
                  </button>
                  {/* an explanation is an (i), never a visible line (owner, 2026-10-22) */}
                  <InfoTip label="About redirecting this object">The 3D object stays and its entity ID changes: no model rebuild is needed.</InfoTip>
                </div>
              </div>
            ) : (
              <div className="entity-id-display">
                {/* ⚠️ ONE FIRST LINE (owner, 2026-11-05): the id, never more than 2 lines (its whole text on hover), the
                    toggle and the pencil at its right */}
                <span className="entity-id-text" title={[m.entityId, ...(objects ?? [])].join(" · ")}>
                  <IdText id={m.entityId} />
                  {!!objects?.length && (
                    <span className="muted entity-id-link" title="This device's 3D object, linked by name">
                      {" "}· 3D object: {objects.join(", ")}
                    </span>
                  )}
                </span>
                <span className="entity-id-tools">
                  {/* the one small icon button of a list's row (owner, 2026-11-06) */}
                  <button
                    type="button" className="icon-btn-sm"
                    title="Redirect this 3D mesh to a different entity ID" aria-label={`Redirect ${m.entityId} to another entity ID`}
                    onClick={(e) => { e.stopPropagation(); onStartRemap(entryKey); }}
                  >
                    <Pencil size={16} aria-hidden />
                  </button>
                </span>
                <span className="entity-id-confirm">
                  <ConfirmToggle m={m} draftField={draftField} />
                </span>
              </div>
            )}
          </div>
          {!editing && (
            <MappingFields entryKey={entryKey} entityId={m.entityId} mapping={m} entity={entity}
              cell={(key, label, field) => (
                <CardField key={key} label={label}>{field}</CardField>
              )} />
          )}
        </div>
      }
      // an object the 3D model names is never removed here
      remove={onRemove && { icon: "bin", label: `Remove ${name}'s settings`, run: () => onRemove(entryKey) }} />
  );
}

export default memo(EntityMapRow);
