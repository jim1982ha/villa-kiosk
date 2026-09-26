// src/babylon/walkerSpawn.ts
// WHERE A WALKER CAN STAND: the first-person spawn — which candidate wins,
// whether a person fits there and on which surface, where the foot of the
// staircase is, and the eye height all of it is measured with.
//
// ⚠️ ~330 LINES OF SceneManager WITH NO TEST (to 2.496.97), after six releases
// of spawn fixes each reported from a screenshot: mid-flight on the stairs, the
// crawlspace under them, between open risers, a split-level floor probed from
// below. And it leaked: `standable()` returned a boolean and handed its real
// answers — the surface stood on, why it refused — back through two fields the
// caller read straight after; `config.eyeHeight ?? 1.7` was written seven times
// and the room viewpoints ignored the setting altogether (`floorY + 1.7`); and
// picking a room skipped the stand check the default spawn made, so a
// split-level room placed the eye from the slab beneath it.
//
// The rays are behind SpawnWorld — SceneManager's Babylon adapter, and the
// oracle's test grid (tests/oracles/walker_spawn.mjs): two adapters, a real
// seam. Pure otherwise.

import { pointInPolygon, type Pt2 } from "@/utils/geometry";
import type { TeleportPoint } from "@/types/scene.types";

/** The eye height when the config sets none — the ONE default. */
export const DEFAULT_EYE_HEIGHT = 1.7;
export function eyeHeightOf(configured: number | undefined): number {
  return configured ?? DEFAULT_EYE_HEIGHT;
}

/**
 * How far above the probed floor a surface may be and still be the one you
 * stand on, rather than something over your head.
 *
 * 0.70 m: a domestic step is ~0.17 m and a split-level change is a few of them;
 * a person's torso starts well above this, so nothing at head height can hide
 * under it. Deliberately larger than CameraController.STEP_CLEAR (0.55), which
 * answers a different question — what the collision capsule may climb WHILE
 * WALKING, rather than what a spawn may be placed on top of.
 */
export const STAND_STEP_MAX = 0.70;
/** The collision capsule's radius — the headroom test samples its width. */
const BODY_RADIUS = 0.3;

/** What the spawn needs from the villa. */
export interface SpawnWorld {
  eyeHeight: number;
  /** The storey's floor under (x, z) — floorProbe's LOWEST hit in the column. */
  floorAt(x: number, z: number, floor: number): number;
  /** A structure-only ray straight UP from (x, y, z), `len` long: the first
   *  surface's height and name, or null. Structure, not collidables: stairs are
   *  deliberately not collidable, and they are what this has to see. */
  castUp(x: number, y: number, z: number, len: number): { y: number; mesh: string } | null;
  /** The plan's stairwell containing (x, z), if any (Storeys.stairwellAt). */
  stairwellAt(x: number, z: number): { name: string } | null;
  /** The plan's ground-storey rooms (Storeys.groundRooms). */
  groundRooms(): readonly { pts: Pt2[] }[];
  /** A look-target down the most open direction from an eye at (x, y, z). */
  openestFacing(x: number, y: number, z: number): { x: number; y: number; z: number };
}

export type Stand = { ok: true; y: number } | { ok: false; why: string };

/**
 * Can a PERSON STAND HERE — and on which surface?
 *
 * ⚠️ NEVER INSIDE A STAIRWELL (2.460.0). This villa's staircase is OPEN-RISER:
 * a single vertical ray between two treads reaches the sky and reports clear
 * headroom while a person there is inside the stairs. The plan knows where the
 * staircase is — asking it is exact and cannot be threaded.
 *
 * ⚠️ NO "IS THIS THE LOWEST FLOOR IN THE VILLA" TEST (2.463.0). It rejected the
 * Living Room and Bedroom 1 outright on a split-level ground storey and sent
 * the spawn back to the staircase. The test was only ever about not landing on
 * a tread, which the stairwell test answers exactly.
 *
 * ⚠️ THE PROBED FLOOR IS NOT ALWAYS THE SURFACE YOU STAND ON (2.464.0). The
 * probe takes the LOWEST hit, so under a raised room it is the slab BENEATH it,
 * and the headroom ray then hit the real floor from underneath ("blocked 0.08m
 * up by Structure_primitive72" — a floor, not an obstruction). So walk UP: a
 * surface within one step of the probe IS the walking surface. Bounded.
 *
 * ⚠️ HEADROOM, ACROSS THE BODY'S WIDTH (2.459.0). The floor under a staircase
 * is at ground level, so height alone accepted the crawlspace beneath it. The
 * head-and-torso room is sampled at the capsule's centre and four points on its
 * radius — a ray is a measure-zero object and obstructions have gaps.
 *
 * A refusal NAMES ITS BLOCKER: "not standable" is not a diagnosis.
 */
export function standAt(w: SpawnWorld, x: number, z: number, floor: number): Stand {
  const floorY = w.floorAt(x, z, floor);
  const well = w.stairwellAt(x, z);
  if (well) return { ok: false, why: `inside stairwell "${well.name}"` };
  let standY = floorY;
  for (let i = 0; i < 4; i++) {
    const step = w.castUp(x, standY + 0.02, z, STAND_STEP_MAX);
    if (!step) break;
    standY = step.y;
  }
  const need = w.eyeHeight + 0.15;
  const R = BODY_RADIUS;
  for (const [dx, dz] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]] as const) {
    const hit = w.castUp(x + dx, standY + STAND_STEP_MAX, z + dz, need - STAND_STEP_MAX);
    if (hit) {
      return {
        ok: false,
        why: `blocked ${(hit.y - floorY).toFixed(2)}m above floor by "${hit.mesh}"`
          + (standY !== floorY ? ` (stood up to ${(standY - floorY).toFixed(2)}m)` : ""),
      };
    }
  }
  return { ok: true, y: standY };
}

/**
 * The nearest spot to (x, z) a person can stand on in a GROUND-storey room —
 * the foot of the staircase, by construction rather than by an offset
 * particular to one villa.
 *
 * ⚠️ THE TEST IS WHAT YOU STAND ON, NOT POLYGON CONTAINMENT (2.458.0): a
 * stairwell's XZ sits inside whatever room surrounds it, so containment
 * answered yes at the first sample and the walker landed mid-flight. `standAt`
 * carries the floor, the stairwell and the headroom tests.
 *
 * Outward in rings, 1–8 m, 12 directions; unchanged with no ground rooms
 * (calibration has not run).
 */
export function stairFoot(w: SpawnWorld, x: number, z: number): { x: number; z: number } {
  const ground = w.groundRooms();
  if (!ground.length) return { x, z };
  const atGround = (px: number, pz: number) =>
    standAt(w, px, pz, 1).ok && ground.some((r) => pointInPolygon(px, pz, r.pts));
  if (atGround(x, z)) return { x, z };
  for (let radius = 1; radius <= 8; radius += 1) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
      if (atGround(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

/** Which end of a straight flight is its BOTTOM, from the tread heights
 *  probed near each end — and the way up from there (+1 / −1 along the axis). */
export function flightBottom(loEnd: number, hiEnd: number, loY: number, hiY: number): { bottom: number; up: number } {
  const bottom = loY <= hiY ? loEnd : hiEnd;
  const up = Math.sign((loY <= hiY ? hiEnd : loEnd) - bottom) || 1;
  return { bottom, up };
}

/** The ground-floor rooms a walker would expect to arrive in first, by the
 *  words a plan names them with (any language the owner writes in). */
const ARRIVAL_ROOM = /main|living|salon|séjour|sejour|hall|entr/i;

/**
 * The default first-person landing: ALWAYS the ground floor.
 *
 * ⚠️ EVERY CANDIDATE IS VALIDATED, AND THE CHAIN FALLS THROUGH ON FAILURE
 * (2.459.0) — the staircase spawn put the walker somewhere unstandable twice
 * while it was the only candidate consulted.
 *
 * ⚠️ THE STAIRCASE IS LAST, AND THAT IS THE OWNER'S CALL (2.460.0): four
 * releases could not make it produce a spot a person can stand in, and the
 * owner asked three times to arrive on the ground floor. A ROOM's centroid is
 * open floor by construction. Order: an arrival room (living, hall, entry…),
 * any ground room, the stair foot, any room at all.
 *
 * The eye goes on the surface `standAt` validated, not the point's own y —
 * on a split level that was the slab UNDER a raised room.
 */
export function pickSpawn(
  w: SpawnWorld, points: readonly TeleportPoint[] | null | undefined, stairs: () => TeleportPoint | null,
  log: (line: string) => void = () => {},
): TeleportPoint {
  const ground = (p: TeleportPoint) => p.floor === 1;
  const candidates: Array<[string, () => TeleportPoint | null | undefined]> = [
    ["namedRoom", () => points?.find((p) => ground(p) && ARRIVAL_ROOM.test(p.name))],
    ["groundRoom", () => points?.find(ground)],
    ["stairFoot", stairs],
    ["anyPoint", () => points?.[0]],
  ];
  for (const [why, get] of candidates) {
    const p = get();
    if (!p) continue;
    const s = standAt(w, p.position.x, p.position.z, p.floor);
    if (!s.ok) { log(`spawn: REJECTED ${why} "${p.name}" — ${s.why}`); continue; }
    log(`spawn: ${why} "${p.name}" floor=${p.floor} at=${p.position.x.toFixed(1)},${p.position.z.toFixed(1)} standY=${s.y.toFixed(2)}`);
    return { ...p, position: { ...p.position, y: s.y + w.eyeHeight } };
  }
  // Nothing validated. Say so — silently falling back to the origin is how a
  // spawn bug reads as "the villa loaded somewhere strange".
  const fallback = points?.find(ground) ?? points?.[0];
  log(`spawn: NO standable candidate — using ${fallback ? `"${fallback.name}"` : "origin"}`);
  return fallback ?? {
    name: "Start", floor: 1, position: { x: 0, y: w.eyeHeight, z: 0 }, target: { x: 0, y: 1.6, z: 2 },
  };
}

/**
 * Into the room the user picked (overview → first person). The user's choice
 * is never refused, but it is STOOD IN like the default spawn: on a split
 * level the eye goes on the room's real surface, not the slab probed beneath
 * it (it used to skip this check), and it faces open space.
 */
export function roomSpawn(w: SpawnWorld, room: TeleportPoint): TeleportPoint {
  const { x, z } = room.position;
  const s = standAt(w, x, z, room.floor);
  const y = (s.ok ? s.y : w.floorAt(x, z, room.floor)) + w.eyeHeight;
  return { name: room.name, floor: room.floor, position: { x, y, z }, target: w.openestFacing(x, y - 0.1, z) };
}
