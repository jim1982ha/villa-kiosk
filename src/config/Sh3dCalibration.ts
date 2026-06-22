// src/config/Sh3dCalibration.ts
// Known SweetHome-3D plan positions (centimetres) for TheLysHouse.
//
// Because the interactive meshes are named with their entity IDs and sit at these
// known plan positions, the app can fit the exact transform from plan-space to
// the loaded model's world-space at runtime — then place every room anchor /
// teleport point correctly, regardless of the GLB's scale, origin or mirroring.
//
// For a different villa these simply won't match any meshes and the app falls
// back to its default anchors + live calibration.

export interface PlanXY {
  x: number;
  y: number;
}

/** entity_id -> plan position (cm). Spread across the footprint for a good fit. */
export const ENTITY_CALIBRATION_CM: Record<string, PlanXY> = {
  "camera.livingroom_cam": { x: 1214, y: 991 },
  "camera.patio_1f_cam": { x: 2336, y: 1135 },
  "camera.patio_terrace_cam": { x: 463, y: 1141 },
  "camera.swimming_pool_cam": { x: 94, y: 109 },
  "camera.main_house_door_cam": { x: 826, y: 275 },
  "camera.garden_and_terrace_cam": { x: 921, y: 1144 },
  "camera.garden_public_wall_cam": { x: 559, y: 1144 },
  "camera.kitchen_cam": { x: 80, y: 233 },
  "camera.parking_gate_cam": { x: 2231, y: 278 },
  "climate.living_room_air_conditioner": { x: 755, y: 371 },
  "fan.guest_bathroom_guest_bathroom_fan": { x: 1551, y: 409 },
  "sensor.sensor_t1_temperature": { x: 1488, y: 469 },
  "fan.master_bedroom_master_bathroom_wallswitch_center": { x: 2326, y: 798 },
  "media_player.tv": { x: 1039, y: 1042 },
  "lock.living_room_aqara_smart_door_lock_0aa9_lock_mechanism": { x: 1018, y: 363 },
  "binary_sensor.water_leak_water_heater_1f_water_leak": { x: 2124, y: 385 },
};

export interface RoomPolygon {
  name: string;
  points: PlanXY[]; // plan polygon (cm)
}

/**
 * Actual SweetHome room polygons (cm). Room identification is a point-in-polygon
 * test of the camera against these (after transforming to model space), so the
 * label is exactly the SweetHome room you're standing in — no guessing.
 * (The kitchen/dining/living are one open "Main Room" in this model.)
 */
export const ROOM_POLYGONS_CM: RoomPolygon[] = [
  { name: "Bedroom 1", points: [{ x: 1271.5, y: 631.6 }, { x: 1685.5, y: 631.6 }, { x: 1685.5, y: 1047.6 }, { x: 1271.5, y: 1047.6 }] },
  { name: "Main Room", points: [{ x: 1682.2, y: 635.2 }, { x: 1682.2, y: 505.2 }, { x: 1372.2, y: 505.2 }, { x: 1372.2, y: 365.2 }, { x: 696.2, y: 365.2 }, { x: 197.5, y: 185.2 }, { x: 58.9, y: 566.6 }, { x: 441.5, y: 703.9 }, { x: 441.5, y: 1051.2 }, { x: 1268.2, y: 1051.2 }, { x: 1268.2, y: 635.2 }, { x: 1682.2, y: 635.2 }] },
  { name: "Guest Bathroom", points: [{ x: 1375.5, y: 361.6 }, { x: 1790.5, y: 361.6 }, { x: 1790.5, y: 501.6 }, { x: 1375.5, y: 501.6 }] },
  { name: "WIC / Dressing", points: [{ x: 1790.5, y: 361.6 }, { x: 2100.5, y: 361.6 }, { x: 2100.5, y: 631.6 }, { x: 1790.5, y: 631.6 }] },
  { name: "Master Bedroom", points: [{ x: 2100.5, y: 631.6 }, { x: 2100.5, y: 1047.6 }, { x: 1685.5, y: 1047.6 }, { x: 1685.5, y: 501.6 }, { x: 1790.5, y: 501.6 }, { x: 1790.5, y: 631.6 }] },
  { name: "Master Bathroom", points: [{ x: 2100.5, y: 631.6 }, { x: 2351.5, y: 631.6 }, { x: 2351.5, y: 1047.6 }, { x: 2100.5, y: 1047.6 }] },
  { name: "Storage / Laundry", points: [{ x: 2351.5, y: 361.6 }, { x: 2100.5, y: 361.6 }, { x: 2100.5, y: 631.6 }, { x: 2351.5, y: 631.6 }] },
];

/** Area centroid of a polygon (cm). Good enough as a standing/teleport spot. */
export function polygonCentroid(points: PlanXY[]): PlanXY {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) {
    // Degenerate: fall back to vertex average.
    const n = points.length;
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}
