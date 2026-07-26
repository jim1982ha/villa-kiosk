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
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import ViewControls, { type ViewControlsProps } from "./ViewControls";
import type { HassEntity } from "@/types/ha.types";
import type { Category } from "@/types/scene.types";

type IconType = ComponentType<{ size?: number | string }>;

/** One rendered tile. Clicking it opens a SummaryGroupPanel listing (and
 *  controlling) the `entityIds` it represents. `value`/`tone` are the at-a-
 *  glance summary; `title`/`icon` head the modal; `canControl` gates the
 *  modal's inline controls for the active profile. */
interface SummaryTile {
  id: string;
  icon: IconType;
  label: string;
  value: string;
  tone: "on" | "off" | "warn" | "neutral";
  category: Category;
  entityIds: string[];
  title: string;
  canControl: boolean;
}

const OFF_STATES = new Set(["off", "unavailable", "unknown", ""]);
const isOn = (e: HassEntity | undefined) => !!e && !OFF_STATES.has(e.state);

const friendly = (e: HassEntity) =>
  e.attributes.friendly_name ??
  e.entity_id.split(".")[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Build the ordered tile list from the live entity snapshot. Pure (no side
 *  effects) so it's cheap to recompute on every state push via useMemo. */
function deriveTiles(
  entities: Record<string, HassEntity>,
  can: (c: Category) => boolean,
): SummaryTile[] {
  const all = Object.values(entities);
  const byDomain = (d: string) => all.filter((e) => e.entity_id.startsWith(`${d}.`));
  const tiles: SummaryTile[] = [];

  // ── Door locks ───────────────────────────────────────────────────────
  const locks = byDomain("lock");
  if (locks.length) {
    const lockedN = locks.filter((l) => l.state === "locked").length;
    const allLocked = lockedN === locks.length;
    const single = locks.length === 1;
    tiles.push({
      id: "__locks",
      icon: allLocked ? DoorClosed : DoorOpen,
      label: single ? friendly(locks[0]) : "Locks",
      value: single
        ? (locks[0].state === "locked" ? "Locked" : locks[0].state === "unlocked" ? "Unlocked" : locks[0].state)
        : `${lockedN}/${locks.length} locked`,
      tone: allLocked ? "neutral" : "warn",
      category: "access_control",
      entityIds: locks.map((l) => l.entity_id),
      title: single ? friendly(locks[0]) : "Locks",
      canControl: can("access_control"),
    });
  }

  // ── Pool / jacuzzi switches ──────────────────────────────────────────
  const poolSwitches = byDomain("switch").filter((e) => /pool|jacuzzi|jaccuzi|spa/i.test(e.entity_id));
  if (poolSwitches.length) {
    const on = poolSwitches.some(isOn);
    tiles.push({
      id: "__pool", icon: Waves, label: "Pool",
      value: on ? "On" : "Off", tone: on ? "on" : "off", category: "energy",
      entityIds: poolSwitches.map((e) => e.entity_id), title: "Pool", canControl: can("energy"),
    });
  }

  // ── All lights ───────────────────────────────────────────────────────
  const lights = byDomain("light");
  if (lights.length) {
    const n = lights.filter(isOn).length;
    tiles.push({
      id: "__lights", icon: Lightbulb, label: "Lights",
      value: n === lights.length ? "All On" : n > 0 ? `${n} On` : "All Off",
      tone: n > 0 ? "on" : "off", category: "light",
      entityIds: lights.map((e) => e.entity_id), title: "Lights", canControl: can("light"),
    });
  }

  // ── Climate ("AC") ───────────────────────────────────────────────────
  const climates = byDomain("climate");
  if (climates.length) {
    const active = climates.filter((e) => e.state !== "off" && !OFF_STATES.has(e.state));
    const temps = active
      .map((e) => e.attributes.current_temperature ?? e.attributes.temperature)
      .filter((t): t is number => typeof t === "number");
    const avg = temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null;
    tiles.push({
      id: "__climate", icon: Snowflake, label: "AC",
      value: active.length === 0 ? "Off" : avg !== null ? `${avg}°C` : `${active.length} On`,
      tone: active.length ? "on" : "off", category: "comfort",
      entityIds: climates.map((e) => e.entity_id), title: "Climate", canControl: can("comfort"),
    });
  }

  // ── Energy → total instantaneous power across power sensors (read-only) ─
  const powerSensors = byDomain("sensor").filter(
    (e) => e.attributes.device_class === "power" || /(^|_)w$|watt/i.test(e.attributes.unit_of_measurement ?? ""),
  );
  if (powerSensors.length) {
    const totalW = powerSensors.reduce((sum, e) => {
      const v = Number(e.state);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
    tiles.push({
      id: "__energy", icon: Zap, label: "Energy",
      value: totalW >= 1000 ? `${(totalW / 1000).toFixed(1)} kW` : `${Math.round(totalW)} W`,
      tone: totalW > 3000 ? "warn" : "neutral", category: "energy",
      entityIds: powerSensors.map((e) => e.entity_id), title: "Energy", canControl: false,
    });
  }

  return tiles;
}

interface Props {
  /** Open an entity's full control panel (wired to Dashboard's setActivePanel). */
  onOpenEntity: (entityId: string) => void;
  /** Entities with real geometry in the loaded model — everything else is
   *  flagged "not on the map" in the group modal. */
  mappedEntityIds: Set<string>;
  /** The camera view controls this bar hosts in its left section (see
   *  ViewControls) — HUD renders them standalone only when this bar is off. */
  view: ViewControlsProps;
}

function Tile({ t, onOpen }: { t: SummaryTile; onOpen: (t: SummaryTile) => void }) {
  const Icon = t.icon;
  return (
    <button
      type="button"
      className={`summary-tile tone-${t.tone}`}
      // --tile-grad: the gradient icon square (categoryGradient, shared with the
      // top bar). --tile-accent: the solid bottom colour, used only for the lit
      // border (color-mix needs a solid colour, not a gradient).
      style={{
        ["--tile-grad" as string]: categoryGradient(t.category),
        ["--tile-accent" as string]: CATEGORY_COLORS[t.category].bottom,
      }}
      onClick={() => onOpen(t)}
      title={`${t.label}: ${t.value} — tap to see & control everything it includes`}
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
    // Tapping the tile NEVER applies a scene directly (even with just one) —
    // it always opens the menu; a scene is only applied when SELECTED from it.
    // This keeps the bar's rule uniform: an icon tap opens a chooser/modal,
    // never a direct state change.
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
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose a scene to apply"
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
      {open && pos && createPortal(
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

export default function SummaryBar({ onOpenEntity, mappedEntityIds, view }: Props) {
  const { entities, callService } = useHA();
  const { role } = useProfile();
  const { config } = useConfig();

  const [openGroup, setOpenGroup] = useState<SummaryTile | null>(null);

  const deviceTiles = useMemo(
    () => deriveTiles(entities, (c) => (role ? isCategoryAllowed(role, c) : false)),
    [entities, role],
  );

  const scenes = config.kioskScenes ?? [];
  // A scene spans categories — allow running one if the profile may control ANY.
  const canRunScenes = !!role && CATEGORY_ORDER.some((c) => isCategoryAllowed(role, c));

  // Hidden via Settings. (When shown it always renders — even with no tiles —
  // because it hosts the view controls HUD then leaves out.)
  if (config.showSummaryBar === false) return null;

  return (
    <>
      <div className="summary-bar" role="toolbar" aria-label="Quick controls and summaries">
        {/* Left section: camera view controls, fenced off by a separator. */}
        <div className="summary-bar-views"><ViewControls {...view} /></div>
        {(deviceTiles.length > 0 || scenes.length > 0) && <span className="summary-bar-sep" aria-hidden="true" />}
        {deviceTiles.map((t) => <Tile key={t.id} t={t} onOpen={setOpenGroup} />)}
        {scenes.length > 0 && (
          <SceneMenu
            scenes={scenes}
            canRun={canRunScenes}
            apply={(s) => { void applyScene(s, callService); }}
          />
        )}
      </div>
      {openGroup && (
        <SummaryGroupPanel
          group={{ title: openGroup.title, icon: openGroup.icon, entityIds: openGroup.entityIds }}
          canControl={openGroup.canControl}
          mappedEntityIds={mappedEntityIds}
          onClose={() => setOpenGroup(null)}
          onOpenEntity={(id) => { setOpenGroup(null); onOpenEntity(id); }}
        />
      )}
    </>
  );
}
