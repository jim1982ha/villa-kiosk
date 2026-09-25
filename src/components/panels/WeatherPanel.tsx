// src/components/panels/WeatherPanel.tsx
// The villa's weather station: what the air is doing now, what it has been
// doing, and whether the instrument is healthy — opened from the summary
// bar's Weather tile. Which sensors are the station, and what each reading
// MEANS, is config/weatherStation.ts's; this file only lays it out.
//
// Everything here is the station's own readings and Home Assistant's own
// recorder: no forecast, nothing fetched from outside the villa's LAN.

import { useEffect, useMemo, useState } from "react";
import { CloudSun, Gauge, LineChart, Radio } from "lucide-react";
import BasePanel from "./BasePanel";
import Sparkline from "./Sparkline";
import DualSparkline from "./DualSparkline";
import { useHistoryRange, HistoryHeader } from "./historyRange";
import ModalTabs, { type ModalTab } from "@/components/common/ModalTabs";
import { useHA } from "@/ha/HAStateStore";
import { fetchHistory } from "@/ha/HAHistoryAPI";
import { formatSensorParts } from "@/utils/entityValue";
import { isUnavailable } from "@/utils/stateColors";
import type { HassEntity, HistorySeries } from "@/types/ha.types";
import {
  beaufort, compass, comfortInsight, pressureTendency, toCelsius, toKmh, uvBand,
  type WeatherRole, type WeatherStation,
} from "@/config/weatherStation";

type Tab = "now" | "trends" | "station";
const TABS: ModalTab<Tab>[] = [
  { id: "now", label: "Now", icon: CloudSun },
  { id: "trends", label: "Trends", icon: LineChart },
  { id: "station", label: "Station", icon: Radio },
];
const EMPTY: HistorySeries = { points: [], gaps: [], window: { from: 0, to: 0 } };

/** "14 s ago", "3 min ago", "2 h ago". */
function ago(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export default function WeatherPanel({ station, onClose }: { station: WeatherStation; onClose: () => void }) {
  const { entities } = useHA();
  const [tab, setTab] = useState<Tab>("now");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);

  const ent = (role: WeatherRole): HassEntity | undefined => {
    const id = station.roles[role];
    const e = id ? entities[id] : undefined;
    return e && !isUnavailable(e) ? e : undefined;
  };
  const num = (role: WeatherRole): number | undefined => {
    const e = ent(role);
    const v = e ? Number(e.state) : NaN;
    return Number.isFinite(v) ? v : undefined;
  };
  const text = (role: WeatherRole): string => {
    const e = ent(role);
    if (!e) return "—";
    const p = formatSensorParts(e);
    return p.unit ? `${p.value} ${p.unit}` : p.value;
  };
  const celsius = (role: WeatherRole): number | undefined => {
    const v = num(role), e = ent(role);
    return v === undefined || !e ? undefined : toCelsius(v, String(e.attributes.unit_of_measurement ?? ""));
  };
  const kmh = (role: WeatherRole): number | undefined => {
    const v = num(role), e = ent(role);
    return v === undefined || !e ? undefined : toKmh(v, String(e.attributes.unit_of_measurement ?? ""));
  };

  // The pressure tendency is a 3-hour change: the one reading that needs the
  // recorder. It arrives a beat after the rest rather than blocking the tab.
  const [tendency, setTendency] = useState<string | null>(null);
  const pressureId = station.roles.pressure;
  useEffect(() => {
    if (!pressureId) return;
    let cancelled = false;
    fetchHistory(pressureId, 3).then((h) => {
      if (cancelled || h.points.length < 2) return;
      const first = h.points[0].v, last = h.points[h.points.length - 1].v;
      setTendency(pressureTendency(last - first));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pressureId]);

  const insight = comfortInsight({
    temperatureC: celsius("temperature"), feelsLikeC: celsius("feelsLike"),
    dewPointC: celsius("dewPoint"), indoorDewPointC: celsius("indoorDewPoint"),
  });
  const updated = ago(ent("temperature")?.last_updated, now);
  const speed = kmh("windSpeed");
  const dir = num("windDirection");
  const rate = num("rainRate");
  const uv = num("uv");

  return (
    <BasePanel title="Weather" icon={<CloudSun size={22} />} history={false} onClose={onClose}>
      <ModalTabs tabs={TABS} active={tab} onSelect={setTab} label="Weather sections" />
      {tab === "now" && (
        <div className="weather-now">
          <div className="weather-hero">
            <span className="weather-temp">{text("temperature")}</span>
            <span className="weather-hero-side">
              {ent("feelsLike") && <>feels like <b>{text("feelsLike")}</b><br /></>}
              {ent("humidity") && <>humidity {text("humidity")}</>}
              {ent("dewPoint") && <> · dew {text("dewPoint")}</>}
            </span>
          </div>
          {updated && <div className="weather-updated">updated {updated}</div>}
          {insight && <div className="weather-insight">{insight}</div>}

          {(ent("windSpeed") || ent("windGust")) && <>
            <div className="weather-sec">Wind</div>
            <div className="weather-grid">
              <div className="weather-cell">
                <div className="entity-label">Speed</div>
                <div className="weather-cell-v">{text("windSpeed")}</div>
                <div className="weather-cell-s">
                  {speed !== undefined && beaufort(speed)}
                  {dir !== undefined && ` · ${compass(dir)} ${Math.round(dir)}°`}
                </div>
              </div>
              <div className="weather-cell">
                <div className="entity-label">Gust</div>
                <div className="weather-cell-v">{text("windGust")}</div>
                {ent("windGustToday") && <div className="weather-cell-s">peak today {text("windGustToday")}</div>}
              </div>
            </div>
          </>}

          {(ent("rainRate") || ent("rainToday")) && <>
            <div className="weather-sec">Rain</div>
            <div className="weather-grid">
              <div className="weather-cell">
                <div className="entity-label">Right now</div>
                <div className="weather-cell-v">{rate === undefined ? "—" : rate > 0 ? "Raining" : "Dry"}</div>
                <div className="weather-cell-s">rate {text("rainRate")}</div>
              </div>
              <div className="weather-cell">
                <div className="entity-label">Today</div>
                <div className="weather-cell-v">{text("rainToday")}</div>
                <div className="weather-cell-s">
                  {ent("rainMonth") && `month ${text("rainMonth")}`}
                  {ent("rainYear") && ` · year ${text("rainYear")}`}
                </div>
              </div>
            </div>
          </>}

          {(ent("uv") || ent("pressure")) && <>
            <div className="weather-sec">Sky &amp; pressure</div>
            <div className="weather-grid">
              {ent("uv") && (
                <div className="weather-cell">
                  <div className="entity-label">UV index</div>
                  <div className="weather-cell-v">{text("uv")}</div>
                  {uv !== undefined && <div className="weather-cell-s">{uvBand(uv).band} — {uvBand(uv).advice}</div>}
                </div>
              )}
              {ent("pressure") && (
                <div className="weather-cell">
                  <div className="entity-label">Pressure</div>
                  <div className="weather-cell-v">{text("pressure")}</div>
                  <div className="weather-cell-s">{tendency ?? "…"}</div>
                </div>
              )}
            </div>
          </>}

          {(ent("indoorTemperature") || ent("indoorHumidity")) && <>
            <div className="weather-sec">Indoor · outdoor</div>
            {ent("indoorTemperature") && <Row label="Temperature" a={text("indoorTemperature")} b={text("temperature")} />}
            {ent("indoorHumidity") && <Row label="Humidity" a={text("indoorHumidity")} b={text("humidity")} />}
            {ent("indoorDewPoint") && <Row label="Dew point" a={text("indoorDewPoint")} b={text("dewPoint")} />}
          </>}
        </div>
      )}
      {tab === "trends" && <Trends station={station} />}
      {tab === "station" && (
        <div className="weather-station">
          {station.entityIds.map((id) => {
            const e = entities[id];
            if (!e) return null;
            const p = formatSensorParts(e);
            return (
              <div key={id} className="weather-row">
                <span className="weather-row-l">{String(e.attributes.friendly_name ?? id)}</span>
                <span className="weather-row-v">
                  {isUnavailable(e) ? "Unavailable" : p.unit ? `${p.value} ${p.unit}` : p.value}
                  <span className="weather-row-s"> · {ago(e.last_updated, now)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </BasePanel>
  );
}

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className="weather-row">
      <span className="weather-row-l">{label}</span>
      <span className="weather-row-v">{a} · {b}</span>
    </div>
  );
}

/** The station's history, on the shared range picker and chart components. */
function Trends({ station }: { station: WeatherStation }) {
  const { entities } = useHA();
  const { range, picker } = useHistoryRange();
  // Keyed by the sensors' ids, never by the station object's identity: an
  // effect on an object re-runs whenever anyone rebuilds it (see SummaryBar).
  const idsKey = (["temperature", "indoorTemperature", "pressure", "windSpeed", "windGust", "rainToday"] as const)
    .map((r) => `${r}=${station.roles[r] ?? ""}`).join("|");
  const ids = useMemo(() => idsKey.split("|").map((kv) => kv.split("=") as [WeatherRole, string]).filter(([, id]) => !!id), [idsKey]);
  const [series, setSeries] = useState<Partial<Record<WeatherRole, HistorySeries>>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(ids.map(([r, id]) => fetchHistory(id, range.hours).then((h) => [r, h] as const).catch(() => [r, EMPTY] as const)))
      .then((all) => { if (!cancelled) { setSeries(Object.fromEntries(all)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [ids, range.hours]);
  const unit = (r: WeatherRole) => String(entities[station.roles[r] ?? ""]?.attributes.unit_of_measurement ?? "");
  const s = (r: WeatherRole) => series[r] ?? EMPTY;

  return (
    <div className="weather-trends">
      <div className="field"><HistoryHeader title={range.title} picker={picker} /></div>
      {station.roles.temperature && (
        <div className="field">
          <label className="entity-label">Temperature{station.roles.indoorTemperature ? " — outdoor · indoor" : ""}</label>
          {station.roles.indoorTemperature
            ? <DualSparkline window={s("temperature").window}
                a={{ data: s("temperature").points, gaps: s("temperature").gaps, color: "var(--accent)", unit: unit("temperature"), label: "Outdoor" }}
                b={{ data: s("indoorTemperature").points, gaps: s("indoorTemperature").gaps, color: "var(--status-warning)", unit: unit("indoorTemperature"), label: "Indoor" }} />
            : <Sparkline data={s("temperature").points} gaps={s("temperature").gaps} window={s("temperature").window} unit={unit("temperature")} loading={loading} />}
        </div>
      )}
      {station.roles.pressure && (
        <div className="field">
          <label className="entity-label"><Gauge size={12} /> Pressure</label>
          <Sparkline data={s("pressure").points} gaps={s("pressure").gaps} window={s("pressure").window} unit={unit("pressure")} loading={loading} />
        </div>
      )}
      {station.roles.windSpeed && (
        <div className="field">
          <label className="entity-label">Wind{station.roles.windGust ? " — speed · gust" : ""}</label>
          {station.roles.windGust
            ? <DualSparkline window={s("windSpeed").window}
                a={{ data: s("windSpeed").points, gaps: s("windSpeed").gaps, color: "var(--accent)", unit: unit("windSpeed"), label: "Speed" }}
                b={{ data: s("windGust").points, gaps: s("windGust").gaps, color: "var(--status-on)", unit: unit("windGust"), label: "Gust" }} />
            : <Sparkline data={s("windSpeed").points} gaps={s("windSpeed").gaps} window={s("windSpeed").window} unit={unit("windSpeed")} loading={loading} />}
        </div>
      )}
      {station.roles.rainToday && (
        <div className="field">
          <label className="entity-label">Rain today — accumulated</label>
          <Sparkline data={s("rainToday").points} gaps={s("rainToday").gaps} window={s("rainToday").window} unit={unit("rainToday")} loading={loading} />
        </div>
      )}
    </div>
  );
}
