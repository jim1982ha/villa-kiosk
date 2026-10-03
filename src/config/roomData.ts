// src/config/roomData.ts
// The villa's ROOM DATA — the "<model>.rooms.json" sidecar the Blender
// pipeline writes next to the GLB (or embeds in it): what a valid document is,
// what adopting one changes in config, and how a device reads the central copy.
//
// ⚠️ FOUR RULES FOR ONE FILE (to 2.496.253). The upload treated `{rooms: []}`
// as a deliberate reset, the load (parseRoomData) rejected it as "No named
// rooms found", the proxy only checked that it starts with `{`, and the two
// places that adopt a plan disagreed about what a new plan wipes. So a GLB
// uploaded without room data — the case the reset existed for — left every
// device on the OLD rooms with "Failed to refresh room names…", and a wrong
// .json picked in Settings was stored for every device before it was checked.
// One module now answers all of it, for the upload and the load alike.
//
// Pure apart from `fetchRoomData`, whose fetch is passed in.
// tests/oracles/room_data.mjs.

import type { AppConfig } from "./AppConfig";
import { isFittedPoint } from "./deviceConfig";
import { sliceChanged } from "@/babylon/entityMapDiff";
import { ENTITY_ID_RE, type ParsedEntity, type ParsedRoom, type ParsedRoomData } from "@/utils/sh3dParser";

/** The document an upload stores when a GLB arrives with no room data of its
 *  own: the explicit reset, so devices drop the previous model's rooms rather
 *  than matching a new villa against them. */
export const EMPTY_ROOM_DATA = JSON.stringify({ schema: 1, rooms: [], entities: [] });

/**
 * Read a room-data document. Defensive because the bytes come from an
 * uploaded or served file: every field is coerced to the expected shape and
 * anything malformed is dropped rather than trusted.
 *
 * Throws (with a message a person can act on) when the text is not room data
 * at all — not JSON, no `rooms` list, or a `rooms` list of which not one entry
 * is usable (usually the wrong file). An EMPTY `rooms` list is valid: it is
 * the reset (EMPTY_ROOM_DATA), and reads as no rooms.
 */
export function readRoomData(text: string): ParsedRoomData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not valid room-data JSON.");
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as { rooms?: unknown; entities?: unknown };
  if (!Array.isArray(obj.rooms)) throw new Error("Not a room-data file (it has no \"rooms\" list).");

  const rooms: ParsedRoom[] = [];
  for (const r of obj.rooms as Record<string, unknown>[]) {
    const name = typeof r?.name === "string" ? r.name : "";
    const pts = Array.isArray(r?.points) ? (r.points as Record<string, unknown>[]) : [];
    const points = pts
      .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const floor = Number.isFinite(Number(r?.floor)) ? Number(r.floor) : 1;
    if (name && points.length >= 3) rooms.push({ name, points, floor });
  }

  const entities: ParsedEntity[] = [];
  if (Array.isArray(obj.entities)) {
    for (const e of obj.entities as Record<string, unknown>[]) {
      const entityId = typeof e?.entityId === "string" ? e.entityId : "";
      const x = Number(e?.x);
      const y = Number(e?.y);
      if (!ENTITY_ID_RE.test(entityId) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      entities.push({
        entityId, x, y,
        angle: Number.isFinite(Number(e?.angle)) ? Number(e.angle) : 0,
        pitch: Number.isFinite(Number(e?.pitch)) ? Number(e.pitch) : 0,
      });
    }
  }

  if (obj.rooms.length > 0 && rooms.length === 0) throw new Error("No named rooms found in that room-data file.");
  return { rooms, entities };
}

type RoomSlice = Pick<AppConfig, "sh3dRooms" | "sh3dEntities" | "teleportPoints">;

/**
 * What adopting `next` changes in config, or null when it changes nothing.
 *
 * `origin` is WHO is adopting it, and decides what a changed plan wipes:
 *
 *   * "upload" — the owner just replaced the villa's plan. The rooms menu is
 *     rebuilt from this file alone: every previous room goes, including the
 *     rooms people added by hand ("Add room here"), which are shared — so this
 *     one deliberate act clears them on every device.
 *   * "load" — a device reading the central copy when it opens. It drops only
 *     its OWN fitted rooms (derived per device, recomputed from the new plan)
 *     and never the shared, hand-added ones. Its local copy of the plan can be
 *     stale or empty (a new browser, cleared storage, asleep during the
 *     upload), so "the names differ" says nothing about what everyone else has
 *     done since — wiping the shared list on that evidence deleted rooms the
 *     owner added AFTER the upload, on every device.
 */
export function roomDataPatch(
  cur: RoomSlice, next: ParsedRoomData, origin: "upload" | "load",
): Partial<RoomSlice> | null {
  const adopted = { sh3dRooms: next.rooms, sh3dEntities: next.entities };
  if (origin === "upload") return { ...adopted, teleportPoints: [] };
  // By content (sliceChanged): readRoomData returns fresh arrays every open.
  if (!sliceChanged(cur.sh3dRooms ?? [], next.rooms) && !sliceChanged(cur.sh3dEntities ?? [], next.entities)) return null;
  const names = (rooms: readonly { name: string }[]) => rooms.map((r) => r.name).sort().join("|");
  if (names(cur.sh3dRooms ?? []) === names(next.rooms)) return adopted;
  return { ...adopted, teleportPoints: cur.teleportPoints.filter((p) => !isFittedPoint(p)) };
}

export type RoomDataFetch =
  | { ok: true; data: ParsedRoomData }
  | { ok: false; status: number }
  | { ok: false; error: Error };

/** How long the central copy may take. It is read in the shadow of the GLB's
 *  download, so this only bounds a hung request — the load proceeds without it. */
const ROOM_DATA_TIMEOUT_MS = 5000;

/** Read the central room data at `url` (centralModel.modelUrl of its path and
 *  version). Never throws: a status, a timeout or an invalid document comes
 *  back as the answer. */
export async function fetchRoomData(
  url: string,
  // A wrapper, never `= fetch`: an unbound browser builtin throws "Illegal
  // invocation" when called as a plain function (2.496.197-203).
  fetchFn: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<RoomDataFetch> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ROOM_DATA_TIMEOUT_MS);
  try {
    const resp = await fetchFn(url, { signal: ctrl.signal });
    if (!resp.ok) return { ok: false, status: resp.status };
    return { ok: true, data: readRoomData(await resp.text()) };
  } catch (err) {
    return { ok: false, error: err as Error };
  } finally {
    clearTimeout(tid);
  }
}
