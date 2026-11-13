// src/components/common/SearchOrAdd.tsx
// THE one field over a list of Advanced Settings › Devices and Villa (owner, 2026-11-06: "one search field per list"):
// typing narrows the list under it, and, when the list can take a device (`offer`), its suggestions are the matching
// devices, each saying where it already is ("In group Kitchen Temperature", "On the list": picking it shows it in the
// list) or what picking it does ("Create a group", "Add to the list"). Auto-detected entity settings uses it to narrow
// only. The shell is the shared picker's (SearchPicker, free-text mode: the words stay, they are the list's filter);
// what is offered is config/searchOrAdd's, by value.
//
// ⚠️ IT REPLACED TWO FIELDS PER LIST: Grouped devices' "New group" picker with its Create button above a "Filter by
// entity ID or label…" box, Unavailable by design' "Add a device…", Bound 3D objects' picker with its Add button.

import { useEffect, useRef, useState, type RefObject } from "react";
import SearchPicker, { type SearchRow } from "./SearchPicker";
import { useDeviceSearch } from "@/hooks/useDeviceSearch";
import { firstToAdd, offered, type AddOffer } from "@/config/searchOrAdd";
import EmptyLine from "@/components/common/EmptyLine";

export default function SearchOrAdd({ query, onQuery, placeholder, offer, onAdd, onFound }: {
  /** What is typed: the list's filter (its owner narrows the list with it). */
  query: string;
  onQuery: (query: string) => void;
  /** "Search groups, or a device to group…": the family of words every list's field uses. */
  placeholder: string;
  /** What it offers to add; none: it only narrows its list. */
  offer?: AddOffer;
  /** A device in no place was picked: add it (create its group, put it on the list). */
  onAdd?: (entityId: string) => void;
  /** A device already in the list was picked: show it there. */
  onFound?: (entityId: string) => void;
}) {
  const src = useDeviceSearch();
  const rows = (q: string): SearchRow[] => (offer ? offered(q, src, offer) : []).map((o) => (o.exact || o.ahead
    ? { key: o.id, label: o.words, sub: o.ahead ? "not there yet, will activate when it appears" : o.name, strong: true }
    : { key: o.id, label: o.name, sub: o.id, side: o.words }));
  const pick = (id: string) => {
    const o = offer && offered(query, src, offer).find((x) => x.id === id);
    if (o?.placed) onFound?.(id); else if (o) onAdd?.(id);
  };
  return (
    <div className="search-or-add">
      <SearchPicker text={{ value: query, onChange: onQuery }} rows={rows} onPick={pick} placeholder={placeholder} enterPicks
        clear={!!query && { label: "Clear the search", run: () => onQuery("") }} />
    </div>
  );
}

/** What a list says when its field narrows it to nothing: "No group has “kitchen”.", and the field's offer as a button
 *  ("Create a group with Kitchen Temperature") when a device in no place matches. */
export function SearchEmpty({ query, noun, offer, onAdd }: {
  query: string; noun: string; offer?: AddOffer; onAdd?: (entityId: string) => void;
}) {
  const src = useDeviceSearch();
  const add = offer ? firstToAdd(query, src, offer) : undefined;
  return (
    <div className="search-empty">
      <EmptyLine>No {noun} has “{query.trim()}”.</EmptyLine>
      {add && offer && onAdd && (
        <button type="button" className="btn" onClick={() => onAdd(add.id)}>{offer.exactWords(add.name)}</button>
      )}
    </div>
  );
}

/** The card a pick showed or added, marked and brought into view: `hit(key)` after the pick, `marked(key)` the frame's
 *  class for a card, `listRef` on the list holding the cards. ⚠️ ONE MARK FOR "THE CARD YOU ASKED FOR": the Cockpit's
 *  (`cockpit-focus`, the card a device window's warning opened the Inbox on), never a second look. */
export function useSearchHit(): { hit: (key: string | null) => void; marked: (key: string) => string | undefined;
  listRef: RefObject<HTMLDivElement> } {
  const [key, setKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (key) listRef.current?.querySelector(".cockpit-focus")?.scrollIntoView?.({ block: "nearest" });
  }, [key]);
  return { hit: setKey, marked: (k) => (k === key ? "cockpit-focus" : undefined), listRef };
}

