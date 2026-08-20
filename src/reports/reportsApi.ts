// src/reports/reportsApi.ts
// Client for the reports subsystem's four endpoints, served from the add-on's
// own /data volume like every other shared store.
//
// ⚠️ EVERY READ NARROWS. A store written by a newer add-on must not inject
// unknown shapes into this app, and one written by an older add-on must not
// crash it — the same rule `fmApi.parseFmData` follows, for the same reason.
//
// ⚠️ THE OWNER-ONLY ENDPOINTS ARE ENFORCED ON THE SERVER, NOT HERE. Hiding a
// tab is a rendering convenience; `supervisor-proxy.py` refuses a non-owner PUT
// to /reports-config and a non-owner GET of /reports-diagnostics whatever the
// browser sends. See auth/permissions.ts's own header.

import { ingressPath } from "@/ha/ingress";
import {
  AUDIENCE, CADENCE, DELIVERY_STATUS, NARRATION_MODE, SEVERITY,
  type Audience, type Cadence, type DeliveryResult, type NarrationMode,
  type ReportHistoryEntry, type ReportSchedule, type ReportsConfig,
  type Severity,
} from "./reportsTypes";

/** What `/reports-diagnostics` answers. Shaped here rather than in
 *  `reportsTypes.ts` because it is NOT part of the shared contract — the
 *  parity test would then demand a Python twin for a purely diagnostic view. */
export interface ReportsDiagnostics {
  ready: boolean;
  contractVersion: number;
  enabled: boolean;
  modules: { name: string; requires: string[]; audiences: string[]; minDays: number }[];
  reachable: boolean;
  error: string;
  capabilities: string[];
  capabilitiesMissing: string[];
  capabilityMeaning: Record<string, string>;
  capabilityAbsent: Record<string, string>;
  preflight: { severity: string; detail: string; code: string }[];
  collector: {
    connected: boolean;
    connectedSince: string;
    drops: number;
    onlineSince: string;
    buffered: number;
    seenTypes: Record<string, number>;
    blueprintCategories: string[];
    silentTypes: string[];
    lastEventAt: string;
  };
}

/** The composed prose plus the diagnostic surface, from a PREVIEW.
 *  ⚠️ `_`-prefixed keys are NOT persisted to history — see `append_history`. */
export interface ReportPreview {
  title: string;
  body: string;
  findingCount: number;
  severity: Severity;
  analysis: {
    ran: string[];
    skipped: { module: string; reason: string }[];
    aggregated: {
      eventsSeen: number;
      eventsDropped: number;
      groups: number;
      groupsByCategory: Record<string, number>;
      groupsPriced: number;
      savings: { total: number; groups: number; basisMix: Record<string, number> };
      tasks: number;
      openIncidents: number;
      schemaDrift: { blueprint: string; events: number; missing: string[]; legacy: string[] }[];
    };
    periodSince: string;
  };
}

// ── narrowing helpers ───────────────────────────────────────────────────────
// Small and local on purpose. A validation library would be a new runtime
// dependency for a screen that reads five endpoints, and the plan's own
// constraint for this phase is zero new dependencies.

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const strs = (v: unknown): string[] =>
  arr(v).filter((x): x is string => typeof x === "string");
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(v))) if (typeof n === "number") out[k] = n;
  return out;
};
const texts = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(obj(v))) if (typeof t === "string") out[k] = t;
  return out;
};
/** A value from a closed set, or the set's first member. ⚠️ Never the raw
 *  string: these drive rendering decisions, and an unrecognised one from a
 *  newer add-on must degrade to something displayable rather than leak out. */
const oneOf = <T extends readonly string[]>(v: unknown, set: T): T[number] =>
  (set as readonly string[]).includes(str(v)) ? (str(v) as T[number]) : set[0];

// ── config ─────────────────────────────────────────────────────────────────
//
// ⚠️ THE STORED DOCUMENT IS A SPARSE OVERLAY AND MUST STAY ONE. Absent means
// "use the default", and the backend applies defaults at read time rather than
// persisting them. Writing a fully-populated document back would make a DELETED
// schedule indistinguishable from an absent one — the config-resurrection bug
// CLAUDE.md's hard rule describes, which shipped once already against the
// device-config store's seeded entity map. So `parseReportsConfig` leaves
// absent fields UNDEFINED and the UI supplies display defaults at the point of
// rendering, never at the point of storage.

function parseSchedule(raw: unknown): ReportSchedule {
  const s = obj(raw);
  return {
    id: str(s.id),
    cadence: oneOf(s.cadence, CADENCE) as Cadence,
    hour: Math.min(23, Math.max(0, Math.round(num(s.hour, 7)))),
    audience: oneOf(s.audience, AUDIENCE) as Audience,
    ...(Array.isArray(s.targets) ? { targets: strs(s.targets) } : {}),
  };
}

export function parseReportsConfig(raw: unknown): ReportsConfig {
  const c = obj(raw);
  const out: ReportsConfig = {};
  if (typeof c.enabled === "boolean") out.enabled = c.enabled;
  if (Array.isArray(c.schedules)) out.schedules = c.schedules.map(parseSchedule);
  if (Array.isArray(c.notifyTargets)) out.notifyTargets = strs(c.notifyTargets);
  if (typeof c.timezone === "string") out.timezone = c.timezone;
  if (typeof c.minHistoryDays === "number") out.minHistoryDays = c.minHistoryDays;
  const modules = obj(c.modules);
  if (Object.keys(modules).length) {
    const flags: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(modules)) {
      if (typeof v === "boolean") flags[k] = v;
    }
    out.modules = flags;
  }
  const narration = obj(c.narration);
  if (typeof narration.mode === "string") {
    out.narration = { mode: oneOf(narration.mode, NARRATION_MODE) as NarrationMode };
  }
  return out;
}

/** ⚠️ Returns null on a TRANSPORT failure so the caller can tell "the server
 *  has nothing configured" from "could not reach it" — the second must never
 *  be shown as an empty schedule list, which reads as "reports are off" and
 *  invites someone to configure them a second time.
 *
 *  `raw` carries keys this app version does not recognise, so an older client
 *  cannot delete a newer one's field on write. Same rule as the FM store. */
export async function fetchReportsConfig(): Promise<
  { config: ReportsConfig; rev: string; raw: Record<string, unknown> } | null
> {
  try {
    const r = await fetch(ingressPath("reports-config"), { credentials: "same-origin" });
    if (!r.ok) return null;
    const d = (await r.json()) as { data?: unknown; rev?: unknown };
    return { config: parseReportsConfig(d.data), rev: str(d.rev, "0"), raw: obj(d.data) };
  } catch {
    return null;
  }
}

export type SaveOutcome =
  | { ok: true; rev: string }
  | { ok: false; conflict: boolean; error: string };

/** Write the settings. Owner only — and the server enforces that too.
 *
 *  ⚠️ CONDITIONAL ON `expectedRev`, exactly like the FM store: two devices can
 *  hold this dialog open at once, and an unconditional whole-document PUT would
 *  silently drop whichever schedule landed first. A 409 is surfaced so the
 *  caller can re-read rather than overwrite.
 *
 *  ⚠️ The revision travels IN THE BODY, not as `If-Match`. That is this
 *  server's contract (`_json_store_handlers`), and a header would simply be
 *  ignored — the write would then succeed unconditionally, which is the exact
 *  failure the parameter exists to prevent. */
export async function saveReportsConfig(
  config: ReportsConfig,
  expectedRev: string | null,
  carryOver: Record<string, unknown> = {},
): Promise<SaveOutcome> {
  try {
    const r = await fetch(ingressPath("reports-config"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { ...carryOver, ...config },
        ...(expectedRev === null ? {} : { rev: expectedRev }),
      }),
    });
    if (r.status === 409) {
      return { ok: false, conflict: true, error: "Someone else saved first." };
    }
    if (!r.ok) {
      return { ok: false, conflict: false, error: `The add-on refused the change (${r.status}).` };
    }
    const d = (await r.json().catch(() => ({}))) as { rev?: unknown };
    return { ok: true, rev: str(d.rev, "0") };
  } catch {
    return { ok: false, conflict: false, error: "Could not reach the add-on." };
  }
}

// ── history ─────────────────────────────────────────────────────────────────

function parseDelivery(raw: unknown): DeliveryResult {
  const d = obj(raw);
  return {
    target: str(d.target),
    status: oneOf(d.status, DELIVERY_STATUS),
    detail: str(d.detail),
  };
}

function parseEntry(raw: unknown): ReportHistoryEntry {
  const e = obj(raw);
  return {
    id: str(e.id),
    at: str(e.at),
    audience: oneOf(e.audience, AUDIENCE) as Audience,
    cadence: oneOf(e.cadence, CADENCE) as Cadence,
    narration: oneOf(e.narration, NARRATION_MODE) as NarrationMode,
    findingCount: num(e.findingCount),
    severity: oneOf(e.severity, SEVERITY) as Severity,
    deliveries: arr(e.deliveries).map(parseDelivery),
  };
}

/** Newest first — the list is stored oldest-first as a ring. */
export async function fetchReportsHistory(): Promise<ReportHistoryEntry[] | null> {
  try {
    const r = await fetch(ingressPath("reports-history"), { credentials: "same-origin" });
    if (!r.ok) return null;
    const d = (await r.json()) as { data?: unknown };
    const entries = arr(obj(d.data).entries).map(parseEntry);
    return entries.reverse();
  } catch {
    return null;
  }
}

// ── diagnostics ─────────────────────────────────────────────────────────────

export async function fetchReportsDiagnostics(): Promise<ReportsDiagnostics | null> {
  try {
    const r = await fetch(ingressPath("reports-diagnostics"), { credentials: "same-origin" });
    if (!r.ok) return null;
    const d = obj(await r.json());
    const collector = obj(d.collector);
    return {
      ready: bool(d.ready),
      contractVersion: num(d.contract_version),
      enabled: bool(d.enabled),
      modules: arr(d.modules).map((m) => {
        const mod = obj(m);
        return {
          name: str(mod.name),
          requires: strs(mod.requires),
          audiences: strs(mod.audiences),
          minDays: num(mod.min_days),
        };
      }),
      reachable: bool(d.reachable),
      error: str(d.error),
      capabilities: strs(d.capabilities),
      capabilitiesMissing: strs(d.capabilities_missing),
      capabilityMeaning: texts(d.capability_meaning),
      capabilityAbsent: texts(d.capability_absent),
      preflight: arr(d.preflight).map((p) => {
        const item = obj(p);
        return {
          severity: str(item.severity, "notice"),
          detail: str(item.detail),
          code: str(item.code),
        };
      }),
      collector: {
        connected: bool(collector.connected),
        connectedSince: str(collector.connected_since),
        drops: num(collector.drops),
        onlineSince: str(collector.online_since),
        buffered: num(collector.buffered),
        seenTypes: counts(collector.seen_types),
        blueprintCategories: strs(collector.blueprint_categories),
        silentTypes: strs(collector.silent_types),
        lastEventAt: str(collector.last_event_at),
      },
    };
  } catch {
    return null;
  }
}

// ── run now ─────────────────────────────────────────────────────────────────

/** Compose a report. ⚠️ `preview: true` SENDS NOTHING and records nothing —
 *  that is how an operator reads one before switching the schedule on, and
 *  "enable it and see what arrives" means finding out that a module is noisy
 *  on somebody's phone. */
export async function runReportNow(
  options: { preview: boolean; audience?: Audience; cadence?: Cadence; targets?: string[] },
): Promise<ReportPreview | null> {
  try {
    const r = await fetch(ingressPath("reports-run-now"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!r.ok) return null;
    const d = obj(await r.json());
    const analysis = obj(d._analysis);
    const agg = obj(analysis.aggregated);
    const savings = obj(agg.savings);
    return {
      title: str(d._title),
      body: str(d._body),
      findingCount: num(d.findingCount),
      severity: oneOf(d.severity, SEVERITY) as Severity,
      analysis: {
        ran: strs(analysis.ran),
        skipped: arr(analysis.skipped).map((s) => {
          const item = obj(s);
          return { module: str(item.module), reason: str(item.reason) };
        }),
        aggregated: {
          eventsSeen: num(agg.events_seen),
          eventsDropped: num(agg.events_dropped),
          groups: num(agg.groups),
          groupsByCategory: counts(agg.groups_by_category),
          groupsPriced: num(agg.groups_priced),
          savings: {
            total: num(savings.total),
            groups: num(savings.groups),
            basisMix: counts(savings.basis_mix),
          },
          tasks: num(agg.tasks),
          openIncidents: num(agg.open_incidents),
          schemaDrift: arr(agg.schema_drift).map((s) => {
            const item = obj(s);
            return {
              blueprint: str(item.blueprint),
              events: num(item.events),
              missing: strs(item.missing),
              legacy: strs(item.legacy),
            };
          }),
        },
        periodSince: str(analysis.period_since),
      },
    };
  } catch {
    return null;
  }
}
