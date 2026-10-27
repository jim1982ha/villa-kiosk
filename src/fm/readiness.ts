// src/fm/readiness.ts
// "Is the villa ready for the next guest?"
//
// Pure: takes the live entity snapshot plus the FM store and returns a list of
// checks. No React, no network, so the rules can be tested and so the same
// answer can be rendered in the operator panel, the monthly recap, or (later)
// an owner-facing summary.
//
// Why this matters commercially: a failed check-in costs a review, and
// reviews drive occupancy — the kind of thing a management contract's own
// performance clauses exist to protect, whatever they happen to say.

import type { HassEntity } from "@/types/ha.types";
import { isOffline, missingFromHa, NOT_IN_HA } from "@/utils/stateColors";
import { isTicketOpen, stageOf } from "./fmEngine";
import { openCounts } from "./deviceWork";
import { faultSource, ISSUE_SOURCES, type IssueSource } from "./issueSource";
import { lockFacts, lightFacts, climateFacts } from "@/config/villaSummary";
import { locksGroup, lightsGroup, type SummaryGroup } from "@/config/summaryGroups";
import type { EntityMapping } from "@/types/scene.types";
import { AirVent, Cctv, WifiOff } from "lucide-react";
import type { FmData } from "./fmTypes";
import type { VillaAttention } from "@/config/attention";
import type { Tone } from "./tone";
import { countOf } from "@/utils/countOf";
import { isDomain } from "@/utils/entityDomain";

export type CheckState = "pass" | "warn" | "fail";

/** Each check state's ONE word and tone, as the Recap's rows, the saved snapshot and the recap's §5 say it (the tab
 *  draws the word as its icon, in the tone's colour). ⚠️ TWO SPELLINGS (architecture review, 2026-10-19): the recap
 *  wrote "Attention" where the snapshot wrote "Warning" for the same amber check, and the tone sat apart in fm/tone. */
export const CHECK_WORDS: Record<CheckState, { word: string; tone: Tone }> = {
  pass: { word: "Pass", tone: "ok" },
  warn: { word: "Warning", tone: "warn" },
  fail: { word: "Fail", tone: "danger" },
};

/** The verdict over every check, in the tab's words — and the snapshot's, which shouted "READY, WITH FINDINGS" over
 *  a tab saying "Ready, with things worth fixing" (architecture review, 2026-10-19). */
export const VERDICT_WORDS: Record<CheckState, string> = {
  pass: "Ready for the next guest",
  warn: "Ready, with things worth fixing",
  fail: "Not ready",
};

export interface ReadinessCheck {
  id: string;
  label: string;
  state: CheckState;
  /** What the operator should read — the actual finding, not a restatement. */
  detail: string;
  /** Entities behind a failing check, so the UI can jump to them on the map. */
  entityIds?: string[];
  /** The open faults' sources, in the legend's order — the icons the Overview shows them with, drawn in the line
   *  ("Check the ⏾ ⚑ faults in Overview…", ReadinessTab). Text stays plain for the saved snapshot. */
  sources?: IssueSource[];
  /** What tapping the check opens: its devices, as a list (SummaryGroupPanel), behind a button with these words.
   *  Shown when the check names devices. Absent for a check about no device (the tickets). */
  opens?: CheckTarget;
}

/**
 * A check's own devices, as the list its button opens.
 *
 * ⚠️ WHAT EACH CHECK OPENED WAS DECIDED BY ITS ID IN THREE OTHER PLACES (until 2.496.403): ReadinessTab kept the
 * button words per id and hid the device chips for "devices-online", FacilitySections rebuilt the doors' and lights'
 * lists per id and found "devices-online" by name for the recap's count — Air conditioning and Cameras had no
 * button, and "View unavailable devices" left Recap for the Overview (architecture review round two, 2026-10-17).
 */
export interface CheckTarget {
  /** The button's words: "View doors". */
  label: string;
  /** The list it opens. */
  group: SummaryGroup;
  /** A health list (devices not reporting): every device in it, hidden or diagnostic ones too, no "turn all". Its
   *  devices are chips under the check like any other's (owner, 2026-10-18). */
  health?: boolean;
}
/** The "All devices reporting" check's words — the recap's §4 points the reader to it by name. */
export const AVAILABILITY_CHECK_LABEL = "All devices reporting";

/** What the readiness is built from: ONE profile's view (useVillaAttention — attention.attentionFor): its devices (only
 *  those it may open, with the villa's fold and critical list) and its problems (the alarms; the faults it is shown).
 *  ⚠️ IT TOOK THE ROLE-BLIND DEVICE LIST BESIDE THE PROFILE'S ALARMS (architecture review, 2026-10-19): the Recap counted
 *  devices offline the Overview did not list for the same person, and every fault record, seen or not. */
export type ReadinessView = Pick<VillaAttention, "devices" | "attentionItems">;

export interface ReadinessResult {
  checks: ReadinessCheck[];
  passed: number;
  total: number;
  /** The devices the "All devices reporting" check covers, and those of them not reporting — the recap's §4. */
  availability: { total: number; offline: readonly string[] };
  /** Worst state across all checks — what the headline shows. */
  overall: CheckState;
}

// "Off" is OFF_STATES, through villaSummary — the same set every other surface
// counts "on" against, so this check cannot disagree with the HUD.

/**
 * Build the readiness checks.
 *
 * `mappedEntityIds` scopes "devices offline" to things actually on the villa
 * map, so a stray Home Assistant entity that has nothing to do with this villa
 * can't hold the readiness check red forever.
 */
export function buildReadiness(
  entities: Record<string, HassEntity>,
  fm: FmData,
  /** The profile's view (ReadinessView): its devices (config/deviceGroups' villaDevices, through the profile's
   *  filter) and the problems the Cockpit lists for it — the alarms are its items of kind "alarm" (every device the
   *  map paints red: its condition is wrong, config/deviceCondition): the one rule, never a second reading of the
   *  entities. */
  view: ReadinessView,
  /** The user's own device names (config.entityMap) — a one-door villa's list is named after its door. */
  entityMap: Record<string, EntityMapping>,
): ReadinessResult {
  const checks: ReadinessCheck[] = [];
  const { devices } = view;
  const alarms = view.attentionItems;

  // ⚠️ THE VILLA'S OWN DEVICES, NOT EVERYTHING HOME ASSISTANT KNOWS. The old
  // predicate here was `!disabled && (mapped || entities[id])`, and that second
  // clause admits EVERY entity HA has — so a helper, a neighbouring
  // integration or a light in another building counted toward "all lights off"
  // and "all doors locked". `selectableDeviceIds` is the same set the offline
  // badge and the Facility device count already use, so all three now answer
  // from one list instead of three predicates that happened to agree.
  //
  // ⚠️ FROM THE PROFILE'S DEVICES, NOT FROM THE ENTITIES (architecture review, 2026-10-19): a device the model names
  // whose entity the villa's system no longer has was counted under "All devices reporting" and called "Missing" on
  // the Overview's card, and was absent from Cameras and Air conditioning — the scan went over the entities, where it
  // is not. Each device with its state; one the system does not have (missingFromHa) reads as lost, and is NAMED as
  // the card names it (NOT_IN_HA).
  const own: Record<string, HassEntity> = {};
  for (const id of devices.ids) {
    const e = entities[id] ?? (missingFromHa(entities, id) ? lostDevice(id) : undefined);
    if (e) own[id] = e;
  }

  // ── No alarm ─────────────────────────────────────────────────────────────
  // ⚠️ AN ALARM MADE THE VILLA "READY, WITH THINGS WORTH FIXING" (architecture review, 2026-10-19 evening): these checks
  // had no alarm of their own — a leak sounding read amber here, and the saved snapshot said "READY, WITH FINDINGS",
  // while the top bar was red. An alarm is what makes the villa not ready, as it makes the top bar red.
  //
  // ⚠️ A JAMMED LOCK WAS COUNTED TWICE (owner, 2026-10-28): its condition is wrong, so the Cockpit lists it as an alarm,
  // and "Doors locked" below names it "jammed" too: two lines of the recap for one door. A lock is that check's alone;
  // this one keeps every other device in alarm.
  const locks = lockFacts(own), lockIds = new Set(locks?.ids ?? []);
  const sounding = alarms.filter((a) => a.kind === "alarm" && !(a.entityId && lockIds.has(a.entityId)));
  checks.push({
    id: "alarms",
    label: sounding.length === 0 ? "No alarm" : countOf(sounding.length, "alarm"),
    state: sounding.length === 0 ? "pass" : "fail",
    detail: sounding.length === 0 ? "Nothing is in alarm." : sounding.map((a) => `${a.title}: ${a.detail}`).join(" · "),
    entityIds: sounding.flatMap((a) => (a.entityId ? [a.entityId] : [])),
  });
  // ⚠️ HOW BAD, AS THE TOP BAR SAYS IT (architecture review "One answer per question" #3, 2026-10-19): the top bar
  // turns red for a CRITICAL device not answering, and amber for any other, a fault or a late task (owner,
  // 2026-10-18 — attention.villaHealthFrom). These checks went red past two devices or two faults, whichever they
  // were: two faults and the alarm panel offline read amber here under a red top bar.
  const offlineState = (ids: readonly string[]): CheckState =>
    ids.length === 0 ? "pass" : ids.some((id) => devices.isCritical(id)) ? "fail" : "warn";

  const byDomain = (d: string) => Object.values(own).filter((e) => isDomain(e.entity_id, d));
  /** "2 offline, 1 missing": the devices not answering, the ones the villa's system no longer has named apart. */
  const notAnswering = (ids: readonly string[], word: string, noun = "") => {
    const gone = ids.filter((id) => missingFromHa(entities, id)).length, off = ids.length - gone;
    const n = (k: number) => (noun ? countOf(k, noun) : `${k}`);
    return [off ? `${n(off)} ${word}` : "", gone ? `${n(gone)} ${NOT_IN_HA.toLowerCase()}` : ""].filter(Boolean).join(", ");
  };

  // ── Devices online ───────────────────────────────────────────────────────
  // Shared with the HUD's unavailable-devices badge — deliberately the SAME
  // function, not a parallel reimplementation. They used to disagree (this
  // check counted raw candidates with no device-folding or debris filtering,
  // so a two-entity combo sensor could read as two broken devices here and
  // one on the HUD badge); see unavailableDeviceIds's docstring.
  const offline = devices.unavailable as string[];
  checks.push({
    id: "devices-online",
    label: AVAILABILITY_CHECK_LABEL,
    state: offlineState(offline),
    detail: offline.length === 0
      ? "Every configured device is reporting."
      : `${notAnswering(offline, "offline or not reporting", "device")}.`,
    entityIds: offline,
    opens: { label: "View unavailable devices", group: { title: "Unavailable devices", icon: WifiOff, entityIds: offline }, health: true },
  });

  // ── Doors locked ─────────────────────────────────────────────────────────
  // `lock.*` entities only — see summaryGroups.locksGroup's docstring for why
  // this isn't extended to switches that merely look like a door/gate relay
  // by name (tried once, misfired on every "outdoor" light switch — reverted).
  //
  // ⚠️ THE SAME FACTS AS THE SUMMARY TILE (villaSummary.lockFacts). This used
  // `state !== "locked"` and reported an unavailable or jammed lock as "not
  // locked" while the tile, for the same lock, said "Unknown". Still a warning
  // — a door nobody can confirm is not a secured door — but named for what it
  // is, so the check never claims a door is open when nothing said so.
  //
  // ⚠️ ONE WORD PER FACT, ONE COUNT PER FACT (architecture review, 2026-10-19): a jammed, a moving and an unavailable
  // lock were all "not reporting" here while the alarm check named the same lock "Jammed" — and the unavailable one
  // was counted here AND under "All devices reporting". A lock whose contact is LOST is that check's alone; this one
  // names what the lock itself said: unlocked, jammed, moving, or no value to give.
  if (locks) {
    const notLocked = [...locks.unlocked, ...locks.jammed, ...locks.moving, ...locks.unknown];
    const parts = [
      locks.unlocked.length ? `${locks.unlocked.length} unlocked` : "",
      locks.jammed.length ? `${locks.jammed.length} jammed` : "",
      locks.moving.length ? `${locks.moving.length} moving` : "",
      locks.unknown.length ? `${locks.unknown.length} not reporting` : "",
    ].filter(Boolean);
    const answering = locks.ids.length - locks.lost.length;
    checks.push({
      id: "locks",
      label: "Doors locked",
      state: notLocked.length === 0 ? "pass" : "warn",
      detail: notLocked.length === 0
        ? `All ${countOf(answering, "lock")} secured.`
        : `${parts.join(", ")}.`,
      entityIds: notLocked,
      // every lock, as the summary tile opens them (summaryGroups) — not only the failing ones
      opens: target("View doors", locksGroup(locks, entities, entityMap)),
    });
  }

  // ── Lights off (a lit empty villa is burned Direct Expense) ──────────────
  const lights = lightFacts(own);
  if (lights) {
    const lit = lights.on.length;
    checks.push({
      id: "lights",
      label: "Lights off before arrival",
      state: lit === 0 ? "pass" : "warn",
      detail: lit === 0 ? "All lights off." : `${lit} still on.`,
      entityIds: lights.on,
      opens: target("View lights", lightsGroup(lights)),
    });
  }

  // ── Climate reachable ────────────────────────────────────────────────────
  const climate = climateFacts(own);
  if (climate) {
    const broken = climate.unreachable;
    checks.push({
      id: "climate",
      label: "Air conditioning reachable",
      state: offlineState(broken),
      detail: broken.length === 0
        ? `${countOf(climate.ids.length, "unit")} responding.`
        : `${notAnswering(broken, "not responding")}, cannot pre-cool.`,
      entityIds: broken,
      opens: target("View air conditioning", { title: "Air conditioning", icon: AirVent, entityIds: climate.ids.slice() }),
    });
  }

  // ── Cameras healthy (security is part of the house rules obligation) ─────
  const cameras = byDomain("camera");
  if (cameras.length) {
    // "online" is lost contact or not (isOffline): one meaning with every offline list (2026-10-18)
    const down = cameras.filter((c) => isOffline(c));
    checks.push({
      id: "cameras",
      label: "Cameras online",
      state: offlineState(down.map((c) => c.entity_id)),
      detail: down.length === 0
        ? `${countOf(cameras.length, "camera")} online.`
        : `${notAnswering(down.map((c) => c.entity_id), "offline")}.`,
      entityIds: down.map((c) => c.entity_id),
      opens: target("View cameras", { title: "Cameras", icon: Cctv, entityIds: cameras.map((c) => c.entity_id) }),
    });
  }

  // ── Nothing broken and unresolved ────────────────────────────────────────
  // ⚠️ THE TITLE SAYS WHAT IS FOUND, NOT THE GOAL (owner, 2026-10-14): "No open faults or tickets" stood over "5 still
  // open" — the card contradicted itself. Failing, it counts both and says where each is dealt with.
  // counted per device, as the Overview and Tickets draw them (openCounts, architecture review 2026-10-15)
  // ⚠️ THE FAULTS THIS PROFILE IS SHOWN (the Overview's: its fault items), not every record (architecture review,
  // 2026-10-19) — the Recap counted faults about devices the Overview did not list for the same person
  const shown = new Set(alarms.flatMap((i) => (i.kind === "fault" && i.ticketId ? [i.ticketId] : [])));
  const records = fm.tickets.filter((t) => shown.has(t.id));
  const open = openCounts(records, devices.deviceOfRecord);
  const faults = records.filter((t) => isTicketOpen(t) && stageOf(t) === "fault");
  const where = [open.faults ? "the faults in \"Overview\"" : "", open.tickets ? "the open tickets in \"Tickets\"" : ""].filter(Boolean);
  const found = new Set(faults.map(faultSource));
  checks.push({
    id: "tickets",
    // a fault and the ticket it became are both unresolved (owner, 2026-10-14: faults become tickets)
    label: open.total === 0
      ? "No open faults or tickets"
      : `${countOf(open.faults, "detected fault")} (${countOf(open.tickets, "open ticket")})`,
    state: open.total === 0 ? "pass" : "warn",   // a fault is a warning, however many (owner, 2026-10-18)
    detail: open.total === 0 ? "Nothing to deal with." : `Check ${where.join(", or ")}.`,
    sources: ISSUE_SOURCES.filter((s) => found.has(s)),
  });

  const passed = checks.filter((c) => c.state === "pass").length;
  const overall: CheckState = checks.some((c) => c.state === "fail")
    ? "fail" : checks.some((c) => c.state === "warn") ? "warn" : "pass";
  return { checks, passed, total: checks.length, overall, availability: { total: devices.ids.length, offline } };
}

/** A device the villa's system does not have, as a state: lost contact (contactOf), no reading. */
const lostDevice = (id: string): HassEntity =>
  ({ entity_id: id, state: "unavailable", attributes: {}, last_changed: "", last_updated: "", context: { id: "" } }) as unknown as HassEntity;

const target = (label: string, group: SummaryGroup | null): CheckTarget | undefined => group ? { label, group } : undefined;
