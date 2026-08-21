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
  modules: { name: string; requires: string[]; audiences: Audience[]; minDays: number }[];
  reachable: boolean;
  error: string;
  capabilities: string[];
  capabilitiesMissing: string[];
  capabilityMeaning: Record<string, string>;
  capabilityAbsent: Record<string, string>;
  preflight: { severity: Severity; detail: string; code: string }[];
  /** ⚠️ WHEN DISCOVERY RAN, which is NOT "now". This endpoint probes Home
   *  Assistant live on every request, and the dialog requests it once, when it
   *  opens — so everything derived from it is a snapshot taken at this instant
   *  and does not update while the dialog is open. The Coverage tab prints it
   *  rather than leaving a reader to assume a live feed. */
  at: string;
  /** Every `notify.*` service this property has, for the destination picker.
   *  Already on the wire inside `inventory` — the Schedule tab could only
   *  REMOVE targets until v2.545.0 because nothing parsed it, which made
   *  "where briefings go" unconfigurable from the dialog that owns it. */
  notifyTargets: { service: string; name: string; broadcast: boolean }[];
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
    /** ⚠️ PROSE, NOT A `SkipReason` CODE, and typing it as one would be
     *  wrong. `analyse()` returns `describe_skips(skipped)`, which has already
     *  mapped `missing_capability` to "not possible on this property" — the
     *  code never reaches this endpoint. Checked because /dry-audit flagged
     *  `SkipReason` as an unused export and the obvious fix was to use it here. */
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
/** A value from a closed set, or `fallback` (the set's first member by
 *  default). ⚠️ NEVER THE RAW STRING: these drive rendering decisions —
 *  `severity` is interpolated straight into a CSS class name — so an
 *  unrecognised value from a newer add-on must degrade to something
 *  displayable rather than reach the DOM. */
const oneOf = <T extends readonly string[]>(
  v: unknown, set: T, fallback?: T[number],
): T[number] =>
  (set as readonly string[]).includes(str(v))
    ? (str(v) as T[number])
    : (fallback ?? set[0]);

/** ⚠️ Members of a closed set, DROPPED rather than coerced when unknown.
 *  Coercing an unrecognised audience to the first one would claim a module
 *  serves a brief it does not; omitting it says only that this client does not
 *  know about it, which is true. */
const membersOf = <T extends readonly string[]>(v: unknown, set: T): T[number][] =>
  strs(v).filter((x): x is T[number] => (set as readonly string[]).includes(x));

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

/** ⚠️ THE STORE SPEAKS snake_case AND THIS APP SPEAKS camelCase, AND TWO KEYS
 *  DIFFER BETWEEN THEM. `store.CONFIG_DEFAULTS` is the wire contract:
 *  `notify_targets` and `min_history_days`. Read or written as `notifyTargets`
 *  / `minHistoryDays` they are not errors — they are ACCEPTED AND IGNORED. The
 *  proxy's `validate_config` only checks keys it knows, and `config_view` keeps
 *  unknown ones so a newer add-on's settings survive a downgrade, so a save
 *  returns 200 and the scheduler then reads `notify_targets`, finds nothing,
 *  and delivers a composed brief to nowhere.
 *
 *  This is the third defect of the same family in this file, after the envelope
 *  key (v2.544.0, two sites). Same shape every time: Python one side,
 *  TypeScript the other, a string literal in each and nothing between them. The
 *  mapping is stated ONCE here and used by both directions, so the parse and
 *  the serialise cannot drift; `tests/py/test_store_envelope.py` derives the
 *  wire names from `CONFIG_DEFAULTS` and fails if this table omits one.
 *
 *  Schedule ITEM fields (`id`/`cadence`/`hour`/`audience`/`targets`) are single
 *  words and identical on both sides — nothing to map, which is exactly why
 *  they worked and hid this. */
const CONFIG_WIRE_KEYS = {
  enabled: "enabled",
  schedules: "schedules",
  notify_targets: "notifyTargets",
  modules: "modules",
  narration: "narration",
  timezone: "timezone",
  min_history_days: "minHistoryDays",
} as const;

/** ⚠️ AND THE SAME RULE ONE LEVEL DOWN. `providers.shared()` reads the
 *  narration slice with `settings.get("monthly_limit")`, so a nested key is
 *  exactly as capable of being written under a name nothing reads — and more
 *  capable of hiding, because the slice itself arrives intact and the mode
 *  works. The one that would have broken: a budget the operator set to 20
 *  silently running at the default 200. */
const NARRATION_WIRE_KEYS = {
  mode: "mode",
  monthly_limit: "monthlyLimit",
} as const;

/** A `ReportsConfig` in the store's own vocabulary, ready to PUT. */
function toWire(config: ReportsConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [wire, client] of Object.entries(CONFIG_WIRE_KEYS)) {
    const value = (config as Record<string, unknown>)[client];
    if (value !== undefined) out[wire] = value;
  }
  if (config.narration) {
    const slice: Record<string, unknown> = {};
    for (const [wire, client] of Object.entries(NARRATION_WIRE_KEYS)) {
      const value = (config.narration as Record<string, unknown>)[client];
      if (value !== undefined) slice[wire] = value;
    }
    out.narration = slice;
  }
  return out;
}

export function parseReportsConfig(raw: unknown): ReportsConfig {
  const c = obj(raw);
  const out: ReportsConfig = {};
  if (typeof c.enabled === "boolean") out.enabled = c.enabled;
  if (Array.isArray(c.schedules)) out.schedules = c.schedules.map(parseSchedule);
  if (Array.isArray(c.notify_targets)) out.notifyTargets = strs(c.notify_targets);
  if (typeof c.timezone === "string") out.timezone = c.timezone;
  if (typeof c.min_history_days === "number") out.minHistoryDays = c.min_history_days;
  const modules = obj(c.modules);
  if (Object.keys(modules).length) {
    // ⚠️ AN OBJECT PER MODULE — see `ReportsConfig.modules`. A bare boolean is
    // read by the server as "not a dict" and discarded, so an operator's
    // switch-off would be accepted and ignored. Older stored configs may still
    // hold the bare form; it is READ leniently and written back in the shape
    // the server actually reads.
    const slices: Record<string, { enabled?: boolean }> = {};
    for (const [k, v] of Object.entries(modules)) {
      if (typeof v === "boolean") slices[k] = { enabled: v };
      else if (typeof obj(v).enabled === "boolean") slices[k] = { enabled: obj(v).enabled as boolean };
    }
    if (Object.keys(slices).length) out.modules = slices;
  }
  const narration = obj(c.narration);
  if (typeof narration.mode === "string" || typeof narration.monthly_limit === "number") {
    out.narration = {
      ...(typeof narration.mode === "string"
        ? { mode: oneOf(narration.mode, NARRATION_MODE) as NarrationMode } : {}),
      ...(typeof narration.monthly_limit === "number"
        ? { monthlyLimit: narration.monthly_limit } : {}),
    };
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
    const d = (await r.json()) as { config?: unknown; rev?: unknown };
    return { config: parseReportsConfig(d.config), rev: str(d.rev, "0"), raw: obj(d.config) };
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
 *  failure the parameter exists to prevent.
 *
 *  ⚠️ THE ENVELOPE KEY IS `config`, AND IT IS PER-STORE, NOT PER-CODEBASE.
 *  `_json_store_handlers(path, key, …)` takes the key as an argument, so
 *  /device-config and /reports-config wrap their document in `config` while
 *  /fm-data wraps its in `data`. This client was written from `fmApi.ts` and
 *  inherited `data`, which the server does not read here — so `body.get("config")`
 *  was None and every save came back 400 ("config must be a dict"). The GET had
 *  the SAME defect and failed SILENTLY: `d.data` was undefined, `parseReportsConfig`
 *  degraded it to defaults, and the Schedule tab showed an empty configuration
 *  that looked exactly like a property with nothing set up. The write failing
 *  loudly is the only reason the read was ever found. Pinned by
 *  `tests/py/test_store_envelope.py`, which derives each key from the proxy. */
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
        // ⚠️ `toWire`, NOT the config object — see CONFIG_WIRE_KEYS. Spreading
        // this app's own camelCase names writes keys the scheduler never reads,
        // and the write SUCCEEDS, which is what made it invisible.
        config: { ...carryOver, ...toWire(config) },
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
    // ⚠️ `history`, NOT `data` — the envelope key is per-store, and this was
    // the THIRD site with the same inherited mistake. It never surfaced: a
    // history store that parses to nothing renders as "nothing has been
    // delivered yet", which is the correct display for a subsystem that has
    // never run. Found by `tests/py/test_store_envelope.py` on its first pass,
    // not by anyone reading the tab.
    const d = (await r.json()) as { history?: unknown };
    const entries = arr(obj(d.history).entries).map(parseEntry);
    return entries.reverse();
  } catch {
    return null;
  }
}

// ── narration credentials ───────────────────────────────────────────────────
//
// ⚠️ THERE IS NO READ PATH FOR THE VALUE, ON PURPOSE, AND THAT IS THE WHOLE
// SHAPE OF THIS PAIR. Every other store here is read-then-write: fetch the
// document, edit it, PUT it back. A credential must not work that way, because
// the fetch would put an API key into a browser — and this browser is a kiosk
// running unattended on a villa wall. The server answers only "is one set"
// (`secrets.configured`, which exists so the value is never even loaded), and
// this client cannot ask for more because there is nothing to ask.

/** Which providers have a credential stored. Never the credential. */
export async function fetchNarrationSecrets(): Promise<Record<string, boolean>> {
  try {
    const r = await fetch(ingressPath("reports-secret"), { credentials: "same-origin" });
    if (!r.ok) return {};
    const d = obj(await r.json());
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(obj(d.configured))) out[k] = v === true;
    return out;
  } catch {
    return {};
  }
}

/** Store or clear one credential. An empty `value` DELETES it — the only way to
 *  turn a provider off completely, since clearing the mode leaves the key on
 *  disk and a credential that outlives its purpose is one nobody watches. */
export async function saveNarrationSecret(
  provider: string, value: string,
): Promise<{ ok: boolean; error: string }> {
  try {
    const r = await fetch(ingressPath("reports-secret"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, value }),
    });
    if (r.ok) return { ok: true, error: "" };
    const d = obj(await r.json().catch(() => ({})));
    return { ok: false, error: str(d.error) || `Refused (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the add-on." };
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
          audiences: membersOf(mod.audiences, AUDIENCE),
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
          // ⚠️ UNKNOWN DEGRADES UPWARD, NOT DOWN. `oneOf`'s default is the
          // set's first member — "info" — so an unrecognised severity from a
          // newer add-on would render a preflight item as the LEAST urgent
          // thing on the page. "I do not know how urgent this is" must not
          // read as "not urgent"; `HistoryTab` narrows the same convention and
          // this site did not, which is what /dry-audit found.
          severity: oneOf(item.severity, SEVERITY, "warning") as Severity,
          detail: str(item.detail),
          code: str(item.code),
        };
      }),
      at: str(d.at),
      notifyTargets: arr(obj(d.inventory).notify_targets).map((t) => {
        const target = obj(t);
        return {
          service: str(target.service),
          name: str(target.name),
          broadcast: bool(target.broadcast),
        };
      }).filter((t) => t.service !== ""),
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
