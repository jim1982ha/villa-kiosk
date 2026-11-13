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
import { labelOf } from "@/config/EntityMap";
import { deviceRoom, deviceRoomOrRecord, firstRoom, recordRoomNow, roomLabel } from "@/config/devicePlace";
import { devicesFor, recordEntity, type VillaDevices } from "@/config/deviceGroups";
import { alertNumberOf, closedAsLasting, DUE_WORDS, faultAlertLabel, faultBegan, faultName, fmAttention, helpIsLatest, stageOf, standingHelp, type FmStage, type HelpAsked } from "@/fm/fmEngine";
import type { AgentCadence } from "@/agent/agentApi";
import { faultStanding, watchedRecords, type FaultClosing } from "@/fm/faultStanding";
import type { ConfirmingFault } from "@/fm/faultConfirm";
import { faultMove, notedStory, type FaultMove } from "@/fm/faultNotes";
import { deviceWorkKey, groupByDevice } from "@/fm/deviceWork";
import { faultSource, type IssueSource } from "@/fm/issueSource";
import type { FmData, FmTicketCheck } from "@/fm/fmTypes";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import { isOffline, lostContact, lostPartsWords, missingFromHa, NOT_IN_HA, partName } from "@/utils/deviceHealth";
import { countOf } from "@/utils/countOf";
import type { Since } from "@/config/presence";

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
  device?: CardDevice;
  /** The open fault about this very entity, when this item is its live state (groupAttention): one problem, not two. */
  fault?: AttentionItem;
  /** Set on a fault whose entity Home Assistant reports "unavailable" right now: its device is offline, and so is
   *  what the fault is about — it goes onto the device's Unavailable line (mergeFaults). */
  offline?: boolean;
  /** Set on a line about a device hidden in the villa's system (attentionOf): no device card (the hidden device itself
   *  has none), filed on its own under "Other", opening nothing. */
  hidden?: true;
  /** Set on an offline device (kind "unavailable"): it is on the villa's ONE list of critical devices — the one its
   *  "critical devices offline" rule watches (agent-contract.json criticalDevices, owner 2026-10-18): red, the
   *  villa's health danger. Any other offline device is amber. */
  critical?: boolean;
  /** Set on a fault: how the VESTA Agent reads it again to close it (FmTicket.check) — the card's "Next check". */
  check?: FmTicketCheck;
  /** Set on a fault of an open visit (FmTicket.monitoredUntil): when it closes if nothing more is seen — its pill. */
  monitoredUntil?: string;
  /** Set on a fault the VESTA Agent will close if it stays as it is now (FmTicket.closesAt): when, and what its device
   *  reads now and since when — "Locked since 14:38 · closes at about 14:49 if it stays locked" (cockpitCard). `since`:
   *  read from its history (useStateSince), never its last_changed. */
  closing?: FaultClosing;
  /** Set on an alert fault the VESTA Agent holds because it is expected (FmTicket.expected): its words. On Watch while
   *  the Agent is online, as a fault right again is (attentionOf's `clearing`). */
  expected?: string;
  /** When this problem began, on EVERY kind of line (beganAt, a late task its due day): a fault when it was opened
   *  (FmTicket.openedAt): its row's time until something is told of it. Absent only for a device gone from the
   *  villa's system longer than it keeps, or until its history is read. */
  openedAt?: string;
  /** `openedAt` is only as far back as the villa keeps: it began before that. */
  openedBefore?: true;
  /** Set on a fault: its short story on Telegram, in time order (faultNotes.notedStory — "Escalation sent to Owner"). */
  story?: { note: string; at: string }[];
  /** Set on a fault: who last moved it, when, and its stage (faultNotes.faultMove): the card's strip and who line. */
  move?: FaultMove | null;
  /** Set on a fault: the Need help pressed on it that nothing has answered yet (fmEngine.standingHelp). */
  help?: HelpAsked;
  /** Its `latest` pill says that Need help (fmEngine.helpIsLatest): its buttons do not say it again. */
  helpInPill?: true;
  /** Set on a fault an alert raised: the number its Telegram messages carry ("#91"), which names VESTA's card of it
   *  (messagesModel.cardsOfIssue). */
  alertNumber?: number;
  /** Its alert's name as Telegram writes it ("#91-P1", fmEngine.alertLabel): the chip of its card's strip. */
  alertLabel?: string;
  /** Set on a fault: the other open records that say exactly the same thing on the same card (foldTwins) — one line,
   *  "(N times)", and the card's buttons act on every one of them. */
  twins?: string[];
}

/** A fault's `closing` (FmTicket.closesAt): its moment, and what its device reads now and since when; undefined when the
 *  Agent did not say, or said something that is not a moment.
 *
 *  ⚠️ A RESTART IS NOT WHEN IT WAS LOCKED (villa, 2026-10-26): "since" was the entity's last_changed, which every restart
 *  of the villa's system rewrites — `sinceOf` reads it from the history, as the presence tile does. */
function closingOf(closesAt: string | undefined, entity: HassEntity | undefined, entityId: string | undefined,
  sinceOf: (id: string) => Since, openedAt?: string): AttentionItem["closing"] {
  if (!closesAt || Number.isNaN(Date.parse(closesAt))) return undefined;
  if (!entity || !entityId || isOffline(entity)) return { at: closesAt };
  const since = sinceOf(entityId);
  // ⚠️ A STATE OLDER THAN THE PROBLEM IS NOT WHAT CHANGED (owner's end-to-end test, 2026-10-30: a lock that had been
  // UNAVAILABLE read "Unlocked since before 19 Oct · closes … if it stays unlocked"): the device has been in it since
  // before the problem was opened, so the problem was about something else (its availability) — "Back to normal"
  const opened = openedAt ? Date.parse(openedAt) : NaN;
  if (since && since !== "loading" && (since.before || (!Number.isNaN(opened) && since.at < opened))) return { at: closesAt };
  return { at: closesAt, word: rowText(entityId, entity), since };
}

/** When a device's state on a card began: its history, else (not read yet, or it cannot say) its last_changed, else
 *  nothing. ⚠️ EVERY CARD SAYS WHEN (owner, 2026-11-01: an offline camera's row had no time): only a fault had a
 *  moment; the kinds of line that are a device's live state had none, and their row showed an empty corner. */
function beganAt(id: string, entity: HassEntity | undefined, sinceOf: (id: string) => Since): Pick<AttentionItem, "openedAt" | "openedBefore"> {
  const since = sinceOf(id);
  if (since && since !== "loading") return { openedAt: new Date(since.at).toISOString(), ...(since.before ? { openedBefore: true as const } : {}) };
  return entity?.last_changed ? { openedAt: entity.last_changed } : {};
}

/** The devices the map paints red (their deviceLook says `alert`): one line each, "alarm". */
function alarmIds(devices: VillaDevices, entities: Record<string, HassEntity>, entityMap: Record<string, EntityMapping>): string[] {
  const looks = storeLookSource(entities, { entityMap, isCritical: devices.isCritical, isHidden: devices.isHidden });
  return devices.ids.filter((id) => entities[id] && deviceLook(id, looks).alert);
}

/** The entities the cards say "since" of, the ones useStateSince reads: a fault's waiting to close (closingOf), an
 *  offline or red device's (beganAt). */
export function sinceEntities(opts: { fmData: FmData; devices: VillaDevices; entities: Record<string, HassEntity>;
  entityMap: Record<string, EntityMapping> }): string[] {
  const { fmData, devices, entities, entityMap } = opts;
  const closing = fmAttention(fmData).unresolved.filter((t) => t.closesAt)
    .map((t) => recordEntity(t.entityId, (x) => x in entities)).filter((id): id is string => !!id);
  return [...new Set([...closing, ...devices.unavailable, ...devices.partlyLost.flatMap((id) => lostPartsOf(devices, id)),
    ...alarmIds(devices, entities, entityMap)])].sort();
}

/** The parts of a device that answers while they do not (VillaDevices.healthOf "partly"); [] for any other health. */
function lostPartsOf(devices: VillaDevices, id: string): readonly string[] {
  const h = devices.healthOf(id);
  return h.kind === "partly" ? h.lost : [];
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

/** Most serious first within a row: its kind (ATTENTION_RANK), then an alert VESTA follows (someone is being asked)
 *  before a finding with no alert, then the redder line.
 *  ⚠️ THE ALERT HID BEHIND THE NIGHT CHECK (owner, 2026-10-30: "it's here but not visible in the card on the left"): the
 *  onsen pump's row led with the night check's "ran shorter than expected" (a moon, 10:08) and its #96 alert, escalated
 *  to the Owner, was only seen once the card was opened: two faults, one rank, kept in arrival order. */
function mostSerious(a: AttentionItem, b: AttentionItem): number {
  const alerted = (i: AttentionItem) => (i.alertNumber ?? i.fault?.alertNumber) !== undefined ? 0 : 1;
  return ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind] || alerted(a) - alerted(b)
    || SEVERITY_RANK[attentionSeverity(a)] - SEVERITY_RANK[attentionSeverity(b)];
}

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
    const sorted = mergeFaults(foldTwins([...list].sort(mostSerious)));
    const worst = sorted[0];
    // ⚠️ ONE SHAPE FOR EVERY ROW (owner, 2026-10-10: "all these lines feel inconsistently shown"): a device's row is
    // titled by the DEVICE, whatever its problems. With ONE problem it read as the problem — an open fault on the
    // entrance lock was titled "Entrance door unlocked" while the same lock with two problems was titled "Entrance";
    // the problems are the row's lines (attentionLineIn), one or several. A problem with no device stands for itself.
    groups.push({
      key,
      kind: worst.kind,
      // ⚠️ ALWAYS A ROOM LINE (owner, 2026-10-15: a card without one broke the layout): cardHead
      ...cardHead(worst.device, worst.title, worst.room),
      // The DEVICE, as the map opens it — not the entity the problem names. A
      // ticket on a pump's energy meter opened the meter's chart while the
      // map's pump badge opens its power (2.496.258).
      // a line about a hidden device opens nothing: the hidden device has no window to open
      entityId: worst.hidden ? undefined : worst.device?.key ?? worst.entityId,
      items: sorted,
    });
  }
  return groups.sort((a, b) => ATTENTION_RANK[a.kind] - ATTENTION_RANK[b.kind]
    || a.title.localeCompare(b.title) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { danger: 0, warn: 1, lost: 2 };

/** A line's severity WITH the fault it carries (mergeFaults: an offline sensor's "Unavailable" line holding the night
 *  check's fault about it): the worse of the two — the card draws both icons, the line's grey and the fault's amber. */
function itemSeverity(item: AttentionItem): AttentionSeverity {
  const own = attentionSeverity(item);
  if (!item.fault) return own;
  const carried = attentionSeverity(item.fault);
  return SEVERITY_RANK[carried] < SEVERITY_RANK[own] ? carried : own;
}

/** What is wrong with each device, read from the Overview's own cards (groupAttention). */
export interface DeviceIssues {
  /** Every entity a problem names and its device, with an AMBER issue (a fault, merged or not, or late maintenance):
   *  what a badge's amber "!" and a room's amber number read. */
  amber: ReadonlySet<string>;
}

/**
 * ⚠️ ONE ANSWER PER DEVICE (owner, 2026-10-25, review L: "fix the recommended ones"). The map's badge read the fault
 * RECORDS (faultDevices) while the window's sign and the Overview read the cards: an offline sensor with its fault was
 * an amber "!" on the map and a grey sign in its window (the fault sat inside the "Unavailable" line), and a pump with
 * only late maintenance had an amber sign and no mark. Now all read the cards, here: the badge's "!" means "an amber
 * issue in the Cockpit" — a fault, OR late maintenance — and the sign's colour is the card's worst (itemSeverity).
 * Each problem's own entity AND its device (the card's key) carry it, so a device's badge has it whichever of its
 * entities the problem names. Role-blind for the map (the villa model's items); a profile's sign reads its own cards.
 */
export function deviceIssues(groups: readonly AttentionGroup[]): DeviceIssues {
  const amber = new Set<string>();
  const note = (id: string | undefined, s: AttentionSeverity) => {
    if (id && s === "warn") amber.add(id);
  };
  for (const g of groups) {
    for (const item of g.items) {
      for (const one of item.fault ? [item, item.fault] : [item]) {
        if (aboutActivity(one) || one.hidden) continue;
        const s = attentionSeverity(one);
        note(one.entityId, s);
        note(g.entityId, s);
      }
    }
  }
  return { amber };
}

/** A problem that is about what happened AROUND a device, not about the device: an open visit's fault (its
 *  `monitoredUntil`, which the VESTA Agent writes on a visit's fault only, agent-contract.json ticket.fields). Its
 *  device names where the activity was seen, so it never wears the amber "!" of a device problem (deviceIssues).
 *  ⚠️ A VISIT IS NO DEVICE FAULT (owner, 2026-11-07, visit #148-P1: the motion sensor of the visit's strongest step
 *  put two amber "!" on its camera's badge, "there is nothing wrong with this device"). Its card stays in the Cockpit. */
export function aboutActivity(item: Pick<AttentionItem, "monitoredUntil">): boolean {
  return !!item.monitoredUntil;
}

/** The amber issues one profile's Cockpit lists (`may`: the devices it may see, villaVisibility.visibleTo): what a
 *  badge's amber "!" reads in every window that profile opens, the same cards its window's warning sign reads
 *  (issueSeverity) — a guest's badge never shows a problem its own Cockpit does not (architecture review N, card 5). */
export function faultsFor(problems: VillaProblems, may: (entityId: string) => boolean): ReadonlySet<string> {
  return deviceIssues(attentionFor(problems, may).attentionGroups).amber;
}

/** The most serious issue the Overview lists for the devices of `ids` (a device window: the device and its linked
 *  entity) — the cards it would mark (cardFocused), as this profile sees them; null: no card, so no warning.
 *  ⚠️ EVERY ISSUE, NOT ONLY A FAULT RECORD (owner, 2026-10-24: a temperature sensor's "Unavailable" card was in the
 *  Cockpit and its window showed no warning — 2.496.523 read the badge's fault predicate only). */
export function issueSeverity(groups: readonly AttentionGroup[], ids: readonly string[],
  deviceOf: (id: string) => string): AttentionSeverity | null {
  let best: AttentionSeverity | null = null;
  for (const g of groups) {
    if (!cardFocused(g.entityId, ids, deviceOf)) continue;
    for (const item of g.items) {
      const s = itemSeverity(item);
      if (best === null || SEVERITY_RANK[s] < SEVERITY_RANK[best]) best = s;
    }
  }
  return best;
}

/** Is the Overview card of `cardEntityId` (its device) one of the devices `focus` names (a device window's warning:
 *  the device and its linked entity, each folded onto its device as the cards are)? */
export function cardFocused(cardEntityId: string | undefined, focus: readonly string[] | undefined,
  deviceOf: (entityId: string) => string): boolean {
  if (!cardEntityId || !focus?.length) return false;
  const card = deviceOf(cardEntityId);
  return focus.some((id) => deviceOf(id) === card);
}

/** What a problem IS: its kind — and a CRITICAL offline device its own, where any other offline device is just
 *  offline (owner, 2026-10-18: "critical" = red and told at once). */
type AttentionTone = AttentionKind | "critical";
export function attentionTone(item: AttentionItem): AttentionTone {
  return item.kind === "unavailable" && item.critical ? "critical" : item.kind;
}

/** How SERIOUS a problem is, on every surface — the Cockpit button, a card's icon, the Recap's row (the
 *  .cockpit-attention-<severity> class): red (danger) only for an alarm or a critical device offline; a fault, any
 *  other offline device and a late task are a warning, amber (owner, 2026-10-18). ⚠️ ONE OWNER (architecture review,
 *  2026-10-19): the button read this rule while the card's icon still painted every fault red from a stylesheet
 *  written before the decision.
 *  ⚠️ ANY OTHER OFFLINE DEVICE IS GREY, "lost" (owner, 2026-10-22: badge proposal 2): one vocabulary with the map —
 *  red act now, amber a fault (check soon), grey no contact. The villa's health level still counts it a warning
 *  (villaHealthFrom: only danger is red there). */
export type AttentionSeverity = "danger" | "warn" | "lost";
export function attentionSeverity(item: AttentionItem): AttentionSeverity {
  const tone = attentionTone(item);
  return tone === "alarm" || tone === "critical" ? "danger" : tone === "unavailable" ? "lost" : "warn";
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
    // the same words of the same alert: two alerts saying the same are two problems (their names are their chips)
    const key = i.kind === "fault" ? `${i.stage ?? ""}|${i.alertLabel ?? ""}|${i.title}` : undefined;
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
/** The device a card stands for, as every card names and places it: the device the entity folds onto (the one fold
 *  every count uses), its name, and its room (its own, else its entity's, else the record's). */
export interface CardDevice { key: string; label: string; room?: string }

/** THE way a problem's entity becomes its card's device (architecture review N, card 6): the open issues' cards and
 *  the Watched cards both (config/cockpitCard confirmingCards), which made the same four steps each — a change to how
 *  a card names its device or its room reached one list and not the other. */
export function cardDevice(entityId: string, recordRoom: string | undefined, ctx: {
  devices: Pick<VillaDevices, "deviceOf">; entityMap: Parameters<typeof labelOf>[1];
  entities: Record<string, HassEntity>; resolvedRooms: Record<string, string>;
}): CardDevice {
  const key = ctx.devices.deviceOf(entityId);
  // ⚠️ EMPTY MEANS ABSENT (2026-10-16): this was `rooms[key] ?? rooms[entityId] ?? i.room`, and resolveRooms stores ""
  // for no room, so `??` stopped there — a device with no room whose sensor had one read "Other".
  return { key, label: labelOf(key, ctx.entityMap, ctx.entities), room: deviceRoomOrRecord(ctx.resolvedRooms, key, entityId, recordRoom) };
}

/** The room a stored record shows now, ONE answer with its Inbox card's (cardDevice): its device's room, the stored one
 *  only with no device. ⚠️ A MISSING DEVICE HAS ITS ROOM TOO (owner, 2026-11-01: one lock read "Living Room" in the Inbox
 *  and no room in Tickets): the Tickets tab asked only about a device the villa's system still has. */
export function recordRoom(r: { entityId?: string; room?: string }, ctx: { entities: Record<string, HassEntity>;
  resolvedRooms: Record<string, string>; deviceOf: (id: string) => string }): string {
  const id = recordEntity(r.entityId, (x) => x in ctx.entities);
  return recordRoomNow(ctx.resolvedRooms, id ? { key: ctx.deviceOf(id), entityId: id } : null, r.room);
}

/** A stored record's device pill, as its Inbox card names and opens it (cardDevice): the name of the device its entity
 *  folds onto and that device, opened by a tap. A device the villa's system no longer has keeps the name stored with
 *  the record (the name it had), a record with no entity its stored name alone, opening nothing.
 *  ⚠️ ONE ANSWER WITH THE INBOX (architecture review round 16, 2026-11-03): the Tickets tab looked the record's raw
 *  entity field up as one id, so a record naming several ("sensor.a,sensor.b", a rule watching three phases) was never
 *  found: its pill showed the stored name or the raw list, and a tap opened nothing. It goes through recordEntity as the
 *  Inbox card does. A device hidden in the villa's system (`devices.isHidden`) is named, opening nothing: it has no
 *  window, as its Inbox card opens nothing (attentionOf). */
export function recordDevicePill(r: { entityId?: string; room?: string; deviceLabel?: string }, ctx: {
  devices: Pick<VillaDevices, "deviceOf"> & Partial<Pick<VillaDevices, "isHidden">>; entityMap: Parameters<typeof labelOf>[1];
  entities: Record<string, HassEntity>; resolvedRooms: Record<string, string>;
}): { label?: string; opens?: string } {
  const id = recordEntity(r.entityId, (x) => x in ctx.entities);
  if (!id) return r.deviceLabel ? { label: r.deviceLabel } : {};
  const device = cardDevice(id, r.room, ctx);
  const label = id in ctx.entities ? device.label : r.deviceLabel ?? device.label;
  return ctx.devices.isHidden?.(id) ? { label } : { opens: device.key, label };
}

/** A card's title and room line: the DEVICE, whatever its problems (a problem with no device stands for itself), and
 *  ALWAYS a room line (a device no room holds reads as the By Room list files it, "Other"). */
export function cardHead(device: CardDevice | undefined, title: string, recordRoom: string | undefined): { title: string; room: string } {
  return { title: device ? device.label : title, room: roomLabel(firstRoom(device?.room, recordRoom)) };
}

interface AttentionInputs {
  /** The villa's devices (deviceGroups.villaDevices) — ASKED, never restated: which are not answering, which may raise
   *  an alarm (its ids), each problem's device (deviceOf, the one fold every count uses), which are critical.
   *  ⚠️ FOUR OPTIONS SAID IT AGAIN (architecture review, 2026-10-19): unavailableIds, selectableIds, the folding and
   *  the critical list, and the critical devices were worked out a second time here from the last two. */
  devices: VillaDevices;
  entities: Record<string, HassEntity>;
  entityMap: Record<string, EntityMapping>;
  resolvedRooms: Record<string, string>;
  fmData: FmData;
  /** Since when an entity is in its state, from its history (useStateSince over sinceEntities); absent: not said. */
  sinceOf?: (id: string) => Since;
  /** The VESTA Agent's own timing: how long what is Done stays on Watch; absent: it did not say. */
  cadence?: AgentCadence | null;
  /** The moment the list is read at (what is on Watch then); absent: now. */
  now?: number;
}

/** What needs attention (`attentionItems`), and the devices whose live state is held as "Not a problem while it lasts"
 *  (`held`: their fault a person closed so, the state begun before that close) — the ONE answer the open issues and the
 *  Recap's checks read (owner, 2026-11-04: the Recap still said "1 unlocked" of a door closed "Not a problem"). */
export function attentionOf(opts: AttentionInputs): Pick<VillaProblems, "attentionItems" | "held" | "clearing"> {
  const { devices, entities, entityMap, resolvedRooms, fmData } = opts;
  const sinceOf = opts.sinceOf ?? (() => null);
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
      ...beganAt(id, entities[id], sinceOf),
    });
  }

  // ⚠️ A DEAD PART OF A LIVE DEVICE (architecture review item 4, 2026-11-13: a camera's person detection unavailable for
  // days, on no card): one line on the device's card, its parts' names in the grey of lost contact, since the first of
  // them went. Its entity is that part, so a fault about it is this line's (mergeFaults); never critical: the device
  // answers.
  for (const id of devices.partlyLost) {
    const lost = lostPartsOf(devices, id);
    if (!lost.length) continue;
    const device = [labelOf(id, entityMap, entities), entities[id]?.attributes?.friendly_name as string | undefined];
    const began = lost.map((p) => beganAt(p, entities[p], sinceOf))
      .sort((a, b) => (Date.parse(a.openedAt ?? "") || Infinity) - (Date.parse(b.openedAt ?? "") || Infinity))[0];
    items.push({
      id: `parts:${id}`,
      kind: "unavailable",
      title: labelOf(id, entityMap, entities),
      detail: lostPartsWords(lost.map((p) => partName(labelOf(p, entityMap, entities), device))),
      source: "live",
      room: deviceRoom(resolvedRooms, id),
      entityId: lost[0],
      ...began,
    });
  }

  const fm = fmAttention(fmData);
  for (const t of fm.unresolved) {
    const entityId = recordEntity(t.entityId, (x) => x in entities);   // the one the Tickets tab files it under too
    items.push({
      id: `fault:${t.id}`,
      kind: "fault",
      // what it is about; its alert's name is its strip's chip (alertLabel), never its words again
      title: faultName(t),
      room: t.room,
      entityId,
      ticketId: t.id,
      stage: stageOf(t),
      story: notedStory(t),
      move: faultMove(t),
      help: standingHelp(t),
      ...(helpIsLatest(t) ? { helpInPill: true as const } : {}),
      openedAt: faultBegan(t),
      ...(alertNumberOf(t) !== undefined ? { alertNumber: alertNumberOf(t), alertLabel: faultAlertLabel(t) } : {}),
      source: faultSource(t),
      check: t.check,
      ...(t.monitoredUntil ? { monitoredUntil: t.monitoredUntil } : {}),
      ...(t.expected ? { expected: t.expected } : {}),
      closing: closingOf(t.closesAt, entityId ? entities[entityId] : undefined, entityId, sinceOf, t.openedAt),
      // lost contact — isOffline, or an entity the villa's system no longer has (Missing), as devices.unavailable
      // reads it: the device's offline line takes it. ⚠️ A MISSING ENTITY TOO (architecture review, 2026-10-21): only
      // one the villa's system still had counted, so a ticket on a sibling deleted with its device stood as a second
      // line under the device's "Missing".
      offline: !!entityId && lostContact(entities, entityId),
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
      // the day it was due; one never done counts from when it was set up (its first due day may still be to come)
      ...(s.state === "never" && s.schedule.createdAt ? { openedAt: s.schedule.createdAt }
        : s.dueAt === null ? {} : { openedAt: new Date(s.dueAt).toISOString() }),
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
  // above, as that. A device in use (a detection, a door open, a lock
  // unlocked) is never `alert` either (config/deviceCondition: in use, owner
  // 2026-10-26), so it is no line here. ⚠️ A SECOND FILTER SAID IT AGAIN (to
  // 2.496.542, alertIsFault): once in use stopped being red it matched nothing.
  for (const id of alarmIds(devices, entities, entityMap)) {
    const entity = entities[id];
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
      ...beganAt(id, entity, sinceOf),
    });
  }

  // Each problem's device. An entity the fold does not know (a helper, a
  // template — no device in the registry, no owner group) is its own device:
  // the worst case is a row of its own, as before grouping. Never by name.
  // ⚠️ A HIDDEN DEVICE'S FINDINGS ARE NOT HIDDEN WITH IT (architecture review item 5, 2026-11-13): hidden in the villa's
  // system (devices.isHidden: the device or any of its folded entities) means never listed, picked or carded, and since
  // 2026-10-25 its faults and late tasks were dropped too, so a VESTA finding "an automation still watches this hidden,
  // offline device", which exists BECAUSE it is hidden, was silently lost. Its line is kept, filed on its own under
  // "Other" (no device card, no room, opening nothing: `hidden`), counted as any problem; its badge, its window's sign
  // and its live state stay out (the hidden device has no live line: devices.ids leaves it out).
  for (const i of items) {
    if (!i.entityId) continue;
    if (devices.isHidden(i.entityId)) {
      i.hidden = true;
      i.room = undefined;
      continue;
    }
    i.device = cardDevice(i.entityId, i.room, { devices, entityMap, entities, resolvedRooms });
  }

  // ⚠️ DONE MOVES THE CARD TO WATCH (owner, 2026-11-02: an offline device's Done closed its fault, and the device's live
  // state stayed as an open issue with nothing left to press): a device whose fault VESTA is watching has its live line
  // on Watch only, until VESTA's verdict; any other fault of the device stays. VESTA reopens it if it is still wrong.
  const watched = new Set(watchedRecords(fmData, opts.cadence ?? null, opts.now ?? Date.now()).flatMap((t) => {
    const id = recordEntity(t.entityId, (x) => x in entities) ?? t.entityId;
    return id ? [devices.deviceOf(id)] : [];
  }));
  // ⚠️ "NOT A PROBLEM WHILE IT LASTS" HOLDS ON THE DEVICE TOO (owner, 2026-11-02): a device whose fault a person closed so
  // has its live state, begun before that close, out of the open issues; a state begun after it is a new problem
  const lasting = new Map<string, number>();
  const began = (id: string) => Date.parse(beganAt(id, entities[id], sinceOf).openedAt ?? "") || 0;
  const held = new Set<string>();
  for (const t of fmData.tickets) {
    if (!closedAsLasting(t)) continue;
    const id = recordEntity(t.entityId, (x) => x in entities) ?? t.entityId;
    const at = Date.parse(t.resolvedAt ?? "");
    if (!id || !Number.isFinite(at)) continue;
    lasting.set(devices.deviceOf(id), Math.max(at, lasting.get(devices.deviceOf(id)) ?? 0));
    // the faulted entity itself, in the state it was in at the close: held, an issue item or not (an unlocked lock
    // is none: its closed fault was all Open issues had of it, the Recap counted it still)
    if (began(id) <= at) held.add(devices.deviceOf(id));
  }
  const live = (i: AttentionItem) => (i.kind === "unavailable" || i.kind === "alarm") && !!i.entityId;
  // a live state of the device begun before the close (another of its entities, offline since)
  const heldLine = (i: AttentionItem) => live(i) && (Date.parse(i.openedAt ?? "") || 0) <= (lasting.get(devices.deviceOf(i.entityId!)) ?? -1);
  for (const i of items) if (heldLine(i)) held.add(devices.deviceOf(i.entityId!));
  const shown = items.filter((i) => !(live(i) && i.hidden)
    && !(live(i) && watched.has(devices.deviceOf(i.entityId!)))
    && !heldLine(i));
  // ⚠️ RIGHT AGAIN, OR HELD AS EXPECTED, IS ON WATCH, NOT AN OPEN ISSUE (owner, 2026-11-12): an open fault the VESTA
  // Agent will close if it stays as it is (its `closing`), or holds because it is expected (`expected`), is on Watch,
  // counted, marked and signed nowhere, as a Done waiting for VESTA's verdict is: where it stands is the record's one
  // answer (fm/faultStanding), and its Watch card's fields come with it, from this very record
  const now = opts.now ?? Date.now();
  const records = new Map(fm.unresolved.map((t) => [t.id, t]));
  const onWatch = new Map<AttentionItem, ConfirmingFault>();
  for (const i of shown) {
    const t = i.kind === "fault" && i.ticketId ? records.get(i.ticketId) : undefined;
    const s = t ? faultStanding(t, opts.cadence ?? null, now, i.closing) : null;
    if (s?.place === "watch") onWatch.set(i, s.fault);
  }
  return { attentionItems: shown.filter((i) => !onWatch.has(i)), held,
    clearing: [...onWatch].map(([item, fault]) => ({ item, fault })) };
}

/** An open fault on Watch (attentionOf's `clearing`): its line, and its Watch card's fields (fm/faultStanding). */
export interface OnWatch { item: AttentionItem; fault: ConfirmingFault }

/** The villa's problems, role-blind — what the villa model holds. Nothing
 *  counts or shows these directly: a profile's view is attentionFor's. */
export interface VillaProblems {
  /** The villa's devices the items were built over (VillaModel.devices). */
  devices: VillaDevices;
  attentionItems: AttentionItem[];
  /** The devices whose live state is held as "Not a problem while it lasts" (attentionOf); absent: none. */
  held?: ReadonlySet<string>;
  /** The open faults held on Watch, never counted (attentionOf): right again, waiting out the VESTA Agent's clear wait
   *  (their `closing`), or held by the Agent because they are expected (their `expected`); absent: none. */
  clearing?: OnWatch[];
}

/** What needs attention as ONE PROFILE is shown it — and the profile's devices (`devices`: only those it may open,
 *  deviceGroups.devicesFor), the ONE view the Overview, the top bar and the Recap count from. */
export interface VillaAttention extends VillaProblems {
  /** One row per device (groupAttention) — what the badge, the phone menu and
   *  the Cockpit list COUNT and show. */
  attentionGroups: AttentionGroup[];
  health: VillaHealth;
  /** May this profile be shown `entityId` in a list or a picker: not hidden in the villa's system, and the profile may
   *  open it. Every list of devices of the profile's passes it. */
  shows: (entityId: string) => boolean;
  /** May this profile be told of a problem about `entityId`: the profile may open it, hidden or not — a hidden device's
   *  findings are filed under "Other" (attentionOf), never dropped. Every list of problems passes it (the open issues,
   *  Watch and Closed: config/cockpitIssues). */
  raises: (entityId: string) => boolean;
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
  // ⚠️ LISTED IS NOT RAISED (architecture review item 5, 2026-11-13): one predicate, "not hidden and the profile may
  // open it", decided both what a list may name and which problems the profile is told of, so a hidden device's
  // findings were dropped. A device list reads `shows`; a problem reads `raises`, the profile's own visibility alone
  // (attentionOf has already filed a hidden device's problems under "Other").
  const shows = (id: string) => !att.devices.isHidden(id) && may(id);
  const raises = may;
  const attentionItems = att.attentionItems.filter((i) => !i.entityId || raises(i.entityId));
  const clearing = (att.clearing ?? []).filter((c) => !c.item.entityId || raises(c.item.entityId));
  // Grouped AFTER the profile's filter, never before: a row is built only
  // from problems this profile may open, so it cannot name a hidden one.
  const attentionGroups = groupAttention(attentionItems);
  return {
    devices: devicesFor(att.devices, shows),
    attentionItems,
    ...(att.held ? { held: att.held } : {}),
    clearing,
    attentionGroups,
    health: villaHealthFrom(attentionGroups),
    shows,
    raises,
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

