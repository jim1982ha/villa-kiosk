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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, LineChart, Zap } from "lucide-react";
import BasePanel from "./BasePanel";
import ChartTip from "./ChartTip";
import BarChart from "./BarChart";
import type { BarSeg } from "@/utils/barChart";
import { fmtChartTime } from "./chartUtils";
import { useHA } from "@/ha/HAStateStore";
import { useHistory } from "@/hooks/useHistory";
import { fetchEnergySetup, fetchEnergyPeriod, type EnergyWindowSetup } from "@/ha/HAEnergyAPI";
import type { HistorySeries } from "@/types/ha.types";
import { PERIOD_MS, type StatisticsPeriod } from "@/utils/statisticsSeries";
import { localMidnight } from "@/utils/localDay";
import {
  energyPeriod, periodStarts, deviceRanking, typicalDay, todayHeadline, standoutDay, risers, fmtKwh, fmtMoney,
  type EnergyBucket, type EnergyPeriodKind, type EnergySplit, type NodeUse,
} from "@/config/energyModel";

type View = "now" | "history";
const DAY = 86_400_000;

const weekday = (t: number) => new Date(t).toLocaleDateString([], { weekday: "short" });

export default function EnergyPanel({ onClose, fallback }: { onClose: () => void; fallback: () => ReactNode }) {
  const { ws, entities } = useHA();
  const [view, setView] = useState<View>("now");
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => { topRef.current?.closest(".panel-body")?.scrollTo({ top: 0 }); }, [view]);
  // A statistic's name: the device's own name in HA's Energy settings, else its
  // entity's, without the trailing "energy" every one of them carries.
  const nameOf = (id: string) =>
    String(entities[id]?.attributes.friendly_name ?? id).replace(/\s+energy$/i, "");
  const { data: setup, status } = useHistory<EnergyWindowSetup | null>(
    "energy-setup", () => fetchEnergySetup(ws, nameOf), null);
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
      headerActions={view === "now" ? <span className="weather-live">Home Assistant Energy</span> : undefined}
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
          ? <NowView setup={setup} costUnit={costUnit} />
          : <HistoryView setup={setup} costUnit={costUnit} />}
    </BasePanel>
  );
}

// ── Now ──────────────────────────────────────────────────────────────────

/** Live kW of a device from its power statistic's entity, if HA has one. */
function useRateKw() {
  const { entities } = useHA();
  return (rateId: string | null): number | undefined => {
    if (!rateId) return undefined;
    const e = entities[rateId];
    const v = e ? Number(e.state) : NaN;
    if (!Number.isFinite(v)) return undefined;
    const u = String(e?.attributes.unit_of_measurement ?? "W").toLowerCase();
    return u === "kw" ? v : u === "mw" ? v * 1000 : v / 1000;
  };
}

function NowView({ setup, costUnit }: { setup: EnergyWindowSetup; costUnit: string | undefined }) {
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

  const cards: { tone: "good" | "caution" | "neutral"; title: string; detail: string }[] = [];
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

      {cards.length > 0 && (
        <div className="weather-advice">
          {cards.slice(0, 3).map((a) => (
            <div key={a.title} className={`weather-advice-card tone-${a.tone}`}>
              <div className="weather-advice-title"><span className="weather-advice-mark" aria-hidden="true">{a.tone === "good" ? "✓" : a.tone === "neutral" ? "·" : "!"}</span>{a.title}</div>
              <div className="weather-advice-detail">{a.detail}</div>
            </div>
          ))}
        </div>
      )}

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
        <Flow split={split} rateKw={rateKw} />
        {split.used > 0 && split.overlap > split.used * 0.05 && (
          <div className="energy-note">The devices add up to more than the grid meter: some are set up beside the meter they belong to. In Home Assistant&apos;s Energy settings, set each one&apos;s upstream device.</div>
        )}
      </div>
    </div>
  );
}

/** Where a period's energy went, as HA's dashboard models it: the grid (and
 *  solar) on the left, each top-level device a band sized by its kWh, what it
 *  contains named beside it, and what no device accounts for. */
function Flow({ split, rateKw }: { split: EnergySplit; rateKw: (id: string | null) => number | undefined }) {
  // The band under the pointer (or the finger) — its tooltip says what the
  // one line of text beside it cannot: its share, and what is inside it.
  const [hover, setHover] = useState<number | null>(null);
  const rows = [...split.roots.filter((r) => r.kwh > 0.005), ...(split.untracked > 0.005 ? [null] : [])];
  if (!rows.length) return <div className="muted body-text">Nothing recorded yet today.</div>;
  const scaleTo = Math.max(split.used, split.roots.reduce((a, r) => a + r.kwh, 0) + split.untracked, 1e-6);
  // Half the height it was first drawn at (owner, 2026-09-26): one line of
  // text a device, the bands scaled to match.
  const BAR = 150, SLOT = 22, GAP = 4;
  const px = (kwh: number) => (kwh / scaleTo) * BAR;
  const W = 800; // room for a one-line label (name · kWh · now · inside)
  let srcY = 10, dstY = 4;
  const bands = rows.map((r, i) => {
    const kwh = r ? r.kwh : split.untracked;
    const h = Math.max(3, px(kwh));
    const band = { i, r, kwh, h, sy: srcY, dy: dstY };
    srcY += h;
    dstY += Math.max(h, SLOT) + GAP;
    return band;
  });
  const H = Math.max(dstY, BAR + 16);
  const gridH = px(split.used);
  const nowKw = split.roots.reduce<number | undefined>((a, r) => {
    const k = rateKw(r.node.rateId); return k === undefined ? a : (a ?? 0) + k;
  }, undefined);
  // A phone gets the same answer as rows — the flow's text would be 7 px.
  const list = (
    <div className="energy-flow-list">
      <div className="energy-flow-row grid"><b>Grid</b><span>{fmtKwh(split.used)} kWh{nowKw !== undefined ? ` · ${nowKw.toFixed(2)} kW now` : ""}</span></div>
      {bands.map((b) => {
        const kw = b.r ? rateKw(b.r.node.rateId) : undefined;
        return (
          <div key={`r${b.i}`} className="energy-flow-row">
            <i className={b.r ? `e-s${b.i % 6}` : "e-untracked"} style={{ width: `${Math.max(2, (b.kwh / scaleTo) * 100)}%` }} />
            <b>{b.r ? b.r.node.name : "Untracked"}</b>
            <span>{fmtKwh(b.kwh)} kWh{kw !== undefined ? ` · ${kw < 1 ? `${Math.round(kw * 1000)} W` : `${kw.toFixed(2)} kW`} now` : ""}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <>
    {list}
    <div className="spark-wrap energy-flow-wrap" onPointerLeave={() => setHover(null)}>
    <svg className="energy-flow" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Where the energy went: the grid, then each device">
      {bands.map((b) => {
        const x0 = 150, x1 = 340, sy0 = b.sy, sy1 = b.sy + b.h, dy0 = b.dy, dy1 = b.dy + b.h;
        return <path key={`b${b.i}`} className={`energy-band ${b.r ? `e-s${b.i % 6}` : "e-untracked"}${hover === b.i ? " hover" : ""}`}
          onPointerEnter={() => setHover(b.i)} onPointerDown={() => setHover(b.i)}
          d={`M${x0} ${sy0} C 250 ${sy0}, 250 ${dy0}, ${x1} ${dy0} L ${x1} ${dy1} C 250 ${dy1}, 250 ${sy1}, ${x0} ${sy1} Z`} />;
      })}
      <rect x="116" y="10" width="34" height={Math.max(3, gridH)} rx="6" className="energy-grid" />
      <text x="102" y={10 + gridH / 2 - 12} textAnchor="end" className="energy-flow-name">Grid</text>
      <text x="102" y={10 + gridH / 2 + 6} textAnchor="end" className="energy-flow-sub">{fmtKwh(split.used)} kWh</text>
      {nowKw !== undefined && <text x="102" y={10 + gridH / 2 + 22} textAnchor="end" className="energy-flow-sub">{nowKw.toFixed(2)} kW now</text>}
      {bands.map((b) => {
        const kw = b.r ? rateKw(b.r.node.rateId) : undefined;
        const inside = b.r?.children.filter((c) => c.kwh > 0.005) ?? [];
        const sub = [
          kw !== undefined ? `${kw < 1 ? `${Math.round(kw * 1000)} W` : `${kw.toFixed(2)} kW`} now` : "",
          inside.length ? `${inside.length === 1 ? inside[0].node.name : `${inside.length} devices`} ${fmtKwh(inside.reduce((a, c) => a + c.kwh, 0))}` : "",
        ].filter(Boolean).join(" · ");
        return (
          <g key={`l${b.i}`} onPointerEnter={() => setHover(b.i)} onPointerDown={() => setHover(b.i)}>
            {/* The whole row answers the pointer, not only the thin band. */}
            <rect x="340" y={b.dy} width={W - 340} height={Math.max(b.h, SLOT)} className="energy-hit" />
            <rect x="340" y={b.dy} width="14" height={b.h} rx="3" className={b.r ? `energy-node e-s${b.i % 6}` : "energy-node e-untracked"} />
            <text x="366" y={b.dy + Math.min(b.h, SLOT) / 2 + 5}>
              <tspan className="energy-flow-name">{b.r ? b.r.node.name : "Untracked"} · {fmtKwh(b.kwh)} kWh</tspan>
              <tspan className="energy-flow-sub" dx="8">{b.r ? sub : "no device meter in HA"}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
    {hover !== null && bands[hover] && (() => {
      const b = bands[hover];
      const u = b.r;
      const kw = u ? rateKw(u.node.rateId) : undefined;
      const inside = u?.children.filter((c) => c.kwh > 0.005) ?? [];
      const pct = split.used > 0 ? Math.round((b.kwh / split.used) * 100) : 0;
      const rows = [
        { key: "t", text: `${u ? u.node.name : "Untracked"} · ${fmtKwh(b.kwh)} kWh` },
        { key: "p", text: `${pct}% of the ${fmtKwh(split.used)} kWh used` },
        ...(kw !== undefined ? [{ key: "n", text: `${kw < 1 ? `${Math.round(kw * 1000)} W` : `${kw.toFixed(2)} kW`} now` }] : []),
        ...inside.slice(0, 6).map((c) => ({ key: c.node.id, text: `↳ ${c.node.name} ${fmtKwh(c.kwh)} kWh` })),
        ...(inside.length > 6 ? [{ key: "more", text: `↳ ${inside.length - 6} more ${fmtKwh(inside.slice(6).reduce((a, c) => a + c.kwh, 0))} kWh` }] : []),
        ...(u && inside.length && u.untracked > 0.005 ? [{ key: "u", text: `↳ not metered ${fmtKwh(u.untracked)} kWh` }] : []),
        ...(!u ? [{ key: "x", text: "no device meter in Home Assistant accounts for it" }] : []),
      ];
      return (
        <ChartTip x={366 / W} y={(b.dy + Math.max(b.h, SLOT)) / H} stamp="today so far" rows={rows} />
      );
    })()}
    </div>
    </>
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
/** The buckets each range shows (energyModel.periodStarts). */
const KIND: Record<RangeKey, EnergyPeriodKind> = { day: "hoursToday", week: "last7", month: "last30", year: "last12Months" };

function HistoryView({ setup, costUnit }: { setup: EnergyWindowSetup; costUnit: string | undefined }) {
  const { ws } = useHA();
  const [range, setRange] = useState<RangeKey>("week");
  const now = Date.now();
  const starts = periodStarts(KIND[range], now);
  const { data, status } = useHistory<Record<string, HistorySeries> | null>(
    `energy-history|${range}|${starts[0]}`,
    () => fetchEnergyPeriod(ws, setup, starts[0], RANGES[range].period),
    null,
  );
  const picker = (
    <div className="segmented weather-ranges" role="group" aria-label="Period">
      {(Object.keys(RANGES) as RangeKey[]).map((k) => (
        <button key={k} type="button" className={k === range ? "active" : ""} aria-pressed={k === range} onClick={() => setRange(k)}>{RANGES[k].label}</button>
      ))}
    </div>
  );
  if (!data) {
    return (
      <div className="weather-history">
        <div className="energy-history-head">{picker}</div>
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
  const series = [...roots.map((r, i) => ({ id: r.node.id, label: r.node.name, cls: `e-s${i % 6}` })), { id: "_u", label: "Untracked", cls: "e-untracked" }];
  const rank = deviceRanking(whole).filter((u) => u.kwh > 0.005);

  return (
    <div className="weather-history">
      <div className="energy-history-head">{picker}</div>
      <div className="weather-figures">
        <Figure label="Energy" value={`${fmtKwh(whole.used)} kWh`} />
        <Figure label="Cost" value={hasCost ? fmtMoney(costTotal, costUnit) : "—"} />
        <Figure label={`Per ${unit}`} value={p.readyCount ? `${fmtKwh(whole.used / p.readyCount)} kWh` : "—"} />
        <Figure label={`Busiest ${unit}`} value={busiest >= 0 ? `${label(starts[busiest])} · ${fmtKwh(p.buckets[busiest].split!.used)}` : "—"} />
      </div>

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head">
          <div className="weather-eyebrow">Energy used, by device</div>
          <div className="weather-legend">{series.map((s) => <span key={s.id}><i className={`key ${s.cls}`} />{s.label}</span>)}</div>
        </div>
        <BarChart label="Energy used, by device" height={220} fmt={kwh} unit="kWh"
          buckets={p.buckets.map((b) => ({
            t: b.t,
            segs: segsOf(b, () => [
              ...roots.map((r, k) => {
                const u = b.split!.roots.find((x) => x.node.id === r.node.id);
                return { key: r.node.id, label: r.node.name, v: u?.kwh ?? 0, cls: `e-s${k % 6}` };
              }),
              { key: "_u", label: "Untracked", v: b.split!.untracked, cls: "e-untracked" },
            ]),
          }))}
          stamp={(t) => label(t)} ticks={tickIdx.map((i) => ({ i, label: label(starts[i]) }))} />
      </div>

      {hasCost && (
        <div className="weather-tile chart energy-wide">
          <div className="weather-chart-head"><div className="weather-eyebrow">Cost per {unit}</div><div className="weather-legend">{fmtMoney(costTotal, costUnit)}</div></div>
          <BarChart label={`Cost per ${unit}`} height={120} fmt={(v) => fmtMoney(v, costUnit)} unit={costUnit}
            buckets={p.buckets.map((b, i) => ({ t: b.t, segs: b.state === "pending" ? [] : costs[i] === undefined ? null : [{ key: "cost", label: "Cost", v: costs[i]!, cls: "e-used" }] }))}
            stamp={(t) => label(t)} ticks={tickIdx.map((i) => ({ i, label: label(starts[i]) }))} />
        </div>
      )}

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head"><div className="weather-eyebrow">Every device</div><div className="weather-legend">share of {fmtKwh(whole.used)} kWh</div></div>
        <div className="energy-rank">
          {rank.map((u) => <RankRow key={u.node.id} u={u} of={Math.max(whole.used, rank[0]?.kwh ?? 0)} used={whole.used} />)}
          {whole.untracked > 0.005 && <RankRow u={null} kwh={whole.untracked} of={Math.max(whole.used, rank[0]?.kwh ?? 0)} used={whole.used} />}
        </div>
      </div>
    </div>
  );
}

function RankRow({ u, kwh, of, used }: { u: NodeUse | null; kwh?: number; of: number; used: number }) {
  const v = u ? u.kwh : kwh ?? 0;
  return (
    <>
      <span className={u ? "" : "muted"}>{u ? u.node.name : "Untracked"}</span>
      <span className="energy-rank-bar"><i style={{ width: `${Math.max(1, (v / Math.max(1e-6, of)) * 100)}%` }} className={u ? "" : "e-untracked"} /></span>
      <b>{fmtKwh(v)} kWh</b>
      <span className="muted">{used > 0 ? `${Math.round((v / used) * 100)}%` : ""}</span>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return <div className="weather-figure"><div className="weather-figure-l">{label}</div><div className="weather-figure-v">{value}</div></div>;
}
