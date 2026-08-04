// src/components/cockpit/cockpitData.ts
// Pure derivation for the Cockpit page — no React, no I/O. Everything here
// routes through selectableDeviceIds/entityMap/resolvedRooms, never a raw HA
// domain query: a real villa has hundreds of `switch`/`select`/`button`
// entities that are internal Zigbee2MQTT device configuration (per-motor
// calibration, relay-lock toggles), not end-user villa state — a domain-count
// summary would be actively misleading, not just noisy. See the Cockpit plan
// memory for how this was verified.

import { binarySensorClassInfo } from "@/config/BinarySensorClasses";
import { CATEGORY_ORDER, effectiveCategory } from "@/config/EntityCategories";
import { displayLabelFor } from "@/config/EntityMap";
import { roomKey } from "@/config/roomKey";
import { scheduleBoard } from "@/fm/fmEngine";
import type { FmData } from "@/fm/fmTypes";
import { isOn } from "@/utils/entityState";
import type { HassEntity, RawLogbookEntry } from "@/types/ha.types";
import type { Category, EntityMapping } from "@/types/scene.types";

export type AttentionKind = "unavailable" | "fault" | "schedule" | "alarm";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  /** Short status word — "Open", "Overdue", "Leak detected", etc. */
  detail: string;
  room?: string;
  /** Present when this item can be drilled into (opens the entity's own
   *  panel) — a fault/schedule with no device behind it (a whole-villa task,
   *  a free-text device description) has none, so it renders as read-only. */
  entityId?: string;
}

/**
 * Everything currently wrong, in one list — replaces the split between the
 * HUD's unavailable-devices badge and Facility's separate attention badge.
 * Four sources, each already tracked somewhere in the app, just never
 * combined: unavailable devices, open faults, overdue/never-recorded
 * maintenance, and any binary_sensor currently in its device_class's alarm
 * state (leak/smoke/tamper/etc — BinarySensorClasses' `alarmState`, computed
 * per class already, just never aggregated across the villa before).
 */
export function buildAttentionItems(opts: {
  unavailableIds: readonly string[];
  entities: Record<string, HassEntity>;
  entityMap: Record<string, EntityMapping>;
  resolvedRooms: Record<string, string>;
  fmData: FmData;
  selectableIds: readonly string[];
}): AttentionItem[] {
  const { unavailableIds, entities, entityMap, resolvedRooms, fmData, selectableIds } = opts;
  const items: AttentionItem[] = [];

  for (const id of unavailableIds) {
    const mapping = entityMap[id];
    items.push({
      id: `unavailable:${id}`,
      kind: "unavailable",
      title: displayLabelFor(id, mapping?.label, entities[id]?.attributes.friendly_name as string | undefined),
      detail: "Unavailable",
      room: resolvedRooms[id],
      entityId: id,
    });
  }

  for (const t of fmData.tickets) {
    if (t.status === "resolved") continue;
    items.push({
      id: `fault:${t.id}`,
      kind: "fault",
      title: t.title,
      detail: t.status === "in_progress" ? "In progress" : "Open fault",
      room: t.room,
      entityId: t.entityId,
    });
  }

  for (const s of scheduleBoard(fmData)) {
    if (s.state !== "overdue" && s.state !== "never") continue;
    items.push({
      id: `schedule:${s.schedule.id}`,
      kind: "schedule",
      title: s.schedule.title,
      detail: s.state === "never" ? "Never recorded" : "Overdue",
      room: s.schedule.room,
      entityId: s.schedule.entityId,
    });
  }

  // Every binary_sensor currently reporting its own device_class's "problem"
  // state — a leak, a tamper trip, low battery, a disconnected sensor.
  // Restricted to selectableIds (never a raw HA domain scan): a bare
  // Zigbee2MQTT relay-lock/config sub-entity is technically a binary_sensor
  // too, and was never meant to be villa-facing.
  for (const id of selectableIds) {
    if (!id.startsWith("binary_sensor.")) continue;
    const entity = entities[id];
    if (!entity) continue;
    const info = binarySensorClassInfo(entity.attributes.device_class as string | undefined);
    if (info.alarmState === "none" || entity.state !== info.alarmState) continue;
    const mapping = entityMap[id];
    items.push({
      id: `alarm:${id}`,
      kind: "alarm",
      title: displayLabelFor(id, mapping?.label, entity.attributes.friendly_name as string | undefined),
      detail: info.alarmState === "on" ? info.onLabel : info.offLabel,
      room: resolvedRooms[id],
      entityId: id,
    });
  }

  return items;
}

export type VillaHealthLevel = "ok" | "warn" | "danger";

export interface VillaHealth {
  level: VillaHealthLevel;
  summary: string;
}

/** Unavailable devices and active alarms are the "something is actually
 *  broken or unsafe right now" tier (danger); open faults and overdue
 *  maintenance are "needs doing, not urgent" (warn) — a schedule running a
 *  few days late shouldn't paint the whole villa red the same as a leak
 *  sensor going off. */
export function villaHealthFrom(items: AttentionItem[]): VillaHealth {
  if (items.length === 0) return { level: "ok", summary: "Everything looks fine." };
  const hasDanger = items.some((i) => i.kind === "unavailable" || i.kind === "alarm");
  const n = items.length;
  return {
    level: hasDanger ? "danger" : "warn",
    summary: `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention.`,
  };
}

export interface CategoryTile {
  category: Category;
  total: number;
  onCount: number;
}

/** One tile per category, count + a generic cross-domain "on" count —
 *  deliberately non-judgmental (a light being on isn't a problem), kept
 *  visually separate from the attention list so the page doesn't read as
 *  "everything is red". */
export function buildCategoryTiles(
  selectableIds: readonly string[],
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
): CategoryTile[] {
  const totals = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  const ons = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const id of selectableIds) {
    const mapping = entityMap[id];
    if (!mapping) continue;
    const entity = entities[id];
    const cat = effectiveCategory(id, mapping.type, mapping.category, entity?.attributes.device_class as string | undefined);
    totals.set(cat, (totals.get(cat) ?? 0) + 1);
    if (isOn(entity)) ons.set(cat, (ons.get(cat) ?? 0) + 1);
  }
  return CATEGORY_ORDER.map((category) => ({
    category, total: totals.get(category) ?? 0, onCount: ons.get(category) ?? 0,
  }));
}

const NO_ROOM = "Other";

export interface RoomGroup {
  room: string;
  /** null for the "Other" bucket, or a room with no resolvable floor at all
   *  (neither HA nor the floor plan has one for it). */
  floor: number | null;
  count: number;
  /** Every selectable device resolved to this room — lets the Cockpit pivot
   *  row drill into the same SummaryGroupPanel every other device list in
   *  the app already uses, instead of a bespoke list view. */
  entityIds: string[];
}

/** Devices bucketed by resolved room, each joined to its floor. HA's own
 *  Floor assignment wins whenever any device in the room has one (via
 *  entityFloorNumbers — see HAStateStore.tsx); the floor-plan's own per-room
 *  `floor` value (sh3dRooms, matched by room NAME) is the fallback for
 *  whatever HA hasn't organised into a Floor yet — same "HA wins, geometry
 *  is the fallback" precedence resolvedRooms itself already uses. Reported:
 *  a room whose devices' Areas were all correctly on "2F" in HA still fell
 *  into the floor pivot's "Other" bucket, because the floor-plan's OWN
 *  drawn-room data (sh3dRooms) was the only signal ever read for storey —
 *  it either had no entry matching this room's name, or disagreed with a
 *  since-reorganised HA Floor. Alphabetical with "Other" always last, same
 *  convention SummaryGroupPanel's own room grouping uses. */
export function buildRoomGroups(
  selectableIds: readonly string[],
  resolvedRooms: Record<string, string>,
  sh3dRooms: { name: string; floor?: number }[] | undefined,
  entityFloorNumbers: Record<string, number>,
): RoomGroup[] {
  const floorByRoom = new Map<string, number>();
  for (const r of sh3dRooms ?? []) floorByRoom.set(roomKey(r.name), r.floor ?? 1);

  const idsByRoom = new Map<string, string[]>();
  for (const id of selectableIds) {
    const room = resolvedRooms[id]?.trim() || NO_ROOM;
    const list = idsByRoom.get(room) ?? [];
    list.push(id);
    idsByRoom.set(room, list);
  }
  return [...idsByRoom.entries()]
    .map(([room, entityIds]) => {
      const haFloor = entityIds.map((id) => entityFloorNumbers[id]).find((f) => f != null);
      const floor = room === NO_ROOM ? null : (haFloor ?? floorByRoom.get(roomKey(room)) ?? null);
      return { room, count: entityIds.length, entityIds, floor };
    })
    .sort((a, b) => {
      if (a.room === NO_ROOM) return b.room === NO_ROOM ? 0 : 1;
      if (b.room === NO_ROOM) return -1;
      return a.room.localeCompare(b.room);
    });
}

export interface FloorGroup {
  /** null = rooms with no resolvable floor (including the "Other" bucket). */
  floor: number | null;
  count: number;
  /** Every selectable device on this floor — the union of its rooms'
   *  entityIds, same reasoning as RoomGroup's own field above. */
  entityIds: string[];
}

/** Re-bucket buildRoomGroups' output by floor instead of room — the same
 *  underlying counts, pivoted, so the two views can never disagree with each
 *  other the way two independently-computed totals eventually would. */
export function buildFloorGroups(roomGroups: RoomGroup[]): FloorGroup[] {
  const idsByFloor = new Map<number | null, string[]>();
  for (const g of roomGroups) {
    const list = idsByFloor.get(g.floor) ?? [];
    list.push(...g.entityIds);
    idsByFloor.set(g.floor, list);
  }
  return [...idsByFloor.entries()]
    .map(([floor, entityIds]) => ({ floor, count: entityIds.length, entityIds }))
    .sort((a, b) => (a.floor ?? Infinity) - (b.floor ?? Infinity));
}

export interface ActivityEntry {
  /** epoch ms (RawLogbookEntry.when is epoch SECONDS — converted once here). */
  t: number;
  name: string;
  message: string;
}

/**
 * Turn one raw logbook row into a readable line. Only automation/script
 * entries carry a real HA-authored `message` (the computed trigger cause) —
 * used verbatim, since reproducing THAT is exactly the kind of thing this
 * app has no business re-implementing. A plain state change (a motion
 * sensor, a lock, a light) arrives with just a raw `state` and no sentence —
 * HA's own frontend builds that text client-side, the API doesn't hand it
 * over — so this reuses the kiosk's OWN existing state vocabulary
 * (BinarySensorClasses' on/off wording, the same table SensorPanel/badges
 * already read) rather than showing a bare "on"/"off", or invents nothing
 * and falls back to the raw state, capitalised, for domains with no such
 * table (lock, switch, light, …). Returns null when there's truly nothing
 * to show (no entity_id, no message, no state).
 */
export function describeLogbookEntry(
  raw: RawLogbookEntry,
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
): ActivityEntry | null {
  const t = raw.when * 1000;
  if (!Number.isFinite(t)) return null;

  if (raw.message) {
    return { t, name: raw.name ?? raw.entity_id ?? "", message: raw.message };
  }
  if (!raw.entity_id || raw.state == null) return null;

  const entity = entities[raw.entity_id];
  const mapping = entityMap[raw.entity_id];
  const name = displayLabelFor(raw.entity_id, mapping?.label, raw.name ?? (entity?.attributes.friendly_name as string | undefined));

  if (raw.entity_id.startsWith("binary_sensor.")) {
    const info = binarySensorClassInfo(entity?.attributes.device_class as string | undefined);
    return { t, name, message: raw.state === "on" ? info.onLabel : info.offLabel };
  }
  return { t, name, message: raw.state.charAt(0).toUpperCase() + raw.state.slice(1) };
}

/** Describe + filter to the villa's own selectable devices (HA's raw
 *  logbook is unfiltered and genuinely noisy — a bare date/time helper alone
 *  produced roughly one entry every six seconds in a real pull) + sort
 *  newest first. `limit` bounds the RENDERED list, logged via the caller if
 *  entries are actually dropped — this is a "most recent 20" UI choice, not
 *  a silent data cap. */
export function buildActivityFeed(
  raw: RawLogbookEntry[],
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
  selectableIds: readonly string[],
  limit = 20,
): ActivityEntry[] {
  const known = new Set(selectableIds);
  const described = raw
    .filter((r) => r.entity_id && known.has(r.entity_id))
    .map((r) => describeLogbookEntry(r, entities, entityMap))
    .filter((e): e is ActivityEntry => e !== null)
    .sort((a, b) => b.t - a.t);
  return described.slice(0, limit);
}
