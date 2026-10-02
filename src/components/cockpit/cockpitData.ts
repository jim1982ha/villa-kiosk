// src/components/cockpit/cockpitData.ts
// Pure derivation for the Cockpit page — no React, no I/O. Everything here
// routes through selectableDeviceIds/entityMap/resolvedRooms, never a raw HA
// domain query: a real villa has hundreds of `switch`/`select`/`button`
// entities that are internal Zigbee2MQTT device configuration (per-motor
// calibration, relay-lock toggles), not end-user villa state — a domain-count
// summary would be actively misleading, not just noisy. See the Cockpit plan
// memory for how this was verified.

import { stateLabelFor } from "@/config/BinarySensorClasses";
import { categoryCounts } from "@/config/activeDevices";
import { deviceLook, groupLook, storeLookSource, type LookSource } from "@/utils/deviceActivity";
import { deviceRowText } from "@/utils/entityValue";
import type { Threshold } from "@/config/ThresholdConfig";
import { displayLabelFor } from "@/config/EntityMap";
import { roomKey, NO_ROOM_LABEL } from "@/config/roomKey";
import { fmAttention } from "@/fm/fmEngine";
import type { FmData } from "@/fm/fmTypes";
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
  /** Set on a fault: the Facility ticket it is, so the row can close it in
   *  one step (FmDataContext.closeTicket). */
  ticketId?: string;
  /** The villa DEVICE the entity belongs to (deviceGroups.deviceFolding: the
   *  owner's device groups, then Home Assistant's device registry) — what
   *  groupAttention folds on. Set exactly when `entityId` is. */
  device?: { key: string; label: string; room?: string };
}

/**
 * One row of "Needs attention": a DEVICE and everything wrong with it, or one
 * problem that names no device (a whole-villa fault, a schedule).
 *
 * ⚠️ THE SAME DOOR WAS TWO ROWS (2.496.246). An unlocked entrance door was red
 * on the map — one row, "Unlocked" — and ten minutes later the VESTA rule's
 * alert became the agent's Kiosk ticket on that same lock — a second row, and
 * the count went up for a door already listed. An offline device and its
 * watchdog ticket did the same. The badge counts these rows, not the problems
 * inside them.
 */
export interface AttentionGroup {
  /** Stable across state pushes — the device, or the lone problem's own id. */
  key: string;
  /** The most serious problem in the row (ATTENTION_RANK): its icon. */
  kind: AttentionKind;
  title: string;
  room?: string;
  /** What tapping the row opens: the most serious problem's device entity. */
  entityId?: string;
  /** Every problem in the row, most serious first; never empty. */
  items: AttentionItem[];
}

/** Most serious first: red on the map now, then gone silent, then a fault
 *  someone has to deal with, then late maintenance. */
const ATTENTION_RANK: Record<AttentionKind, number> = { alarm: 0, unavailable: 1, fault: 2, schedule: 3 };

/**
 * Fold problems into one row per device. Pure, and it only GROUPS: every item
 * given comes back exactly once (the oracle checks it), so a fault's Close
 * button and ticket survive inside its device's row.
 *
 * Rows are ordered by their most serious problem, then by title, then by key —
 * never by which problem arrived first, so a ticket landing on a door already listed
 * as Unlocked leaves the row where it is.
 */
export function groupAttention(items: readonly AttentionItem[]): AttentionGroup[] {
  const byKey = new Map<string, AttentionItem[]>();
  for (const i of items) {
    const key = i.device ? `device:${i.device.key}` : `item:${i.id}`;
    const list = byKey.get(key);
    if (list) list.push(i); else byKey.set(key, [i]);
  }
  const groups: AttentionGroup[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind]);
    const worst = sorted[0];
    // A device with ONE problem reads exactly as it did before grouping.
    const one = sorted.length === 1;
    groups.push({
      key,
      kind: worst.kind,
      title: one || !worst.device ? worst.title : worst.device.label,
      room: one || !worst.device ? worst.room ?? worst.device?.room : worst.device.room ?? worst.room,
      entityId: worst.entityId,
      items: sorted,
    });
  }
  return groups.sort((a, b) => ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind]
    || a.title.localeCompare(b.title) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** One problem's line inside a device's row. A state needs no more than its
 *  word ("Unlocked", "Unavailable"); a fault or a schedule names itself, since
 *  its title is what is wrong, not the device ("Open fault: Entrance door
 *  unlocked"). */
export function attentionLine(item: AttentionItem): string {
  return item.kind === "fault" || item.kind === "schedule" ? `${item.detail}: ${item.title}` : item.detail;
}

/**
 * Everything currently wrong, in one list — replaces the split between the
 * HUD's unavailable-devices badge and Facility's separate attention badge.
 * Four sources, each already tracked somewhere in the app, just never
 * combined: unavailable devices, open faults, overdue/never-recorded
 * maintenance, and every device the map paints RED (its deviceLook is
 * `alert`).
 */
export function buildAttentionItems(opts: {
  unavailableIds: readonly string[];
  entities: Record<string, HassEntity>;
  entityMap: Record<string, EntityMapping>;
  /** The villa's per-entity alert overrides — what makes a reading red on
   *  the map, so it is what makes it an alarm here (deviceLook). */
  alertThresholds: Record<string, Threshold>;
  resolvedRooms: Record<string, string>;
  fmData: FmData;
  selectableIds: readonly string[];
  /** member entity → the entity standing for its device
   *  (deviceGroups.deviceFolding), so groupAttention folds a lock's own
   *  alarm and a ticket raised on its battery sensor into ONE row. */
  folding: ReadonlyMap<string, string>;
}): AttentionItem[] {
  const { unavailableIds, entities, entityMap, alertThresholds, resolvedRooms, fmData, selectableIds, folding } = opts;
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

  const fm = fmAttention(fmData);
  for (const t of fm.openFaults) {
    items.push({
      id: `fault:${t.id}`,
      kind: "fault",
      title: t.title,
      detail: t.status === "in_progress" ? "In progress" : "Open fault",
      room: t.room,
      entityId: t.entityId,
      ticketId: t.id,
    });
  }

  for (const s of fm.lateTasks) {
    items.push({
      id: `schedule:${s.schedule.id}`,
      kind: "schedule",
      title: s.schedule.title,
      detail: s.state === "never" ? "Never recorded" : "Overdue",
      room: s.schedule.room,
      entityId: s.schedule.entityId,
    });
  }

  // ── A RED BADGE IS ALWAYS HERE (2.496.245) ─────────────────────────────
  // Every device the map paints red: its deviceLook — the badge's own rule,
  // the villa's alert overrides included — says `alert`. This was its own
  // rule, binary_sensors only and blind to config.alertThresholds: an
  // unlocked door, a sensor past its threshold, a binary_sensor the villa had
  // overridden were red on the map and absent from "Needs attention".
  // Restricted to selectableIds (never a raw HA domain scan): a bare
  // Zigbee2MQTT relay-lock/config sub-entity is technically a binary_sensor
  // too, and was never meant to be villa-facing. An unavailable device is
  // never `alert` (its face is the amber "unavailable"), so it is listed once,
  // above, as that.
  const looks = storeLookSource(entities, { entityMap, alertThresholds });
  for (const id of selectableIds) {
    const entity = entities[id];
    if (!entity || !deviceLook(id, looks).alert) continue;
    const mapping = entityMap[id];
    const domain = id.split(".")[0];
    items.push({
      id: `alarm:${id}`,
      kind: "alarm",
      title: displayLabelFor(id, mapping?.label, entity.attributes.friendly_name as string | undefined),
      // A binary_sensor's own words for its state ("Leak detected",
      // "Disconnected"); anything else, what its list row says ("Unlocked",
      // "Jammed", "92 %").
      detail: domain === "binary_sensor"
        ? stateLabelFor(id, entity.attributes.device_class as string | undefined)(entity.state)
        : deviceRowText(entity, domain),
      room: resolvedRooms[id],
      entityId: id,
    });
  }

  // Each problem's device. An entity the fold does not know (a helper, a
  // template — no device in the registry, no owner group) is its own device:
  // the worst case is a row of its own, as before grouping. Never by name.
  for (const i of items) {
    if (!i.entityId) continue;
    const key = folding.get(i.entityId) ?? i.entityId;
    i.device = {
      key,
      label: displayLabelFor(key, entityMap[key]?.label, entities[key]?.attributes.friendly_name as string | undefined),
      room: resolvedRooms[key] ?? resolvedRooms[i.entityId] ?? i.room,
    };
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
/**
 * The attention a PROFILE is shown: items about a device it may not open are
 * left out, and the health line is re-read from what remains. The HUD badge
 * and the Cockpit list both take this, so a guest's badge can no longer count
 * a camera or a leak sensor their Cockpit list would refuse to open (2.496.191).
 * Items with no device (a schedule) stand for themselves.
 */
export function attentionFor<T extends { unavailableIds: readonly string[]; selectableIds: readonly string[]; attentionItems: AttentionItem[] }>(
  att: T, may: (entityId: string) => boolean,
): T & { attentionGroups: AttentionGroup[]; health: VillaHealth } {
  const attentionItems = att.attentionItems.filter((i) => !i.entityId || may(i.entityId));
  // Grouped AFTER the profile's filter, never before: a row is built only
  // from problems this profile may open, so it cannot name a hidden one.
  const attentionGroups = groupAttention(attentionItems);
  return {
    ...att,
    unavailableIds: att.unavailableIds.filter(may),
    selectableIds: att.selectableIds.filter(may),
    attentionItems,
    attentionGroups,
    health: villaHealthFrom(attentionGroups),
  };
}

/** The level is read from EVERY problem (a fault beside an unavailable device
 *  is still danger); the count is the ROWS, the number the badge shows. */
export function villaHealthFrom(groups: readonly AttentionGroup[]): VillaHealth {
  if (groups.length === 0) return { level: "ok", summary: "Everything looks fine." };
  const hasDanger = groups.some((g) => g.items.some((i) => i.kind === "unavailable" || i.kind === "alarm"));
  const n = groups.length;
  return {
    level: hasDanger ? "danger" : "warn",
    summary: `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention.`,
  };
}

export interface CategoryTile {
  category: Category;
  total: number;
  onCount: number;
  /** The category's devices — what its tile opens. */
  entityIds: string[];
}

/** What a Cockpit tile (room, floor or category) counts: its devices, how
 *  many are on — POWER, a group's `onCount` (a locked lock is not "on", a
 *  motion sensor never is) — and how many Home Assistant has lost. */
export interface TileStats { total: number; onCount: number; offline: number }

export function tileStats(entityIds: readonly string[], source: LookSource): TileStats {
  const g = groupLook(entityIds.map((id) => deviceLook(id, source)), { showingDevices: false });
  return { total: entityIds.length, onCount: g.onCount, offline: g.offline };
}

/** The line under a tile's name — ONE wording for rooms, floors and
 *  categories (2.496.235; rooms and floors were bars): "4 devices · 1 on",
 *  plus "· 1 offline" when Home Assistant has lost any of them. */
export function tileLine(s: TileStats): string {
  if (s.total === 0) return "None";
  const parts = [`${s.total} device${s.total === 1 ? "" : "s"}`];
  if (s.onCount > 0) parts.push(`${s.onCount} on`);
  if (s.offline > 0) parts.push(`${s.offline} offline`);
  return parts.join(" · ");
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
  // "On" is config/activeDevices' one rule (a locked lock is not on).
  return categoryCounts(selectableIds, entities, entityMap);
}


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
    const room = resolvedRooms[id]?.trim() || NO_ROOM_LABEL;
    const list = idsByRoom.get(room) ?? [];
    list.push(id);
    idsByRoom.set(room, list);
  }
  return [...idsByRoom.entries()]
    .map(([room, entityIds]) => {
      const haFloor = entityIds.map((id) => entityFloorNumbers[id]).find((f) => f != null);
      const floor = room === NO_ROOM_LABEL ? null : (haFloor ?? floorByRoom.get(roomKey(room)) ?? null);
      return { room, count: entityIds.length, entityIds, floor };
    })
    .sort((a, b) => {
      if (a.room === NO_ROOM_LABEL) return b.room === NO_ROOM_LABEL ? 0 : 1;
      if (b.room === NO_ROOM_LABEL) return -1;
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

  // ⚠️ THE SHARED WORDS, NOT ITS OWN (2.496.252). This line worded binary
  // states by hand — anything but "on" took the OFF word, so a leak sensor
  // that went OFFLINE read "No leak" — and capitalised the rest by hand, so
  // "not_home" read "Not_home". stateLabelFor and prettyState are the rules
  // every other surface (the pill, the history bars) already reads.
  return { t, name, message: stateLabelFor(raw.entity_id, entity?.attributes.device_class as string | undefined)(raw.state) };
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
