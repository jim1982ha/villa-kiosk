// src/components/common/SearchPicker.tsx
// THE searchable dropdown: a search box, and under it the rows that match what is typed, one picked by a tap. Each
// picker says only WHICH rows match (EntityPicker: the villa's devices; Advanced Settings › Messages: what the villa
// has announced). Rule: "No free-text field where the value comes from a known set: choose from a searchable dropdown".
//
// ⚠️ ONE LIST FOR THE TICKET FORM TOO (architecture review 2026-10-31 round 12 #2): DeviceSearchPicker had built its
// own box before this one existed, with eight results and a list that opened only once something was typed. Its free
// text ("Spare pool pump", saved as typed) is this shell's `text` mode; every picker lists up to SEARCH_ROWS rows and
// opens on a tap.
//
// ⚠️ IT WAS ENTITYPICKER'S OWN (to 2.496.560): a second list to pick from (an announcement's title, ticket 16 of "One
// inbox") would have copied its box, its outside-tap close and its rows. The shell is here, once.

import { useRef, useState, type ReactNode } from "react";
import { useOutsideClose } from "@/hooks/useOutsideClose";
import { Search } from "lucide-react";

export interface SearchRow {
  key: string;
  label: ReactNode;
  /** A muted second line under the label (an entity's id). */
  sub?: ReactNode;
  /** A muted word on the right (a device's state). */
  side?: ReactNode;
  /** Drawn bolder: a row that is not one of the matches (EntityPicker's "Use …"). */
  strong?: boolean;
}

/** The rows a picker lists at most: past it, typing narrows the list. One number for every picker. */
export const SEARCH_ROWS = 60;

export default function SearchPicker({
  rows, onPick, placeholder, compact, before, empty, none, trailing, onOpenChange, text,
}: {
  /** The rows matching what is typed ("" when nothing is). */
  rows: (query: string) => readonly SearchRow[];
  onPick: (key: string) => void;
  placeholder: string;
  /** The search box at the height of a small pill, inline beside pills. */
  compact?: boolean;
  /** A row of its own above the matches (EntityPicker's "Use …" for an id not there yet), picked like any other. */
  before?: (query: string) => SearchRow | null;
  /** Said in the open list when there is nothing to pick from at all. */
  empty?: string;
  /** Said in the open list when nothing matches what is typed (the ticket form: "it will be saved as free text"). */
  none?: (query: string) => ReactNode;
  /** Beside the box while the list is closed (EntityPicker's clear button). */
  trailing?: ReactNode;
  /** The list opened or closed (EntityPicker hides its "Bound to" line while it is open). */
  onOpenChange?: (open: boolean) => void;
  /** FREE TEXT: the box's words are the value (a device or a description typed as is), kept when the list closes;
   *  without it the box only searches, and closing clears it. */
  text?: { value: string; onChange: (text: string) => void };
}) {
  const [own, setOwn] = useState("");
  const query = text ? text.value : own;
  const setQuery = text ? text.onChange : setOwn;
  const [open, setOpenState] = useState(false);
  const setOpen = (o: boolean) => { setOpenState(o); onOpenChange?.(o); };
  const containerRef = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); if (!text) setOwn(""); };

  // Outside tap or Escape closes the list and clears the query.
  useOutsideClose([containerRef], open, close);

  return (
    <div ref={containerRef} className="picker">
      <div className={`config-search${compact ? " config-search-compact" : ""}`}>
        <Search size={compact ? 13 : 16} />
        <input
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
        {!open && trailing}
      </div>

      {open && (() => {
        const found = rows(query).slice(0, SEARCH_ROWS);
        return (
        <div className="picker-dropdown">
          {empty && <div className="muted body-text" style={{ padding: 12 }}>{empty}</div>}
          {!empty && found.length === 0 && query.trim() && none
            && <div className="muted body-text" style={{ padding: 12 }}>{none(query.trim())}</div>}
          {[before?.(query), ...found].filter((r): r is SearchRow => !!r).map((r) => (
            <button key={r.key} className={`row picker-option${r.strong ? " strong" : ""}`} onClick={() => { onPick(r.key); close(); }}>
              <span style={{ flex: 1, textAlign: "left" }}>
                {r.label}
                {r.sub !== undefined && <div className="muted" style={{ fontSize: "var(--text-2xs)" }}>{r.sub}</div>}
              </span>
              {r.side !== undefined && <span className="muted" style={{ fontSize: "var(--text-2xs)" }}>{r.side}</span>}
            </button>
          ))}
        </div>
        );
      })()}
    </div>
  );
}
