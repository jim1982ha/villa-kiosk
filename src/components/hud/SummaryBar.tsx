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

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  Lightbulb, Snowflake, Zap, Waves, Sparkles, DoorClosed, DoorOpen,
} from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useProfile } from "@/auth/ProfileContext";
import { isCategoryAllowed } from "@/auth/permissions";
import { CATEGORY_COLORS, CATEGORY_ORDER, categoryGradient } from "@/config/EntityCategories";
import { applyScene } from "@/config/scenes";
import type { KioskScene } from "@/config/scenes";
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

function Tile({ t }: { t: SummaryTile }) {
  const Icon = t.icon;
  const interactive = !!t.onTap;
  return (
    <button
      type="button"
      className={`summary-tile tone-${t.tone}${interactive ? "" : " is-info"}`}
      // --tile-grad: the gradient icon square (categoryGradient, shared with the
      // top bar). --tile-accent: the solid bottom colour, used only for the lit
      // border (color-mix needs a solid colour, not a gradient).
      style={{
        ["--tile-grad" as string]: categoryGradient(t.category),
        ["--tile-accent" as string]: CATEGORY_COLORS[t.category].bottom,
      }}
      onClick={t.onTap}
      disabled={!interactive}
      title={interactive ? `${t.label}: ${t.value}` : `${t.label}: ${t.value} (view only)`}
    >
      <span className="summary-tile-icon"><Icon size={24} /></span>
      <span className="summary-tile-text">
        <span className="summary-tile-label">{t.label}</span>
        <span className="summary-tile-value">{t.value}</span>
      </span>
    </button>
  );
}

/** ONE "Scene" tile for however many scenes exist. A single scene applies on
 *  tap; two or more open a pop-up picker above the tile. */
function SceneMenu({ scenes, canRun, apply }: {
  scenes: KioskScene[];
  canRun: boolean;
  apply: (s: KioskScene) => void;
}) {
  const [open, setOpen] = useState(false);
  // The pop-up is PORTALED to <body>: the summary-bar has a transform +
  // overflow, so a menu nested inside it would be clipped and mis-positioned.
  // We anchor it to the tile via the tile's viewport rect (position: fixed).
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const single = scenes.length === 1;

  const toggle = () => {
    if (single) { apply(scenes[0]); return; }
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 });
    setOpen(true);
  };

  return (
    <div className="summary-scene">
      <button
        ref={btnRef}
        type="button"
        className="summary-tile tone-neutral"
        style={{
          ["--tile-grad" as string]: categoryGradient("others"),
          ["--tile-accent" as string]: CATEGORY_COLORS.others.bottom,
        }}
        disabled={!canRun}
        aria-haspopup={single ? undefined : "menu"}
        aria-expanded={single ? undefined : open}
        title={single ? `Apply scene: ${scenes[0].name}` : "Choose a scene to apply"}
        onClick={toggle}
      >
        <span className="summary-tile-icon"><Sparkles size={24} /></span>
        <span className="summary-tile-text">
          <span className="summary-tile-label">Scene</span>
          <span className="summary-tile-value">
            {single ? scenes[0].name : `${scenes.length} scenes`}
          </span>
        </span>
      </button>
      {open && !single && pos && createPortal(
        <div
          ref={menuRef}
          className="summary-scene-menu"
          role="menu"
          aria-label="Scenes"
          style={{ position: "fixed", right: pos.right, bottom: pos.bottom }}
        >
          {scenes.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              className="summary-scene-item"
              onClick={() => { apply(s); setOpen(false); }}
            >
              <Sparkles size={16} /><span>{s.name}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function SummaryBar({ onOpenEntity }: Props) {
  const { entities, callService } = useHA();
  const { role } = useProfile();
  const { config } = useConfig();

  const deviceTiles = useMemo(
    () => deriveTiles(
      entities,
      (c) => (role ? isCategoryAllowed(role, c) : false),
      callService,
      onOpenEntity,
    ),
    [entities, role, callService, onOpenEntity],
  );

  const scenes = config.kioskScenes ?? [];
  // A scene spans categories — allow running one if the profile may control ANY.
  const canRunScenes = !!role && CATEGORY_ORDER.some((c) => isCategoryAllowed(role, c));

  // Hidden via Settings, or nothing at all to show.
  if (config.showSummaryBar === false || (!deviceTiles.length && !scenes.length)) return null;

  return (
    <div className="summary-bar" role="toolbar" aria-label="Quick controls and summaries">
      {deviceTiles.map((t) => <Tile key={t.id} t={t} />)}
      {scenes.length > 0 && (
        <SceneMenu
          scenes={scenes}
          canRun={canRunScenes}
          apply={(s) => { void applyScene(s, callService); }}
        />
      )}
    </div>
  );
}
