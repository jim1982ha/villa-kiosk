// src/utils/geometry.ts

export interface Pt2 {
  x: number;
  z: number;
}

/** Ray-casting point-in-polygon test on the XZ plane. */
export function pointInPolygon(x: number, z: number, poly: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
