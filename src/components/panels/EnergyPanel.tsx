// src/components/panels/EnergyPanel.tsx
// The villa's energy, opened from the summary bar's Energy tile — as agreed
// with the owner on the design canvas (2026-09-26, boards 6 and 7):
//   * NOW — today against a typical day, three observations, hour by hour, the
//     last seven days, and where today's energy went (grid → HA's devices);
//   * HISTORY AND TRENDS — a day, week, month or year: energy by device, cost,
//     and every device ranked.
//
// ⚠️ EVERY NUMBER IS HOME ASSISTANT'S ENERGY DASHBOARD'S OWN. Its setup, its
// cost and the recorder's per-period kWh are read on each open (HAEnergyAPI);
// nothing is configured in VESTA, so a change in HA's Energy settings shows
// here the next time the window opens. The words: config/energyModel.ts.
// No Energy dashboard in HA: the bar's old device list opens instead.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, LineChart, Zap } from "lucide-react";
import BasePanel from "./BasePanel";
import { List, PieChart } from "lucide-react";
import { flowTree, flowLayout, energySlices, sliceTurns, legendPage, deviceColours, UNTRACKED_CLS, type FlowNode } from "@/config/energyFlow";
import { useConfig } from "@/config/ConfigContext";
import { resolveSiteTitle } from "@/config/AppConfig";
import { useSegmentedChoice } from "./historyRange";
import ChartTip from "./ChartTip";
import BarChart from "./BarChart";
import { Figure, ObservationCards, type ObservationCard } from "./WindowPieces";
import type { BarSeg } from "@/utils/barChart";
import { fmtChartTime } from "./chartUtils";
import { useHA } from "@/ha/HAStateStore";
import { useHistory } from "@/hooks/useHistory";
import { fetchEnergySetup, fetchEnergyPeriod, type EnergyWindowSetup } from "@/ha/HAEnergyAPI";
import type { HistorySeries } from "@/types/ha.types";
import { PERIOD_MS, type StatisticsPeriod } from "@/utils/statisticsSeries";
import { localMidnight } from "@/utils/localDay";
import {
  energyPeriod, periodStarts, deviceRanking, typicalDay, todayHeadline, standoutDay, risers, fmtKwh, fmtMoney, fmtPower, powerKw,
  type EnergyBucket, type EnergyPeriodKind, type EnergySplit, type NodeUse,
} from "@/config/energyModel";

type View = "now" | "history";
const DAY = 86_400_000;

const weekday = (t: number) => new Date(t).toLocaleDateString([], { weekday: "short" });

export default function EnergyPanel({ onClose, fallback }: { onClose: () => void; fallback: () => ReactNode }) {
  const { ws, entities, haConfig } = useHA();
  const { config } = useConfig();
  // The house the flow starts from: the name the kiosk's own title shows.
  const house = resolveSiteTitle(config, haConfig?.location_name);
  const [view, setView] = useState<View>("now");
  // The period picker lives in the HEADER on the history screen, as the
  // Weather window's does — the same control (useSegmentedChoice).
  const { key: range, picker } = useSegmentedChoice(RANGE_OPTIONS, "week", "Period", "weather-ranges");
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => { topRef.current?.closest(".panel-body")?.scrollTo({ top: 0 }); }, [view]);
  // A statistic's name: the device's own name in HA's Energy settings, else its
  // entity's, without the trailing "energy" every one of them carries.
  const nameOf = (id: string) =>
    String(entities[id]?.attributes.friendly_name ?? id).replace(/\s+energy$/i, "");
  const { data: setup, status } = useHistory<EnergyWindowSetup | null>(
    "energy-setup", () => fetchEnergySetup(ws, nameOf), null);
  // Every device's colour, once, from HA's setup (energyFlow.deviceColours).
  const colourOf = useMemo(() => (setup ? deviceColours(setup) : () => UNTRACKED_CLS), [setup]);
  if (status === "ready" && setup === null) return <>{fallback()}</>;
  const costUnit = setup?.gridIn.map((id) => setup.costOf[id]).filter(Boolean)
    .map((c) => String(entities[c]?.attributes.unit_of_measurement ?? ""))[0];

  const back = (
    <button type="button" className="weather-back" onClick={() => setView("now")} aria-label="Back to Energy">
      <ChevronLeft size={22} />
    </button>
  );
  return (
    <BasePanel
      title={view === "now" ? "Energy" : "History and trends"}
      icon={view === "now" ? <Zap size={22} /> : back}
      className="summary-group-modal weather-modal energy-modal"
      history={false}
      onClose={onClose}
      headerActions={view === "now" ? <span className="weather-live">Home Assistant Energy</span> : picker}
      footerLeading={view === "now" && (
        <button type="button" className="btn ghost" onClick={() => setView("history")}>
          <LineChart size={18} /> History and trends
        </button>
      )}
    >
      <div ref={topRef} />
      {!setup
        ? <div className="state-timeline-skeleton weather-chart" />
        : view === "now"
          ? <NowView setup={setup} costUnit={costUnit} house={house} colourOf={colourOf} />
          : <HistoryView setup={setup} costUnit={costUnit} range={range} colourOf={colourOf} />}
    </BasePanel>
  );
}

// ── Now ──────────────────────────────────────────────────────────────────

/** Live kW of a device from its power statistic's entity, if HA has one. */
function useRateKw() {
  const { entities } = useHA();
  return (rateId: string | null): number | undefined => {
    const e = rateId ? entities[rateId] : undefined;
    return e ? powerKw(e.state, e.attributes.unit_of_measurement as string | undefined) : undefined;
  };
}

function NowView({ setup, costUnit, house, colourOf }: { setup: EnergyWindowSetup; costUnit: string | undefined; house: string; colourOf: (id: string) => string }) {
  const { ws } = useHA();
  const now = Date.now();
  const today = localMidnight(now), weekAgo = localMidnight(now, -7);
  // Refreshed every five minutes while open: the recorder writes hourly
  // buckets, so a faster refresh would fetch the same numbers.
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 300_000); return () => clearInterval(t); }, []);
  const { data, status } = useHistory<{ hourly: Record<string, HistorySeries>; daily: Record<string, HistorySeries> } | null>(
    `energy-now|${today}|${tick}`,
    async () => {
      const [hourly, daily] = await Promise.all([
        fetchEnergyPeriod(ws, setup, today, "hour"),
        fetchEnergyPeriod(ws, setup, weekAgo, "day"),
      ]);
      return { hourly, daily };
    },
    null,
  );
  const rateKw = useRateKw();
  if (!data) return <div className="muted body-text weather-chart-empty">{status === "failed" ? "Couldn't load Home Assistant's energy." : "Loading…"}</div>;

  // The period's sums, bucket by bucket, are energyModel's: an hour the
  // recorder has no reading for is MISSING there, never 0 kWh.
  const hours = periodStarts("hoursToday", now);
  const days = periodStarts("last7Complete", now);
  const todayP = energyPeriod(setup, data.hourly, hours, PERIOD_MS.hour, now);
  const weekP = energyPeriod(setup, data.daily, days, PERIOD_MS.day, now);
  const split = todayP.whole;
  const cost = todayP.cost;
  const daily = weekP.buckets.map((b) => b.split?.used);
  const typical = typicalDay(daily);
  const standout = standoutDay(daily, typical);
  const dayFraction = (now - today) / DAY;
  const clock = fmtChartTime(now);

  // Per-device typical and stand-out day, for the stand-out card's "what rose".
  const deviceTypical = (id: string) => typicalDay(days.map((t) => weekP.at(id, t)));
  const leafDevices = setup.devices.filter((d) => d.children.length === 0);
  const leader = deviceRanking(split).filter((u) => u.node.children.length === 0)[0];

  const cards: ObservationCard[] = [];
  if (standout && typical) {
    const t = days[standout.index];
    const rose = risers(leafDevices, (id) => weekP.at(id, t), deviceTypical).slice(0, 2).map((r) => r.node.name);
    const dayCost = weekP.buckets[standout.index].cost;
    cards.push({
      tone: "caution",
      title: `${weekday(t)}: ${standout.ratio.toFixed(1)}× usual`,
      detail: `${fmtKwh(daily[standout.index] ?? 0)} kWh${dayCost !== undefined && dayCost > 0 ? `, ${fmtMoney(dayCost, costUnit)}` : ""}.`
        + (rose.length ? ` ${rose.join(" and ")} ran more than usual.` : " No device meter shows why."),
    });
  }
  if (leader && split.used > 0) {
    const typ = deviceTypical(leader.node.id);
    cards.push({
      tone: "neutral",
      title: `${leader.node.name} leads`,
      detail: `${fmtKwh(leader.kwh)} kWh today — ${Math.round((leader.kwh / split.used) * 100)}% of the villa`
        + (typ ? ` (about ${fmtKwh(typ)} kWh on a typical day).` : "."),
    });
  }
  if (split.used > 0 && split.overlap > split.used * 0.05) {
    cards.push({
      tone: "caution",
      title: "Devices overlap the meter",
      detail: `They add up to ${fmtKwh(split.overlap)} kWh more than was used: some are set up beside the meter they are part of. Give them an upstream device in HA's Energy settings.`,
    });
  } else if (split.used > 0 && split.untracked / split.used > 0.25) {
    cards.push({
      tone: "neutral",
      title: `${Math.round((split.untracked / split.used) * 100)}% untracked`,
      detail: `${fmtKwh(split.untracked)} of today's ${fmtKwh(split.used)} kWh has no device meter in HA's Energy settings.`,
    });
  }

  return (
    <div className="weather-now energy-now">
      <div className="weather-feels">
        <div>
          <div className="weather-eyebrow">Today so far</div>
          <div className="weather-headline">{todayHeadline(split.used, typical, dayFraction, clock)}</div>
        </div>
        <div className="energy-hero">
          <div className="weather-big">{fmtKwh(split.used)}</div>
          <div className="energy-hero-sub">kWh{cost !== undefined ? ` · ${fmtMoney(cost, costUnit)}` : ""}</div>
        </div>
      </div>

      <ObservationCards cards={cards.slice(0, 3)} />

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head"><div className="weather-eyebrow">Today, hour by hour</div><div className="weather-legend">kWh per hour</div></div>
        <BarChart label="Energy used today, hour by hour" fmt={kwh} unit="kWh"
          buckets={todayP.buckets.map((b) => ({ t: b.t, segs: segsOf(b, () => [{ key: "used", label: "Used", v: b.split!.used, cls: "e-used" }]) }))}
          stamp={(t) => `${fmtChartTime(t)}–${fmtChartTime(t + 3_600_000)}`}
          ticks={[0, 6, 12, 18, 23].map((i) => ({ i, label: fmtChartTime(hours[i]) }))}
        />
      </div>

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head">
          <div className="weather-eyebrow">Last 7 days</div>
          <div className="weather-legend">{fmtKwh(daily.reduce<number>((a, v) => a + (v ?? 0), 0))} kWh{typical ? ` · typical day ${fmtKwh(typical)}` : ""}</div>
        </div>
        <BarChart label="Energy used, the last seven days" fmt={kwh} unit="kWh"
          buckets={weekP.buckets.map((b, i) => ({ t: b.t, segs: segsOf(b, () => [{ key: "used", label: "Used", v: b.split!.used, cls: standout?.index === i ? "e-standout" : "e-used" }]) }))}
          stamp={(t) => new Date(t).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}
          ticks={days.map((t, i) => ({ i, label: weekday(t) }))} typical={typical}
        />
      </div>

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head">
          <div className="weather-eyebrow">Where today&apos;s {fmtKwh(split.used)} kWh went</div>
          <div className="weather-legend">kWh today · now</div>
        </div>
        <Flow split={split} rateKw={rateKw} house={house} colourOf={colourOf} />
        {split.used > 0 && split.overlap > split.used * 0.05 && (
          <div className="energy-note">The devices add up to more than the grid meter: some are set up beside the meter they belong to. In Home Assistant&apos;s Energy settings, set each one&apos;s upstream device.</div>
        )}
      </div>
    </div>
  );
}

/** Where a period's energy went, as Home Assistant's Energy dashboard draws
 *  it (owner, 2026-09-26): the house, each top-level device, the devices
 *  inside each, and at every level what no device accounts for. The tree and
 *  its layout are config/energyFlow's; this draws them. A phone gets the same
 *  tree as rows — the diagram's text would be 7 px. */
export function Flow({ split, rateKw, house, colourOf }: { split: EnergySplit; rateKw: (id: string | null) => number | undefined; house: string; colourOf: (id: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const tree = flowTree(split, house, colourOf);
  if (tree.children.length === 0) return <div className="muted body-text">Nothing recorded yet today.</div>;
  const L = flowLayout(tree);
  const { W, H, nodeW } = L;
  const colRight = (d: number) => Math.min(W, ...L.boxes.filter((b) => b.depth === d + 1).map((b) => b.x), W);
  const now = (id: string | null) => { const kw = rateKw(id); return kw === undefined ? "" : `${fmtPower(kw)} now`; };
  const nowKw = split.roots.reduce<number | undefined>((a, r) => {
    const k = rateKw(r.node.rateId); return k === undefined ? a : (a ?? 0) + k;
  }, undefined);
  const nowOf = (n: FlowNode) => (n.kind === "house" ? (nowKw === undefined ? "" : `${fmtPower(nowKw)} now`) : n.kind === "device" ? now(n.rateId) : "");
  const hb = hover === null ? null : L.boxes[hover];
  return (
    <>
    <div className="energy-flow-list">
      {L.boxes.map((b) => (
        <div key={`r${b.node.id}`} className={`energy-flow-row${b.depth === 0 ? " grid" : ""}`} style={{ marginLeft: b.depth * 12 }}>
          {b.depth > 0 && <i className={b.node.cls} style={{ width: `${Math.max(2, (b.node.kwh / tree.kwh) * 100)}%` }} />}
          <b>{b.node.label}</b>
          <span>{fmtKwh(b.node.kwh)} kWh{nowOf(b.node) ? ` · ${nowOf(b.node)}` : ""}</span>
        </div>
      ))}
    </div>
    <div className="spark-wrap energy-flow-wrap" onPointerLeave={() => setHover(null)}>
    <svg className="energy-flow" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Where the energy went: ${house}, then each device`}>
      {L.links.map((k) => {
        const x0 = k.from.x + nodeW, x1 = k.to.x, mx = (x0 + x1) / 2;
        const on = hb !== null && (hb.node === k.to.node || hb.node === k.from.node);
        return <path key={`l${k.to.node.id}`} className={`energy-band ${k.to.node.cls}${on ? " hover" : ""}`}
          d={`M${x0} ${k.sy} C ${mx} ${k.sy}, ${mx} ${k.dy}, ${x1} ${k.dy} L ${x1} ${k.dy + k.w} C ${mx} ${k.dy + k.w}, ${mx} ${k.sy + k.w}, ${x0} ${k.sy + k.w} Z`} />;
      })}
      {L.boxes.map((b, i) => {
        const slotH = Math.max(b.h, 20);
        return (
          <g key={`n${b.node.id}`} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
            {/* The whole row beside the bar answers the pointer, not only the bar. */}
            <rect x={b.x} y={b.y} width={colRight(b.depth) - b.x} height={slotH} className="energy-hit" />
            <rect x={b.x} y={b.y} width={nodeW} height={b.h} rx="3" className={`energy-node ${b.node.cls}`} />
            {/* Name and kWh only, as HA's diagram: a middle column's label
                runs over the links, and "now" beside it ran into the next
                column's names. The power "now" is in the tooltip and the
                phone rows. */}
            <text x={b.x + nodeW + 8} y={b.y + slotH / 2 + 4.5} className="energy-flow-name">{b.node.label} · {fmtKwh(b.node.kwh)} kWh</text>
          </g>
        );
      })}
    </svg>
    {hb && (() => {
      const n = hb.node;
      const pct = tree.kwh > 0 ? Math.round((n.kwh / tree.kwh) * 100) : 0;
      const sub = nowOf(n);
      const rows = [
        { key: "t", text: `${n.label} · ${fmtKwh(n.kwh)} kWh` },
        ...(n.kind !== "house" ? [{ key: "p", text: `${pct}% of the ${fmtKwh(tree.kwh)} kWh used` }] : []),
        ...(sub ? [{ key: "n", text: sub }] : []),
        ...n.members.slice(0, 8).map((m, k) => ({ key: `m${k}`, text: `↳ ${m.label} ${fmtKwh(m.kwh)} kWh` })),
        ...(n.members.length > 8 ? [{ key: "more", text: `↳ ${n.members.length - 8} more` }] : []),
        ...(n.kind === "untracked" ? [{ key: "x", text: "no device meter in Home Assistant accounts for it" }] : []),
      ];
      return <ChartTip x={(hb.x + nodeW + 8) / W} y={(hb.y + Math.max(hb.h, 20)) / H} stamp="today so far" rows={rows} />;
    })()}
    </div>
    </>
  );
}

/** Every device as HA's "Individual devices" pie: the devices with nothing
 *  inside them, each parent's own untracked part and what no device accounts
 *  for — slices that add up to what was used (config/energyFlow). */
export function DevicePie({ split, colourOf }: { split: EnergySplit; colourOf: (id: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const slices = energySlices(split, colourOf);
  const total = slices.reduce((a, s) => a + s.kwh, 0);
  if (!slices.length) return <div className="muted body-text">Nothing recorded.</div>;
  const turns = sliceTurns(slices.map((s) => s.kwh));
  const cls = (i: number) => slices[i].cls;
  const R0 = 58, R1 = 92, C = 100;
  const pt = (f: number, r: number) => { const a = f * 2 * Math.PI - Math.PI / 2; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (from: number, to: number): string => {
    // A single slice is the whole ring: two halves, since one arc cannot close.
    if (to - from >= 0.9999) return `${arc(0, 0.5)} ${arc(0.5, 1)}`;
    const [x0, y0] = pt(from, R1), [x1, y1] = pt(to, R1), [x2, y2] = pt(to, R0), [x3, y3] = pt(from, R0);
    const big = to - from > 0.5 ? 1 : 0;
    return `M${x0} ${y0} A${R1} ${R1} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${R0} ${R0} 0 ${big} 0 ${x3} ${y3} Z`;
  };
  const pg = legendPage(slices.length, page);
  const hs = hover === null ? null : slices[hover];
  const mid = hover === null ? 0 : (turns[hover].from + turns[hover].to) / 2;
  const [tx, ty] = pt(mid, R1);
  return (
    <div className="energy-pie">
      <div className="spark-wrap energy-pie-wrap" onPointerLeave={() => setHover(null)}>
        <svg className="energy-pie-svg" viewBox="0 0 200 200" role="img" aria-label="Every device's share">
          {slices.map((s, i) => (
            <path key={s.id} d={arc(turns[i].from, turns[i].to)} className={`energy-slice ${cls(i)}${hover === i ? " hover" : ""}`}
              onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
          ))}
          <text x={C} y={C - 4} className="energy-pie-total-l">Total</text>
          <text x={C} y={C + 16} className="energy-pie-total-v">{fmtKwh(total)} kWh</text>
        </svg>
        {hs && <ChartTip x={tx / 200} y={ty / 200} rows={[{ key: "s", marker: <i className={`key ${cls(hover!)}`} />, text: `${hs.label} · ${fmtKwh(hs.kwh)} kWh` }]}
          stamp={`${total > 0 ? Math.round((hs.kwh / total) * 100) : 0}% of ${fmtKwh(total)} kWh`} />}
      </div>
      {/* Ten devices a page (legendPage); the pie keeps every slice. */}
      <div className="energy-pie-side">
        <div className="energy-pie-legend">
          {slices.slice(pg.from, pg.to).map((s, k) => {
            const i = pg.from + k;
            return (
              <span key={s.id} className={hover === i ? "hover" : ""} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <i className={`key ${cls(i)}`} />{s.label}<b>{fmtKwh(s.kwh)} kWh</b>
              </span>
            );
          })}
        </div>
        {pg.pages > 1 && (
          <div className="energy-pie-pages">
            <button type="button" className="btn ghost" disabled={pg.page === 0} onClick={() => setPage(pg.page - 1)} aria-label="Previous devices"><ChevronLeft size={18} /></button>
            <span>{pg.from + 1}–{pg.to} of {slices.length}</span>
            <button type="button" className="btn ghost" disabled={pg.page === pg.pages - 1} onClick={() => setPage(pg.page + 1)} aria-label="Next devices"><ChevronRight size={18} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A bucket's bar: its segments once ready; nothing yet while pending; and an
 *  outage band where the recorder has no reading — never a bar of 0
 *  (energyModel.energyPeriod, utils/barChart). */
function segsOf(b: EnergyBucket, ready: () => BarSeg[]): BarSeg[] | null {
  return b.state === "ready" ? ready() : b.state === "pending" ? [] : null;
}
const kwh = (v: number) => `${fmtKwh(v)} kWh`;

// ── History and trends ───────────────────────────────────────────────────

type RangeKey = "day" | "week" | "month" | "year";
const RANGES: Record<RangeKey, { label: string; period: StatisticsPeriod }> = {
  day: { label: "Day", period: "hour" },
  week: { label: "Week", period: "day" },
  month: { label: "Month", period: "day" },
  year: { label: "Year", period: "month" },
};
const RANGE_OPTIONS = (Object.keys(RANGES) as RangeKey[]).map((key) => ({ key, label: RANGES[key].label }));
/** The buckets each range shows (energyModel.periodStarts). */
const KIND: Record<RangeKey, EnergyPeriodKind> = { day: "hoursToday", week: "last7", month: "last30", year: "last12Months" };

const SHAPES = [
  { key: "list" as const, label: <List size={16} />, title: "As a list" },
  { key: "pie" as const, label: <PieChart size={16} />, title: "As a pie" },
];

function HistoryView({ setup, costUnit, range, colourOf }: { setup: EnergyWindowSetup; costUnit: string | undefined; range: RangeKey; colourOf: (id: string) => string }) {
  const { ws } = useHA();
  // Every device as a list or as HA's pie — the app's one segmented control.
  const { key: shape, picker: shapePicker } = useSegmentedChoice(SHAPES, "list", "Show every device as", "energy-shape");
  const now = Date.now();
  const starts = periodStarts(KIND[range], now);
  const { data, status } = useHistory<Record<string, HistorySeries> | null>(
    `energy-history|${range}|${starts[0]}`,
    () => fetchEnergyPeriod(ws, setup, starts[0], RANGES[range].period),
    null,
  );
  if (!data) {
    return (
      <div className="weather-history">
        <div className="muted body-text weather-chart-empty">{status === "failed" ? "Couldn't load Home Assistant's energy." : "Loading…"}</div>
      </div>
    );
  }
  const p = energyPeriod(setup, data, starts, PERIOD_MS[RANGES[range].period], now);
  const whole = p.whole;
  const costs = p.buckets.map((b) => b.cost);
  const hasCost = p.cost !== undefined;
  const costTotal = p.cost ?? 0;
  const busiest = p.busiest;
  const unit = range === "day" ? "hour" : range === "year" ? "month" : "day";
  const label = (t: number) => range === "day" ? fmtChartTime(t)
    : range === "year" ? new Date(t).toLocaleDateString([], { month: "short" })
    : new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric" });
  const tickIdx = range === "day" ? [0, 6, 12, 18, 23] : range === "month" ? [0, 7, 14, 21, 29] : starts.map((_, i) => i);
  const roots = whole.roots.filter((r) => r.kwh > 0.005);
  const series = [...roots.map((r) => ({ id: r.node.id, label: r.node.name, cls: colourOf(r.node.id) })), { id: "_u", label: "Untracked", cls: UNTRACKED_CLS }];
  const rank = deviceRanking(whole).filter((u) => u.kwh > 0.005);

  return (
    <div className="weather-history">
      <div className="weather-figures">
        <Figure label="Energy" value={`${fmtKwh(whole.used)} kWh`} />
        <Figure label="Cost" value={hasCost ? fmtMoney(costTotal, costUnit) : "—"} />
        <Figure label={`Per ${unit}`} value={p.readyCount ? `${fmtKwh(whole.used / p.readyCount)} kWh` : "—"} />
        <Figure label={`Busiest ${unit}`} value={busiest >= 0 ? `${label(starts[busiest])} · ${fmtKwh(p.buckets[busiest].split!.used)}` : "—"} />
      </div>

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head">
          <div className="weather-eyebrow">{hasCost ? `Energy and cost per ${unit}` : "Energy used, by device"}</div>
          <div className="weather-legend">
            {series.map((s) => <span key={s.id}><i className={`key ${s.cls}`} />{s.label}</span>)}
            {hasCost && <span><i className="key cost line" />Cost · {fmtMoney(costTotal, costUnit)}</span>}
          </div>
        </div>
        {/* ONE chart for the energy and what it cost (owner, 2026-09-26): the
            devices stacked in kWh on the left axis, the cost plotted over them
            on its own right axis, both in one tooltip. */}
        <BarChart label={hasCost ? `Energy and cost per ${unit}` : "Energy used, by device"} height={220} fmt={kwh} unit="kWh"
          line={hasCost ? { values: p.buckets.map((b, i) => (b.state === "pending" ? undefined : costs[i])), label: "Cost", cls: "cost", unit: costUnit, fmt: (v) => fmtMoney(v, costUnit) } : undefined}
          buckets={p.buckets.map((b) => ({
            t: b.t,
            segs: segsOf(b, () => [
              ...roots.map((r) => {
                const u = b.split!.roots.find((x) => x.node.id === r.node.id);
                return { key: r.node.id, label: r.node.name, v: u?.kwh ?? 0, cls: colourOf(r.node.id) };
              }),
              { key: "_u", label: "Untracked", v: b.split!.untracked, cls: UNTRACKED_CLS },
            ]),
          }))}
          stamp={(t) => label(t)} ticks={tickIdx.map((i) => ({ i, label: label(starts[i]) }))} />
      </div>

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head">
          <div className="weather-eyebrow">Every device</div>
          <div className="energy-rank-tools">
            {shape === "list" && <span className="weather-legend">share of {fmtKwh(whole.used)} kWh</span>}
            {shapePicker}
          </div>
        </div>
        {shape === "pie"
          ? <DevicePie split={whole} colourOf={colourOf} />
          : (
            <div className="energy-rank">
              {rank.map((u) => <RankRow key={u.node.id} u={u} of={Math.max(whole.used, rank[0]?.kwh ?? 0)} used={whole.used} />)}
              {whole.untracked > 0.005 && <RankRow u={null} kwh={whole.untracked} of={Math.max(whole.used, rank[0]?.kwh ?? 0)} used={whole.used} />}
            </div>
          )}
      </div>
    </div>
  );
}

function RankRow({ u, kwh, of, used }: { u: NodeUse | null; kwh?: number; of: number; used: number }) {
  const v = u ? u.kwh : kwh ?? 0;
  return (
    <>
      <span className={u ? "" : "muted"}>{u ? u.node.name : "Untracked"}</span>
      <span className="energy-rank-bar"><i style={{ width: `${Math.max(1, (v / Math.max(1e-6, of)) * 100)}%` }} className={u ? "" : UNTRACKED_CLS} /></span>
      <b>{fmtKwh(v)} kWh</b>
      <span className="muted">{used > 0 ? `${Math.round((v / used) * 100)}%` : ""}</span>
    </>
  );
}
