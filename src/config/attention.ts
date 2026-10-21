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

import { deviceLook, storeLookSource } from "@/utils/deviceActivity";
import { alarmText, rowText } from "@/config/reading";
import { alertIsFault } from "@/config/BinarySensorClasses";
import { labelOf } from "@/config/EntityMap";
import { deviceRoom, deviceRoomOrRecord, firstRoom, roomLabel } from "@/config/devicePlace";
import { devicesFor, recordEntity, type VillaDevices } from "@/config/deviceGroups";
import { DUE_WORDS, faultTitle, fmAttention, stageOf, type FmStage } from "@/fm/fmEngine";
import { lastNoted } from "@/fm/faultNotes";
import { deviceWorkKey, groupByDevice } from "@/fm/deviceWork";
import { faultSource, type IssueSource } from "@/fm/issueSource";
import type { FmData, FmTicketCheck } from "@/fm/fmTypes";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import { isOffline, missingFromHa, NOT_IN_HA } from "@/utils/stateColors";
import { countOf } from "@/utils/countOf";
import { isDomain } from "@/utils/entityDomain";

export type AttentionKind = "unavailable" | "fault" | "schedule" | "alarm";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  /** Where it comes from (fm/issueSource): its icon on the card. Live for a state; a fault's own (faultSource). */
  source?: IssueSource;
  title: string;
  /** Short status word — "Unavailable", "Overdue", "Leak detected", etc. Absent on a fault: what its line says of its
   *  status is its stage's word (faultStatus, fmEngine.STAGE_WORDS), never one of its own. */
  detail?: string;
  room?: string;
  /** Present when this item can be drilled into (opens the entity's own
   *  panel) — a fault/schedule with no device behind it (a whole-villa task,
   *  a free-text device description) has none, so it renders as read-only. */
  entityId?: string;
  /** Set on a fault: the record it is, so its card can take it on or close it
   *  (FmDataContext.advanceTickets / closeTickets). */
  ticketId?: string;
  /** Set on a fault: where its record stands (fmEngine.stageOf) — a fault nobody has taken on, or a ticket (never
   *  closed: a closed record is on no list). */
  stage?: FmStage;
  /** The villa DEVICE the entity belongs to (deviceGroups.deviceFolding: the
   *  owner's device groups, then Home Assistant's device registry) — what
   *  groupAttention folds on. Set exactly when `entityId` is. */
  device?: { key: string; label: string; room?: string };
  /** The open fault about this very entity, when this item is its live state (groupAttention): one problem, not two. */
  fault?: AttentionItem;
  /** Set on a fault whose entity Home Assistant reports "unavailable" right now: its device is offline, and so is
   *  what the fault is about — it goes onto the device's Unavailable line (mergeFaults). */
  offline?: boolean;
  /** Set on an offline device (kind "unavailable"): it is on the villa's ONE list of critical devices — the one its
   *  "critical devices offline" rule watches (agent-contract.json criticalDevices, owner 2026-10-18): red, the
   *  villa's health danger. Any other offline device is amber. */
  critical?: boolean;
  /** Set on a fault: how the VESTA Agent reads it again to close it (FmTicket.check) — the card's "Next check". */
  check?: FmTicketCheck;
  /** Set on a fault the VESTA Agent will close if it stays as it is now (FmTicket.closesAt): when, and what its device
   *  reads now and since when — "Locked since 14:38 · closes at about 14:49 if it stays locked" (cockpitCard). */
  closing?: { at: string; word?: string; since?: string };
  /** Set on a fault: what last happened about it on Telegram (faultNotes.lastNoted — "Escalation sent to Owner"). */
  latest?: { note: string; at: string };
  /** Set on a fault: the other open records that say exactly the same thing on the same card (foldTwins) — one line,
   *  "(N times)", and the card's buttons act on every one of them. */
  twins?: string[];
}

/** A fault's `closing` (FmTicket.closesAt): its moment, and what its device reads now and since when; undefined when the
 *  Agent did not say, or said something that is not a moment. */
function closingOf(closesAt: string | undefined, entity: HassEntity | undefined, entityId: string | undefined):
  AttentionItem["closing"] {
  if (!closesAt || Number.isNaN(Date.parse(closesAt))) return undefined;
  if (!entity || !entityId || isOffline(entity)) return { at: closesAt };
  return { at: closesAt, word: rowText(entityId, entity), since: entity.last_changed };
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
 * about the same entity (mergeFaults), or as a `twin` of an identical fault's
 * line (foldTwins) — so a fault's Close button and ticket survive inside its
 * device's row.
 *
 * Rows are ordered by their most serious problem, then by title, then by key —
 * never by which problem arrived first, so a ticket landing on a door already listed
 * as Unlocked leaves the row where it is.
 */
export function groupAttention(items: readonly AttentionItem[]): AttentionGroup[] {
  // the one card per device the Tickets tab and the counts use too (fm/deviceWork)
  const byKey = groupByDevice(items, (i) => deviceWorkKey(i.device?.key, i.id));
  const groups: AttentionGroup[] = [];
  for (const { key, items: list } of byKey) {
    const sorted = mergeFaults(foldTwins([...list].sort((a, b) => ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind])));
    const worst = sorted[0];
    // ⚠️ ONE SHAPE FOR EVERY ROW (owner, 2026-10-10: "all these lines feel inconsistently shown"): a device's row is
    // titled by the DEVICE, whatever its problems. With ONE problem it read as the problem — an open fault on the
    // entrance lock was titled "Entrance door unlocked" while the same lock with two problems was titled "Entrance";
    // the problems are the row's lines (attentionLineIn), one or several. A problem with no device stands for itself.
    groups.push({
      key,
      kind: worst.kind,
      title: worst.device ? worst.device.label : worst.title,
      // ⚠️ ALWAYS A ROOM LINE (owner, 2026-10-15: a card without one broke the layout): a device no room holds reads as
      // the By Room list files it, "Other"
      room: roomLabel(firstRoom(worst.device?.room, worst.room)),
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

/** What a problem IS: its kind — and a CRITICAL offline device its own, where any other offline device is just
 *  offline (owner, 2026-10-18: "critical" = red and told at once). */
export type AttentionTone = AttentionKind | "critical";
export function attentionTone(item: AttentionItem): AttentionTone {
  return item.kind === "unavailable" && item.critical ? "critical" : item.kind;
}

/** How SERIOUS a problem is, on every surface — the Cockpit button, a card's icon, the Recap's row (the
 *  .cockpit-attention-<severity> class): red (danger) only for an alarm or a critical device offline; a fault, any
 *  other offline device and a late task are a warning, amber (owner, 2026-10-18). ⚠️ ONE OWNER (architecture review,
 *  2026-10-19): the button read this rule while the card's icon still painted every fault red from a stylesheet
 *  written before the decision. */
export type AttentionSeverity = "danger" | "warn";
export function attentionSeverity(item: AttentionItem): AttentionSeverity {
  const tone = attentionTone(item);
  return tone === "alarm" || tone === "critical" ? "danger" : "warn";
}

/**
 * A fault about the SAME entity whose live state is already listed is that state's fault, not a second problem — and
 * so is a fault about ANOTHER entity of the device when that entity is unavailable too (`offline`): the device is off.
 *
 * ⚠️ ONE PROBLEM, ONE LINE (owner, 2026-10-10: "why do we see 2 lines for the same issue?"): the laundry door read
 * "Unlocked" (its live state) and "Open fault: Laundry Room door unlocked" (the agent's ticket for the VESTA rule's
 * alert about it); an offline pump plug read "Unavailable" and "Open fault: … offline for 9 h". The fault goes onto
 * the live line (`fault`), which keeps its Close. A fault on another entity of the device stays its own line.
 *
 * ⚠️ THE SAME OFFLINE DEVICE, TWO LINES (owner, 2026-10-14): a Timmerflotte sensor read "Unavailable" (its temperature,
 * the entity the model shows) and "Timmerflotte_5969 has been offline for 9 h." (the night check's fault, on another of
 * its entities) — every one of its nine entities was unavailable. Told by Home Assistant's state, never by the words.
 */
/** Faults on one card that say exactly the same thing — the same title, at the same stage — are ONE line; the others
 *  ride on it as `twins`, so its count says how many and its buttons reach them all.
 *  ⚠️ ONE LINE PER PROBLEM (owner, 2026-10-17: "#49 · One mains phase lost" six times — "i never want to see 1
 *  individual line per update"): records that say the same are counted, never listed one under the other. */
function foldTwins(items: AttentionItem[]): AttentionItem[] {
  const first = new Map<string, AttentionItem>();
  const out: AttentionItem[] = [];
  for (const i of items) {
    const key = i.kind === "fault" ? `${i.stage ?? ""}|${i.title}` : undefined;
    const kept = key !== undefined ? first.get(key) : undefined;
    if (kept && i.ticketId) {
      kept.twins = [...(kept.twins ?? []), i.ticketId];
      continue;
    }
    // a copy: the villa model's items are shared by every render (as mergeFaults)
    const own = i.kind === "fault" ? { ...i, twins: undefined } : i;
    if (key !== undefined) first.set(key, own);
    out.push(own);
  }
  return out;
}

function mergeFaults(items: AttentionItem[]): AttentionItem[] {
  // copies: the villa model's items are shared by every render and profile — a fault written onto one would stay
  // there after it was closed
  const out = items.map((i) => ({ ...i, fault: undefined }) as AttentionItem);
  const live = new Map(out.filter((i) => (i.kind === "alarm" || i.kind === "unavailable") && i.entityId)
    .map((i) => [i.entityId as string, i]));
  const offlineLine = out.find((i) => i.kind === "unavailable");
  return out.filter((i) => {
    if (i.kind !== "fault") return true;
    const own = i.entityId ? live.get(i.entityId) : undefined;
    const state = own && !own.fault ? own : !own && i.offline && offlineLine && !offlineLine.fault ? offlineLine : undefined;
    if (!state) return true;
    state.fault = i;
    return false;
  });
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
  /** The villa's devices (deviceGroups.villaDevices) — ASKED, never restated: which are not answering, which may raise
   *  an alarm (its ids), each problem's device (deviceOf, the one fold every count uses), which are critical.
   *  ⚠️ FOUR OPTIONS SAID IT AGAIN (architecture review, 2026-10-19): unavailableIds, selectableIds, the folding and
   *  the critical list, and the critical devices were worked out a second time here from the last two. */
  devices: VillaDevices;
  entities: Record<string, HassEntity>;
  entityMap: Record<string, EntityMapping>;
  resolvedRooms: Record<string, string>;
  fmData: FmData;
}): AttentionItem[] {
  const { devices, entities, entityMap, resolvedRooms, fmData } = opts;
  const items: AttentionItem[] = [];

  for (const id of devices.unavailable) {
    items.push({
      id: `unavailable:${id}`,
      kind: "unavailable",
      // a critical entity stands for its device (the fold): the rule may name a lock's battery sensor, the model the lock
      critical: devices.isCritical(id),
      title: labelOf(id, entityMap, entities),
      // an object the model names whose entity Home Assistant does not have says so, as everywhere (NOT_IN_HA)
      detail: missingFromHa(entities, id) ? NOT_IN_HA : "Unavailable",
      source: "live",
      room: deviceRoom(resolvedRooms, id),
      entityId: id,
    });
  }

  const fm = fmAttention(fmData);
  for (const t of fm.unresolved) {
    const entityId = recordEntity(t.entityId, (x) => x in entities);   // the one the Tickets tab files it under too
    items.push({
      id: `fault:${t.id}`,
      kind: "fault",
      title: faultTitle(t),
      room: t.room,
      entityId,
      ticketId: t.id,
      stage: stageOf(t),
      latest: lastNoted(t),
      source: faultSource(t),
      check: t.check,
      closing: closingOf(t.closesAt, entityId ? entities[entityId] : undefined, entityId),
      // lost contact — isOffline, or an entity the villa's system no longer has (Missing), as devices.unavailable
      // reads it: the device's offline line takes it. ⚠️ A MISSING ENTITY TOO (architecture review, 2026-10-21): only
      // one the villa's system still had counted, so a ticket on a sibling deleted with its device stood as a second
      // line under the device's "Missing".
      offline: !!entityId && (entities[entityId] ? isOffline(entities[entityId]) : missingFromHa(entities, entityId)),
    });
  }

  for (const s of fm.lateTasks) {
    items.push({
      id: `schedule:${s.schedule.id}`,
      kind: "schedule",
      title: s.schedule.title,
      detail: DUE_WORDS[s.state].word,   // its state's ONE word (the Schedule's pill's, the recap's)
      source: "schedule",
      room: s.schedule.room,
      entityId: s.schedule.entityId,
    });
  }

  // ── A RED BADGE IS ALWAYS HERE (2.496.245) ─────────────────────────────
  // Every device the map paints red: its deviceLook — the badge's own rule,
  // says `alert`. This was its own rule, binary_sensors only: an unlocked door
  // was red on the map and absent from "Needs attention".
  // Restricted to the villa's devices (never a raw HA domain scan): a bare
  // Zigbee2MQTT relay-lock/config sub-entity is technically a binary_sensor
  // too, and was never meant to be villa-facing. An unavailable device is
  // never `alert` (its face is the amber "unavailable"), so it is listed once,
  // above, as that. A detection (a motion sensor that sees someone) is red and
  // NO fault (alertIsFault, owner 2026-10-21): the one red badge not listed.
  const looks = storeLookSource(entities, { entityMap, isCritical: devices.isCritical, isHidden: devices.isHidden });
  for (const id of devices.ids) {
    const entity = entities[id];
    if (!entity || !deviceLook(id, looks).alert) continue;
    if (isDomain(id, "binary_sensor") && !alertIsFault(id, entity.attributes.device_class as string | undefined)) continue;
    items.push({
      id: `alarm:${id}`,
      kind: "alarm",
      title: labelOf(id, entityMap, entities),
      // A binary_sensor's own words for its state ("Leak detected",
      // "Disconnected"); anything else, what its list row says ("Unlocked",
      // "Jammed", "92 %") — config/reading, as every reading.
      detail: alarmText(id, entity),
      source: "live",
      room: deviceRoom(resolvedRooms, id),
      entityId: id,
    });
  }

  // Each problem's device. An entity the fold does not know (a helper, a
  // template — no device in the registry, no owner group) is its own device:
  // the worst case is a row of its own, as before grouping. Never by name.
  for (const i of items) {
    if (!i.entityId) continue;
    const key = devices.deviceOf(i.entityId);   // the one fold every count and the Tickets tab use
    i.device = {
      key,
      label: labelOf(key, entityMap, entities),
      // ⚠️ EMPTY MEANS ABSENT (2026-10-16): this was `rooms[key] ?? rooms[entityId] ?? i.room`, and resolveRooms
      // stores "" for no room, so `??` stopped there — a device with no room whose sensor had one read "Other".
      room: deviceRoomOrRecord(resolvedRooms, key, i.entityId, i.room),
    };
  }

  return items;
}

/** The villa's problems, role-blind — what the villa model holds. Nothing
 *  counts or shows these directly: a profile's view is attentionFor's. */
export interface VillaProblems {
  /** The villa's devices the items were built over (VillaModel.devices). */
  devices: VillaDevices;
  attentionItems: AttentionItem[];
}

/** What needs attention as ONE PROFILE is shown it — and the profile's devices (`devices`: only those it may open,
 *  deviceGroups.devicesFor), the ONE view the Overview, the top bar and the Recap count from. */
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
    devices: devicesFor(att.devices, may),
    attentionItems,
    attentionGroups,
    health: villaHealthFrom(attentionGroups),
  };
}

/** The level is read from EVERY problem (attentionSeverity: danger is an alarm or a CRITICAL device offline, owner
 *  2026-10-18; anything else a warning); the count is the ROWS, the number the badge shows. */
export function villaHealthFrom(groups: readonly AttentionGroup[]): VillaHealth {
  if (groups.length === 0) return { level: "ok", summary: "Everything looks fine." };
  const hasDanger = groups.some((g) => g.items.some((i) => attentionSeverity(i) === "danger"));
  const n = groups.length;
  return {
    level: hasDanger ? "danger" : "warn",
    summary: `${countOf(n, "thing")} need${n === 1 ? "s" : ""} attention.`,
  };
}

