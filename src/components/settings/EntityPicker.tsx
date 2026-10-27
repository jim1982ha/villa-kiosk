// src/components/settings/EntityPicker.tsx
// Searchable dropdown over the LIVE Home Assistant entity list. This is what
// makes binding turnkey — you pick from real entities, not typed IDs.
//
// ⚠️ ONE OWNER OF A DEVICE'S NAME (owner, 2026-10-28): it showed the villa's system's raw name, deliberately (so a
// device renamed in VESTA stayed findable by the name the villa's system knows), and was the one screen calling a
// device something else. It SHOWS the name every screen shows (labelOf), and its search matches BOTH names and the id
// (EntityMap.matchesName), so renaming a device never makes it unfindable.

import { useRef, useMemo, useState } from "react";
import { useOutsideClose } from "@/hooks/useOutsideClose";
import { Search, X } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { labelOf, matchesName } from "@/config/EntityMap";
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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside tap or Escape closes the list and clears the query.
  useOutsideClose([containerRef], open, () => { setOpen(false); setQuery(""); });

  const list = useMemo(() => {
    return Object.values(entities)
      .filter((e) => !domains || domains.includes(domainOf(e.entity_id)))
      .filter((e) => matchesName(query, e.entity_id, entityMap, entities))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .slice(0, 60);
  }, [entities, entityMap, query, domains]);

  const selected = value ? entities[value] : undefined;
  // What to show once a pick has been made and the dropdown is closed —
  // the entity's name as every screen shows it, or (allowCustom) the raw entity_id
  // itself if it doesn't exist in HA yet. This MUST win over a caller-supplied
  // `placeholder` (e.g. "New entity ID…" on the rename picker): `placeholder`
  // is a static hint for the empty state, so `placeholder ?? selectedLabel`
  // always picked the static hint once it was non-null, silently hiding the
  // selection the user just made (the picker looked untouched after clicking
  // a dropdown row, even though `value`/`onChange` had already fired).
  const selectedLabel = value && !open ? (selected ? nameOf(value) : value) : undefined;

  return (
    <div ref={containerRef} className="picker">
      <div className={`config-search${compact ? " config-search-compact" : ""}`}>
        <Search size={compact ? 13 : 16} />
        <input
          placeholder={selectedLabel ?? placeholder ?? "Search entities…"}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
        {/* Only when there's actually something TO clear, the caller wants
            that offered, and the dropdown isn't open (where it would just
            sit awkwardly next to an in-progress search). */}
        {onClear && value && !open && (
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
      </div>

      {!hideCurrentLabel && value && !open && (
        <div className="muted body-text" style={{ marginTop: 6 }}>
          Bound to <strong>{value}</strong>
        </div>
      )}

      {open && (
        <div className="picker-dropdown">
          {allowCustom && ENTITY_ID_RE.test(query.trim()) && !entities[query.trim()] && (
            <button
              className="row picker-option strong"
              onClick={() => { onChange(query.trim()); setOpen(false); setQuery(""); }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                Use "{query.trim()}"
                <div className="muted" style={{ fontSize: "var(--text-2xs)" }}>entity not there yet, will activate when it appears</div>
              </span>
            </button>
          )}

          {Object.keys(entities).length === 0 && !allowCustom && (
            <div className="muted body-text" style={{ padding: 12 }}>
              Entities show once connected.
            </div>
          )}
          {list.map((e) => (
            <button
              key={e.entity_id}
              className="row picker-option"
              onClick={() => { onChange(e.entity_id); setOpen(false); setQuery(""); }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                {nameOf(e.entity_id)}
                <div className="muted" style={{ fontSize: "var(--text-2xs)" }}>{e.entity_id}</div>
              </span>
              {/* Worded as every other row (deviceRowText): "Normal", "21.4 °C" — not "off", "21.4" */}
              <span className="muted" style={{ fontSize: "var(--text-2xs)" }}>{deviceRowText(e, domainOf(e.entity_id))}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
