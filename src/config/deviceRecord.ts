// src/config/deviceRecord.ts
// THE device list Advanced Settings edits: every device the Kiosk keeps settings for, ONE row
// each, saying how its 3D object is linked (architecture review 2026-10-12, candidate 1).
//
// ⚠️ ONE RECORD, TWO EDITORS, AND A ROW THAT CHANGED LISTS. The auto-detected list hid every device
// that was a value of `meshBindings`, and the Villa tab's bound-objects list showed it instead, with
// the same fields — so "change entity" (which binds the old object to the new id) silently moved a
// device to the other tab, and its search there came back "No entities match" (owner, 2026-10-12,
// after renaming a light in Home Assistant: five releases, 2.496.327–333, each fixing one screen).
// Every stored device is now a row here, hand-linked or not; the Villa tab keeps only the
// object ↔ entity link.

import type { EntityMapping } from "@/types/scene.types";
import { searchNames } from "./EntityMap";
import { deviceRoom } from "./devicePlace";
import { domainOf } from "@/utils/entityDomain";

export interface DeviceRow {
  id: string;
  mapping: EntityMapping;
  /** 3D objects linked to this device BY NAME in meshBindings (by hand, or by "change entity") —
   *  empty for a device whose object is simply named after it. */
  objects: string[];
}

/** Every stored device the owner has not removed, with the objects linked to it, in stored order. */
export function deviceRows(
  entityMap: Readonly<Record<string, EntityMapping>>,
  meshBindings: Readonly<Record<string, string>>,
  removed: ReadonlySet<string>,
): DeviceRow[] {
  const objects = new Map<string, string[]>();
  for (const [mesh, id] of Object.entries(meshBindings)) {
    const list = objects.get(id) ?? [];
    list.push(mesh);
    objects.set(id, list);
  }
  return Object.entries(entityMap)
    .filter(([id]) => !removed.has(id))
    .map(([id, mapping]) => ({ id, mapping, objects: objects.get(id) ?? [] }));
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

/** The entities "Add a device…" (EntityPicker) lists for a search: of `domains` when given, found by what any device
 *  is found by, in id order. Pure. */
export function entitySearch(query: string, src: SearchSource, domains?: readonly string[]): string[] {
  return Object.keys(src.entities)
    .filter((id) => !domains || domains.includes(domainOf(id)))
    .filter((id) => matchesQuery(query, ...deviceSearchTexts(id, src)))
    .sort((a, b) => a.localeCompare(b));
}

/** Does a search find this device group: any of its devices, its lead and its members alike, by what any device is
 *  found by (Advanced Settings' device groups). Pure. */
export function groupMatches(group: { primaryEntityId: string; memberEntityIds: readonly string[] }, query: string,
  src: SearchSource): boolean {
  return matchesQuery(query, ...[group.primaryEntityId, ...group.memberEntityIds].flatMap((id) => deviceSearchTexts(id, src)));
}

/** Does a search find this row: what any device is found by (deviceSearchTexts), or one of its linked objects.
 *  Case-insensitive; an empty search finds everything. */
export function rowMatches(row: DeviceRow, query: string, src: SearchSource): boolean {
  return matchesQuery(query, ...deviceSearchTexts(row.id, src), ...row.objects);
}

/** Does a typed search find any of these texts — trimmed, case-insensitive, a part of one is enough; an empty search
 *  finds everything, a missing text nothing. The rule of every search box over a list (Advanced Settings' rows and
 *  lost objects, the device groups, the fault form's device picker), written out at each until 2026-10-22. */
export function matchesQuery(query: string, ...texts: (string | undefined | null)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return texts.some((s) => s != null && s.toLowerCase().includes(q));
}
