// src/utils/sh3dTransform.ts
// Convert SweetHome 3D plan coordinates (cm) to Babylon world coordinates (m).

import type { ModelTransform, Vec3 } from "@/types/scene.types";

/** plan (x,y in cm) -> Babylon (x,z in m); y is supplied separately (eye height). */
export function sh3dToBabylon(
  planX: number,
  planY: number,
  t: ModelTransform,
  eyeY = 1.7,
): Vec3 {
  const x = (planX - t.centreX) * t.scale * (t.flipX ? -1 : 1);
  const z = (planY - t.centreZ) * t.scale * (t.flipZ ? -1 : 1);
  return { x, y: eyeY, z };
}
