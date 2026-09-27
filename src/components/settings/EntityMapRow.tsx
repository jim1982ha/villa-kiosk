// src/components/settings/EntityMapRow.tsx
// One row of ConfigEditor's auto-detected-entities table, split out and
// React.memo'd — see ConfigEditor's own comment on WHY. In short: every field
// here used to keep its "not-yet-committed" draft state (see useDraftCommit)
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
import { Pencil, Trash2, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import EntityPicker from "./EntityPicker";
import { useDraftCommit } from "@/hooks/useDraftCommit";
import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import MappingFields from "./MappingFields";


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
  expanded: boolean;
  editing: boolean;
  /** Only meaningful when `editing` — the parent always passes undefined for
   *  every non-editing row so their props stay stable while the one row being
   *  remapped re-renders on its own picker's every keystroke. */
  remapNewId: string | undefined;
  matchedRowRef?: RefObject<HTMLTableRowElement>;
  onToggleExpanded: (key: string) => void;
  onStartRemap: (key: string) => void;
  onRemapChange: (id: string | undefined) => void;
  onRemapApply: (key: string, newId: string) => void;
  onRemapCancel: () => void;
  onRemove: (key: string) => void;
  /** Stable identity (reads the latest config via a ref internally) — see
   *  ConfigEditor's patch(). Passing the SAME function to every row is what
   *  lets React.memo's default shallow-prop comparison actually work. */
  onPatch: (key: string, change: Partial<EntityMapping>) => void;
}

function EntityMapRow({
  entryKey, mapping, entity, stale, expanded, editing, remapNewId, matchedRowRef,
  onToggleExpanded, onStartRemap, onRemapChange, onRemapApply, onRemapCancel, onRemove, onPatch,
}: Props) {
  // Draft state is now scoped to THIS ROW's own component instance (one hook
  // instance per mounted row, keyed internally by a constant since there's
  // only ever one "self" to draft for) — see useDraftCommit's docstring for
  // the general instant-echo/debounced-commit pattern this follows.
  // The show-in-3D toggle is this row's own field; every other field is
  // MappingFields', shared with the bound-objects table.
  const field = useDraftCommit<Partial<EntityMapping>>((_k, change) => onPatch(entryKey, change));
  const draftField = (change: Partial<EntityMapping>) =>
    field.draft("v", { ...field.drafts.v, ...change });

  // Merge in any not-yet-committed edit so the control reflects the click
  // instantly, even while the heavy commit is pending.
  const m = field.drafts.v ? { ...mapping, ...field.drafts.v } : mapping;

  return (
    <tr
      ref={matchedRowRef}
      className={stale ? "config-row-stale" : undefined}
      style={m.disabled ? { opacity: 0.5 } : undefined}
      title={stale ? `${m.entityId} no longer exists in Home Assistant` : undefined}
    >
      <td data-label="" className="device-card-header">
        <input
          type="checkbox"
          checked={!m.disabled}
          onChange={(e) => draftField({ disabled: !e.target.checked })}
          title="Show this device in the 3D view (badge, highlight, tap). Turn off for devices modelled but not yet integrated in Home Assistant."
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
            </div>
          </div>
        ) : (
          <div
            className="entity-id-display entity-id-toggle"
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            title="Click to expand — use the pencil to redirect this mesh to a different entity ID"
            onClick={() => onToggleExpanded(entryKey)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleExpanded(entryKey); }
            }}
          >
            <span className="entity-id-text">{m.entityId}</span>
            <span className="entity-id-actions">
              <button
                className="icon-btn"
                title="Redirect this 3D mesh to a different entity ID"
                onClick={(e) => { e.stopPropagation(); onStartRemap(entryKey); }}
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon-btn icon-btn-danger"
                title="Remove this entity"
                onClick={(e) => { e.stopPropagation(); onRemove(entryKey); }}
              >
                <Trash2 size={16} />
              </button>
            </span>
            {expanded ? <ChevronDown size={16} className="muted" /> : <ChevronRight size={16} className="muted" />}
          </div>
        )}
      </td>

      {editing && (
        <td data-label="">
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-secondary)" }}>
            Mesh stays, entity ID changes — no model rebuild needed.
          </span>
        </td>
      )}

      {expanded && !editing && (
        <MappingFields entityId={m.entityId} mapping={m} entity={entity}
          onPatch={(change) => onPatch(entryKey, change)}
          cell={(key, label, field, opts) => (
            <td key={key} data-label={label} className={opts?.pair ? "config-cell-pair" : undefined}
              style={opts?.pair ? { minWidth: 180 } : undefined}>{field}</td>
          )} />
      )}
    </tr>
  );
}

export default memo(EntityMapRow);
