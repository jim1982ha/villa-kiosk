// src/babylon/villaPlan.ts
// THE VILLA'S PLAN IN THE MODEL'S WORLD — one module: which devices mark a
// point of the plan, the plan→world fit, each room's outline in world space
// and the floor it lies on, the storeys, and each room's viewpoint.
//
// ⚠️ TWO COPIES, AND THEY DRIFTED (2026-11-20). SceneManager.calibrateRooms
// did all of this inline, and the render rig, which exists to show a light
// fix before it ships, re-implemented it with its own rules: a pose mesh told
// by `id.includes("__")`, the spread filter only on request, a 50 m model, the
// storey's meshes by a name pattern. The rig then checked its own copy of the
// plan, not the app's. Both call this now; what stays in SceneManager is the
// fan-out to the camera, the floors and the visuals.
//
// Interface: `buildVillaPlan(inputs, ports)` → the calibrated plan, or null
// when there is nothing to fit against. The scene comes in as ports: the
// floor probe (FloorProbe, which samples a storey's meshes, FloorManager's)
// and the solver's "is there a floor here?" for a villa with no device on its
// plan (flatFloorAt). tests/oracles/villa_plan.mjs.

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { hasVariantSuffix } from "@/config/EntityMap";
import { polygonCentroid } from "@/config/Sh3dCalibration";
import type { PlanWorldPair } from "@/utils/affineFit";
import { pointInside, type Pt2 } from "@/utils/geometry";
import type { TeleportPoint } from "@/types/scene.types";
import type { FloorArea } from "./floorProbe";
import { rayTargets } from "./meshRoles";
import { solvePlanToWorld } from "./roomCalibration";
import { Storeys, isStairwell } from "./storeys";

/** A device whose meshes' centres spread wider than this (metres) is not one
 *  point on the plan, so it does not calibrate the plan. A lamp's parts, a
 *  curtain, a fan lie well inside it. */
export const CALIBRATION_SPREAD_M = 1;

/** Round a derived world coordinate to millimetres. Used where a computed
 *  position is about to be STORED rather than only drawn — see the teleport
 *  points below for why the precision has to be dropped. */
const mm = (v: number): number => Math.round(v * 1000) / 1000;

/** A room as the plan draws it (cm), with the storey it records. */
export interface PlanRoom { name: string; points: { x: number; y: number }[]; floor?: number }

/** A calibrated room in world space — what the plan (storeys.ts) holds. */
export interface WorldRoom {
  name: string;
  pts: Pt2[];
  floorY: number;
  /** The plan's storey number for it. */
  storey: number;
  /** A stepped room's surface-hugging highlight mesh, built after first paint. */
  conform?: { positions: number[]; indices: number[] };
}

export interface VillaPlanInputs {
  /** Every device's meshes, by entity id (EntityVisuals' index). Only those
   *  with a point on the plan are read, and only theirs get a world matrix. */
  devices: Iterable<readonly [string, readonly AbstractMesh[]]>;
  /** Each device's point on the plan (cm). */
  entities: Readonly<Record<string, { x: number; y: number }>>;
  rooms: readonly PlanRoom[];
  /** The loaded model's horizontal size (world metres): the fit's scale when
   *  too few devices mark the plan. */
  modelWidth: number;
  modelDepth: number;
  /** The configured eye height above a room's floor, for its viewpoint. */
  eyeHeight: number;
}

export interface VillaPlanPorts {
  /** The floor most of an area of a storey lies on, from the storey's own
   *  meshes whether or not it is shown; null where it has none. FloorProbe is
   *  the adapter, and holds the storeys' meshes (FloorManager) for the light
   *  pools too. */
  probe: { areaFloorY(area: FloorArea, storey: number): number | null };
  /** Does a downward ray at (x, z) meet a flat floor? Only for a villa with
   *  no device on its plan (roomCalibration's last strategy). */
  hitsFloorAt(x: number, z: number): boolean;
}

export interface VillaPlan {
  planToWorld: (px: number, py: number) => { x: number; z: number };
  /** Which strategy the fit landed on, for the load log. */
  strategy: string;
  /** The device ↔ plan points the fit was given. */
  pairs: PlanWorldPair[];
  /** Every room of the plan, in its order, in world space with its floor. */
  rooms: WorldRoom[];
  /** The plan the readers share: the rooms that contain anything. */
  storeys: Storeys<WorldRoom>;
  /** One viewpoint per room, in its order. */
  teleportPoints: TeleportPoint[];
  /** Staircase rooms (index into `rooms`), whose glow hugs the steps later. */
  stairRooms: Array<{ index: number; pts: Pt2[]; floor: number }>;
}

/**
 * The device ↔ plan pairs the fit is solved from.
 *
 * ⚠️ ONLY MESHES THAT MARK ONE PLACE (owner, 2026-11-19: the light on the
 * floor sat beside its lamp). A pose mesh ("__open") stands where the pose
 * puts it, a curtain drawn aside, not at the device's plan point; a device
 * drawn as meshes spread over metres (a row of globes, fans sharing a name)
 * averages to a point the plan never marked. Both pulled the fit and moved
 * every room; the robust fit (roomCalibration) drops what is left.
 *
 * Only the calibration entities matter, and only their meshes need a world
 * matrix, so both the read and the recompute touch a hundred-odd meshes
 * rather than all of them (SceneManager's note on reading the index).
 */
export function planPairs(
  devices: Iterable<readonly [string, readonly AbstractMesh[]]>,
  entities: Readonly<Record<string, { x: number; y: number }>>,
): PlanWorldPair[] {
  const pairs: PlanWorldPair[] = [];
  for (const [entityId, list] of devices) {
    if (!(entityId in entities) || hasVariantSuffix(entityId)) continue;
    let x = 0, z = 0, n = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const m of list) {
      if (hasVariantSuffix(m.name)) continue;
      // Bounding-box centre (same reason as in SceneManager.normalizeScale).
      m.computeWorldMatrix(true);
      const c = m.getBoundingInfo().boundingBox.centerWorld;
      x += c.x; z += c.z; n += 1;
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
    if (n === 0 || Math.hypot(maxX - minX, maxZ - minZ) > CALIBRATION_SPREAD_M) continue;
    const plan = entities[entityId];
    pairs.push({ px: plan.x, py: plan.y, wx: x / n, wz: z / n });
  }
  return pairs;
}

/** The scene's adapter for `hitsFloorAt`: a downward ray meets a flat,
 *  enabled-or-not mesh that is no ceiling. */
export function flatFloorAt(scene: Scene): (x: number, z: number) => boolean {
  const target = rayTargets({ enabled: false });
  return (wx, wz) => scene.pickWithRay(
    new Ray(new Vector3(wx, 20, wz), new Vector3(0, -1, 0), 40),
    (m) => {
      // ⚠️ A CEILING IS THIN TOO (2.478.0, /dry-audit). This ray starts at
      // y=20 and the thinness test alone happily accepts a 2.44 m ceiling
      // slab on the way down, answering "there is floor here" from the
      // lid rather than the floor. Harmless where a floor is directly
      // beneath, wrong wherever a ceiling overhangs past one — and it
      // feeds CALIBRATION, so a wrong answer moves the whole plan fit.
      // The ceiling rule is `rayTargets`' now and cannot be dropped.
      if (!target(m)) return false;
      const bb = m.getBoundingInfo().boundingBox;
      return (bb.maximumWorld.y - bb.minimumWorld.y) < 0.8; // flat = floor/ground
    },
  )?.hit ?? false;
}

/** The plan in the model's world, or null with no rooms and no device to fit. */
export function buildVillaPlan(inputs: VillaPlanInputs, ports: VillaPlanPorts): VillaPlan | null {
  const pairs = planPairs(inputs.devices, inputs.entities);
  // Delegated to the pure solver in roomCalibration.ts (three strategies, in
  // order of accuracy). The solver only needs one scene query — the
  // no-entity fallback's "does a downward ray hit a floor here?" probe.
  const solution = solvePlanToWorld({
    pairs, rooms: inputs.rooms as PlanRoom[],
    modelWidth: inputs.modelWidth, modelDepth: inputs.modelDepth,
    hitsFloorAt: ports.hitsFloorAt,
  });
  if (!solution) return null;
  const { planToWorld } = solution;

  // Transform each room polygon to model space; centroid → teleport point.
  const rooms: WorldRoom[] = [];
  const teleportPoints: TeleportPoint[] = [];
  const stairRooms: VillaPlan["stairRooms"] = [];
  for (const room of inputs.rooms) {
    const pts = room.points.map((p) => planToWorld(p.x, p.y));
    // The storey the plan actually recorded. This used to be
    // `(room.floor ?? 1) >= 2 ? 2 : 1` — a clamp onto a `1 | 2` union, so a
    // three-storey villa had its top floor's rooms filed under the second.
    const floor = room.floor ?? 1;
    const c = polygonCentroid(room.points);
    // Its viewpoint: in the room, even where its middle is not.
    const wc = pointInside(pts, planToWorld(c.x, c.y));
    // Its floor: what most of it lies on (floorProbe.areaFloorY), the ground
    // (0) where its storey has nothing under it.
    const floorY = ports.probe.areaFloorY({ outline: pts }, floor) ?? 0;
    // Surface-hug the glow ONLY for staircase rooms (matched by name). The
    // grid-probe raycasts the whole fused structure, so running it on every
    // room — especially the big outdoor/terrain polygons, which vary in height
    // and so false-positive as "stepped" — flooded load with tens of thousands
    // of raycasts and hung "Loading the villa". Stairs are the only case a flat
    // patch reads wrong, so scope it to them. Built after first paint
    // (SceneManager.finishCalibrationCosmetics, since 2.350.0).
    if (isStairwell(room.name)) stairRooms.push({ index: rooms.length, pts, floor });
    // The plan's storey travels with the room — Storeys (storeys.ts) needs
    // it, and re-deriving it from a centroid height is what went wrong.
    rooms.push({ name: room.name, pts, floorY, storey: floor });
    // QUANTISED TO MILLIMETRES, and that is not cosmetic — it is what stops
    // this data pushing itself to the server on every single boot.
    //
    // These points are DERIVED: `planToWorld` is an affine fit re-solved on
    // each load and `floorY` comes off a raycast, so both land on full
    // double precision. Dashboard adopts them into `config.teleportPoints`,
    // which is a SHARED key — and the sync layer diffs shared items with
    // JSON.stringify (keyedSync's diffKeyed), so a single differing ULP in
    // one coordinate makes the whole room read as an edit worth sending.
    // Field telemetry showed a config push on essentially every boot with no
    // user edit behind it, ~15/day, against a rule the sync layer's own
    // docstring calls load-bearing ("push only real changes").
    //
    // A millimetre is far below anything the camera can express (these feed
    // an eye position and a look-at target in metres) and far above the noise
    // floor of a re-solved fit, so equal geometry now serialises equal.
    teleportPoints.push({
      name: room.name,
      floor,
      // The configured eye height — it was a literal 1.7 here, so a villa
      // with its own eye height had every room viewpoint at the wrong one,
      // and syncRoomPoints (floorY = y − eyeHeight) read the floor wrong.
      position: { x: mm(wc.x), y: mm(floorY + inputs.eyeHeight), z: mm(wc.z) },
      target: { x: mm(wc.x), y: mm(floorY + inputs.eyeHeight - 0.1), z: mm(wc.z + 1.5) },
      // DERIVED — never synced. See TeleportPoint.fitted.
      fitted: true,
    });
  }
  // ONE plan per calibration, the same object for every reader. A polygon
  // of fewer than three points contains nothing and has no floor to vote.
  const storeys = new Storeys(rooms.filter((p) => p.pts.length >= 3));
  return { planToWorld, strategy: solution.strategy, pairs, rooms, storeys, teleportPoints, stairRooms };
}
