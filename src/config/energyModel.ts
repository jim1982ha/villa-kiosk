// src/config/energyModel.ts
// The Energy window's rules, over what Home Assistant's Energy dashboard has
// ALREADY decided — never a second setup of it in VESTA.
//
// ⚠️ NOTHING HERE IS CONFIGURED IN VESTA. The sources (grid import/export),
// the individual devices, which device sits inside which (`included_in_stat`,
// HA's "upstream device") and the cost statistics are read from HA on every
// open (HAEnergyAPI.fetchEnergySetup), and the kWh are the recorder's own
// per-period `change`. Add a device, nest a pump under its phase, change the
// tariff helper — the window shows it the next time it opens.
//
// The words are rules on those numbers, the way config/weatherStation.ts
// words the weather: a day against a typical one, the day that stood out, the
// device that leads, and whether the devices add up. PURE —
// tests/oracles/energy_model.mjs drives it with the villa's measured week.

import { localMidnight, localMonthStart } from "@/utils/localDay";
import { COMPILE_GRACE_MS } from "@/utils/statisticsSeries";

/** One `energy/get_prefs` device-consumption entry. */
export interface EnergyDevicePref {
  stat_consumption: string;
  stat_rate?: string | null;
  included_in_stat?: string | null;
  name?: string | null;
}

/** The parts of `energy/get_prefs` the window reads. */
export interface EnergySetupPrefs {
  energy_sources: {
    type: string;
    stat_energy_from?: string | null;
    stat_energy_to?: string | null;
  }[];
  device_consumption: EnergyDevicePref[];
}

/** A device in HA's own hierarchy: its children are the devices whose
 *  "upstream device" it is. */
export interface EnergyNode {
  id: string;
  name: string;
  rateId: string | null;
  children: EnergyNode[];
}

/** The villa's energy as HA's dashboard models it. */
export interface EnergySetup {
  /** Grid import statistics (consumption from the grid). */
  gridIn: string[];
  /** Grid export statistics (returned to the grid). */
  gridOut: string[];
  /** Solar production statistics. */
  solar: string[];
  /** Devices with no upstream device — HA's top level. */
  roots: EnergyNode[];
  /** Every device, flat. */
  devices: EnergyNode[];
}

/** HA's hierarchy from its prefs. A device whose upstream is not itself a
 *  configured device (or points back into a loop) is a root. */
export function energySetup(prefs: EnergySetupPrefs, nameOf: (statId: string) => string): EnergySetup {
  const pick = (type: string, key: "stat_energy_from" | "stat_energy_to") =>
    prefs.energy_sources.filter((s) => s.type === type && s[key]).map((s) => s[key] as string);
  const nodes = new Map<string, EnergyNode>();
  for (const d of prefs.device_consumption) {
    if (nodes.has(d.stat_consumption)) continue;
    nodes.set(d.stat_consumption, {
      id: d.stat_consumption,
      name: d.name?.trim() || nameOf(d.stat_consumption),
      rateId: d.stat_rate || null,
      children: [],
    });
  }
  const parentOf = new Map<string, string>();
  for (const d of prefs.device_consumption) {
    const p = d.included_in_stat;
    if (p && p !== d.stat_consumption && nodes.has(p)) parentOf.set(d.stat_consumption, p);
  }
  // A loop (a is inside b, b inside a) is a misconfiguration: break it by
  // treating its members as roots rather than losing them.
  const inLoop = (id: string) => {
    const seen = new Set<string>();
    for (let c: string | undefined = id; c; c = parentOf.get(c)) { if (seen.has(c)) return true; seen.add(c); }
    return false;
  };
  const roots: EnergyNode[] = [];
  for (const n of nodes.values()) {
    const p = parentOf.get(n.id);
    if (p && !inLoop(n.id)) nodes.get(p)!.children.push(n);
    else roots.push(n);
  }
  return {
    gridIn: pick("grid", "stat_energy_from"),
    gridOut: pick("grid", "stat_energy_to"),
    solar: pick("solar", "stat_energy_from"),
    roots,
    devices: [...nodes.values()],
  };
}

/** One node's kWh for a period, with its children and what they leave. */
export interface NodeUse { node: EnergyNode; kwh: number; children: NodeUse[]; untracked: number }

/** A period's energy, laid out as HA's dashboard does. */
export interface EnergySplit {
  /** Consumed: grid import + solar − export (what HA calls "consumption"). */
  used: number;
  gridIn: number;
  gridOut: number;
  solar: number;
  /** Top-level devices, largest first. */
  roots: NodeUse[];
  /** Used minus the top-level devices — HA's "untracked consumption". Never
   *  negative: when the devices add up to MORE than was used, some are
   *  counted twice, and that is `overlap`, not a negative remainder. */
  untracked: number;
  /** How much the top-level devices exceed what was used (0 when they don't)
   *  — devices set up beside the meter they are part of, not inside it. */
  overlap: number;
}

/** A period's split, from each statistic's kWh in it (missing: no data). */
export function energySplit(setup: EnergySetup, kwh: (statId: string) => number | undefined): EnergySplit {
  const sum = (ids: string[]) => ids.reduce((a, id) => a + (kwh(id) ?? 0), 0);
  const gridIn = sum(setup.gridIn), gridOut = sum(setup.gridOut), solar = sum(setup.solar);
  const used = Math.max(0, gridIn + solar - gridOut);
  const walk = (n: EnergyNode): NodeUse => {
    const children = n.children.map(walk).sort((a, b) => b.kwh - a.kwh);
    const own = kwh(n.id) ?? 0;
    return { node: n, kwh: own, children, untracked: Math.max(0, own - children.reduce((a, c) => a + c.kwh, 0)) };
  };
  const roots = setup.roots.map(walk).sort((a, b) => b.kwh - a.kwh);
  const tracked = roots.reduce((a, r) => a + r.kwh, 0);
  return { used, gridIn, gridOut, solar, roots, untracked: Math.max(0, used - tracked), overlap: Math.max(0, tracked - used) };
}

/** Every device's use, flat, largest first — the ranking a history period shows. */
export function deviceRanking(split: EnergySplit): NodeUse[] {
  const out: NodeUse[] = [];
  const add = (u: NodeUse) => { out.push(u); u.children.forEach(add); };
  split.roots.forEach(add);
  return out.sort((a, b) => b.kwh - a.kwh);
}

/** A typical day: the MEDIAN of complete days, so one unusual day (a party,
 *  a pump left on) does not move it. A day with no reading (undefined) is
 *  left out, never counted as 0. Undefined with no days. */
export function typicalDay(days: readonly (number | undefined)[]): number | undefined {
  const d = days.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!d.length) return undefined;
  const m = d.length >> 1;
  return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
}

/** How today compares, so far: against a typical day's share of the hours
 *  gone. Below 80% quiet, above 120% busy — a fifth either way. */
export const QUIET_BELOW = 0.8;
export const BUSY_ABOVE = 1.2;
export function todayHeadline(soFar: number, typical: number | undefined, dayFraction: number, clock: string): string {
  if (typical === undefined || !(typical > 0)) return `${fmtKwh(soFar)} kWh so far today.`;
  const pct = Math.round((soFar / typical) * 100);
  const pace = soFar / (typical * Math.max(0.01, dayFraction));
  const word = pace < QUIET_BELOW ? "A quiet day" : pace > BUSY_ABOVE ? "A busy day" : "A usual day";
  return `${word} — ${pct}% of a typical one by ${clock}.`;
}

/** A day that stood out: at least this many times a typical one. */
export const STANDOUT_RATIO = 1.5;

/** The last complete day that stood out, if any: its index and ratio. */
export function standoutDay(days: readonly (number | undefined)[], typical: number | undefined): { index: number; ratio: number } | null {
  if (typical === undefined || !(typical > 0)) return null;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d === undefined) continue;
    const r = d / typical;
    if (r >= STANDOUT_RATIO) return { index: i, ratio: r };
  }
  return null;
}

/** The devices that rose on a stand-out day against their own typical day —
 *  at least half a kWh more, largest rise first. */
export function risers(
  devices: readonly EnergyNode[], dayKwh: (id: string) => number | undefined, typicalKwh: (id: string) => number | undefined,
): { node: EnergyNode; extra: number }[] {
  return devices
    .map((node) => ({ node, extra: (dayKwh(node.id) ?? 0) - (typicalKwh(node.id) ?? 0) }))
    .filter((r) => r.extra >= 0.5 && r.node.children.length === 0)
    .sort((a, b) => b.extra - a.extra);
}

// ── A period, bucket by bucket (2.496.113) ───────────────────────────────
// ⚠️ A BUCKET THE RECORDER HAS NO READING FOR IS MISSING, NEVER 0 kWh. The
// window used to look each statistic up by bucket start with `?? 0`, so an
// hour the meter did not report drew as an hour nothing was used — the exact
// defect utils/statisticsSeries exists to prevent, one layer up. Here a
// bucket is `ready` (a source reported it), `pending` (it has not ended long
// enough ago for HA to have compiled it — the current hour) or `missing`.

export { COMPILE_GRACE_MS };

/** The setup with HA's cost statistics (HAEnergyAPI.fetchEnergySetup). */
export interface EnergyCostSetup extends EnergySetup {
  /** energy statistic → its cost statistic, where HA computes one. */
  costOf: Record<string, string>;
}

/** A statistic's per-bucket values: what the recorder returned (the
 *  HistorySeries shape — only `points` is read here). */
export interface EnergySeries { points: readonly { t: number; v: number }[] }

export type EnergyBucketState = "ready" | "pending" | "missing";

export interface EnergyBucket {
  t: number;
  state: EnergyBucketState;
  /** The bucket's split; null unless `ready`. */
  split: EnergySplit | null;
  /** The grid's cost in the bucket, where HA has a cost statistic with a reading. */
  cost: number | undefined;
}

export interface EnergyPeriod {
  buckets: EnergyBucket[];
  /** The whole period (every reading the recorder returned). */
  whole: EnergySplit;
  /** The whole period's grid cost; undefined when no cost statistic has a reading. */
  cost: number | undefined;
  /** One statistic's value in the bucket starting at `t`; undefined where it has none. */
  at: (statId: string, t: number) => number | undefined;
  /** The ready bucket that used the most, or -1 when none used anything. */
  busiest: number;
  /** How many buckets are ready — what a per-bucket average divides by. */
  readyCount: number;
}

/**
 * A period's energy, bucket by bucket, from each statistic's readings.
 * `starts` are the buckets' starts, oldest first; `bucketMs` the length of
 * the last (each other bucket ends where the next starts). A statistic's
 * readings are summed WITH their sign: HA's dashboard does, and a reversed
 * clamp is the owner's to correct in HA, not this window's to hide.
 */
export function energyPeriod(
  setup: EnergyCostSetup, series: Readonly<Record<string, EnergySeries | undefined>>,
  starts: readonly number[], bucketMs: number, now: number,
): EnergyPeriod {
  const maps = new Map<string, Map<number, number>>();
  const mapOf = (id: string) => {
    let m = maps.get(id);
    if (!m) {
      m = new Map();
      for (const p of series[id]?.points ?? []) m.set(p.t, (m.get(p.t) ?? 0) + p.v);
      maps.set(id, m);
    }
    return m;
  };
  const at = (id: string, t: number) => mapOf(id).get(t);
  const sources = [...setup.gridIn, ...setup.solar];
  const costIds = setup.gridIn.map((id) => setup.costOf[id]).filter((c): c is string => !!c);
  const sumOf = (ids: string[], get: (id: string) => number | undefined) => {
    let any = false, v = 0;
    for (const id of ids) { const x = get(id); if (x !== undefined) { any = true; v += x; } }
    return any ? v : undefined;
  };
  const buckets = starts.map((t, i): EnergyBucket => {
    const end = starts[i + 1] ?? t + bucketMs;
    const ready = sources.some((id) => at(id, t) !== undefined);
    return {
      t,
      state: ready ? "ready" : end + COMPILE_GRACE_MS > now ? "pending" : "missing",
      split: ready ? energySplit(setup, (id) => at(id, t)) : null,
      cost: sumOf(costIds, (id) => at(id, t)),
    };
  });
  const totalOf = (id: string) => {
    const pts = series[id]?.points ?? [];
    return pts.length ? pts.reduce((a, p) => a + p.v, 0) : undefined;
  };
  let busiest = -1;
  buckets.forEach((b, i) => {
    if (b.split && b.split.used > 0 && (busiest < 0 || b.split.used > buckets[busiest].split!.used)) busiest = i;
  });
  return {
    buckets,
    whole: energySplit(setup, totalOf),
    cost: sumOf(costIds, totalOf),
    at,
    busiest,
    readyCount: buckets.filter((b) => b.state === "ready").length,
  };
}

/** The buckets a view shows, oldest first. */
export type EnergyPeriodKind =
  | "hoursToday"      // today's 24 hours
  | "last7Complete"   // the seven days before today (today is not complete)
  | "last7"           // the last seven days, today included
  | "last30"          // the last thirty days, today included
  | "last12Months";   // the last twelve calendar months, this one included
export function periodStarts(kind: EnergyPeriodKind, now: number): number[] {
  switch (kind) {
    case "hoursToday": {
      const m = localMidnight(now);
      return Array.from({ length: 24 }, (_, h) => m + h * 3_600_000);
    }
    case "last7Complete": return Array.from({ length: 7 }, (_, i) => localMidnight(now, i - 7));
    case "last7": return Array.from({ length: 7 }, (_, i) => localMidnight(now, i - 6));
    case "last30": return Array.from({ length: 30 }, (_, i) => localMidnight(now, i - 29));
    case "last12Months": return Array.from({ length: 12 }, (_, i) => localMonthStart(now, i - 11));
  }
}

export function fmtKwh(v: number): string {
  return v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** A cost in the cost statistic's own currency (HA writes it as the unit, an
 *  ISO code such as IDR or EUR); a unit that is not one is written after. */
export function fmtMoney(v: number, unit: string | undefined, locale?: string): string {
  if (unit && /^[A-Z]{3}$/.test(unit)) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: unit, maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v);
    } catch { /* not a currency Intl knows */ }
  }
  return `${Math.round(v).toLocaleString(locale)}${unit ? ` ${unit}` : ""}`;
}
