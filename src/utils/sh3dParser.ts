// src/utils/sh3dParser.ts
// Room + entity plan metadata for the kiosk. This used to parse the full
// SweetHome ".sh3d" (a ZIP) in the browser — but that file bundles every
// furniture catalog model + texture, so it grew to hundreds of MB while the app
// only ever needed <20 KB of it. The Blender pipeline now emits a compact
// "<model>.rooms.json" sidecar next to the GLB (see _write_room_sidecar in
// blender_pipeline.py); this module just validates + adopts that JSON. Nothing
// in the app parses a raw .sh3d anymore.

export interface ParsedRoom {
  name: string;
  points: { x: number; y: number }[];
  /** 1-based storey index (1 = ground floor). */
  floor: number;
}
export interface ParsedEntity {
  entityId: string;
  x: number;
  y: number;
  /** SweetHome plan-rotation (radians) — drives a camera's motion beam. */
  angle: number;
  /** SweetHome tilt around the local X axis (radians) — beam up/down. */
  pitch: number;
}
export interface ParsedRoomData {
  rooms: ParsedRoom[];
  entities: ParsedEntity[];
}

const ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;

/**
 * Parse + validate the pipeline's room-data sidecar (the JSON described above).
 * Defensive because the bytes come from an uploaded/served file: every field is
 * coerced to the expected shape and anything malformed is dropped rather than
 * trusted. Throws only when there isn't a single usable room (so the caller can
 * surface "that file has no rooms").
 */
export function parseRoomData(text: string): ParsedRoomData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not valid room-data JSON.");
  }
  const obj = raw as { rooms?: unknown; entities?: unknown };

  const rooms: ParsedRoom[] = [];
  if (Array.isArray(obj.rooms)) {
    for (const r of obj.rooms as Record<string, unknown>[]) {
      const name = typeof r?.name === "string" ? r.name : "";
      const pts = Array.isArray(r?.points) ? (r.points as Record<string, unknown>[]) : [];
      const points = pts
        .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      const floor = Number.isFinite(Number(r?.floor)) ? Number(r.floor) : 1;
      if (name && points.length >= 3) rooms.push({ name, points, floor });
    }
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

  if (rooms.length === 0) throw new Error("No named rooms found in that room-data file.");
  return { rooms, entities };
}
