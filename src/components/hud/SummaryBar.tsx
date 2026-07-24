// src/components/hud/SummaryBar.tsx
// A bottom dashboard strip of live "summary / scene / quick-action" tiles —
// the row of Gate / Pool / Lights / AC / Scene / Energy cards. Everything is
// AUTO-DERIVED from whatever HA entities exist (no per-villa config needed to
// get value out of the box): scene.* become one-tap scene buttons, all
// light.* collapse into a single "Lights — N on" toggle, climate.* into an
// "AC" summary, power sensors into an "Energy" reading, and a pool switch /
// door lock into quick-toggle / open-panel tiles when present.
//
// RBAC: an ACTION tile (toggle/scene/open) is only interactive when the
// profile may control that category; otherwise it renders as a read-only
// info tile (never hidden — seeing "Lights: all on" is useful even to a
// viewer who can't change it). Purely-informational tiles (Energy, an AC
// reading with no panel) are always shown.
//
// This is the DOM counterpart to the 3D floating badges — same design
// tokens (glassy card, category accent), laid out as a horizontally
// scrollable centre strip so it never fights the corner controls
// (view toggle / joystick) in the bottom bar.

import { useMemo, type ComponentType } from "react";
import {
  Lightbulb, Snowflake, Zap, Waves, Sparkles, DoorClosed, DoorOpen,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { isCategoryAllowed } from "@/auth/permissions";
import { CATEGORY_COLORS } from "@/config/EntityCategories";
import type { HassEntity } from "@/types/ha.types";
import type { Category } from "@/types/scene.types";

type IconType = ComponentType<{ size?: number | string }>;

/** One rendered tile. `onTap` present ⇒ interactive; absent ⇒ read-only info. */
interface SummaryTile {
  id: string;
  icon: IconType;
  label: string;
  value: string;
  /** Drives the accent: "on" lit, "warn" amber, "off"/"neutral" muted. */
  tone: "on" | "off" | "warn" | "neutral";
  /** The category whose colour tints the tile (matches the 3D badges). */
  category: Category;
  onTap?: () => void;
}

const OFF_STATES = new Set(["off", "unavailable", "unknown", ""]);
const isOn = (e: HassEntity | undefined) => !!e && !OFF_STATES.has(e.state);

const friendly = (e: HassEntity) =>
  e.attributes.friendly_name ??
  e.entity_id.split(".")[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const MAX_SCENE_TILES = 4;

/** Build the ordered tile list from the live entity snapshot. Pure (no side
 *  effects) so it's cheap to recompute on every state push via useMemo. */
function deriveTiles(
  entities: Record<string, HassEntity>,
  can: (c: Category) => boolean,
  callService: ReturnType<typeof useHA>["callService"],
  onOpenEntity: (entityId: string) => void,
): SummaryTile[] {
  const all = Object.values(entities);
  const byDomain = (d: string) => all.filter((e) => e.entity_id.startsWith(`${d}.`));
  const tiles: SummaryTile[] = [];

  // ── Door lock → "Entrance" open/closed, opens its panel ──────────────
  for (const lock of byDomain("lock")) {
    const locked = lock.state === "locked";
    tiles.push({
      id: lock.entity_id,
      icon: locked ? DoorClosed : DoorOpen,
      label: friendly(lock),
      value: locked ? "Locked" : lock.state === "unlocked" ? "Unlocked" : lock.state,
      tone: locked ? "neutral" : "warn",
      category: "access_control",
      onTap: can("access_control") ? () => onOpenEntity(lock.entity_id) : undefined,
    });
  }

  // ── Pool / jacuzzi switch → quick on/off toggle ──────────────────────
  const pool = byDomain("switch").find((e) =>
    /pool|jacuzzi|jaccuzi|spa/i.test(e.entity_id));
  if (pool) {
    const on = isOn(pool);
    tiles.push({
      id: pool.entity_id,
      icon: Waves,
      label: "Pool",
      value: on ? "On" : "Off",
      tone: on ? "on" : "off",
      category: "energy",
      onTap: can("energy")
        ? () => callService("switch", "toggle", {}, { entity_id: pool.entity_id })
        : undefined,
    });
  }

  // ── All lights → one aggregate toggle ────────────────────────────────
  const lights = byDomain("light");
  if (lights.length) {
    const onIds = lights.filter(isOn).map((e) => e.entity_id);
    const n = onIds.length;
    const anyOn = n > 0;
    tiles.push({
      id: "__lights",
      icon: Lightbulb,
      label: "Lights",
      value: n === lights.length ? "All On" : anyOn ? `${n} On` : "All Off",
      tone: anyOn ? "on" : "off",
      category: "light",
      onTap: can("light")
        ? () =>
            callService(
              "light",
              anyOn ? "turn_off" : "turn_on",
              {},
              { entity_id: anyOn ? onIds : lights.map((e) => e.entity_id) },
            )
        : undefined,
    });
  }

  // ── Climate → "AC" summary (avg current temp of the ones that are on) ─
  const climates = byDomain("climate");
  if (climates.length) {
    const active = climates.filter((e) => e.state !== "off" && !OFF_STATES.has(e.state));
    const temps = active
      .map((e) => e.attributes.current_temperature ?? e.attributes.temperature)
      .filter((t): t is number => typeof t === "number");
    const avg = temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null;
    tiles.push({
      id: "__climate",
      icon: Snowflake,
      label: "AC",
      value: active.length === 0 ? "Off" : avg !== null ? `${avg}°C` : `${active.length} On`,
      tone: active.length ? "on" : "off",
      category: "comfort",
      onTap:
        can("comfort") && climates[0]
          ? () => onOpenEntity(climates[0].entity_id)
          : undefined,
    });
  }

  // ── Scenes → one-tap activation tiles ────────────────────────────────
  const scenes = byDomain("scene").slice(0, MAX_SCENE_TILES);
  for (const scene of scenes) {
    tiles.push({
      id: scene.entity_id,
      icon: Sparkles,
      label: "Scene",
      value: friendly(scene),
      tone: "neutral",
      category: "others",
      onTap: can("others")
        ? () => callService("scene", "turn_on", {}, { entity_id: scene.entity_id })
        : undefined,
    });
  }

  // ── Energy → total instantaneous power across power sensors ──────────
  const powerSensors = byDomain("sensor").filter(
    (e) =>
      e.attributes.device_class === "power" ||
      /(^|_)w$|watt/i.test(e.attributes.unit_of_measurement ?? ""),
  );
  if (powerSensors.length) {
    const totalW = powerSensors.reduce((sum, e) => {
      const v = Number(e.state);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
    tiles.push({
      id: "__energy",
      icon: Zap,
      label: "Energy",
      value: totalW >= 1000 ? `${(totalW / 1000).toFixed(1)} kW` : `${Math.round(totalW)} W`,
      tone: totalW > 3000 ? "warn" : "neutral",
      category: "energy",
    });
  }

  return tiles;
}

interface Props {
  /** Open an entity's full control panel (wired to Dashboard's setActivePanel). */
  onOpenEntity: (entityId: string) => void;
}

export default function SummaryBar({ onOpenEntity }: Props) {
  const { entities, callService } = useHA();
  const { role } = useProfile();
  useConfig(); // reserved: future per-villa tile overrides (config.summaryTiles)

  const tiles = useMemo(
    () =>
      deriveTiles(
        entities,
        (c) => (role ? isCategoryAllowed(role, c) : false),
        callService,
        onOpenEntity,
      ),
    [entities, role, callService, onOpenEntity],
  );

  if (!tiles.length) return null;

  return (
    <div className="summary-bar" role="toolbar" aria-label="Quick controls and summaries">
      {tiles.map((t) => {
        const Icon = t.icon;
        const accent = CATEGORY_COLORS[t.category].bottom;
        const interactive = !!t.onTap;
        return (
          <button
            key={t.id}
            type="button"
            className={`summary-tile tone-${t.tone}${interactive ? "" : " is-info"}`}
            style={{ ["--tile-accent" as string]: accent }}
            onClick={t.onTap}
            disabled={!interactive}
            title={interactive ? `${t.label}: ${t.value}` : `${t.label}: ${t.value} (view only)`}
          >
            <span className="summary-tile-icon"><Icon size={18} /></span>
            <span className="summary-tile-text">
              <span className="summary-tile-label">{t.label}</span>
              <span className="summary-tile-value">{t.value}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
