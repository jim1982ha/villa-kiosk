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
import { isOffline } from "@/utils/stateColors";
import type { VillaDevices } from "@/config/deviceGroups";
import { isTicketOpen, stageOf } from "./fmEngine";
import { openCounts } from "./deviceWork";
import { faultSource, ISSUE_SOURCES, type IssueSource } from "./issueSource";
import { lockFacts, lightFacts, climateFacts } from "@/config/villaSummary";
import { locksGroup, lightsGroup, type SummaryGroup } from "@/config/summaryGroups";
import type { EntityMapping } from "@/types/scene.types";
import { AirVent, Cctv, WifiOff } from "lucide-react";
import type { FmData } from "./fmTypes";
import type { AttentionItem } from "@/config/attention";

export type CheckState = "pass" | "warn" | "fail";

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
export interface ReadinessResult {
  checks: ReadinessCheck[];
  passed: number;
  total: number;
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
  /** The villa's own devices, already resolved — see config/deviceGroups'
   *  villaDevices. ⚠️ THIS REPLACED TWO OPTIONAL ARGUMENTS in a seven-argument
   *  list that re-ordered the same nouns a third way. Both defaulted to empty,
   *  so a caller that forgot one silently resurrected dismissed devices and
   *  unfolded every combo sensor rather than failing. */
  devices: VillaDevices,
  /** The user's own device names (config.entityMap) — a one-door villa's list is named after its door. */
  entityMap: Record<string, EntityMapping>,
  /** The villa's alarms as the Cockpit lists them (attention items of kind "alarm": every device the map paints red,
   *  the villa's alert thresholds included) — the one rule, never a second reading of the entities here. */
  alarms: readonly AttentionItem[],
): ReadinessResult {
  const checks: ReadinessCheck[] = [];

  // ── No alarm ─────────────────────────────────────────────────────────────
  // ⚠️ AN ALARM MADE THE VILLA "READY, WITH THINGS WORTH FIXING" (architecture review, 2026-10-19 evening): these checks
  // had no alarm of their own — a leak sounding read amber here, and the saved snapshot said "READY, WITH FINDINGS",
  // while the top bar was red. An alarm is what makes the villa not ready, as it makes the top bar red.
  const sounding = alarms.filter((a) => a.kind === "alarm");
  checks.push({
    id: "alarms",
    label: sounding.length === 0 ? "No alarm" : `${sounding.length} alarm${sounding.length === 1 ? "" : "s"}`,
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

  // ⚠️ THE VILLA'S OWN DEVICES, NOT EVERYTHING HOME ASSISTANT KNOWS. The old
  // predicate here was `!disabled && (mapped || entities[id])`, and that second
  // clause admits EVERY entity HA has — so a helper, a neighbouring
  // integration or a light in another building counted toward "all lights off"
  // and "all doors locked". `selectableDeviceIds` is the same set the offline
  // badge and the Facility device count already use, so all three now answer
  // from one list instead of three predicates that happened to agree.
  const byDomain = (d: string) =>
    Object.values(entities).filter(
      (e) => e.entity_id.startsWith(`${d}.`) && devices.has(e.entity_id));

  // ── Devices online ───────────────────────────────────────────────────────
  // Shared with the HUD's unavailable-devices badge — deliberately the SAME
  // function, not a parallel reimplementation. They used to disagree (this
  // check counted raw candidates with no device-folding or debris filtering,
  // so a two-entity combo sensor could read as two broken devices here and
  // one on the HUD badge); see unavailableDeviceIds's docstring.
  const offline = devices.unavailable as string[];
  checks.push({
    id: "devices-online",
    label: "All devices reporting",
    state: offlineState(offline),
    detail: offline.length === 0
      ? "Every configured device is reporting."
      : `${offline.length} device${offline.length === 1 ? "" : "s"} offline or not reporting.`,
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
  const locks = lockFacts(entities, devices);
  if (locks) {
    const notLocked = [...locks.unlocked, ...locks.unknown];
    const parts = [
      locks.unlocked.length ? `${locks.unlocked.length} unlocked` : "",
      locks.unknown.length ? `${locks.unknown.length} not reporting` : "",
    ].filter(Boolean);
    checks.push({
      id: "locks",
      label: "Doors locked",
      state: notLocked.length === 0 ? "pass" : "warn",
      detail: notLocked.length === 0
        ? `All ${locks.ids.length} lock${locks.ids.length === 1 ? "" : "s"} secured.`
        : `${parts.join(", ")}.`,
      entityIds: notLocked,
      // every lock, as the summary tile opens them (summaryGroups) — not only the failing ones
      opens: target("View doors", locksGroup(locks, entities, entityMap)),
    });
  }

  // ── Lights off (a lit empty villa is burned Direct Expense) ──────────────
  const lights = lightFacts(entities, devices);
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
  const climate = climateFacts(entities, devices);
  if (climate) {
    const broken = climate.unreachable;
    checks.push({
      id: "climate",
      label: "Air conditioning reachable",
      state: offlineState(broken),
      detail: broken.length === 0
        ? `${climate.ids.length} unit${climate.ids.length === 1 ? "" : "s"} responding.`
        : `${broken.length} not responding — cannot pre-cool.`,
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
        ? `${cameras.length} camera${cameras.length === 1 ? "" : "s"} online.`
        : `${down.length} offline.`,
      entityIds: down.map((c) => c.entity_id),
      opens: target("View cameras", { title: "Cameras", icon: Cctv, entityIds: cameras.map((c) => c.entity_id) }),
    });
  }

  // ── Nothing broken and unresolved ────────────────────────────────────────
  // ⚠️ THE TITLE SAYS WHAT IS FOUND, NOT THE GOAL (owner, 2026-10-14): "No open faults or tickets" stood over "5 still
  // open" — the card contradicted itself. Failing, it counts both and says where each is dealt with.
  // counted per device, as the Overview and Tickets draw them (openCounts, architecture review 2026-10-15)
  const open = openCounts(fm.tickets, devices.deviceOfRecord);
  const faults = fm.tickets.filter((t) => isTicketOpen(t) && stageOf(t) === "fault");
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const where = [open.faults ? "the faults in \"Overview\"" : "", open.tickets ? "the open tickets in \"Tickets\"" : ""].filter(Boolean);
  const found = new Set(faults.map(faultSource));
  checks.push({
    id: "tickets",
    // a fault and the ticket it became are both unresolved (owner, 2026-10-14: faults become tickets)
    label: open.total === 0
      ? "No open faults or tickets"
      : `${plural(open.faults, "detected fault")} (${plural(open.tickets, "open ticket")})`,
    state: open.total === 0 ? "pass" : "warn",   // a fault is a warning, however many (owner, 2026-10-18)
    detail: open.total === 0 ? "Nothing to deal with." : `Check ${where.join(", or ")}.`,
    sources: ISSUE_SOURCES.filter((s) => found.has(s)),
  });

  const passed = checks.filter((c) => c.state === "pass").length;
  const overall: CheckState = checks.some((c) => c.state === "fail")
    ? "fail" : checks.some((c) => c.state === "warn") ? "warn" : "pass";
  return { checks, passed, total: checks.length, overall };
}

const target = (label: string, group: SummaryGroup | null): CheckTarget | undefined => group ? { label, group } : undefined;
