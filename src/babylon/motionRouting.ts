// src/babylon/motionRouting.ts
// What a presence detector or a triggered sensor LIGHTS on the map — a camera's detection cone (CameraBeams), or a
// room's red floor glow (RoomHighlight) — decided as a value before EntityVisuals touches a mesh.
//
// ⚠️ ONE SWITCH FOR WHAT THE KIOSK DRAWS (owner, 2026-10-22: Advanced Settings › "Room glow and camera cones",
// AppConfig.roomGlowAndCones). Off: no floor glow, no cone — only what the kiosk GENERATES on the map. The devices'
// own 3D objects keep glowing red (meshLookFor's pulse is not routed here), and badges, pills and lists are unchanged.
//
// Pure: tests/oracles/room_glow_switch.mjs drives it (and motionLit / motionChanges, through EntityVisuals' real painter).

import { glowsRoom } from "@/config/deviceCondition";
import { roomKey } from "@/config/roomKey";
import type { EntityType } from "@/types/scene.types";

export interface MotionRoutingInput {
  entityId: string;
  deviceClass: string | undefined;
  /** The sensor reads "on". */
  on: boolean;
  /** How the map draws the sensor (its mesh's mapping, else its saved one). */
  type: EntityType | undefined;
  /** The sensor's own room, if it has one. */
  room: string | undefined;
  /** The cameras that watch with it (EntityVisuals.camerasWatchedBy). */
  cameras: readonly string[];
  /** Whether a camera has a cone to light (a camera placed with no facing has none). */
  hasBeam: (cameraId: string) => boolean;
  /** A camera's own room — the fallback glow for a camera with no cone. */
  cameraRoom: (cameraId: string) => string | undefined;
  /** This profile may not see motion (the guest's, 2.496.210): nothing lights. */
  denied: boolean;
  /** Advanced Settings' "Room glow and camera cones" (AppConfig.roomGlowAndCones): off, nothing lights. */
  enabled: boolean;
}

export interface MotionRouting {
  beams: { cameraId: string; on: boolean }[];
  rooms: { room: string; on: boolean }[];
}

/**
 * A detector linked to a camera lights that camera's cone — or, for a camera with no cone, glows the camera's room (a
 * camera's own detector is rarely given a room of its own). Any other binary_sensor whose "on" glows its room
 * (glowsRoom: someone there, a door open) glows its room. A sensor driving a camera never also glows its own room.
 */
export function motionRouting(i: MotionRoutingInput): MotionRouting {
  const none: MotionRouting = { beams: [], rooms: [] };
  if (i.denied || !i.enabled) return none;
  if (i.cameras.length) {
    const withBeam = i.cameras.filter(i.hasBeam);
    if (withBeam.length) return { beams: withBeam.map((cameraId) => ({ cameraId, on: i.on })), rooms: [] };
    const rooms = i.cameras.map(i.cameraRoom).filter((r): r is string => !!r);
    return { beams: [], rooms: rooms.map((room) => ({ room, on: i.on })) };
  }
  if (i.type === "binary_sensor" && i.room && glowsRoom(i.entityId, i.deviceClass)) {
    return { beams: [], rooms: [{ room: i.room, on: i.on }] };
  }
  return none;
}

/** What is lit on the map: the cameras whose cone is on, and the rooms glowing (by roomKey, with a name to light it by,
 *  as RoomHighlight matches rooms). */
export interface MotionLit {
  beams: ReadonlySet<string>;
  rooms: ReadonlyMap<string, string>;
}

export const NOTHING_LIT: MotionLit = { beams: new Set(), rooms: new Map() };

/**
 * Everything lit by every sensor's routing as it stands (`current`): a cone or a room is lit while ANY of its sensors
 * reads "on".
 *
 * ⚠️ THE LAST SENSOR TO REPORT WON (to 2.496.500): each report switched its own room or cone on or off, so a door
 * closing put its room dark while the motion sensor in it still read "on" (and the second detector of a camera put out
 * the cone the first still lit).
 */
export function motionLit(current: Iterable<MotionRouting>): MotionLit {
  const beams = new Set<string>();
  const rooms = new Map<string, string>();
  for (const r of current) {
    for (const b of r.beams) if (b.on) beams.add(b.cameraId);
    for (const g of r.rooms) if (g.on && !rooms.has(roomKey(g.room))) rooms.set(roomKey(g.room), g.room);
  }
  return { beams, rooms };
}

/**
 * What to switch to go from what is painted to what is lit: each cone and room whose state differs, and nothing else.
 *
 * ⚠️ THE WHOLE LIT SET, EVERY TIME (architecture review O, 2026-10-27): the map repainted a glow only when a sensor
 * changed, and every other event had to remember to replay them — a sensor already on when the map loaded left its
 * room dark for hours, a cone lit "one toggle late". Every event now asks for the lit set as it is now.
 */
export function motionChanges(painted: MotionLit, lit: MotionLit): MotionRouting {
  const beams = [...new Set([...painted.beams, ...lit.beams])]
    .filter((id) => painted.beams.has(id) !== lit.beams.has(id))
    .map((cameraId) => ({ cameraId, on: lit.beams.has(cameraId) }));
  const rooms = [...new Set([...painted.rooms.keys(), ...lit.rooms.keys()])]
    .filter((k) => painted.rooms.has(k) !== lit.rooms.has(k))
    .map((k) => ({ room: (lit.rooms.get(k) ?? painted.rooms.get(k))!, on: lit.rooms.has(k) }));
  return { beams, rooms };
}
