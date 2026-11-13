// src/components/common/SearchPicker.tsx
// THE searchable dropdown: a search box, and under it the rows that match what is typed, one picked by a tap. Each
// picker says only WHICH rows match (EntityPicker: the villa's devices; Settings › Messages: what the villa
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
import { Link2, Search, X } from "lucide-react";
import IconButton from "./IconButton";

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
  rows, onPick, placeholder, compact, before, empty, none, clear, onOpenChange, text, startOpen, enterPicks, chosen,
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
  /** The box's ✕ while the list is closed, with what it empties ("Clear the search"); none: nothing to clear.
   *  ⚠️ DRAWN HERE (owner, 2026-11-10: one definition): three fields each drew a ✕ of their own, three looks. */
  clear?: { label: string; run: () => void } | null | false;
  /** The list opened or closed (EntityPicker hides its "Bound to" line while it is open). */
  onOpenChange?: (open: boolean) => void;
  /** FREE TEXT: the box's words are the value (a device or a description typed as is), kept when the list closes;
   *  without it the box only searches, and closing clears it. */
  text?: { value: string; onChange: (text: string) => void };
  /** Drawn open, the focus in its box: a box shown because a person asked for it (AddOnLine's icon pressed). */
  startOpen?: boolean;
  /** Enter picks the `before` row, or the one row listed (a list's search-or-add field, components/common/SearchOrAdd). */
  enterPicks?: boolean;
  /** The box shows a CHOSEN value while closed (EntityPicker's linked entity), not a hint: its words in the text's own
   *  colour behind a link mark. ⚠️ A PICK THAT LOOKED EMPTY (owner, 2026-11-14, of Villa presence: "it's not clear if an
   *  entity has been set"): the chosen sensor's name sat in the hint's dim grey, as "Search…" does. */
  chosen?: boolean;
}) {
  const [own, setOwn] = useState("");
  const query = text ? text.value : own;
  const setQuery = text ? text.onChange : setOwn;
  const [open, setOpenState] = useState(!!startOpen);
  const setOpen = (o: boolean) => { setOpenState(o); onOpenChange?.(o); };
  const containerRef = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); if (!text) setOwn(""); };

  // Outside tap or Escape closes the list and clears the query.
  useOutsideClose([containerRef], open, close);
  const listed = (q: string) => [before?.(q), ...rows(q).slice(0, SEARCH_ROWS)].filter((r): r is SearchRow => !!r);
  const pick = (key: string) => { onPick(key); close(); };

  return (
    <div ref={containerRef} className="picker">
      <div className={`config-search${compact ? " config-search-compact" : ""}${chosen && !open ? " config-search-chosen" : ""}`}>
        {chosen && !open ? <Link2 size={compact ? 13 : 16} aria-hidden /> : <Search size={compact ? 13 : 16} />}
        <input
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={startOpen}
          value={query}
          // ⚠️ A TAP OPENS IT, NEVER THE FOCUS ALONE (owner, 2026-11-02: "Open a ticket" showed Who's handling it's list
          // open, never tapped): a window puts the focus in its first field (useModalA11y), and the list opened on it.
          // A tap, typing, or the down arrow opens it
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setOpen(true);
            if (e.key === "Enter" && enterPicks) {
              const all = listed(query), only = all[0]?.strong || all.length === 1 ? all[0] : undefined;
              if (only) { e.preventDefault(); pick(only.key); }
            }
          }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
        {!open && clear && (
          <IconButton small label={clear.label} onClick={(e) => { e.stopPropagation(); clear.run(); }}><X size={16} /></IconButton>
        )}
      </div>

      {open && (() => {
        const all = listed(query);
        const said = empty ?? (all.length === 0 && query.trim() && none ? none(query.trim()) : null);
        // nothing to pick and nothing to say: no empty box under the field (a list's filter-only field)
        if (!said && all.length === 0) return null;
        return (
        <div className="picker-dropdown">
          {said && <div className="muted body-text" style={{ padding: 12 }}>{said}</div>}
          {all.map((r) => (
            <button key={r.key} className={`row picker-option${r.strong ? " strong" : ""}`} onClick={() => pick(r.key)}>
              <span style={{ flex: 1, textAlign: "left" }}>
                {r.label}
                {r.sub !== undefined && <div className="fine-print">{r.sub}</div>}
              </span>
              {r.side !== undefined && <span className="fine-print">{r.side}</span>}
            </button>
          ))}
        </div>
        );
      })()}
    </div>
  );
}
