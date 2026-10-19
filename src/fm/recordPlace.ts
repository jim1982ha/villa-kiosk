// src/fm/recordPlace.ts
// WHERE A RECORD IS: the device a fault, a guest's report or a spend entry is about, its name as typed or shown, and
// the room that device is in — the three fields every such record carries (FmTicket / FmCost entityId, deviceLabel,
// room), built in ONE place. Pure; components/fm/useRecordPlace binds it to the live config.
//
// ⚠️ ASSEMBLED THREE TIMES (architecture review, 2026-10-19): the fault form, the guest's report and the Spend tab
// each wrote `{ entityId, deviceLabel, room: entityId ? deviceRoom(...) : undefined }` by hand, the label from a
// different source in each — the shape in which one of the three stops matching the others.

import { deviceRoom } from "@/config/devicePlace";

export interface RecordPlace {
  entityId?: string;
  /** The device's name as it was when the record was made (the picker's label, or free text for a device the villa's
   *  system does not know) — see FmCost.deviceLabel. */
  deviceLabel?: string;
  /** The device's room at the time of entry ("" when it has none); absent for a record on no device. */
  room?: string;
}

/** The place of a record about `entityId` (blank: no device — a whole-villa expense, a free-text device), named
 *  `deviceText` (blank: no name kept). */
export function recordPlace(
  entityId: string | undefined, deviceText: string | undefined, rooms: Readonly<Record<string, string | undefined>>,
): RecordPlace {
  const id = entityId?.trim() || undefined;
  return {
    entityId: id,
    deviceLabel: deviceText?.trim() || undefined,
    room: id ? deviceRoom(rooms, id) : undefined,
  };
}
