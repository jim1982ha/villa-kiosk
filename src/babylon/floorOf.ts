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

/** A storey the MODEL's own structure shows: its 1-based floor and the height
 *  of its slab (the lowest point of its structure). */
export interface StructureFloor { floor: number; y: number }

/** How far above a slab a thing must stand to be ON that storey — the plan's
 *  own clearance (storeys.STOREY_MIN_MOUNT), restated here only because this
 *  module is import-free; tests/oracles/floor_of.mjs holds the two equal. */
export const FLOOR_MIN_MOUNT = 0.30;

/**
 * The 1-based floor of a mesh. Structure carries its pipeline level (0-based).
 * Anything else stands on the storey the plan puts its centre on — the same
 * clearance rule the plan gives a light fixture (a ceiling lamp hangs
 * centimetres under the slab above and is still downstairs).
 *
 * ⚠️ NO PLAN USED TO MEAN TWO FLOORS (2.496.261). Without a plan of two
 * storeys or more, everything above 2.8 m was 2F and nothing could be 3F — a
 * three-storey villa with no rooms drawn put its top floor's devices on the
 * second. The model's own structure knows its storeys (`structure`, one slab
 * per pipeline level), so that decides next, with the same clearance; the
 * fixed split is left only for a model that carries neither.
 */
export function floorOf(
  role: { isStructure: boolean; level: number }, centreY: number, plan?: FloorPlan | null,
  structure?: readonly StructureFloor[],
): number {
  if (role.isStructure) return role.level + 1;
  if (plan && plan.count >= 2) {
    const level = plan.levelAt(centreY);
    if (level !== null) return level;
  }
  if (structure && structure.length >= 2) {
    let pick = structure[0].floor;
    for (const s of structure) if (s.y <= centreY - FLOOR_MIN_MOUNT) pick = s.floor;
    return pick;
  }
  return centreY > FLOOR_SPLIT_Y ? 2 : 1;
}

/** The storeys `meshes` of structure show, lowest first (one entry per
 *  floor, at its lowest point) — what floorOf falls back on. */
export function structureFloors(meshes: readonly { role: { isStructure: boolean; level: number }; minY: number }[]): StructureFloor[] {
  const low = new Map<number, number>();
  for (const { role, minY } of meshes) {
    if (!role.isStructure) continue;
    const f = role.level + 1;
    low.set(f, Math.min(low.get(f) ?? Infinity, minY));
  }
  return [...low].map(([floor, y]) => ({ floor, y })).sort((a, b) => a.floor - b.floor);
}

/**
 * Where a stair trigger takes the walker: the next floor the model HAS above
 * (or below) the active one, or null at the top (bottom). The triggers jumped
 * 1 → 2 and 2 → 1 only, so a third storey could never be walked to.
 */
export function stairTarget(floors: readonly number[], current: number, up: boolean): number | null {
  const sorted = [...floors].sort((a, b) => a - b);
  const next = up ? sorted.find((f) => f > current) : [...sorted].reverse().find((f) => f < current);
  return next ?? null;
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
