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

/** The shape of a Home Assistant entity_id. Exported because the entity
 *  picker validates typed input against the same rule and had its own copy. */
export const ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;

// The parse rule itself lives in config/roomData.ts (readRoomData), the one
// module that decides what valid room data is, for the upload and the load.
