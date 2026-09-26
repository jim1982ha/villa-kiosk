// src/config/energyObservations.ts
// What the Energy window SAYS — the day's headline, the observation cards,
// the history's figures — as rules on energyModel's numbers, the way
// config/weatherStation words the weather. The window only renders them.
//
// ⚠️ EVERY RULE THE OWNER READS IN WORDS LIVED IN THE VIEW (round 7,
// 2.496.125): which cards show and in what order, the 5% overlap and 25%
// untracked thresholds (the overlap one written twice, card and note), the
// three-card cap, "per hour" and "busiest", and five percent-of-total sums
// that each rounded and guarded differently. No test reached any of them.
// PURE; tests/oracles/energy_observations.mjs.

import {
  typicalDay, standoutDay, risers, deviceRanking, todayHeadline, fmtKwh, fmtMoney,
  type EnergyPeriod, type EnergySetup, type EnergySplit,
} from "./energyModel";
import { localMidnight } from "@/utils/localDay";

/** Devices adding up to more than this share OVER what was used: some are set
 *  up beside the meter they belong to. */
export const OVERLAP_SHOWS = 0.05;
/** More than this share of the day with no device meter is worth saying. */
export const UNTRACKED_SHOWS = 0.25;
/** The cards share one row. */
export const MAX_CARDS = 3;

/** A share, in whole percent — 0 of nothing, never NaN. ONE rule for the
 *  cards, the flow's tooltip, the pie and the ranking. */
export function share(v: number, total: number): number {
  return total > 0 ? Math.round((v / total) * 100) : 0;
}

/** Whether the devices overlap the meter enough to say so (card and note). */
export const overlapShows = (s: EnergySplit) => s.used > 0 && s.overlap > s.used * OVERLAP_SHOWS;

export interface EnergyCard { tone: "good" | "caution" | "bad" | "neutral"; title: string; detail: string }

export interface EnergyToday {
  split: EnergySplit;
  cost: number | undefined;
  /** The last seven complete days' use, oldest first; undefined: no reading. */
  daily: (number | undefined)[];
  weekTotal: number;
  typical: number | undefined;
  standout: { index: number; ratio: number } | null;
  headline: string;
  cards: EnergyCard[];
}

/**
 * The first screen's words. `today` is today's hours, `week` the seven
 * complete days before it (energyModel.energyPeriod over periodStarts).
 * The cards, in order, at most MAX_CARDS:
 *   1. a day that stood out this week, with its cost and the devices that rose;
 *   2. the device that leads today (devices with nothing inside them);
 *   3. the devices overlapping the meter — or else, a large untracked share.
 */
export function energyToday(
  setup: EnergySetup, today: EnergyPeriod, week: EnergyPeriod, now: number,
  clock: string, costUnit: string | undefined, locale?: string,
): EnergyToday {
  const split = today.whole;
  const days = week.buckets.map((b) => b.t);
  const daily = week.buckets.map((b) => b.split?.used);
  const typical = typicalDay(daily);
  const standout = standoutDay(daily, typical);
  const dayFraction = (now - localMidnight(now)) / 86_400_000;
  const deviceTypical = (id: string) => typicalDay(days.map((t) => week.at(id, t)));
  const leaves = setup.devices.filter((d) => d.children.length === 0);
  const leader = deviceRanking(split).filter((u) => u.node.children.length === 0)[0];

  const cards: EnergyCard[] = [];
  if (standout && typical) {
    const t = days[standout.index];
    const rose = risers(leaves, (id) => week.at(id, t), deviceTypical).slice(0, 2).map((r) => r.node.name);
    const dayCost = week.buckets[standout.index].cost;
    cards.push({
      tone: "caution",
      title: `${new Date(t).toLocaleDateString(locale, { weekday: "short" })}: ${standout.ratio.toFixed(1)}× usual`,
      detail: `${fmtKwh(daily[standout.index] ?? 0)} kWh${dayCost !== undefined && dayCost > 0 ? `, ${fmtMoney(dayCost, costUnit, locale)}` : ""}.`
        + (rose.length ? ` ${rose.join(" and ")} ran more than usual.` : " No device meter shows why."),
    });
  }
  if (leader && split.used > 0) {
    const typ = deviceTypical(leader.node.id);
    cards.push({
      tone: "neutral",
      title: `${leader.node.name} leads`,
      detail: `${fmtKwh(leader.kwh)} kWh today — ${share(leader.kwh, split.used)}% of the villa`
        + (typ ? ` (about ${fmtKwh(typ)} kWh on a typical day).` : "."),
    });
  }
  if (overlapShows(split)) {
    cards.push({
      tone: "caution",
      title: "Devices overlap the meter",
      detail: `They add up to ${fmtKwh(split.overlap)} kWh more than was used: some are set up beside the meter they are part of. Give them an upstream device in HA's Energy settings.`,
    });
  } else if (split.used > 0 && split.untracked / split.used > UNTRACKED_SHOWS) {
    cards.push({
      tone: "neutral",
      title: `${share(split.untracked, split.used)}% untracked`,
      detail: `${fmtKwh(split.untracked)} of today's ${fmtKwh(split.used)} kWh has no device meter in HA's Energy settings.`,
    });
  }
  return {
    split, cost: today.cost, daily,
    weekTotal: daily.reduce<number>((a, v) => a + (v ?? 0), 0),
    typical, standout,
    headline: todayHeadline(split.used, typical, dayFraction, clock),
    cards: cards.slice(0, MAX_CARDS),
  };
}

/** The history's four figures, each a label and its value ("—" for none). */
export function historyFigures(
  p: EnergyPeriod, unit: string, bucketLabel: (t: number) => string, costUnit: string | undefined, locale?: string,
): { label: string; value: string }[] {
  const b = p.busiest >= 0 ? p.buckets[p.busiest] : null;
  return [
    { label: "Energy", value: `${fmtKwh(p.whole.used)} kWh` },
    { label: "Cost", value: p.cost !== undefined ? fmtMoney(p.cost, costUnit, locale) : "—" },
    // Over the buckets WITH a reading: a missing hour is not a 0 kWh hour.
    { label: `Per ${unit}`, value: p.readyCount ? `${fmtKwh(p.whole.used / p.readyCount)} kWh` : "—" },
    { label: `Busiest ${unit}`, value: b?.split ? `${bucketLabel(b.t)} · ${fmtKwh(b.split.used)}` : "—" },
  ];
}
