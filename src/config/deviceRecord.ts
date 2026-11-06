// src/config/deviceRecord.ts
// THE device list Advanced Settings edits: every device the Kiosk keeps settings for, ONE row
// each (architecture review 2026-10-12, candidate 1), and the 3D objects that show each one.
//
// ⚠️ ONE RECORD, TWO EDITORS, AND A ROW THAT CHANGED LISTS. The auto-detected list hid every device
// that was a value of `meshBindings`, and the Villa tab's bound-objects list showed it instead, with
// the same fields — so "change entity" (which binds the old object to the new id) silently moved a
// device to the other tab, and its search there came back "No entities match" (owner, 2026-10-12,
// after renaming a light in Home Assistant: five releases, 2.496.327–333, each fixing one screen).
// Every stored device is now a row here, hand-linked or not.
// ⚠️ ONE PLACE FOR ITS 3D OBJECTS (owner, 2026-11-06): the Villa tab's "Bound 3D objects" listed the objects bound by
// hand, Devices wrote "· 3D object: …" after the id; a device's card now has a "3D object" field holding every object
// that shows it, linked by its name or bound (objectLinks), and its search adding one (objectOffers).

import type { EntityMapping } from "@/types/scene.types";
import { meshEntityOf, normaliseMeshName, searchNames } from "./EntityMap";
import { deviceRoom } from "./devicePlace";
import { domainOf } from "@/utils/entityDomain";

export interface DeviceRow {
  id: string;
  mapping: EntityMapping;
}

/** Every stored device the owner has not removed, in stored order. */
export function deviceRows(
  entityMap: Readonly<Record<string, EntityMapping>>,
  removed: ReadonlySet<string>,
): DeviceRow[] {
  return Object.entries(entityMap)
    .filter(([id]) => !removed.has(id))
    .map(([id, mapping]) => ({ id, mapping }));
}

/** The model's 3D objects and the devices they show. */
export interface ObjectLinks {
  /** Each object, by its name without export suffixes (normaliseMeshName: one object for its parts and its poses),
   *  and the device it shows, or null, in name order. */
  shows: ReadonlyMap<string, string | null>;
  /** Each device's objects, in name order. */
  byDevice: ReadonlyMap<string, readonly string[]>;
}

/**
 * Which device each 3D object of the model (`catalog`, its mesh names) shows, as the map decides it
 * (EntityMap.meshEntityOf: a binding, else its name): a device's "3D object" field lists what the map shows on it,
 * linked by its name or bound by hand. Pure.
 */
export function objectLinks(
  catalog: readonly string[],
  entityMap: Record<string, EntityMapping>,
  meshBindings: Record<string, string>,
): ObjectLinks {
  const shows = new Map<string, string | null>();
  const byDevice = new Map<string, string[]>();
  for (const mesh of [...catalog].sort()) {
    const object = normaliseMeshName(mesh);
    const id = meshEntityOf(mesh, entityMap, meshBindings);
    if (!shows.get(object)) shows.set(object, id);
    if (id === null) continue;
    const list = byDevice.get(id) ?? [];
    if (!list.includes(object)) list.push(object);
    byDevice.set(id, list);
  }
  for (const list of byDevice.values()) list.sort();
  return { shows: new Map([...shows].sort(([a], [b]) => a.localeCompare(b))), byDevice };
}

/** What a device's "Add a 3D object…" search lists for `query`: the objects found by their name that do not show
 *  `entityId` already, those showing nothing first (`shows` null), then those showing another device (picking one
 *  moves it here). Pure. */
export function objectOffers(query: string, links: ObjectLinks, entityId: string): { object: string; shows: string | null }[] {
  const found = [...links.shows].filter(([object, id]) => id !== entityId && matchesQuery(query, object))
    .map(([object, shows]) => ({ object, shows }));
  return [...found.filter((o) => o.shows === null), ...found.filter((o) => o.shows !== null)];
}

/** What a device search reads: the stored devices, the villa's system's entities, the rooms. */
export interface SearchSource {
  entityMap: Parameters<typeof searchNames>[1];
  entities: Parameters<typeof searchNames>[2];
  resolvedRooms: Readonly<Record<string, string | undefined>>;
}

/**
 * What a device is found by, in EVERY device search (Advanced Settings' rows, "Add a device…", the device groups, the
 * ticket form): the NAME THE MAP SHOWS (not the stored label: a stored entity-id fallback is not a name anyone sees),
 * the villa's system's own name, its room and its id.
 *
 * ⚠️ ONE SEARCH (architecture review 2026-10-31 round 12 #2): typing "pool" found a device by its room in Settings ›
 * Devices, by the system's name but not the room in "Add a device…", by neither in the device groups.
 */
export function deviceSearchTexts(id: string, src: SearchSource): string[] {
  const [shown, platform] = searchNames(id, src.entityMap, src.entities);
  const room = deviceRoom(src.resolvedRooms, id);
  // ...and the three as one line, so a search may run from the name into the room ("kitchen tap" for a tap in the
  // kitchen), as the ticket form's own search did
  return [shown, platform, room, id, `${shown} ${room} ${id}`].filter(Boolean);
}

/** The entities a device picker (EntityPicker, a list's field: SearchOrAdd) lists for a search: of `domains` when given, found by what any device
 *  is found by, in id order. Pure. */
export function entitySearch(query: string, src: SearchSource, domains?: readonly string[]): string[] {
  return Object.keys(src.entities)
    .filter((id) => !domains || domains.includes(domainOf(id)))
    .filter((id) => matchesQuery(query, ...deviceSearchTexts(id, src)))
    .sort((a, b) => a.localeCompare(b));
}

/** Does a search find this device, by what any device is found by, or one of its 3D objects (`objects`: a card of
 *  Devices, its "3D object" field's). Every list of devices asks it (Devices, Asleep between reports). Case-insensitive;
 *  an empty search finds everything. Pure. */
export function deviceMatches(id: string, query: string, src: SearchSource, objects: readonly string[] = []): boolean {
  return matchesQuery(query, ...deviceSearchTexts(id, src), ...objects);
}

/** Does a search find this device group: any of its devices, its lead and its members alike, by what any device is
 *  found by (Advanced Settings' device groups). Pure. */
export function groupMatches(group: { primaryEntityId: string; memberEntityIds: readonly string[] }, query: string,
  src: SearchSource): boolean {
  return matchesQuery(query, ...[group.primaryEntityId, ...group.memberEntityIds].flatMap((id) => deviceSearchTexts(id, src)));
}

/** Does a typed search find any of these texts — trimmed, case-insensitive, a part of one is enough; an empty search
 *  finds everything, a missing text nothing. The rule of every search box over a list (Advanced Settings' rows and
 *  lost objects, the device groups, the fault form's device picker), written out at each until 2026-10-22. */
export function matchesQuery(query: string, ...texts: (string | undefined | null)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return texts.some((s) => s != null && s.toLowerCase().includes(q));
}
