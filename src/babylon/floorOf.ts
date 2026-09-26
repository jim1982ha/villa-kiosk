// src/babylon/floorOf.ts
// WHICH FLOOR A MESH IS ON, and the two questions every reader asks of it —
// decided once, for FloorManager (which stamps it) and its readers (the badge
// culler, the blue "clickable" outlines, the fan spinner).
//
// ⚠️ A SECOND STOREY AUTHORITY, AND THREE READINGS OF IT (round 9, 2.496.140).
// storeys.ts retired "decide the storey from heights" for the whole app, but
// FloorManager still put every non-structure mesh — every light, fan, sensor
// — on 2F iff its bounding-box centre stood over a fixed 2.8 m, two floors at
// most, whatever the plan said. Its readers then each found the stamp their
// own way (mesh → anchor → parent; mesh → parent; mesh only). Now the plan
// decides wherever it knows two storeys or more; the fixed split survives only
// for a villa whose plan does not (no rooms drawn, or one storey drawn over a
// two-storey model), where it is the only information there is.
//
// Pure and import-free: tests/oracles/floor_of.mjs.

/** The height split for a villa whose plan cannot say (see above). */
export const FLOOR_SPLIT_Y = 2.8;

/** What FloorManager needs from the storey plan: Storeys.levelAt. */
export interface FloorPlan { readonly count: number; levelAt(y: number): number | null }

/**
 * The 1-based floor of a mesh. Structure carries its pipeline level (0-based).
 * Anything else stands on the storey the plan puts its centre on — the same
 * clearance rule the plan gives a light fixture (a ceiling lamp hangs
 * centimetres under the slab above and is still downstairs) — and on the
 * height split when the plan knows fewer than two storeys.
 */
export function floorOf(
  role: { isStructure: boolean; level: number }, centreY: number, plan?: FloorPlan | null,
): number {
  if (role.isStructure) return role.level + 1;
  if (plan && plan.count >= 2) {
    const level = plan.levelAt(centreY);
    if (level !== null) return level;
  }
  return centreY > FLOOR_SPLIT_Y ? 2 : 1;
}

/** Anything that can carry the stamp: a mesh, an anchor node. */
export interface FloorNode { metadata?: unknown; parent?: FloorNode | null }

const stampOf = (n: FloorNode | null | undefined): number | undefined => {
  const f = (n?.metadata as { floorIndex?: unknown } | null | undefined)?.floorIndex;
  return typeof f === "number" ? f : undefined;
};

/**
 * The floor stamped on the first of `nodes` that carries one, each node tried
 * before its parent (a split primitive's stamp is on its parent). Nodes are in
 * the caller's order of trust — a label passes its bound mesh first, because a
 * fan's anchor sits on a shared container FloorManager never stamps.
 */
export function stampedFloor(...nodes: (FloorNode | null | undefined)[]): number | undefined {
  for (const n of nodes) {
    const f = stampOf(n) ?? stampOf(n?.parent);
    if (f !== undefined) return f;
  }
  return undefined;
}

/** On the floor being LOOKED AT: a badge, an outline. Unstamped: yes. */
export function onActiveFloor(floor: number | undefined, active: number): boolean {
  return floor === undefined || floor === active;
}

/** DRAWN at all: floors are cumulative downward (the active one and every one
 *  below it are rendered), so a fan below the active floor still turns. */
export function isRenderedFloor(floor: number | undefined, active: number): boolean {
  return floor === undefined || floor <= active;
}
