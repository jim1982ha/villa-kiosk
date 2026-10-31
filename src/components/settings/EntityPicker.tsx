// src/components/settings/EntityPicker.tsx
// Searchable dropdown over the LIVE Home Assistant entity list. This is what
// makes binding turnkey — you pick from real entities, not typed IDs.
//
// ⚠️ ONE OWNER OF A DEVICE'S NAME (owner, 2026-10-28): it showed the villa's system's raw name, deliberately (so a
// device renamed in VESTA stayed findable by the name the villa's system knows), and was the one screen calling a
// device something else. It SHOWS the name every screen shows (labelOf), and its search finds BOTH names, the room and
// the id (deviceRecord.deviceSearchTexts, every device search's), so renaming a device never makes it unfindable.

import { useState } from "react";
import { X } from "lucide-react";
import SearchPicker, { type SearchRow } from "@/components/common/SearchPicker";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { labelOf } from "@/config/EntityMap";
import { entitySearch } from "@/config/deviceRecord";
import { useDeviceSearch } from "@/hooks/useDeviceSearch";
import { ENTITY_ID_RE } from "@/utils/sh3dParser";
import { domainOf } from "@/utils/entityDomain";
import { deviceRowText } from "@/utils/entityValue";

interface Props {
  value?: string;
  onChange: (entityId: string) => void;
  /** Optionally restrict to certain domains, e.g. ["light","switch"]. */
  domains?: string[];
  placeholder?: string;
  /** Allow choosing an entity_id that doesn't exist in HA yet (free text). */
  allowCustom?: boolean;
  /** Hide the "Bound to X" label shown when a value is selected and closed. */
  hideCurrentLabel?: boolean;
  /** Renders a small "×" in the search box once a value is set, calling this
   *  to unset it. Omitted entirely for pickers where clearing wouldn't make
   *  sense (a mesh's own primary binding already has its own "Unbind"
   *  button; a picker with no `value` at all, e.g. "add another member", has
   *  nothing to clear) — only pass this for genuinely OPTIONAL links
   *  (linkedEntityId), which previously had no way at all to
   *  go back to "unset" once something had been picked. */
  onClear?: () => void;
  /** Shrinks the search box to sit inline at the height of a small pill (e.g.
   *  GroupedDevices' "add another member" row, alongside the member pills
   *  themselves) instead of its normal standalone-field size. */
  compact?: boolean;
}


export default function EntityPicker({
  value, onChange, domains, placeholder, allowCustom, hideCurrentLabel, onClear, compact,
}: Props) {
  const { entities } = useHA();
  const { entityMap } = useConfig().config;
  const nameOf = (id: string) => labelOf(id, entityMap, entities);
  const search = useDeviceSearch();
  // the list's open state is the shell's (SearchPicker); the selection's words show while it is closed
  const [open, setOpen] = useState(false);

  const rows = (query: string): SearchRow[] => entitySearch(query, search, domains)
    // Worded as every other row (deviceRowText): "Normal", "21.4 °C" — not "off", "21.4"
    .map((id) => ({ key: id, label: nameOf(id), sub: id, side: deviceRowText(entities[id], domainOf(id)) }));

  const selected = value ? entities[value] : undefined;
  // What to show once a pick has been made — the entity's name as every screen shows it, or (allowCustom) the raw
  // entity_id itself if it doesn't exist in HA yet. This MUST win over a caller-supplied `placeholder` (e.g. "New
  // entity ID…" on the rename picker): `placeholder` is a static hint for the empty state, so `placeholder ??
  // selectedLabel` always picked the static hint once it was non-null, silently hiding the selection the user just
  // made (the picker looked untouched after clicking a dropdown row, even though `value`/`onChange` had already fired).
  const selectedLabel = value && !open ? (selected ? nameOf(value) : value) : undefined;

  return (
    <>
      <SearchPicker
        onOpenChange={setOpen}
        rows={rows}
        onPick={onChange}
        compact={compact}
        placeholder={selectedLabel ?? placeholder ?? "Search entities…"}
        before={(query) => (allowCustom && ENTITY_ID_RE.test(query.trim()) && !entities[query.trim()]
          ? { key: query.trim(), label: `Use "${query.trim()}"`, sub: "entity not there yet, will activate when it appears", strong: true }
          : null)}
        empty={Object.keys(entities).length === 0 && !allowCustom ? "Entities show once connected." : undefined}
        // Only when there's actually something TO clear and the caller wants that offered (the shell hides it while
        // the list is open, where it would just sit awkwardly next to an in-progress search).
        trailing={onClear && value && (
          <button
            type="button"
            className="icon-btn entity-picker-clear"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            title={`Clear (was ${value})`}
            aria-label={`Clear selection (was ${value})`}
          >
            <X size={16} />
          </button>
        )}
      />

      {!hideCurrentLabel && value && !open && (
        <div className="muted body-text" style={{ marginTop: 6 }}>
          Bound to <strong>{value}</strong>
        </div>
      )}
    </>
  );
}
