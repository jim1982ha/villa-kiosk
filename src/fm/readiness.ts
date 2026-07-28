// src/fm/readiness.ts
// "Is the villa ready for the next guest?" — Clause 1.1(iii)(a) (arrivals).
//
// Pure: takes the live entity snapshot plus the FM store and returns a list of
// checks. No React, no network, so the rules can be tested and so the same
// answer can be rendered in the operator panel, the report annex, or (later)
// an owner-facing summary.
//
// Why this matters commercially: a failed check-in costs a review, reviews
// drive occupancy, and Appendix C §1 lets the Owner terminate without penalty
// if occupancy is under 50% in the first six months.

import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import { isUnavailable } from "@/utils/stateColors";
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

const OFF_LIKE = new Set(["off", "unavailable", "unknown", ""]);

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
  now = Date.now(),
): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  const relevant = (id: string) =>
    !entityMap[id]?.disabled && (mappedEntityIds.has(id) || !!entities[id]);

  const byDomain = (d: string) =>
    Object.values(entities).filter((e) => e.entity_id.startsWith(`${d}.`) && relevant(e.entity_id));

  // ── Devices online ───────────────────────────────────────────────────────
  const candidates = new Set<string>([...mappedEntityIds, ...Object.keys(entityMap)]);
  const offline = [...candidates].filter(
    (id) => relevant(id) && isUnavailable(entities[id]));
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
  const litCount = lights.filter((l) => !OFF_LIKE.has(l.state)).length;
  if (lights.length) {
    checks.push({
      id: "lights",
      label: "Lights off before arrival",
      state: litCount === 0 ? "pass" : "warn",
      detail: litCount === 0 ? "All lights off." : `${litCount} still on.`,
      entityIds: lights.filter((l) => !OFF_LIKE.has(l.state)).map((l) => l.entity_id),
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

  // ── Pool serviced within its Clause 3.7(iv) interval ─────────────────────
  const pool = fm.schedules.find((s) => s.builtinKey === "pool_landscaping" && s.enabled);
  if (pool) {
    const st = scheduleStatus(pool, fm.completions, now);
    checks.push({
      id: "pool",
      label: "Pool serviced (Clause 3.7)",
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
