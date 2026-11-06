// src/config/searchOrAdd.ts
// What a list's ONE search field offers besides narrowing the list (components/common/SearchOrAdd): the villa's devices
// matching what is typed, each saying where it already is ("In group Kitchen Temperature", "On the list") or what
// picking it does ("Create a group", "Add to the list"). Pure: a check drives it.
//
// ⚠️ ONE FIELD PER LIST (owner, 2026-11-06): Grouped devices had two, "New group: Search or type entity_id… [+ Create]"
// and "Filter by entity ID or label…"; Asleep between reports a picker and no filter; Bound 3D objects a picker and an
// Add button. Each list now has one field that narrows it and offers its devices.

import { entitySearch, type SearchSource } from "./deviceRecord";
import { labelOf } from "./EntityMap";
import { ENTITY_ID_RE } from "@/utils/sh3dParser";

/** What a list's field offers to add, and how each device is said. */
export interface AddOffer {
  /** Where a device already is ("In group Kitchen Temperature", "On the list"); null: in none, so picking adds it. */
  placeOf: (entityId: string) => string | null;
  /** What picking a device in none does ("Create a group", "Add to the list"). */
  addWords: string;
  /** Typed whole, the id of a real device in none: its own row first, picked by Enter ("Create a group with <id>");
   *  also a list's offer when nothing in it matches ("Create a group with Kitchen Temperature"). */
  exactWords: (device: string) => string;
  /** Only these domains are offered. */
  domains?: readonly string[];
  /** An id the villa's system does not have yet may be added (Devices prepares one): its row's words. */
  ahead?: (entityId: string) => string;
}

/** One device the field offers. `exact`: the row for the id typed whole; `ahead`: an id not there yet. */
export interface Offered {
  id: string;
  name: string;
  /** Its words on the right: where it is, or what picking it does; the whole row's words for an exact or ahead row. */
  words: string;
  /** Already in the list: picking it shows it there, never adds it twice. */
  placed: boolean;
  exact?: boolean;
  ahead?: boolean;
}

/** The devices offered for `query`: nothing until something is typed (the field narrows the list first); the id typed
 *  whole first when it is a real device in none (never repeated under it), or an id not there yet when the list may
 *  prepare one; then every device found by what any device is found by (deviceRecord.entitySearch), in id order. */
export function offered(query: string, src: SearchSource, offer: AddOffer): Offered[] {
  const q = query.trim();
  if (!q) return [];
  const name = (id: string) => labelOf(id, src.entityMap, src.entities);
  const found = entitySearch(q, src, offer.domains);
  const say = (id: string): Offered => {
    const place = offer.placeOf(id);
    return { id, name: name(id), words: place ?? offer.addWords, placed: place !== null };
  };
  const real = q in src.entities && found.includes(q);
  const first: Offered[] = real && offer.placeOf(q) === null ? [{ id: q, name: name(q), words: offer.exactWords(q), placed: false, exact: true }]
    : !real && offer.ahead && ENTITY_ID_RE.test(q) ? [{ id: q, name: q, words: offer.ahead(q), placed: false, ahead: true }]
    : [];
  return [...first, ...found.filter((id) => !first.some((f) => f.id === id)).map(say)];
}

/** The device a list with no match for `query` offers to add: the first one found in no place, else none. */
export function firstToAdd(query: string, src: SearchSource, offer: AddOffer): Offered | undefined {
  return offered(query, src, offer).find((o) => !o.placed);
}
