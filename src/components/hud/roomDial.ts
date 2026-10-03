// src/components/hud/roomDial.ts
// THE ROOM DIAL'S GEOMETRY: which rooms a floor button offers, whether they
// fit an arc beside it on this screen, and where each chip goes. Pure — the
// screen size is an argument, so tests/oracles/room_dial.mjs drives it at a
// phone, an unfolded phone and the wall tablet.
//
// ⚠️ IT LIVED INSIDE THE HUD COMPONENT (until 2.496.268): ~110 lines of polar
// layout redeclared on every render and reading window.innerHeight/innerWidth
// directly, so "does the arc fit, else one column" — adjusted by the owner in
// 2.496.240 and 2.496.263 — could only be checked by a regex over HUD.tsx.

import type { TeleportPoint } from "@/types/scene.types";

export interface RadialItem {
  key: string;
  label: string;
  /** Viewport coordinates (position: fixed) of the chip centre. */
  x: number;
  y: number;
  kind: "room" | "manage";
  /** Highlighted state, currently unused by either kind — kept so a future
   *  "you're already here" indicator doesn't need a shape change. */
  active: boolean;
}

/** Where an open dial sits. `list`: the rooms do not fit the arc on this
 *  screen — they show as one scrollable column beside the floor buttons. */
export interface RoomDial { cx: number; cy: number; floor: number; list: boolean }

export interface Viewport { width: number; height: number }

const ROOM_R = 228;            // baseline outer-arc radius — the original, always-fine "few rooms" size
const ROOM_MIN_ARC_PX = 48;    // safe arc-length per room AT that baseline (228px radius, ~12° steps)
const ROOM_VIEWPORT_PAD = 40;  // top/bottom breathing room — matches the cy-clamp margin below
const ROOM_R_FLOOR = 90;       // sanity floor so an extreme case never collapses the fan onto the button
const RADIAL_CHIP_HALF_W = 95; // half the widest room chip (.radial-item max-width: 190px)
const ANCHOR_GAP = 16;         // the dial's centre sits this far right of the floor button

/** A floor's rooms, alphabetical — reads as a deliberately organised list
 *  rather than whatever order rooms happened to be added. */
export function roomsOnFloor(points: readonly TeleportPoint[], floor: number): TeleportPoint[] {
  return points.filter((p) => (p.floor ?? 1) === floor).sort((a, b) => a.name.localeCompare(b.name));
}

/** Half-angle (deg) of the room fan for `n` rooms: a tight ~12° step per room
 *  until the spread saturates at ±86°. */
function halfAngle(n: number): number {
  return n <= 1 ? 0 : Math.min(86, ((n - 1) * 12) / 2);
}

/** The radius `n` rooms need for their safe label spacing on the arc —
 *  asked by both the radius and the does-it-fit test (2.496.263). */
function neededRadius(n: number): number {
  const half = halfAngle(n);
  let needed = ROOM_R;
  if (n > 1) {
    const stepRad = ((2 * half) / (n - 1)) * (Math.PI / 180);
    if (stepRad > 0) needed = Math.max(ROOM_R, ROOM_MIN_ARC_PX / stepRad);
  }
  return needed;
}

/**
 * Outer arc radius for `n` rooms. The baseline (228px) reproduces the original
 * "few rooms" look. Past ~15 rooms the spread saturates at ±86°, so the radius
 * grows instead to keep the same safe per-room spacing — capped by the
 * viewport's height so the dial is never pushed off-screen.
 */
function radiusFor(n: number, vp: Viewport): number {
  const maxForViewport = vp.height / 2 - ROOM_VIEWPORT_PAD;
  // ⚠️ NOT clamp(needed, ROOM_R_FLOOR, maxForViewport), which it looks like.
  // The FLOOR wins here: on a short viewport maxForViewport can fall below
  // ROOM_R_FLOOR, and clamp() would let the ceiling win and collapse the fan
  // to something unreadable. Written this way on purpose — do not converge.
  return Math.max(ROOM_R_FLOOR, Math.min(neededRadius(n), maxForViewport));
}

/**
 * Whether `n` rooms fit the arc at their safe spacing on this screen, and the
 * arc fits across it.
 *
 * ⚠️ OVERLAP IS NO LONGER THE FALLBACK (owner, 2026-10-01). Past the viewport
 * cap the arc used to let labels overlap: on a phone held upright, 17 rooms
 * stacked onto each other — unreadable, and a tap could land on the wrong
 * room. When the arc does not fit, the same rooms show as one scrollable
 * column instead; the arc stays wherever it fits (the wall tablet).
 */
function arcFits(n: number, cx: number, vp: Viewport): boolean {
  const needed = neededRadius(n);
  return needed <= vp.height / 2 - ROOM_VIEWPORT_PAD && cx + needed + RADIAL_CHIP_HALF_W <= vp.width - 8;
}

/** Open floor `floor`'s dial beside its button (`anchor`, the button's
 *  client rect): centre clamped so the arc is never clipped top or bottom,
 *  and the column instead whenever the arc would not fit. */
export function openRoomDial(
  floor: number, roomCount: number,
  anchor: { right: number; top: number; height: number }, vp: Viewport,
): RoomDial {
  const radius = radiusFor(roomCount, vp);
  const cx = anchor.right + ANCHOR_GAP;
  const margin = radius + ROOM_VIEWPORT_PAD;
  const cy = Math.max(
    Math.min(margin, vp.height / 2),
    Math.min(anchor.top + anchor.height / 2, vp.height - margin),
  );
  return { cx, cy, floor, list: !arcFits(roomCount, cx, vp) };
}

/** The chips of an open dial: on the arc, or (list) in the order the column
 *  shows them — the menu lays the column out, so x/y are unused there. */
export function roomDialItems(rooms: readonly TeleportPoint[], dial: RoomDial, vp: Viewport): RadialItem[] {
  if (dial.list) {
    return rooms.map((p) => ({ key: `r${p.name}`, label: p.name, kind: "room" as const, x: 0, y: 0, active: false }));
  }
  const n = rooms.length;
  const half = halfAngle(n);
  const radius = radiusFor(n, vp);
  return rooms.map((p, i) => {
    const deg = n <= 1 ? 0 : -half + (2 * half) * (i / (n - 1));
    const rad = (deg * Math.PI) / 180;
    return {
      key: `r${p.name}`, label: p.name, kind: "room" as const,
      x: dial.cx + radius * Math.cos(rad), y: dial.cy + radius * Math.sin(rad), active: false,
    };
  });
}
