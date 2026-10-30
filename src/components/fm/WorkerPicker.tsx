// src/components/fm/WorkerPicker.tsx
// "Done by" and "Who's handling it": the names already given for who does the work (fmEngine.knownWorkers), searched
// and picked, and "Use …" for a name not there yet. Rule "No free-text field where the value comes from a known set:
// choose from a searchable dropdown" (owner, 2026-10-01).
//
// ⚠️ TWO BLANK BOXES (architecture review round 8, 2026-10-30): the Today tab's completion and a fault's stage each had
// their own text input, and nothing offered the names already recorded, so one person became three in Recent work.

import { useMemo } from "react";
import { X } from "lucide-react";
import SearchPicker, { type SearchRow } from "@/components/common/SearchPicker";
import { useFmData } from "@/fm/FmDataContext";
import { isKnownWorker, knownWorkers } from "@/fm/fmEngine";

/** How many names the open list shows at once (the search narrows them). */
const MAX_ROWS = 20;

/** What the open list offers for `query`: the known names it matches (case ignored), and the name to "Use" when it is
 *  no known one (null when the query is empty or already known). Pure: tests/oracles/worker_picker.mjs drives it. */
export function workerChoices(known: readonly string[], query: string): { names: string[]; use: string | null } {
  const name = query.trim().replace(/\s+/g, " ");
  const q = name.toLocaleLowerCase();
  return {
    names: known.filter((n) => !q || n.toLocaleLowerCase().includes(q)).slice(0, MAX_ROWS),
    use: name && !isKnownWorker(known, name) ? name : null,
  };
}

export default function WorkerPicker({ value, onChange, placeholder }: {
  /** The name picked ("" for none). */
  value: string;
  onChange: (name: string) => void;
  /** Said in the box while nothing is picked. */
  placeholder: string;
}) {
  const { data } = useFmData();
  const known = useMemo(() => knownWorkers(data), [data]);

  const rows = (query: string): SearchRow[] => workerChoices(known, query).names.map((n) => ({ key: n, label: n }));

  return (
    <SearchPicker
      rows={rows}
      onPick={onChange}
      placeholder={value || placeholder}
      before={(query) => {
        const use = workerChoices(known, query).use;
        return use ? { key: use, label: `Use "${use}"`, sub: "a name not given before", strong: true } : null;
      }}
      empty={known.length === 0 ? "No name given yet: type one." : undefined}
      trailing={value && (
        <button type="button" className="icon-btn entity-picker-clear" onClick={(e) => { e.stopPropagation(); onChange(""); }}
          title={`Clear (was ${value})`} aria-label={`Clear the name (was ${value})`}>
          <X size={16} />
        </button>
      )}
    />
  );
}
