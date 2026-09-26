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

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ChevronLeft, LineChart, Zap } from "lucide-react";
import BasePanel from "./BasePanel";
import ChartTip from "./ChartTip";
import { fmtChartTime } from "./chartUtils";
import { useHA } from "@/ha/HAStateStore";
import { useHistory } from "@/hooks/useHistory";
import { fetchEnergySetup, fetchEnergyPeriod, type EnergyWindowSetup } from "@/ha/HAEnergyAPI";
import type { HistorySeries } from "@/types/ha.types";
import type { StatisticsPeriod } from "@/utils/statisticsSeries";
import {
  energySplit, deviceRanking, typicalDay, todayHeadline, standoutDay, risers, fmtKwh, fmtMoney,
  type EnergySplit, type NodeUse,
} from "@/config/energyModel";

type View = "now" | "history";
const DAY = 86_400_000;

/** A statistic's per-bucket values keyed by bucket start. */
function byStart(s: HistorySeries | undefined): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of s?.points ?? []) m.set(p.t, (m.get(p.t) ?? 0) + p.v);
  return m;
}
function total(s: HistorySeries | undefined): number | undefined {
  return s && s.points.length ? s.points.reduce((a, p) => a + p.v, 0) : undefined;
}
function midnight(offsetDays = 0): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}
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
  const today = midnight(), weekAgo = midnight(-7);
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

  const todayOf = (id: string) => total(data.hourly[id]);
  const split = energySplit(setup, todayOf);
  const cost = setup.gridIn.reduce<number | undefined>((a, id) => {
    const c = setup.costOf[id] ? total(data.hourly[setup.costOf[id]]) : undefined;
    return c === undefined ? a : (a ?? 0) + c;
  }, undefined);

  // Hour by hour: used = import + solar − export, per bucket.
  const usedPerBucket = (src: Record<string, HistorySeries>, starts: number[]) => {
    const maps = { i: setup.gridIn.map((id) => byStart(src[id])), o: setup.gridOut.map((id) => byStart(src[id])), s: setup.solar.map((id) => byStart(src[id])) };
    return starts.map((t) => {
      const g = (ms: Map<number, number>[]) => ms.reduce((a, m) => a + (m.get(t) ?? 0), 0);
      return Math.max(0, g(maps.i) + g(maps.s) - g(maps.o));
    });
  };
  const hours = Array.from({ length: 24 }, (_, h) => today + h * 3_600_000);
  const nowH = new Date().getHours();
  const hourly = usedPerBucket(data.hourly, hours).map((v, h) => (h <= nowH ? v : undefined));

  // The last seven COMPLETE days — today is not one yet.
  const days = Array.from({ length: 7 }, (_, i) => weekAgo + i * DAY);
  const daily = usedPerBucket(data.daily, days);
  const typical = typicalDay(daily);
  const standout = standoutDay(daily, typical);
  const dayFraction = (Date.now() - today) / DAY;
  const clock = fmtChartTime(Date.now());

  // Per-device typical and stand-out day, for the stand-out card's "what rose".
  const deviceDay = (id: string, t: number) => byStart(data.daily[id]).get(t);
  const deviceTypical = (id: string) => typicalDay(days.map((t) => deviceDay(id, t) ?? 0));
  const leafDevices = setup.devices.filter((d) => d.children.length === 0);
  const leader = deviceRanking(split).filter((u) => u.node.children.length === 0)[0];

  const cards: { tone: "good" | "caution" | "neutral"; title: string; detail: string }[] = [];
  if (standout && typical) {
    const t = days[standout.index];
    const rose = risers(leafDevices, (id) => deviceDay(id, t), deviceTypical).slice(0, 2).map((r) => r.node.name);
    const dayCost = setup.gridIn.reduce((a, id) => a + (setup.costOf[id] ? deviceDay(setup.costOf[id], t) ?? 0 : 0), 0);
    cards.push({
      tone: "caution",
      title: `${weekday(t)}: ${standout.ratio.toFixed(1)}× usual`,
      detail: `${fmtKwh(daily[standout.index])} kWh${dayCost > 0 ? `, ${fmtMoney(dayCost, costUnit)}` : ""}.`
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
        <Bars
          buckets={hours.map((t, i) => ({ t, segs: hourly[i] === undefined ? [] : [{ key: "used", label: "Used", v: hourly[i]!, cls: "e-used" }] }))}
          stamp={(t) => `${fmtChartTime(t)}–${fmtChartTime(t + 3_600_000)}`}
          ticks={["00:00", "06:00", "12:00", "18:00", "24:00"]}
        />
      </div>

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head">
          <div className="weather-eyebrow">Last 7 days</div>
          <div className="weather-legend">{fmtKwh(daily.reduce((a, v) => a + v, 0))} kWh{typical ? ` · typical day ${fmtKwh(typical)}` : ""}</div>
        </div>
        <Bars
          buckets={days.map((t, i) => ({ t, segs: [{ key: "used", label: "Used", v: daily[i], cls: standout?.index === i ? "e-standout" : "e-used" }] }))}
          stamp={(t) => new Date(t).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}
          ticks={days.map(weekday)} typical={typical}
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
  const rows = [...split.roots.filter((r) => r.kwh > 0.005), ...(split.untracked > 0.005 ? [null] : [])];
  if (!rows.length) return <div className="muted body-text">Nothing recorded yet today.</div>;
  const scaleTo = Math.max(split.used, split.roots.reduce((a, r) => a + r.kwh, 0) + split.untracked, 1e-6);
  const BAR = 300, SLOT = 44, GAP = 8;
  const px = (kwh: number) => (kwh / scaleTo) * BAR;
  const W = 716;
  let srcY = 10, dstY = 4;
  const bands = rows.map((r, i) => {
    const kwh = r ? r.kwh : split.untracked;
    const h = Math.max(3, px(kwh));
    const band = { i, r, kwh, h, sy: srcY, dy: dstY };
    srcY += h;
    dstY += Math.max(h, SLOT) + GAP;
    return band;
  });
  const H = Math.max(dstY, BAR + 20);
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
    <svg className="energy-flow" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Where the energy went: the grid, then each device">
      {bands.map((b) => {
        const x0 = 150, x1 = 340, sy0 = b.sy, sy1 = b.sy + b.h, dy0 = b.dy, dy1 = b.dy + b.h;
        return <path key={`b${b.i}`} className={`energy-band ${b.r ? `e-s${b.i % 6}` : "e-untracked"}`}
          d={`M${x0} ${sy0} C 250 ${sy0}, 250 ${dy0}, ${x1} ${dy0} L ${x1} ${dy1} C 250 ${dy1}, 250 ${sy1}, ${x0} ${sy1} Z`} />;
      })}
      <rect x="116" y="10" width="34" height={Math.max(3, gridH)} rx="6" className="energy-grid" />
      <text x="102" y={10 + gridH / 2 - 10} textAnchor="end" className="energy-flow-name">Grid</text>
      <text x="102" y={10 + gridH / 2 + 10} textAnchor="end" className="energy-flow-sub">{fmtKwh(split.used)} kWh</text>
      {nowKw !== undefined && <text x="102" y={10 + gridH / 2 + 28} textAnchor="end" className="energy-flow-sub">{nowKw.toFixed(2)} kW now</text>}
      {bands.map((b) => {
        const kw = b.r ? rateKw(b.r.node.rateId) : undefined;
        const inside = b.r?.children.filter((c) => c.kwh > 0.005) ?? [];
        const sub = [
          kw !== undefined ? `${kw < 1 ? `${Math.round(kw * 1000)} W` : `${kw.toFixed(2)} kW`} now` : "",
          inside.length ? `${inside.length === 1 ? inside[0].node.name : `${inside.length} devices`} ${fmtKwh(inside.reduce((a, c) => a + c.kwh, 0))}` : "",
        ].filter(Boolean).join(" · ");
        return (
          <g key={`l${b.i}`}>
            <rect x="340" y={b.dy} width="14" height={b.h} rx="3" className={b.r ? `energy-node e-s${b.i % 6}` : "energy-node e-untracked"} />
            <text x="366" y={b.dy + 15} className="energy-flow-name">{b.r ? b.r.node.name : "Untracked"} · {fmtKwh(b.kwh)} kWh</text>
            {(sub || !b.r) && <text x="366" y={b.dy + 34} className="energy-flow-sub">{b.r ? sub : "no device meter in HA"}</text>}
          </g>
        );
      })}
    </svg>
    </>
  );
}

/** Stacked bars over buckets, with the app's tooltip. `typical` draws a line. */
function Bars({ buckets, stamp, ticks, typical, height = 150 }: {
  buckets: { t: number; segs: { key: string; label: string; v: number; cls: string }[] }[];
  stamp: (t: number) => string; ticks: string[]; typical?: number; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1e-6, typical ?? 0, ...buckets.map((b) => b.segs.reduce((a, s) => a + s.v, 0)));
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(buckets.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * buckets.length))));
  };
  const hb = hover === null ? null : buckets[hover];
  return (
    <div className="spark-wrap energy-bars-wrap">
      <div className="energy-bars" style={{ height, touchAction: "none" }}
        onPointerMove={at} onPointerDown={at} onPointerLeave={() => setHover(null)}>
        {typical !== undefined && <div className="energy-typical" style={{ bottom: `${(typical / max) * 100}%` }} />}
        {buckets.map((b, i) => (
          <div key={b.t} className={`energy-bar${hover === i ? " hover" : ""}`}>
            {b.segs.length === 0
              ? <div className="energy-seg e-none" />
              : b.segs.map((s) => <div key={s.key} className={`energy-seg ${s.cls}`} style={{ height: `${(s.v / max) * 100}%` }} />)}
          </div>
        ))}
      </div>
      {hb && hb.segs.length > 0 && (
        <ChartTip left={`${((hover! + 0.5) / buckets.length) * 100}%`} top={0} flip={hover! > buckets.length / 2}
          t={hb.t} spanHours={0} stampPrefix=""
          rows={[
            ...(hb.segs.length > 1 ? [{ key: "_t", text: `${fmtKwh(hb.segs.reduce((a, s) => a + s.v, 0))} kWh` }] : []),
            ...hb.segs.filter((s) => s.v > 0.005).map((s) => ({ key: s.key, marker: <i className={`key ${s.cls}`} />, text: `${s.label} ${fmtKwh(s.v)} kWh` })),
          ]}
          stamp={stamp(hb.t)} />
      )}
      <div className="weather-axis">{ticks.map((t, i) => <span key={`${t}${i}`}>{t}</span>)}</div>
    </div>
  );
}

// ── History and trends ───────────────────────────────────────────────────

type RangeKey = "day" | "week" | "month" | "year";
const RANGES: Record<RangeKey, { label: string; period: StatisticsPeriod }> = {
  day: { label: "Day", period: "hour" },
  week: { label: "Week", period: "day" },
  month: { label: "Month", period: "day" },
  year: { label: "Year", period: "month" },
};
/** The buckets a range shows, oldest first: today's hours; the last 7 or 30
 *  days (today included); the last 12 calendar months. */
function bucketsOf(range: RangeKey): number[] {
  if (range === "day") return Array.from({ length: 24 }, (_, h) => midnight() + h * 3_600_000);
  if (range === "week" || range === "month") {
    const n = range === "week" ? 7 : 30;
    return Array.from({ length: n }, (_, i) => midnight(i - (n - 1)));
  }
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1);
  return Array.from({ length: 12 }, (_, i) => new Date(d.getFullYear(), d.getMonth() - (11 - i), 1).getTime());
}

function HistoryView({ setup, costUnit }: { setup: EnergyWindowSetup; costUnit: string | undefined }) {
  const { ws } = useHA();
  const [range, setRange] = useState<RangeKey>("week");
  const starts = bucketsOf(range);
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
  const maps = new Map(Object.entries(data).map(([id, s]) => [id, byStart(s)]));
  const at = (id: string, t: number) => maps.get(id)?.get(t);
  const perBucket = starts.map((t) => energySplit(setup, (id) => at(id, t)));
  const whole = energySplit(setup, (id) => total(data[id]));
  const costs = starts.map((t) => setup.gridIn.reduce((a, id) => a + (setup.costOf[id] ? at(setup.costOf[id], t) ?? 0 : 0), 0));
  const hasCost = setup.gridIn.some((id) => setup.costOf[id] && data[setup.costOf[id]]?.points.length);
  const costTotal = costs.reduce((a, v) => a + v, 0);
  const busiest = perBucket.reduce((bi, s, i) => (s.used > perBucket[bi].used ? i : bi), 0);
  const unit = range === "day" ? "hour" : range === "year" ? "month" : "day";
  const done = perBucket.filter((_, i) => starts[i] <= Date.now());
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
        <Figure label={`Per ${unit}`} value={done.length ? `${fmtKwh(whole.used / done.length)} kWh` : "—"} />
        <Figure label={`Busiest ${unit}`} value={perBucket[busiest]?.used > 0 ? `${label(starts[busiest])} · ${fmtKwh(perBucket[busiest].used)}` : "—"} />
      </div>

      <div className="weather-tile chart energy-wide">
        <div className="weather-chart-head">
          <div className="weather-eyebrow">Energy used, by device</div>
          <div className="weather-legend">{series.map((s) => <span key={s.id}><i className={`key ${s.cls}`} />{s.label}</span>)}</div>
        </div>
        <Bars height={220}
          buckets={starts.map((t, i) => ({
            t,
            segs: [
              ...roots.map((r, k) => {
                const u = perBucket[i].roots.find((x) => x.node.id === r.node.id);
                return { key: r.node.id, label: r.node.name, v: u?.kwh ?? 0, cls: `e-s${k % 6}` };
              }),
              { key: "_u", label: "Untracked", v: perBucket[i].untracked, cls: "e-untracked" },
            ],
          }))}
          stamp={(t) => label(t)} ticks={tickIdx.map((i) => label(starts[i]))} />
      </div>

      {hasCost && (
        <div className="weather-tile chart energy-wide">
          <div className="weather-chart-head"><div className="weather-eyebrow">Cost per {unit}</div><div className="weather-legend">{fmtMoney(costTotal, costUnit)}</div></div>
          <Bars height={120}
            buckets={starts.map((t, i) => ({ t, segs: [{ key: "cost", label: "Cost", v: costs[i], cls: "e-used" }] }))}
            stamp={(t) => `${label(t)} · ${fmtMoney(costs[starts.indexOf(t)] ?? 0, costUnit)}`} ticks={tickIdx.map((i) => label(starts[i]))} />
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
