// src/components/canvas/pictureLayout.ts
// Where the villa pictures (PictureView) put things, as values: the floors stacked in the map's free area, each
// picture contain-fitted in its band, the badges on their (u, v), those that would touch drawn as one group badge, the room a point is in,
// the day or night picture, and the badge a remote's arrow key moves to. Pure; no Babylon, no DOM.

import { skyMoment, guessedMoment } from "@/babylon/skyMoment";
import type { PictureFloor, PictureRoom } from "@/utils/villaPictures";
import { MARK_ORDER, type BadgeMark, type LinkPill } from "@/utils/deviceActivity";

export interface Rect { x: number; y: number; w: number; h: number }

/** The largest rect of the picture's shape that fits `box`, centred. */
export function containRect(box: Rect, picW: number, picH: number): Rect {
  if (!(picW > 0 && picH > 0 && box.w > 0 && box.h > 0)) return { x: box.x, y: box.y, w: 0, h: 0 };
  const scale = Math.min(box.w / picW, box.h / picH);
  const w = picW * scale, h = picH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Each floor's band of `area`. ⚠️ SIDE BY SIDE ON A WIDE SCREEN (owner, 2026-11-24: "split the view vertically ...
 *  as it fits more the 16/9 aspect of TV screens"): 1F on the left, 2F on its right; stacked (2F over 1F, 1F at the
 *  bottom, the first ask) where that draws the pictures larger, a phone held upright. Whichever arrangement gives the
 *  pictures the larger scale wins, so no screen gets one shrunk for nothing. Bands are sized to their pictures at a
 *  common scale so one picture is not shrunk for another's shape. */
export function floorBands(area: Rect, floors: readonly PictureFloor[], gap: number): { floor: PictureFloor; band: Rect }[] {
  if (floors.length === 0) return [];
  const dims = floors.map((f) => (f.width > 0 && f.height > 0 ? { w: f.width, h: f.height } : { w: 1, h: 1 }));
  const n = floors.length;
  // side by side: widths add up, the tallest sets the height
  const rowScale = Math.min(Math.max(0, area.w - gap * (n - 1)) / dims.reduce((s, d) => s + d.w, 0),
    area.h / Math.max(...dims.map((d) => d.h)));
  // stacked: heights add up, the widest sets the width
  const colScale = Math.min(area.w / Math.max(...dims.map((d) => d.w)),
    Math.max(0, area.h - gap * (n - 1)) / dims.reduce((s, d) => s + d.h, 0));
  if (rowScale >= colScale) {
    const order = floors.map((floor, i) => ({ floor, d: dims[i] })).sort((a, b) => a.floor.floor - b.floor.floor);
    const used = order.reduce((s, o) => s + o.d.w * rowScale, 0) + gap * (n - 1);
    let x = area.x + (area.w - used) / 2;
    return order.map(({ floor, d }) => {
      const band = { x, y: area.y, w: d.w * rowScale, h: area.h };
      x += band.w + gap;
      return { floor, band };
    });
  }
  const order = floors.map((floor, i) => ({ floor, d: dims[i] })).sort((a, b) => b.floor.floor - a.floor.floor);
  const used = order.reduce((s, o) => s + o.d.h * colScale, 0) + gap * (n - 1);
  let y = area.y + (area.h - used) / 2;
  return order.map(({ floor, d }) => {
    const band = { x: area.x, y, w: area.w, h: d.h * colScale };
    y += band.h + gap;
    return { floor, band };
  });
}

/** Whether the villa pictures show their night picture now: the same decision the 3D sky makes (skyMoment, with
 *  Settings' day/night preview), from the villa's coordinates, else from the villa's own sun (above the horizon or
 *  not), as SunController falls back to it. */
export function showsNight(
  date: Date,
  place: { latitude: number; longitude: number; northOffsetDeg: number },
  preview: "day" | "auto" | "night",
  sunAboveHorizon: boolean | null,
): boolean {
  const { latitude, longitude } = place;
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)) {
    return !skyMoment(date, place, preview).light.isDay;
  }
  return !guessedMoment(sunAboveHorizon ?? true, preview).light.isDay;
}

/** Whether (u, v) is inside the outline `pts` (even-odd rule). */
export function insidePolygon(u: number, v: number, pts: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The room of `floor` drawn around (u, v), or null: what the 3D view answers from its geometry (roomForEntity) for
 *  a device the villa's system gives no area. */
export function roomAt(rooms: readonly PictureRoom[], floor: number, u: number, v: number): string | null {
  return rooms.find((r) => r.floor === floor && insidePolygon(u, v, r.pts))?.name ?? null;
}

export interface BadgeSpot {
  id: string; x: number; y: number;
  /** 2 act now (isUrgent), 1 another corner mark, 0 none. */
  rank: number;
  /** The device's room (resolvedRooms), null: none known. */
  room: string | null;
}

/** What is drawn on a floor's picture: one badge (`ids` of one) or a group badge standing for the badges that would
 *  have touched there. */
export interface DrawnItem {
  /** The badge's entity, or "group:" and its members' ids. */
  key: string;
  ids: string[];
  x: number;
  y: number;
  /** Its most urgent member's rank: an alarm in a group keeps the group pulsing. */
  rank: number;
  /** Every member's room when they share one, else null. */
  room: string | null;
}

/** Room between two drawn badges, px: closer than this, they touch. */
const BADGE_GAP_PX = 2;

/**
 * The badges of one floor, `size` px each, as drawn: nothing on the map overlaps, and badges group only when they
 * touch (owner's standing rule, the 3D map's). Each badge sits on its spot, kept inside its picture (`frame`, so a
 * badge never reaches the next floor's); two that would touch become ONE group badge at their members' centre, and a
 * group that then touches another badge or group takes it in too, the closest pair first, until no two touch. Run
 * again whenever the size changes (a TV groups more than a laptop).
 */
export function groupBadges(spots: readonly BadgeSpot[], size: number, frame: Rect): DrawnItem[] {
  const half = size / 2;
  const clampX = (x: number) => (frame.w >= size ? Math.min(frame.x + frame.w - half, Math.max(frame.x + half, x)) : frame.x + frame.w / 2);
  const clampY = (y: number) => (frame.h >= size ? Math.min(frame.y + frame.h - half, Math.max(frame.y + half, y)) : frame.y + frame.h / 2);
  type Cluster = { members: BadgeSpot[]; x: number; y: number };
  // the badges in id order, so the same devices group the same way whatever order they came in
  let items: Cluster[] = [...spots].sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({ members: [s], x: clampX(s.x), y: clampY(s.y) }));
  const reach = size + BADGE_GAP_PX;
  for (;;) {
    let pick: [number, number] | null = null, best = Infinity;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const dx = Math.abs(items[i].x - items[j].x), dy = Math.abs(items[i].y - items[j].y);
        if (dx >= reach || dy >= reach) continue;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; pick = [i, j]; }
      }
    }
    if (!pick) break;
    const [i, j] = pick;
    const members = [...items[i].members, ...items[j].members];
    // the members' own spots' centre (kept inside the picture, a convex frame: it is)
    const x = clampX(members.reduce((n, m) => n + clampX(m.x), 0) / members.length);
    const y = clampY(members.reduce((n, m) => n + clampY(m.y), 0) / members.length);
    items = [...items.slice(0, i), ...items.slice(i + 1, j), ...items.slice(j + 1), { members, x, y }];
  }
  return items.map(({ members, x, y }) => {
    const ids = members.map((m) => m.id).sort();
    const rooms = new Set(members.map((m) => m.room));
    const room = rooms.size === 1 ? [...rooms][0] : null;
    return {
      key: ids.length === 1 ? ids[0] : `group:${ids.join(",")}`, ids, x, y,
      rank: Math.max(...members.map((m) => m.rank)), room,
    };
  });
}

/** The corner mark a group badge wears: its members' most urgent problem, in the badges' own order (MARK_ORDER), on
 *  either of a member's corners; null when none has a problem ("in use" and "moving" are not shown on a group). */
export function groupMark(members: readonly { mark: BadgeMark | null; linkPill: LinkPill }[]): Exclude<BadgeMark, "active" | "moving"> | null {
  const seen = new Set<string>();
  for (const m of members) { if (m.mark) seen.add(m.mark); if (m.linkPill) seen.add(m.linkPill); }
  const worst = MARK_ORDER.find((k) => seen.has(k));
  return worst && worst !== "active" && worst !== "moving" ? worst : null;
}

export type Arrow = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** The badge a remote's arrow moves to from `from`: the nearest one that way (its distance across the arrow counted
 *  double, so a press follows the row or column it points along), or null at the edge. */
export function badgeToward(from: { x: number; y: number }, others: readonly { id: string; x: number; y: number }[], arrow: Arrow): string | null {
  const [ax, ay] = arrow === "ArrowUp" ? [0, -1] : arrow === "ArrowDown" ? [0, 1] : arrow === "ArrowLeft" ? [-1, 0] : [1, 0];
  let best: string | null = null, bestCost = Infinity;
  for (const o of others) {
    const dx = o.x - from.x, dy = o.y - from.y;
    const along = dx * ax + dy * ay;
    if (along <= 1) continue;
    const across = Math.abs(dx * ay - dy * ax);
    const cost = along + 2 * across;
    if (cost < bestCost) { bestCost = cost; best = o.id; }
  }
  return best;
}
