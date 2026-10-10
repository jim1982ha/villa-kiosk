// src/config/attention.ts
// WHAT NEEDS ATTENTION in the villa, and how a profile is shown it: the items
// (devices Home Assistant lost, alarms, open faults, overdue maintenance),
// grouped one row per device, and the health line read from them. Pure — no
// React, no I/O. The villa model builds the items; every place that shows them
// (Cockpit's list, the HUD's count, the phone menu) asks attentionFor.
//
// ⚠️ IT LIVED IN components/cockpit/ (until 2.496.268), so config/VillaModel —
// the villa's own data — imported from a component folder, and the grouping
// ran twice: once in the villa model, whose result nothing read, then again
// per profile. It is grouped once now, after the profile's filter.

import { stateLabelFor } from "@/config/BinarySensorClasses";
import { deviceLook, storeLookSource } from "@/utils/deviceActivity";
import { deviceRowText } from "@/utils/entityValue";
import type { Threshold } from "@/config/ThresholdConfig";
import { labelOf } from "@/config/EntityMap";
import { fmAttention } from "@/fm/fmEngine";
import type { FmData } from "@/fm/fmTypes";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import { domainOf } from "@/utils/entityDomain";

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
  /** The open fault about this very entity, when this item is its live state (groupAttention): one problem, not two. */
  fault?: AttentionItem;
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
 * given comes back exactly once — as a line, or as the `fault` of the live line
 * about the same entity (mergeFaults) — so a fault's Close button and ticket
 * survive inside its device's row.
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
    const sorted = mergeFaults([...list].sort((a, b) => ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind]));
    const worst = sorted[0];
    // ⚠️ ONE SHAPE FOR EVERY ROW (owner, 2026-10-10: "all these lines feel inconsistently shown"): a device's row is
    // titled by the DEVICE, whatever its problems. With ONE problem it read as the problem — an open fault on the
    // entrance lock was titled "Entrance door unlocked" while the same lock with two problems was titled "Entrance";
    // the problems are the row's lines (attentionLineIn), one or several. A problem with no device stands for itself.
    groups.push({
      key,
      kind: worst.kind,
      title: worst.device ? worst.device.label : worst.title,
      room: worst.device ? worst.device.room ?? worst.room : worst.room,
      // The DEVICE, as the map opens it — not the entity the problem names. A
      // ticket on a pump's energy meter opened the meter's chart while the
      // map's pump badge opens its power (2.496.258).
      entityId: worst.device?.key ?? worst.entityId,
      items: sorted,
    });
  }
  return groups.sort((a, b) => ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind]
    || a.title.localeCompare(b.title) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** A problem's line inside ITS row: under a device, what attentionLine says ("Unlocked", "Open fault: Entrance door
 *  unlocked"); in a row that is the problem itself (no device), only its status ("Open fault") — its title is the
 *  row's already. Every row shows its problems this way, one or several. */
export function attentionLineIn(group: AttentionGroup, item: AttentionItem): string {
  return group.key.startsWith("device:") ? attentionLine(item) : item.detail;
}

/**
 * A fault about the SAME entity whose live state is already listed is that state's fault, not a second problem.
 *
 * ⚠️ ONE PROBLEM, ONE LINE (owner, 2026-10-10: "why do we see 2 lines for the same issue?"): the laundry door read
 * "Unlocked" (its live state) and "Open fault: Laundry Room door unlocked" (the agent's ticket for the VESTA rule's
 * alert about it); an offline pump plug read "Unavailable" and "Open fault: … offline for 9 h". The fault goes onto
 * the live line (`fault`), which keeps its Close. A fault on another entity of the device stays its own line.
 */
function mergeFaults(items: AttentionItem[]): AttentionItem[] {
  // copies: the villa model's items are shared by every render and profile — a fault written onto one would stay
  // there after it was closed
  const out = items.map((i) => ({ ...i, fault: undefined }) as AttentionItem);
  const live = new Map(out.filter((i) => (i.kind === "alarm" || i.kind === "unavailable") && i.entityId)
    .map((i) => [i.entityId as string, i]));
  return out.filter((i) => {
    const state = i.kind === "fault" && i.entityId ? live.get(i.entityId) : undefined;
    if (!state || state.fault) return true;
    state.fault = i;
    return false;
  });
}

/** One problem's line inside a device's row. A state needs no more than its
 *  word ("Unlocked", "Unavailable"); a fault or a schedule names itself, since
 *  its title is what is wrong, not the device ("Open fault: Entrance door
 *  unlocked"). */
export function attentionLine(item: AttentionItem): string {
  if (item.fault) return `${item.detail} — ${item.fault.detail.toLowerCase()}: ${item.fault.title}`;
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
    items.push({
      id: `unavailable:${id}`,
      kind: "unavailable",
      title: labelOf(id, entityMap, entities),
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
    const domain = domainOf(id);
    items.push({
      id: `alarm:${id}`,
      kind: "alarm",
      title: labelOf(id, entityMap, entities),
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
      label: labelOf(key, entityMap, entities),
      room: resolvedRooms[key] ?? resolvedRooms[i.entityId] ?? i.room,
    };
  }

  return items;
}

/** The villa's problems, role-blind — what the villa model holds. Nothing
 *  counts or shows these directly: a profile's view is attentionFor's. */
export interface VillaProblems {
  unavailableIds: string[];
  selectableIds: string[];
  attentionItems: AttentionItem[];
}

/** What needs attention as ONE PROFILE is shown it. */
export interface VillaAttention extends VillaProblems {
  /** One row per device (groupAttention) — what the badge, the phone menu and
   *  the Cockpit list COUNT and show. */
  attentionGroups: AttentionGroup[];
  health: VillaHealth;
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
export function attentionFor(att: VillaProblems, may: (entityId: string) => boolean): VillaAttention {
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

