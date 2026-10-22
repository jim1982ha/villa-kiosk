// src/babylon/motionRouting.ts
// What a presence detector or a triggered sensor LIGHTS on the map — a camera's detection cone (CameraBeams), or a
// room's red floor glow (RoomHighlight) — decided as a value before EntityVisuals touches a mesh.
//
// ⚠️ ONE SWITCH FOR WHAT THE KIOSK DRAWS (owner, 2026-10-22: Advanced Settings › "Room glow and camera cones",
// AppConfig.roomGlowAndCones). Off: no floor glow, no cone — only what the kiosk GENERATES on the map. The devices'
// own 3D objects keep glowing red (meshLookFor's pulse is not routed here), and badges, pills and lists are unchanged.
//
// Pure: tests/oracles/room_glow_switch.mjs drives it.

import { glowsRoom } from "@/config/BinarySensorClasses";
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
