// src/utils/affineFit.ts
// Least-squares fit of a 2D affine map plan(x,y) -> world(x,z). Handles scale,
// translation, rotation and mirroring — so it adapts to however a GLB was
// exported. Two independent linear regressions sharing the same normal matrix.

export interface PlanWorldPair {
  px: number;
  py: number;
  wx: number;
  wz: number;
}

export type Affine = (px: number, py: number) => { x: number; z: number };

/** Solve a 3x3 linear system Ax=b by Gaussian elimination; null if singular. */
function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Fit plan->world. Needs >=3 non-collinear points; returns null otherwise. */
export function fitAffine(pts: PlanWorldPair[]): Affine | null {
  if (pts.length < 3) return null;

  let Spp = 0, Spq = 0, Sp1 = 0, Sqq = 0, Sq1 = 0, S11 = 0;
  let bxP = 0, bxQ = 0, bx1 = 0, bzP = 0, bzQ = 0, bz1 = 0;
  for (const { px, py, wx, wz } of pts) {
    Spp += px * px; Spq += px * py; Sp1 += px;
    Sqq += py * py; Sq1 += py; S11 += 1;
    bxP += px * wx; bxQ += py * wx; bx1 += wx;
    bzP += px * wz; bzQ += py * wz; bz1 += wz;
  }
  const A = [
    [Spp, Spq, Sp1],
    [Spq, Sqq, Sq1],
    [Sp1, Sq1, S11],
  ];
  const cx = solve3(A, [bxP, bxQ, bx1]);
  const cz = solve3(A, [bzP, bzQ, bz1]);
  if (!cx || !cz) return null;

  return (px, py) => ({
    x: cx[0] * px + cx[1] * py + cx[2],
    z: cz[0] * px + cz[1] * py + cz[2],
  });
}

/** RMS distance (world units) between fitted and observed points — fit quality. */
export function affineResidual(pts: PlanWorldPair[], f: Affine): number {
  if (pts.length === 0) return Infinity;
  let sum = 0;
  for (const { px, py, wx, wz } of pts) {
    const w = f(px, py);
    sum += (w.x - wx) ** 2 + (w.z - wz) ** 2;
  }
  return Math.sqrt(sum / pts.length);
}

/**
 * Twice the polygon-area spanned by a point set (via the convex-ish shoelace of
 * the points in given order is unreliable, so we use the bounding triangle test):
 * returns the largest triangle area among the points. Near-zero ⇒ collinear, so
 * an affine fit would be ill-conditioned and should be rejected.
 */
export function spanArea(pts: PlanWorldPair[]): number {
  let maxA = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        const a = pts[i], b = pts[j], c = pts[k];
        const area = Math.abs((b.px - a.px) * (c.py - a.py) - (c.px - a.px) * (b.py - a.py)) / 2;
        if (area > maxA) maxA = area;
      }
    }
  }
  return maxA;
}
