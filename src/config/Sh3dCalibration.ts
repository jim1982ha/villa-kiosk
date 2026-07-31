// src/config/Sh3dCalibration.ts
// SweetHome-3D plan geometry (centimetres) — TYPES and helpers only.
//
// Because interactive meshes are named with their entity IDs and sit at known
// plan positions, the app fits the exact transform from plan-space to the
// loaded model's world-space at runtime, then places every room anchor /
// teleport point correctly regardless of the GLB's scale, origin or mirroring.
//
// This file ships NO plan DATA. Both tables below are deliberately empty: they
// used to hold one specific villa's entity coordinates and room polygons as a
// fallback, which meant any OTHER villa whose config lacked plan data would be
// calibrated against a floor plan that isn't its own. The real data comes from
// config.sh3dEntities / config.sh3dRooms, parsed from the uploaded .sh3d or
// read straight out of the GLB's embedded vk_rooms_json (pipeline >= 2.14.0)
// — see SceneManager's entityCalibration() / calibrateRooms().

export interface PlanXY {
  x: number;
  y: number;
}

/** entity_id -> plan position (cm). Intentionally EMPTY — supplied at runtime
 *  via config.sh3dEntities; see the file header. */
export const ENTITY_CALIBRATION_CM: Record<string, PlanXY> = {};

export interface RoomPolygon {
  name: string;
  points: PlanXY[]; // plan polygon (cm)
  /** 1-based storey (ground floor = 1). An uploaded .sh3d's parsed rooms
   *  carry a real value (see sh3dParser.ts). */
  floor?: number;
}

/**
 * SweetHome room polygons (cm). Room identification is a point-in-polygon test
 * of the camera against these (after transforming to model space), so the label
 * is exactly the SweetHome room you're standing in — no guessing.
 * Intentionally EMPTY — supplied at runtime via config.sh3dRooms; see header.
 */
export const ROOM_POLYGONS_CM: RoomPolygon[] = [];

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
