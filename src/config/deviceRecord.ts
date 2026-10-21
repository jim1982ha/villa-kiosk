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

/**
 * Does a search find this row? Its entity id, the NAME THE MAP SHOWS (not the stored label: a
 * stored entity-id fallback is not a name anyone sees — EntityMap.labelField), its room, or one of
 * its linked objects. Case-insensitive; an empty search finds everything.
 */
export function rowMatches(row: DeviceRow, query: string, shownName: string, room: string): boolean {
  return matchesQuery(query, row.id, shownName, room, ...row.objects);
}

/** Does a typed search find any of these texts — trimmed, case-insensitive, a part of one is enough; an empty search
 *  finds everything, a missing text nothing. The rule of every search box over a list (Advanced Settings' rows and
 *  lost objects, the device groups, the fault form's device picker), written out at each until 2026-10-22. */
export function matchesQuery(query: string, ...texts: (string | undefined | null)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return texts.some((s) => s != null && s.toLowerCase().includes(q));
}
