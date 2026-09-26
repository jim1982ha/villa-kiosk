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
 *  a pump left on) does not move it. Undefined with no days. */
export function typicalDay(days: readonly number[]): number | undefined {
  const d = days.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
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
export function standoutDay(days: readonly number[], typical: number | undefined): { index: number; ratio: number } | null {
  if (typical === undefined || !(typical > 0)) return null;
  for (let i = days.length - 1; i >= 0; i--) {
    const r = days[i] / typical;
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
