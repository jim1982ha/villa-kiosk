// src/components/panels/WeatherPanel.tsx
// The villa's weather station, opened from the summary bar's Weather tile.
// Two views, as agreed with the owner on the design canvas (2026-09-26):
//   * NOW — how the air feels, three pieces of advice, six instruments;
//   * HISTORY AND TRENDS — four figures for a period and six charts.
// Which sensors are the station, and every rule behind the words, is
// config/weatherStation.ts's; this file only lays them out.
//
// ⚠️ THE CHARTS READ HOME ASSISTANT'S STATISTICS, NOT RAW HISTORY. The
// station reports every 16 s: 30 days of wind alone is ~160,000 rows, which a
// wall tablet should not download or draw. The recorder keeps 5-minute and
// hourly means, minima and maxima of every measurement, and hourly/daily
// totals of rain — at most 720 points a line here.
//
// Width: the same as every other window the bottom bar opens
// (`summary-group-modal`, 780 px) — the owner asked for them to match.

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ChevronLeft, CloudSun, LineChart } from "lucide-react";
import { fmtChartValue, fmtChartStamp } from "./chartUtils";
import BasePanel from "./BasePanel";
import { useHA } from "@/ha/HAStateStore";
import { fetchHistory } from "@/ha/HAHistoryAPI";
import { isUnavailable, STATUS_COLOR } from "@/utils/stateColors";
import { bucketGaps, lineRuns, outageBands } from "@/utils/lineChart";
import type { HassEntity, StatisticPeriod } from "@/types/ha.types";
import {
  beaufort, compass, pressureTendency, toCelsius, toKmh, toHpa, uvBand,
  comfortHeadline, comfortPosition, COMFORT_BANDS, windowAdvice, laundryAdvice, outdoorsAdvice,
  type Advice, type WeatherRole, type WeatherStation,
} from "@/config/weatherStation";

type View = "now" | "history";

/** "16 s ago", "3 min ago", "2 h ago". */
function ago(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
const f1 = (v: number | undefined) => (v === undefined ? "—" : v.toFixed(1));
const f0 = (v: number | undefined) => (v === undefined ? "—" : String(Math.round(v)));

/** The station's live readings, by role, in the units the rules use. */
function useReadings(station: WeatherStation) {
  const { entities } = useHA();
  const ent = (role: WeatherRole): HassEntity | undefined => {
    const id = station.roles[role];
    const e = id ? entities[id] : undefined;
    return e && !isUnavailable(e) ? e : undefined;
  };
  const raw = (role: WeatherRole) => {
    const e = ent(role);
    const v = e ? Number(e.state) : NaN;
    return Number.isFinite(v) ? v : undefined;
  };
  const unit = (role: WeatherRole) => String(ent(role)?.attributes.unit_of_measurement ?? "");
  const c = (role: WeatherRole) => { const v = raw(role); return v === undefined ? undefined : toCelsius(v, unit(role)); };
  const k = (role: WeatherRole) => { const v = raw(role); return v === undefined ? undefined : toKmh(v, unit(role)); };
  const rate = raw("rainRate");
  const vpd = raw("vapourDeficit");
  return {
    ent,
    t: c("temperature"), feels: c("feelsLike"), dew: c("dewPoint"),
    inT: c("indoorTemperature"), inDew: c("indoorDewPoint"),
    hum: raw("humidity"), inHum: raw("indoorHumidity"),
    wind: k("windSpeed"), gust: k("windGust"), gustToday: k("windGustToday"), dir: raw("windDirection"),
    rate, raining: rate === undefined ? undefined : rate > 0,
    rainToday: raw("rainToday"), rainMonth: raw("rainMonth"), rainYear: raw("rainYear"),
    rainUnit: unit("rainToday") || "mm",
    pressure: raw("pressure"), pressureUnit: unit("pressure") || "hPa",
    vpd: vpd === undefined ? undefined : toHpa(vpd, unit("vapourDeficit")),
    uv: raw("uv"), solar: raw("solar"),
    updated: ent("temperature")?.last_updated,
  };
}
type Readings = ReturnType<typeof useReadings>;

export default function WeatherPanel({ station, onClose }: { station: WeatherStation; onClose: () => void }) {
  const [view, setView] = useState<View>("now");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);
  const r = useReadings(station);
  const [range, setRange] = useState<RangeKey>("24h");
  // Each screen opens at its TOP: the body is one scroll area shared by both,
  // so History used to open wherever Now had been scrolled to.
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => { topRef.current?.closest(".panel-body")?.scrollTo({ top: 0 }); }, [view]);

  const back = (
    <button type="button" className="weather-back" onClick={() => setView("now")} aria-label="Back to Weather">
      <ChevronLeft size={22} />
    </button>
  );
  return (
    <BasePanel
      title={view === "now" ? "Weather" : "History and trends"}
      icon={view === "now" ? <CloudSun size={22} /> : back}
      className="summary-group-modal weather-modal"
      history={false}
      onClose={onClose}
      headerActions={view === "now"
        ? (r.updated && <span className="weather-live">live · {ago(r.updated, now)}</span>)
        : <RangePicker value={range} onChange={setRange} />}
      // In the footer, so it is visible however far the body scrolls — and in
      // Settings' "Advanced Settings" style: the same button, the same place.
      footerLeading={view === "now" && (
        <button type="button" className="btn ghost" onClick={() => setView("history")}>
          <LineChart size={18} /> History and trends
        </button>
      )}
    >
      <div ref={topRef} />
      {view === "now"
        ? <NowView station={station} r={r} />
        : <HistoryView station={station} range={range} />}
    </BasePanel>
  );
}

// ── Now ──────────────────────────────────────────────────────────────────

function NowView({ station, r }: { station: WeatherStation; r: Readings }) {
  // The 3-hour pressure tendency and today's temperature range need the
  // recorder; both arrive a beat after the live readings rather than block them.
  const [tendency, setTendency] = useState<string | null>(null);
  const pressureId = station.roles.pressure;
  useEffect(() => {
    if (!pressureId) return;
    let cancelled = false;
    fetchHistory(pressureId, 3).then((h) => {
      if (cancelled || h.points.length < 2) return;
      setTendency(pressureTendency(h.points[h.points.length - 1].v - h.points[0].v));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pressureId]);
  const today = useTodayRange(station.roles.temperature);

  const advice = [
    windowAdvice({ outC: r.t, inC: r.inT, outDewC: r.dew, inDewC: r.inDew, raining: r.raining, gustKmh: r.gust }),
    laundryAdvice({ vpdHpa: r.vpd, solarWm2: r.solar, windKmh: r.wind, raining: r.raining }),
    outdoorsAdvice({ raining: r.raining, gustKmh: r.gust, windKmh: r.wind, uv: r.uv }),
  ].filter((a): a is Advice => !!a);

  return (
    <div className="weather-now">
      {r.t !== undefined && (
        <div className="weather-feels">
          <div>
            <div className="weather-eyebrow">How it feels</div>
            <div className="weather-headline">{comfortHeadline(r.t, r.dew, r.wind)}</div>
          </div>
          <div className="weather-big">{f1(r.t)}°</div>
        </div>
      )}

      {r.dew !== undefined && (
        <div className="weather-comfort">
          <div className="weather-comfort-bar">
            {COMFORT_BANDS.map((b, i) => <span key={b} className={`weather-band b${i}`} />)}
            <span className="weather-mark out" style={{ left: `${comfortPosition(r.dew) * 100}%` }} />
            {r.inDew !== undefined && <span className="weather-mark in" style={{ left: `${comfortPosition(r.inDew) * 100}%` }} />}
          </div>
          <div className="weather-comfort-labels">{COMFORT_BANDS.map((b) => <span key={b}>{b}</span>)}</div>
          <div className="weather-comfort-legend">
            <span><i className="dot out" />Outside · dew {f1(r.dew)}°</span>
            {r.inDew !== undefined && <span><i className="dot in" />Inside · dew {f1(r.inDew)}°</span>}
          </div>
        </div>
      )}

      {advice.length > 0 && (
        <div className="weather-advice">
          {advice.map((a) => (
            <div key={a.title} className={`weather-advice-card tone-${a.tone}`}>
              <div className="weather-advice-title"><span className="weather-advice-mark" aria-hidden="true">{a.tone === "good" ? "✓" : a.tone === "neutral" ? "·" : "!"}</span>{a.title}</div>
              <div className="weather-advice-detail">{a.detail}</div>
            </div>
          ))}
        </div>
      )}

      <div className="weather-instruments">
        {(r.wind !== undefined || r.dir !== undefined) && <Tile title="Wind" center><WindCompass r={r} /></Tile>}
        {r.pressure !== undefined && (
          <Tile title="Barometer" center>
            <Barometer hpa={r.pressure} />
            <div className="weather-tile-foot">{tendency ? `${tendency} over the last 3 h` : "…"}</div>
          </Tile>
        )}
        {r.t !== undefined && (
          <Tile title="Temperature">
            <div className="weather-bars">
              <Bar label="Outside" c={r.t} cls="out" />
              {r.feels !== undefined && <Bar label="Feels" c={r.feels} cls="feels" />}
              {r.dew !== undefined && <Bar label="Dew" c={r.dew} cls="water" />}
              {r.inT !== undefined && <Bar label="Inside" c={r.inT} cls="in" />}
            </div>
            {today && <div className="weather-tile-foot">Today {f1(today.min)}° – {f1(today.max)}°</div>}
          </Tile>
        )}
        {(r.hum !== undefined || r.inHum !== undefined) && (
          <Tile title="Humidity">
            <div className="weather-rings">
              {r.hum !== undefined && <Ring pct={r.hum} cls="water" label="Outside" sub={r.dew !== undefined ? `dew ${f1(r.dew)}°` : ""} />}
              {r.inHum !== undefined && <Ring pct={r.inHum} cls="in" label="Inside" sub={r.inDew !== undefined ? `dew ${f1(r.inDew)}°` : ""} />}
            </div>
          </Tile>
        )}
        {(r.rainToday !== undefined || r.rate !== undefined) && <Tile title="Rain gauge"><RainGauge r={r} /></Tile>}
        {(r.uv !== undefined || r.solar !== undefined) && <Tile title="Sun & UV"><SunUv r={r} /></Tile>}
      </div>

    </div>
  );
}

function Tile({ title, center, children }: { title: string; center?: boolean; children: ReactNode }) {
  return (
    <div className={`weather-tile${center ? " center" : ""}`}>
      <div className="weather-eyebrow">{title}</div>
      {children}
    </div>
  );
}

/** Today's low and high, from the recorder's 5-minute statistics since midnight. */
function useTodayRange(entityId: string | undefined): { min: number; max: number } | null {
  const { ws } = useHA();
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    ws.getStatisticsDuringPeriod([entityId], midnight.toISOString(), "5minute", undefined, ["min", "max"])
      .then((res) => {
        const rows = res[entityId] ?? [];
        const mins = rows.map((p) => p.min).filter((v): v is number => typeof v === "number");
        const maxs = rows.map((p) => p.max).filter((v): v is number => typeof v === "number");
        if (!cancelled && mins.length && maxs.length) setRange({ min: Math.min(...mins), max: Math.max(...maxs) });
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [ws, entityId]);
  return range;
}

function WindCompass({ r }: { r: Readings }) {
  const dir = r.dir ?? 0;
  return (
    <>
      <svg className="weather-dial" viewBox="0 0 230 230" role="img" aria-label={`Wind ${f0(r.wind)} km/h from ${compass(dir)}`}>
        <circle cx="115" cy="115" r="100" className="dial-ring" />
        <circle cx="115" cy="115" r="78" className="dial-ring faint" />
        <g className="dial-ticks"><line x1="115" y1="15" x2="115" y2="27" /><line x1="215" y1="115" x2="203" y2="115" /><line x1="115" y1="215" x2="115" y2="203" /><line x1="15" y1="115" x2="27" y2="115" /></g>
        <g className="dial-letters"><text x="115" y="44">N</text><text x="194" y="120">E</text><text x="115" y="198">S</text><text x="36" y="120">W</text></g>
        {r.dir !== undefined && <path d="M115 40 L108 64 L122 64 Z" className="dial-arrow" transform={`rotate(${dir} 115 115)`} />}
        <text x="115" y="118" className="dial-value">{f0(r.wind)}</text>
        <text x="115" y="142" className="dial-unit">km/h{r.dir !== undefined ? ` · from ${compass(dir)}` : ""}</text>
      </svg>
      <div className="weather-tile-foot">
        {r.gust !== undefined && <span>Gust <b>{f1(r.gust)}</b></span>}
        {r.gustToday !== undefined && <span>Peak <b>{f1(r.gustToday)}</b></span>}
        {r.wind !== undefined && <span>{beaufort(r.wind)}</span>}
      </div>
    </>
  );
}

/** A barometer dial: 960 hPa at the left end, 1060 at the right. */
function Barometer({ hpa }: { hpa: number }) {
  const a = ((Math.max(960, Math.min(1060, hpa)) - 960) / 100) * 270 - 135; // degrees from up
  const rad = (a * Math.PI) / 180;
  const x = 115 + 78 * Math.sin(rad), y = 120 - 78 * Math.cos(rad);
  return (
    <svg className="weather-dial" viewBox="0 0 230 230" role="img" aria-label={`Pressure ${hpa.toFixed(1)} hPa`}>
      <path d="M 30 160 A 90 90 0 1 1 200 160" className="baro-track" />
      <path d="M 30 160 A 90 90 0 0 1 60 58" className="baro-zone rain" />
      <path d="M 170 58 A 90 90 0 0 1 200 160" className="baro-zone fair" />
      <g className="baro-words"><text x="26" y="186">RAIN</text><text x="96" y="30">CHANGE</text><text x="178" y="186">FAIR</text></g>
      <line x1="115" y1="120" x2={x.toFixed(1)} y2={y.toFixed(1)} className="baro-needle" />
      <circle cx="115" cy="120" r="7" className="baro-hub" />
      <text x="115" y="160" className="dial-value small">{hpa.toFixed(1)}</text>
      <text x="115" y="182" className="dial-unit">hPa</text>
    </svg>
  );
}

/** A thermometer bar, 0–40 °C. */
function Bar({ label, c, cls }: { label: string; c: number; cls: string }) {
  const pct = Math.max(4, Math.min(100, (c / 40) * 100));
  return (
    <div className="weather-bar">
      <div className="weather-bar-v">{f1(c)}°</div>
      <div className="weather-bar-track"><div className={`weather-bar-fill ${cls}`} style={{ height: `${pct}%` }} /></div>
      <div className="weather-bar-l">{label}</div>
    </div>
  );
}

function Ring({ pct, cls, label, sub }: { pct: number; cls: string; label: string; sub: string }) {
  const c = 2 * Math.PI * 48;
  return (
    <div className="weather-ring-row">
      <svg className="weather-ring" viewBox="0 0 120 120" role="img" aria-label={`${label} humidity ${Math.round(pct)}%`}>
        <circle cx="60" cy="60" r="48" className="ring-track" />
        <circle cx="60" cy="60" r="48" className={`ring-fill ${cls}`} strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}`} transform="rotate(-90 60 60)" />
        <text x="60" y="67" className="ring-value">{Math.round(pct)}%</text>
      </svg>
      <div><div className="weather-ring-l">{label}</div>{sub && <div className="weather-ring-s">{sub}</div>}</div>
    </div>
  );
}

/** A rain tube for today, scaled 0–20 mm (or the next 10 above today). */
function RainGauge({ r }: { r: Readings }) {
  const today = r.rainToday ?? 0;
  const top = Math.max(20, Math.ceil(today / 10) * 10);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((q) => ({ v: Math.round(top * q), y: 248 - q * 224 }));
  const fillH = Math.max(3, (today / top) * 232);
  const u = r.rainUnit;
  return (
    <div className="weather-gauge">
      <svg className="weather-tube" viewBox="0 0 92 260" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Rain today ${f1(today)} ${u}`}>
        <g className="tube-scale">{ticks.map((t) => <text key={t.v} x="26" y={t.y + 4}>{t.v}</text>)}</g>
        <g className="tube-ticks">{ticks.map((t) => <line key={t.v} x1="34" y1={t.y} x2="42" y2={t.y} />)}</g>
        <path d="M 44 12 L 44 244 Q 44 256 56 256 L 76 256 Q 88 256 88 244 L 88 12" className="tube-glass" />
        <rect x="48" y={253 - fillH} width="36" height={fillH} rx="1.5" className="tube-water" />
        <text x="66" y="8" className="tube-unit">{u}</text>
      </svg>
      <div className="weather-gauge-read">
        <div><span>Now</span><b>{r.rate === undefined ? "—" : r.rate > 0 ? `${f1(r.rate)} ${u}/h` : "Dry"}</b></div>
        <div><span>Today</span><b>{f1(r.rainToday)} {u}</b></div>
        {r.rainMonth !== undefined && <div><span>Month</span><b>{f1(r.rainMonth)} {u}</b></div>}
        {r.rainYear !== undefined && <div><span>Year</span><b>{f1(r.rainYear)} {u}</b></div>}
      </div>
    </div>
  );
}

function SunUv({ r }: { r: Readings }) {
  const day = (r.solar ?? 0) > 5;
  return (
    <>
      <svg className="weather-sun" viewBox="0 0 280 110" role="img" aria-label={`UV index ${f0(r.uv)}`}>
        <path d="M 20 100 A 120 120 0 0 1 260 100" className="sun-path" />
        <circle cx={day ? 140 : 20} cy={day ? 16 : 100} r="8" className={`sun-dot${day ? " day" : ""}`} />
        <text x="140" y="92" className="sun-value">UV {f0(r.uv)}</text>
      </svg>
      <div className="weather-tile-foot spread">
        <span>{r.uv !== undefined ? (day ? `${uvBand(r.uv).band} — ${uvBand(r.uv).advice}` : "Night") : day ? "Day" : "Night"}</span>
        {r.solar !== undefined && <span>{f0(r.solar)} W/m²</span>}
      </div>
    </>
  );
}

// ── History and trends ─────────────────────────────────────────────────

type RangeKey = "12h" | "24h" | "7d" | "30d";
const RANGES: Record<RangeKey, { label: string; hours: number; period: "5minute" | "hour"; rainPeriod: "hour" | "day" }> = {
  "12h": { label: "12 h", hours: 12, period: "5minute", rainPeriod: "hour" },
  "24h": { label: "24 h", hours: 24, period: "5minute", rainPeriod: "hour" },
  "7d": { label: "7 days", hours: 168, period: "hour", rainPeriod: "day" },
  "30d": { label: "30 days", hours: 720, period: "hour", rainPeriod: "day" },
};

function RangePicker({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return (
    <div className="segmented weather-ranges" role="group" aria-label="History range">
      {(Object.keys(RANGES) as RangeKey[]).map((k) => (
        <button key={k} type="button" className={k === value ? "active" : ""} aria-pressed={k === value} onClick={() => onChange(k)}>
          {RANGES[k].label}
        </button>
      ))}
    </div>
  );
}

interface Pt { t: number; v: number }
const MEASURED: WeatherRole[] = ["temperature", "indoorTemperature", "humidity", "indoorHumidity", "windSpeed", "windGust", "pressure", "solar", "uv"];

function HistoryView({ station, range }: { station: WeatherStation; range: RangeKey }) {
  const { ws, entities } = useHA();
  const cfg = RANGES[range];
  const periodMs = cfg.period === "5minute" ? 300_000 : 3_600_000;
  // Keyed by the sensors' ids, never by the station object (see SummaryBar).
  const idsKey = MEASURED.map((r) => station.roles[r] ?? "").join("|") + "#" + (station.roles.rainToday ?? "");
  const [stats, setStats] = useState<Record<string, StatisticPeriod[]>>({});
  const [rain, setRain] = useState<StatisticPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState({ from: 0, to: 0 });
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const to = Date.now(), from = to - cfg.hours * 3600_000;
    setWin({ from, to });
    const ids = MEASURED.map((r) => station.roles[r]).filter((x): x is string => !!x);
    const rainId = station.roles.rainToday;
    Promise.all([
      ids.length ? ws.getStatisticsDuringPeriod(ids, new Date(from).toISOString(), cfg.period, undefined, ["mean", "min", "max"]) : Promise.resolve({}),
      rainId ? ws.getStatisticsDuringPeriod([rainId], new Date(from).toISOString(), cfg.rainPeriod, undefined, ["change"]) : Promise.resolve({}),
    ]).then(([m, rr]) => {
      if (cancelled) return;
      setStats(m as Record<string, StatisticPeriod[]>);
      setRain(rainId ? ((rr as Record<string, StatisticPeriod[]>)[rainId] ?? []) : []);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, idsKey, range]);

  const series = (role: WeatherRole, key: "mean" | "min" | "max" = "mean"): Pt[] => {
    const id = station.roles[role];
    return (id ? stats[id] ?? [] : [])
      .map((p) => ({ t: p.start, v: p[key] as number }))
      .filter((p) => typeof p.v === "number" && Number.isFinite(p.v));
  };
  const extent = (pts: Pt[], f: (a: number[]) => number) => (pts.length ? f(pts.map((p) => p.v)) : undefined);
  const tMin = extent(series("temperature", "min"), (a) => Math.min(...a));
  const tMax = extent(series("temperature", "max"), (a) => Math.max(...a));
  const gustMax = extent(series(station.roles.windGust ? "windGust" : "windSpeed", "max"), (a) => Math.max(...a));
  const uvMax = extent(series("uv", "max"), (a) => Math.max(...a));
  const rainTotal = rain.reduce((s, p) => s + (typeof p.change === "number" && p.change > 0 ? p.change : 0), 0);
  const pMin = extent(series("pressure", "min"), (a) => Math.min(...a));
  const pMax = extent(series("pressure", "max"), (a) => Math.max(...a));
  const unitOf = (role: WeatherRole) => {
    const id = station.roles[role];
    return String((id && entities[id]?.attributes.unit_of_measurement) ?? "");
  };

  return (
    <div className="weather-history">
      <div className="weather-figures">
        <Figure label="Temperature range" value={tMin !== undefined && tMax !== undefined ? `${f1(tMin)}° – ${f1(tMax)}°` : "—"} />
        <Figure label="Strongest gust" value={gustMax !== undefined ? `${f1(gustMax)} ${unitOf(station.roles.windGust ? "windGust" : "windSpeed")}` : "—"} />
        <Figure label="Rain" value={station.roles.rainToday ? `${f1(rainTotal)} ${unitOf("rainToday") || "mm"}` : "—"} />
        <Figure label="Highest UV" value={uvMax !== undefined ? `${Math.round(uvMax)} · ${uvBand(uvMax).band.toLowerCase()}` : "—"} />
      </div>
      <div className="weather-charts">
        <ChartTile periodMs={periodMs} title="Temperature" legend={[["Outside", "out"], ["Inside", "in"]]} win={win} loading={loading}
          lines={[{ pts: series("temperature"), cls: "out", label: "Outside", unit: "°" }, { pts: series("indoorTemperature"), cls: "in dashed", label: "Inside", unit: "°" }]} />
        <ChartTile periodMs={periodMs} title="Humidity" legend={[["Outside", "water"], ["Inside", "in"]]} win={win} loading={loading}
          lines={[{ pts: series("humidity"), cls: "water", label: "Outside", unit: "%" }, { pts: series("indoorHumidity"), cls: "in dashed", label: "Inside", unit: "%" }]} />
        <ChartTile periodMs={periodMs} title="Wind" legend={[["Speed", "out area"], ["Gust", "ink"]]} win={win} loading={loading}
          lines={[{ pts: series("windSpeed"), cls: "out", area: true, label: "Speed", unit: ` ${unitOf("windSpeed")}` }, { pts: series("windGust", "max"), cls: "ink thin", label: "Gust", unit: ` ${unitOf("windGust")}` }]} />
        <RainTile rows={rain} win={win} loading={loading} perDay={cfg.rainPeriod === "day"} unit={unitOf("rainToday") || "mm"} />
        <ChartTile periodMs={periodMs} title="Pressure" note={pMin !== undefined && pMax !== undefined ? `${Math.round(pMin)} – ${Math.round(pMax)} ${unitOf("pressure")}` : undefined}
          win={win} loading={loading} lines={[{ pts: series("pressure"), cls: "out", label: "Pressure", unit: ` ${unitOf("pressure")}` }]} />
        <ChartTile periodMs={periodMs} title="Sun & UV" legend={[["Sunlight", "warm area"], ["UV", "warm"]]} win={win} loading={loading}
          lines={[{ pts: series("solar"), cls: "warm", area: true, ownScale: true, label: "Sunlight", unit: " W/m²" }, { pts: series("uv", "max"), cls: "warm", ownScale: true, label: "UV", unit: "" }]} />
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return <div className="weather-figure"><div className="weather-figure-l">{label}</div><div className="weather-figure-v">{value}</div></div>;
}

const tick = (t: number, spanH: number) => {
  const d = new Date(t);
  return spanH > 48 ? `${d.getDate()}/${d.getMonth() + 1}` : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function Axis({ win }: { win: { from: number; to: number } }) {
  const spanH = (win.to - win.from) / 3600_000;
  return (
    <div className="weather-axis">
      <span>{tick(win.from, spanH)}</span><span>{tick((win.from + win.to) / 2, spanH)}</span><span>now</span>
    </div>
  );
}

interface Line { pts: Pt[]; cls: string; label: string; unit: string; area?: boolean; ownScale?: boolean }
const W = 320, H = 150, TOP = 12, BOT = 138;

function ChartTile({ title, legend, note, lines, win, loading, periodMs }: {
  title: string; legend?: [string, string][]; note?: string; lines: Line[]; win: { from: number; to: number }; loading: boolean;
  /** The statistics bucket: a missing one is an outage, never a line. */
  periodMs: number;
}) {
  const drawn = lines.filter((l) => l.pts.length > 0);
  const shared = drawn.filter((l) => !l.ownScale).flatMap((l) => l.pts.map((p) => p.v));
  const lo = shared.length ? Math.min(...shared) : 0, hi = shared.length ? Math.max(...shared) : 1;
  const sx = (t: number) => ((t - win.from) / Math.max(1, win.to - win.from)) * W;
  // Each line is split where ITS buckets are missing (lineRuns: stepped, held,
  // split at outages); the bands shade the first line's outages.
  const path = (l: Line) => {
    const vs = l.pts.map((p) => p.v);
    const a = l.ownScale ? 0 : lo, b = l.ownScale ? Math.max(...vs, 1e-9) : hi;
    const pad = l.ownScale ? 0 : (b - a) * 0.08 || 1;
    const sy = (v: number) => BOT - ((v - (a - pad)) / ((b + pad) - (a - pad) || 1)) * (BOT - TOP);
    return lineRuns(l.pts, bucketGaps(l.pts, periodMs, win), win)
      .filter((run) => run.length >= 2)
      .map((run) => {
        const pts = run.map((p) => `${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`);
        return { line: pts.join(" "), area: `M${sx(run[0].t).toFixed(1)},${BOT} L${pts.join(" L")} L${sx(run[run.length - 1].t).toFixed(1)},${BOT} Z` };
      });
  };
  const bands = drawn.length ? outageBands(bucketGaps(drawn[0].pts, periodMs, win), sx, 0, W) : [];
  const [hoverT, setHoverT] = useState<number | null>(null);
  const onMove = (e: PointerEvent<SVGSVGElement>) => setHoverT(timeAt(e, win));
  // The nearest bucket of each line to the pointer — what the tip reports.
  const hit = hoverT === null ? [] : drawn.map((l) => ({ l, p: nearest(l.pts, hoverT) })).filter((h) => h.p);
  const hx = hit.length ? sx(hit[0].p!.t) : 0;
  return (
    <div className="weather-tile chart">
      <div className="weather-chart-head">
        <div className="weather-eyebrow">{title}</div>
        {legend && <div className="weather-legend">{legend.map(([n, c]) => <span key={n}><i className={`key ${c}`} />{n}</span>)}</div>}
        {note && <div className="weather-legend">{note}</div>}
      </div>
      {drawn.length === 0
        ? (loading ? <div className="state-timeline-skeleton weather-chart" /> : <div className="muted body-text weather-chart-empty">Not enough history yet.</div>)
        : (
          <div className="spark-wrap weather-chart-wrap">
          <svg className="weather-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title} history`}
            style={{ touchAction: "none" }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHoverT(null)}>
            <g className="chart-grid"><line x1="0" y1={TOP} x2={W} y2={TOP} /><line x1="0" y1={(TOP + BOT) / 2} x2={W} y2={(TOP + BOT) / 2} /><line x1="0" y1={BOT} x2={W} y2={BOT} /></g>
            {bands.map((b, i) => <rect key={`gap${i}`} x={b.x} y={TOP} width={b.w} height={BOT - TOP} fill={STATUS_COLOR.unavailable} opacity={0.18} />)}
            {drawn.map((l, i) => (
              <g key={i}>
                {path(l).map((p, j) => (
                  <g key={j}>
                    {l.area && <path d={p.area} className={`chart-area ${l.cls}`} />}
                    <polyline points={p.line} className={`chart-line ${l.cls}`} vectorEffect="non-scaling-stroke" />
                  </g>
                ))}
              </g>
            ))}
            {hit.length > 0 && <line x1={hx} y1={TOP} x2={hx} y2={BOT} className="spark-crosshair" vectorEffect="non-scaling-stroke" />}
          </svg>
          {hit.length > 0 && (
            <Tip x={hx / W} lines={hit.map(({ l, p }) => ({ key: l.label, cls: l.cls, text: `${l.label} ${fmtChartValue(p!.v)}${l.unit}` }))}
              stamp={fmtChartStamp(hit[0].p!.t, (win.to - win.from) / 3_600_000)} />
          )}
          </div>
        )}
      <Axis win={win} />
    </div>
  );
}

/** The time under the pointer, in the chart's window. */
function timeAt(e: PointerEvent<SVGSVGElement>, win: { from: number; to: number }): number {
  const rect = e.currentTarget.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
  return win.from + frac * (win.to - win.from);
}

/** The reading nearest a time (the points are in time order). */
function nearest<T extends { t: number }>(pts: readonly T[], t: number): T | undefined {
  let best: T | undefined, d = Infinity;
  for (const p of pts) { const e = Math.abs(p.t - t); if (e < d) { d = e; best = p; } }
  return best;
}

/** The app's chart tooltip (spark-tip, as Sparkline draws it), one row a line. */
function Tip({ x, lines, stamp }: { x: number; lines: { key: string; cls: string; text: string }[]; stamp: string }) {
  return (
    <div className="spark-tip weather-tip" style={{ left: `${x * 100}%`, top: TOP, transform: `translateX(${x > 0.5 ? "-100%" : "0"})` }}>
      {lines.map((l) => <strong key={l.key}><i className={`key ${l.cls.split(" ")[0]}`} />{l.text}</strong>)}
      <span>{stamp}</span>
    </div>
  );
}

function RainTile({ rows, win, loading, perDay, unit }: {
  rows: StatisticPeriod[]; win: { from: number; to: number }; loading: boolean; perDay: boolean; unit: string;
}) {
  const bars = rows.map((p) => ({ t: p.start, v: typeof p.change === "number" && p.change > 0 ? p.change : 0 }));
  const max = Math.max(...bars.map((b) => b.v), 0);
  const slot = perDay ? 86_400_000 : 3_600_000;
  const bw = Math.max(1.5, (slot / Math.max(1, win.to - win.from)) * W * 0.72);
  const spanH = (win.to - win.from) / 3600_000;
  const [hoverT, setHoverT] = useState<number | null>(null);
  const hitBar = hoverT === null ? undefined : nearest(bars.map((b) => ({ ...b, t: b.t + slot / 2 })), hoverT);
  const hx = hitBar ? ((hitBar.t - win.from) / Math.max(1, win.to - win.from)) * W : 0;
  return (
    <div className="weather-tile chart">
      <div className="weather-chart-head">
        <div className="weather-eyebrow">Rain</div>
        <div className="weather-legend">per {perDay ? "day" : "hour"} · {unit}</div>
      </div>
      {bars.length === 0 && loading
        ? <div className="state-timeline-skeleton weather-chart" />
        : (
          <div className="spark-wrap weather-chart-wrap">
          <svg className="weather-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Rain history"
            style={{ touchAction: "none" }} onPointerMove={(e) => setHoverT(timeAt(e, win))} onPointerDown={(e) => setHoverT(timeAt(e, win))} onPointerLeave={() => setHoverT(null)}>
            <g className="chart-grid"><line x1="0" y1={TOP} x2={W} y2={TOP} /><line x1="0" y1={(TOP + BOT) / 2} x2={W} y2={(TOP + BOT) / 2} /><line x1="0" y1={BOT} x2={W} y2={BOT} /></g>
            {bars.map((b) => {
              const h = max > 0 ? Math.max(2, (b.v / max) * (BOT - TOP)) : 2;
              const x = ((b.t - win.from) / Math.max(1, win.to - win.from)) * W;
              return <rect key={b.t} x={x.toFixed(1)} y={(BOT - h).toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx="1" className="chart-bar" />;
            })}
            {max === 0 && <text x={W / 2} y={H / 2} className="chart-empty-note">{`No rain in the last ${spanH > 48 ? `${Math.round(spanH / 24)} days` : `${Math.round(spanH)} h`}`}</text>}
            {hitBar && <line x1={hx} y1={TOP} x2={hx} y2={BOT} className="spark-crosshair" vectorEffect="non-scaling-stroke" />}
          </svg>
          {hitBar && (
            <Tip x={hx / W} lines={[{ key: "rain", cls: "water", text: `${fmtChartValue(hitBar.v)} ${unit}` }]}
              stamp={`${perDay ? "day of " : "hour from "}${fmtChartStamp(hitBar.t - slot / 2, spanH)}`} />
          )}
          </div>
        )}
      <Axis win={win} />
    </div>
  );
}
