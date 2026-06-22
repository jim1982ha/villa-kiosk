// src/components/settings/EntityPicker.tsx
// Searchable dropdown over the LIVE Home Assistant entity list. This is what
// makes binding turnkey — you pick from real entities, not typed IDs.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";

interface Props {
  value?: string;
  onChange: (entityId: string) => void;
  /** Optionally restrict to certain domains, e.g. ["light","switch"]. */
  domains?: string[];
  placeholder?: string;
  /** Allow choosing an entity_id that doesn't exist in HA yet (free text). */
  allowCustom?: boolean;
}

const ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;

export default function EntityPicker({ value, onChange, domains, placeholder, allowCustom }: Props) {
  const { entities } = useHA();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const list = useMemo(() => {
    const q = query.toLowerCase();
    return Object.values(entities)
      .filter((e) => !domains || domains.includes(e.entity_id.split(".")[0]))
      .filter(
        (e) =>
          e.entity_id.toLowerCase().includes(q) ||
          (e.attributes.friendly_name ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .slice(0, 60);
  }, [entities, query, domains]);

  const selected = value ? entities[value] : undefined;

  return (
    <div style={{ position: "relative" }}>
      <div className="row" style={{ gap: 8 }}>
        <Search size={16} className="muted" />
        <input
          style={{ flex: 1, padding: 10, borderRadius: 8, background: "var(--bg-input)", color: "var(--text-primary)", border: "none" }}
          placeholder={placeholder ?? (selected ? `${selected.attributes.friendly_name ?? value}` : "Search entities…")}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
      </div>

      {value && !open && (
        <div className="muted body-text" style={{ marginTop: 6 }}>
          Bound to <strong>{value}</strong>
        </div>
      )}

      {open && (
        <div
          style={{
            position: "absolute", zIndex: 5, left: 0, right: 0, marginTop: 6,
            maxHeight: 260, overflowY: "auto", background: "var(--bg-overlay)",
            border: "1px solid rgba(201,168,76,0.2)", borderRadius: 10,
          }}
        >
          {/* Let the user commit a not-yet-existing entity_id (free text). */}
          {allowCustom && ENTITY_ID_RE.test(query.trim()) && !entities[query.trim()] && (
            <button
              className="row"
              style={{ width: "100%", padding: "10px 12px", justifyContent: "flex-start", gap: 10, borderBottom: "1px solid rgba(201,168,76,0.25)" }}
              onClick={() => {
                onChange(query.trim());
                setOpen(false);
              }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                Use “{query.trim()}”
                <div className="muted" style={{ fontSize: 11 }}>entity not in HA yet — will activate when it appears</div>
              </span>
            </button>
          )}

          {Object.keys(entities).length === 0 && !allowCustom && (
            <div className="muted body-text" style={{ padding: 12 }}>
              Connect to Home Assistant first to see entities.
            </div>
          )}
          {list.map((e) => (
            <button
              key={e.entity_id}
              className="row"
              style={{ width: "100%", padding: "10px 12px", justifyContent: "flex-start", gap: 10, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              onClick={() => {
                onChange(e.entity_id);
                setOpen(false);
                setQuery("");
              }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                {e.attributes.friendly_name ?? e.entity_id}
                <div className="muted" style={{ fontSize: 11 }}>{e.entity_id}</div>
              </span>
              <span className="muted" style={{ fontSize: 11 }}>{e.state}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
