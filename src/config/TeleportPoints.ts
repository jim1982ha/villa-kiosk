// src/config/TeleportPoints.ts
//
// Teleport anchors derived from the real room geometry in TheLysHouse_1F.sh3d.
//
// Derivation: SweetHome 3D plan coordinates are centimetres with Y pointing
// "down" the plan. We recentre on the model centre (1206, 614 cm) and scale to
// metres (x0.01) to produce Babylon world coordinates, matching `sh3dToBabylon`
// in src/utils/sh3dTransform.ts. If the GLB is exported with different axes,
// adjust DEFAULT_MODEL_TRANSFORM (or recalibrate live via the in-app "Set anchor
// here" button — see TeleportMenu).

import type { TeleportPoint } from "@/types/scene.types";

const THUMB = (name: string) => `./thumbs/${name}.jpg`;

export const TELEPORT_POINTS: TeleportPoint[] = [
  // --- Floor 1 (real centroids from the .sh3d) ---
  { name: "Living Room",    floor: 1, position: { x: -1.56, y: 1.7, z: 1.36 },  target: { x: -1.56, y: 1.6, z: 3.0 },  thumbnail: THUMB("living_room") },
  { name: "Kitchen",        floor: 1, position: { x: -9.06, y: 1.7, z: -1.94 }, target: { x: -9.06, y: 1.6, z: 0.5 },  thumbnail: THUMB("kitchen") },
  { name: "Dining Area",    floor: 1, position: { x: -5.46, y: 1.7, z: 2.06 },  target: { x: -5.46, y: 1.6, z: 0.0 },  thumbnail: THUMB("dining") },
  { name: "Entrance",       floor: 1, position: { x: -2.94, y: 1.7, z: -2.30 }, target: { x: -2.94, y: 1.6, z: 0.0 },  thumbnail: THUMB("entrance") },
  { name: "Guest Bathroom", floor: 1, position: { x: 3.77,  y: 1.7, z: -1.82 }, target: { x: 3.77,  y: 1.6, z: 0.0 },  thumbnail: THUMB("guest_bath") },
  { name: "Bedroom 1",      floor: 1, position: { x: 2.73,  y: 1.7, z: 2.26 },  target: { x: 2.73,  y: 1.6, z: 0.0 },  thumbnail: THUMB("bedroom1") },
  { name: "Master Bedroom", floor: 1, position: { x: 6.53,  y: 1.7, z: 1.13 },  target: { x: 6.53,  y: 1.6, z: 3.0 },  thumbnail: THUMB("master") },
  { name: "Master Bathroom",floor: 1, position: { x: 10.20, y: 1.7, z: 2.26 },  target: { x: 9.0,   y: 1.6, z: 2.26 }, thumbnail: THUMB("master_bath") },
  { name: "WIC / Dressing", floor: 1, position: { x: 7.40,  y: 1.7, z: -1.17 }, target: { x: 7.40,  y: 1.6, z: 1.0 },  thumbnail: THUMB("wic") },
  { name: "Storage / Laundry", floor: 1, position: { x: 10.20, y: 1.7, z: -1.17 }, target: { x: 9.0, y: 1.6, z: -1.17 }, thumbnail: THUMB("laundry") },
  { name: "Pool / Garden",  floor: 1, position: { x: -10.56, y: 1.7, z: -4.64 }, target: { x: -8.0, y: 1.6, z: -2.0 }, thumbnail: THUMB("pool") },

  // --- Floor 2 (added once the 2nd floor is modelled in the same .sh3d) ---
  { name: "Floor 2 Landing", floor: 2, position: { x: 1.56, y: 4.2, z: -1.84 }, target: { x: 1.56, y: 4.1, z: 0.0 }, thumbnail: THUMB("f2_landing") },
];

/** Where the camera starts on first load (centre of the living room, looking in). */
export const DEFAULT_SPAWN: TeleportPoint =
  TELEPORT_POINTS.find((p) => p.name === "Living Room") ?? TELEPORT_POINTS[0];
