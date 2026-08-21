// src/fm/readiness.ts
// "Is the villa ready for the next guest?"
//
// Pure: takes the live entity snapshot plus the FM store and returns a list of
// checks. No React, no network, so the rules can be tested and so the same
// answer can be rendered in the operator panel, the report annex, or (later)
// an owner-facing summary.
//
// Why this matters commercially: a failed check-in costs a review, and
// reviews drive occupancy — the kind of thing a management contract's own
// performance clauses exist to protect, whatever they happen to say.

import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import type { DeviceGroup } from "@/config/AppConfig";
import { isUnavailable } from "@/utils/stateColors";
import { OFF_STATES } from "@/utils/entityState";
import { selectableDeviceIds, unavailableDeviceIds } from "@/config/deviceGroups";
import { scheduleStatus } from "./fmEngine";
import type { FmData } from "./fmTypes";

export type CheckState = "pass" | "warn" | "fail";

export interface ReadinessCheck {
  id: string;
  label: string;
  state: CheckState;
  /** What the operator should read — the actual finding, not a restatement. */
  detail: string;
  /** Entities behind a failing check, so the UI can jump to them on the map. */
  entityIds?: string[];
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  passed: number;
  total: number;
  /** Worst state across all checks — what the headline shows. */
  overall: CheckState;
}


/**
 * Build the readiness checks.
 *
 * `mappedEntityIds` scopes "devices offline" to things actually on the villa
 * map, so a stray Home Assistant entity that has nothing to do with this villa
 * can't hold the readiness check red forever.
 */
export function buildReadiness(
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
  mappedEntityIds: Set<string>,
  fm: FmData,
  /** Same folding/debris rules as the HUD's unavailable-devices badge — see
   *  unavailableDeviceIds. Optional (defaults to none) only for a caller with
   *  no groups configured yet; every real caller has config.deviceGroups. */
  deviceGroups: readonly DeviceGroup[] = [],
  /** See AppConfig.dismissedEntityIds — an entity the owner removed as gone
   *  from HA must not keep the readiness check red forever either. */
  dismissedEntityIds: readonly string[] = [],
  now = Date.now(),
): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  // ⚠️ ONE DEFINITION OF "A DEVICE OF THIS VILLA", AND THIS FILE USED TO HAVE
  // TWO. The `devices-online` check below correctly calls the shared
  // `unavailableDeviceIds`; the camera and climate checks did not — they
  // scanned by domain through a local predicate that applied `disabled` and
  // nothing else. So a camera the owner had DISMISSED stayed red on Readiness
  // while being absent from the Cockpit, on the same screen, and a two-entity
  // device counted twice here and once there. That is the exact drift
  // `unavailableDeviceIds`' own docstring records having already been paid for
  // once, in this very file, for a different check (2.572.0 — D6).
  const villaDevices = new Set(selectableDeviceIds(
    entityMap, [...deviceGroups], mappedEntityIds, entities, dismissedEntityIds));

  // ⚠️ THE CANDIDATE SET NARROWED WITH THE PREDICATE, AND THAT IS THE POINT.
  // The old rule scanned EVERY entity Home Assistant has; this one starts from
  // the villa's own devices. On an unconfigured install that is empty, so the
  // lock/light/climate/camera checks do not render at all — which is the honest
  // answer ("nobody has told us which locks are yours") rather than "all 47
  // locks secured" over a list that includes the neighbours'. `devices-online`
  // already answered 0 there, so the tab is now consistent with itself too.
  const byDomain = (d: string) =>
    Object.values(entities).filter(
      (e) => e.entity_id.startsWith(`${d}.`) && villaDevices.has(e.entity_id));

  // ── Devices online ───────────────────────────────────────────────────────
  // Shared with the HUD's unavailable-devices badge — deliberately the SAME
  // function, not a parallel reimplementation. They used to disagree (this
  // check counted raw candidates with no device-folding or debris filtering,
  // so a two-entity combo sensor could read as two broken devices here and
  // one on the HUD badge); see unavailableDeviceIds's docstring.
  const offline = unavailableDeviceIds(
    entityMap, [...deviceGroups], mappedEntityIds, entities, dismissedEntityIds);
  checks.push({
    id: "devices-online",
    label: "All devices reporting",
    state: offline.length === 0 ? "pass" : offline.length <= 2 ? "warn" : "fail",
    detail: offline.length === 0
      ? "Every configured device is reporting."
      : `${offline.length} device${offline.length === 1 ? "" : "s"} offline or not reporting.`,
    entityIds: offline,
  });

  // ── Doors locked ─────────────────────────────────────────────────────────
  // `lock.*` entities only — see summaryGroups.locksGroup's docstring for why
  // this isn't extended to switches that merely look like a door/gate relay
  // by name (tried once, misfired on every "outdoor" light switch — reverted).
  const locks = byDomain("lock");
  const unlocked = locks.filter((l) => l.state !== "locked");
  if (locks.length) {
    checks.push({
      id: "locks",
      label: "Doors locked",
      state: unlocked.length === 0 ? "pass" : "warn",
      detail: unlocked.length === 0
        ? `All ${locks.length} lock${locks.length === 1 ? "" : "s"} secured.`
        : `${unlocked.length} not locked.`,
      entityIds: unlocked.map((l) => l.entity_id),
    });
  }

  // ── Lights off (a lit empty villa is burned Direct Expense) ──────────────
  const lights = byDomain("light");
  const litCount = lights.filter((l) => !OFF_STATES.has(l.state)).length;
  if (lights.length) {
    checks.push({
      id: "lights",
      label: "Lights off before arrival",
      state: litCount === 0 ? "pass" : "warn",
      detail: litCount === 0 ? "All lights off." : `${litCount} still on.`,
      entityIds: lights.filter((l) => !OFF_STATES.has(l.state)).map((l) => l.entity_id),
    });
  }

  // ── Climate reachable ────────────────────────────────────────────────────
  const climates = byDomain("climate");
  if (climates.length) {
    const broken = climates.filter((c) => isUnavailable(c));
    checks.push({
      id: "climate",
      label: "Air conditioning reachable",
      state: broken.length === 0 ? "pass" : "fail",
      detail: broken.length === 0
        ? `${climates.length} unit${climates.length === 1 ? "" : "s"} responding.`
        : `${broken.length} not responding — cannot pre-cool.`,
      entityIds: broken.map((c) => c.entity_id),
    });
  }

  // ── Cameras healthy (security is part of the house rules obligation) ─────
  const cameras = byDomain("camera");
  if (cameras.length) {
    const down = cameras.filter((c) => isUnavailable(c));
    checks.push({
      id: "cameras",
      label: "Cameras online",
      state: down.length === 0 ? "pass" : "warn",
      detail: down.length === 0
        ? `${cameras.length} camera${cameras.length === 1 ? "" : "s"} online.`
        : `${down.length} offline.`,
      entityIds: down.map((c) => c.entity_id),
    });
  }

  // ── Pool serviced within its configured schedule interval ────────────────
  const pool = fm.schedules.find((s) => s.builtinKey === "pool_landscaping" && s.enabled);
  if (pool) {
    const st = scheduleStatus(pool, fm.completions, now);
    checks.push({
      id: "pool",
      label: "Pool serviced",
      state: st.state === "ok" ? "pass" : st.state === "due-soon" ? "warn" : "fail",
      detail: st.state === "never"
        ? "No pool service recorded yet."
        : st.state === "overdue"
          ? `Overdue by ${Math.abs(Math.round(st.daysUntilDue ?? 0))} day(s).`
          : `Last serviced ${Math.round(pool.everyDays - (st.daysUntilDue ?? 0))} day(s) ago.`,
    });
  }

  // ── Nothing broken and unresolved ────────────────────────────────────────
  const openTickets = fm.tickets.filter((t) => t.status !== "resolved");
  checks.push({
    id: "tickets",
    label: "No unresolved faults",
    state: openTickets.length === 0 ? "pass" : openTickets.length <= 2 ? "warn" : "fail",
    detail: openTickets.length === 0
      ? "No open faults."
      : `${openTickets.length} fault${openTickets.length === 1 ? "" : "s"} still open.`,
  });

  const passed = checks.filter((c) => c.state === "pass").length;
  const overall: CheckState = checks.some((c) => c.state === "fail")
    ? "fail" : checks.some((c) => c.state === "warn") ? "warn" : "pass";
  return { checks, passed, total: checks.length, overall };
}
