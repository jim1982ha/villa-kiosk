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
import { Snowflake, Zap, Waves, Sparkles } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { levelForValue, type Threshold } from "@/config/ThresholdConfig";
import { useProfile } from "@/auth/ProfileContext";
import { isCategoryAllowed } from "@/auth/permissions";
import { CATEGORY_ORDER, categorySurface, type DeviceSurfaceState } from "@/config/EntityCategories";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import type { HaSceneInfo } from "@/config/haScenes";
import { locksGroup, lightsGroup } from "@/config/summaryGroups";
import { successFeedback } from "@/utils/haptics";
import { isOn, onOffSummary, OFF_STATES } from "@/utils/entityState";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping } from "@/types/scene.types";
import { useBackToClose } from "@/hooks/useBackToClose";

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

/** Build the ordered tile list from the live entity snapshot. Pure (no side
 *  effects) so it's cheap to recompute on every state push via useMemo. */
function deriveTiles(
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
  resolvedRooms: Record<string, string>,
  can: (c: Category) => boolean,
  thresholds: Record<string, Threshold>,
): SummaryTile[] {
  const all = Object.values(entities);
  const byDomain = (d: string) => all.filter((e) => e.entity_id.startsWith(`${d}.`));
  const tiles: SummaryTile[] = [];

  // ── Door locks ───────────────────────────────────────────────────────
  // `lock.*` entities only — see locksGroup's own docstring for why this
  // isn't extended to switches that merely LOOK like a door/gate relay by
  // name (tried once, matched every "outdoor" light switch in the villa via
  // an unanchored "door" substring — reverted). Shared with the Facility
  // Readiness tab's "View doors" shortcut (see summaryGroups.ts) so both
  // open the identical group, not two independently-derived lists.
  const locksG = locksGroup(entities, entityMap);
  if (locksG) {
    const locks = locksG.entityIds.map((id) => entities[id]).filter((e): e is HassEntity => !!e);
    const lockedN = locks.filter((l) => l.state === "locked").length;
    const unlockedN = locks.filter((l) => l.state === "unlocked").length;
    const allLocked = lockedN === locks.length;
    const single = locks.length === 1;
    tiles.push({
      id: "__locks",
      icon: locksG.icon,
      // Short + generic on purpose, even for a single lock: the tile's real
      // constraint is horizontal space in the bar, and "Outdoor Entrance
      // Lock" (the lock's own HA friendly_name) was one of the widest tiles
      // in it. "Door Lock" also reads sensibly once a second lock exists (the
      // tile already becomes the even-more-generic "Locks" at that point —
      // see the `single` branch below). The MODAL this tile opens still uses
      // the real per-device name (title, further down) — it has the room.
      label: single ? "Door Lock" : "Locks",
      // Reads as a STATE, not as a score. "2/2 locked" makes you do the
      // arithmetic before you know whether anything is wrong, and the one
      // number that matters — how many are open — is the one it never prints.
      // "Locked" needs no reading at all, and "1 Unlocked" names the problem
      // and its size in fewer characters than the fraction used — which is the
      // point: the bar's real constraint is horizontal space, so the all-good
      // case says the same word the single-lock tile says and no more.
      // Same shape as the single-lock branch above and the light tile's "2 On".
      value: single
        ? (locks[0].state === "locked" ? "Locked" : locks[0].state === "unlocked" ? "Unlocked" : locks[0].state)
        : allLocked ? "Locked"
          : unlockedN > 0 ? `${unlockedN} Unlocked`
            // Not all locked, yet none actually UNLOCKED: every remainder is
            // unavailable or jammed. Counting those as unlocked would be a
            // plain lie about a door, on the tile whose whole job is to be
            // trusted at a glance — so they are reported as what they are.
            : `${locks.length - lockedN} Unknown`,
      tone: allLocked ? "neutral" : "warn",
      category: "access_control",
      entityIds: locksG.entityIds,
      title: locksG.title,
      canControl: can("access_control"),
    });
  }

  // ── Pool / jacuzzi switches ──────────────────────────────────────────
  // Two independent rules, either one qualifies: the entity's own id/name
  // reads as pool equipment, OR the ROOM it resolves to (resolvedRooms — HA's
  // own Area, falling back to GLB geometry, not this switch's own name) is
  // the pool room. The second rule is the more robust one: it catches a
  // switch named nothing like "pool" (a generic "Filter Pump 2") as long as
  // it's placed in the Swimming Pool room, without touching the first rule at
  // all. Anchored against "."/"_"/" "/start/end (room names are human text
  // with spaces, entity ids use "_") — a bare "spa" would otherwise match
  // inside e.g. "spartan_gym_relay" (same substring-collision bug class as
  // EntityCategories' SWITCH_PURPOSE_HINTS).
  const POOL_WORD = /(?:^|[._ ])(?:pool|jacuzzi|jaccuzi|spa)(?:[._ ]|$)/i;
  const poolSwitches = byDomain("switch").filter(
    (e) => POOL_WORD.test(e.entity_id) || POOL_WORD.test(resolvedRooms[e.entity_id] ?? ""),
  );
  if (poolSwitches.length) {
    const on = poolSwitches.some(isOn);
    tiles.push({
      id: "__pool", icon: Waves, label: "Pool",
      value: onOffSummary(poolSwitches.filter(isOn).length, poolSwitches.length),
      tone: on ? "on" : "off", category: "energy",
      entityIds: poolSwitches.map((e) => e.entity_id), title: "Pool", canControl: can("energy"),
    });
  }

  // ── All lights ───────────────────────────────────────────────────────
  // Shared with the Facility Readiness tab's "View lights" shortcut (see
  // summaryGroups.ts) so both open the identical full list of lights, not
  // just the ones a readiness check happens to flag as still lit.
  const lightsG = lightsGroup(entities);
  if (lightsG) {
    const lights = lightsG.entityIds.map((id) => entities[id]).filter((e): e is HassEntity => !!e);
    const n = lights.filter(isOn).length;
    tiles.push({
      id: "__lights", icon: lightsG.icon, label: "Lights",
      value: onOffSummary(n, lights.length),
      tone: n > 0 ? "on" : "off", category: "light",
      entityIds: lightsG.entityIds, title: lightsG.title, canControl: can("light"),
    });
  }

  // ── Climate ("AC") ───────────────────────────────────────────────────
  const climates = byDomain("climate");
  if (climates.length) {
    const active = climates.filter((e) => e.state !== "off" && !OFF_STATES.has(e.state));
    // ONLY real current_temperature readings — never a fallback to `temperature`
    // (the TARGET setpoint). That fallback used to mean this tile could show a
    // bare "26°C" that was actually one unit's target, not a measured room
    // temperature, with nothing to say which — reported as exactly that
    // confusion. Averaging real readings across several rooms is still a
    // meaningful "how warm is the house" glance value; averaging two units'
    // independently-set TARGETS is not a real quantity at all (a living room
    // aimed at 26° and a bedroom aimed at 18° do not average to a "22°" that
    // means anything). With no real reading available, this now falls back to
    // the shared on/off phrasing instead of ever showing a number that isn't
    // actually a temperature.
    const temps = active
      .map((e) => e.attributes.current_temperature)
      .filter((t): t is number => typeof t === "number");
    const avg = temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null;
    tiles.push({
      id: "__climate", icon: Snowflake, label: "AC",
      // Average CURRENT temperature is the more useful glance value while
      // anything is running and actually reporting one; otherwise defer to
      // the shared phrasing so "All Off" here matches "All Off" on the Lights
      // tile beside it (and "3 On" with no reading reads the same way too).
      value: active.length && avg !== null
        ? `${avg}°C`
        : onOffSummary(active.length, climates.length),
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
      // A HARDCODED `totalW > 3000` used to live here, and it was exactly the
      // per-site tuning constant CLAUDE.md's first hard rule forbids: 3 kW is
      // an idle afternoon in a villa with a pool pump and an alarming spike in
      // a small apartment. It was right for the machine it was written on and
      // wrong everywhere else — a tile permanently red on one install and
      // never lit on another.
      //
      // The tile now inherits the alert state of its own members, the way the
      // Locks tile already does: it warns if any contributing power sensor is
      // over the threshold configured FOR THAT SENSOR (config.alertThresholds,
      // which ships empty — see ThresholdConfig). With none configured it stays
      // informational, which is the honest default: the app has no basis for
      // calling any wattage high in a villa it has never seen.
      tone: powerSensors.some((e) => {
        const v = Number(e.state);
        return Number.isFinite(v) && levelForValue(v, thresholds[e.entity_id]) !== "normal";
      }) ? "warn" : "neutral",
      category: "energy",
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
  /** Live HA scenes (config/haScenes.ts) — computed once in Dashboard since
   *  the room-cluster panel needs the exact same derivation. */
  scenes: HaSceneInfo[];
}

function Tile({ t, onOpen }: { t: SummaryTile; onOpen: (t: SummaryTile) => void }) {
  const Icon = t.icon;
  // Neutral by default (VESTA-DESIGN.md §0): the icon chip only takes its
  // category's hue once the tile's own tone says something in it is
  // actually on ("warn" — e.g. an unlocked lock or high energy draw — reads
  // as alerting, same red as everywhere else that signal shows up).
  const state: DeviceSurfaceState = t.tone === "warn" ? "alert" : t.tone === "on" ? "active" : "off";
  // categorySurface composites an OPAQUE fill in JS from the theme's tokens,
  // so unlike a plain var() it is frozen at render time. This bar is on screen
  // permanently, which makes it the worst place for that to go stale — an
  // "auto" kiosk crossing into night would keep light-theme chips until some
  // unrelated HA update happened to re-render it.
  useResolvedTheme();
  const surface = categorySurface(t.category, state);
  return (
    <button
      type="button"
      className={`summary-tile tone-${t.tone}`}
      // --tile-fill/--tile-glyph: the icon chip's state-driven colours.
      // --tile-ring: the solid ring colour, used only for the lit border
      // (color-mix needs a solid colour, not the translucent fill).
      style={{
        ["--tile-fill" as string]: surface.fill,
        ["--tile-glyph" as string]: surface.glyph,
        ...(surface.ring ? { ["--tile-ring" as string]: surface.ring } : {}),
      }}
      onClick={() => onOpen(t)}
      title={`${t.label}: ${t.value} — tap to see & control everything it includes`}
    >
      <span className="summary-tile-icon"><Icon size={20} /></span>
      <span className="summary-tile-text">
        <span className="summary-tile-label">{t.label}</span>
        <span className="summary-tile-value">{t.value}</span>
      </span>
    </button>
  );
}

/** ONE "Scene" tile for however many live HA scenes exist. A single scene
 *  applies on tap; two or more open a pop-up picker above the tile. Reads
 *  Home Assistant's own scene.* entities (see config/haScenes.ts) — there is
 *  no "currently active scene" concept here the way the kiosk's own former
 *  capture-and-compare scenes had (HA doesn't track "which scene is this
 *  live state a match for"), so the tile's value is just the scene count. */
function SceneMenu({ scenes, canRun, apply }: {
  scenes: HaSceneInfo[];
  canRun: boolean;
  apply: (s: HaSceneInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  // Back closes the scene list, never the app: only the villa map lets a press
  // through to the platform. Registered only WHILE open, which is what the
  // hook's `active` argument is for — a mounted-but-closed popover must not
  // hold a history entry, or Back on the villa would appear to do nothing.
  useBackToClose(() => setOpen(false), open);
  useResolvedTheme(); // its tile chip is composited in JS too — see Tile
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
    // ⚠️ DELIBERATELY NOT useModalA11y (/dry-audit note, 2.433.0). That hook is
    // the MODAL contract — focus trap, Escape, focus restore, back-to-close —
    // and this is a non-modal POPOVER: anchored to the tile, no backdrop, no
    // role="dialog", dismissed by an outside pointerdown. Trapping focus in a
    // menu that is not modal is a defect, not a fix: a keyboard user could not
    // Tab out of a thing that is not covering anything. Escape alone is the
    // right half of the contract here, so it is hand-written on purpose.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
        className="summary-tile summary-tile-iconly tone-neutral"
        style={{
          // Same reason as Tile above: composited in JS, so re-theming needs
          // a re-render rather than the cascade.
          ["--tile-fill" as string]: categorySurface("others", "off").fill,
          // .ink, not .glyph: the Scene tile is the app's OWN chrome, not a
          // device, and CATEGORY_COLORS hues are reserved for devices (a room
          // chip once drew in the Energy blue and read as a mis-tagged badge).
          // Every other tile passes a real category through Tile above.
          ["--tile-glyph" as string]: categorySurface("others", "off").ink,
        }}
        disabled={!canRun}
        aria-haspopup="menu"
        aria-expanded={open}
        // ⚠️ The tile draws NO text (see .summary-tile-iconly), so the
        // accessible name has to be stated — a glyph-only button with neither
        // a label nor an aria-label announces as "button" and nothing else.
        // The count belongs in the tooltip, not on the bar: the menu this
        // opens IS the list, so printing its length beside it said the same
        // thing twice, which is what was reported as clutter.
        aria-label={`Scenes (${scenes.length})`}
        title={`${scenes.length} scene${scenes.length === 1 ? "" : "s"} from Home Assistant — tap to run one`}
        onClick={toggle}
      >
        <span className="summary-tile-icon"><Sparkles size={20} /></span>
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
              key={s.entityId}
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

export default function SummaryBar({ onOpenEntity, mappedEntityIds, scenes }: Props) {
  const { entities, suppressedEntityIds, callService } = useHA();
  const { role } = useProfile();
  const { config, resolvedRooms } = useConfig();

  const [openGroup, setOpenGroup] = useState<SummaryTile | null>(null);

  // Entities hidden in HA, or filed under entity_category config/diagnostic,
  // are excluded up front so a tile's "3 On" count never disagrees with the
  // (also-filtered, see SummaryGroupPanel) list its tap opens.
  const visibleEntities = useMemo(() => {
    if (suppressedEntityIds.size === 0) return entities;
    const out: Record<string, HassEntity> = {};
    for (const [id, e] of Object.entries(entities)) {
      if (!suppressedEntityIds.has(id)) out[id] = e;
    }
    return out;
  }, [entities, suppressedEntityIds]);

  const deviceTiles = useMemo(
    () => deriveTiles(visibleEntities, config.entityMap, resolvedRooms, (c) => (role ? isCategoryAllowed(role, c) : false), config.alertThresholds),
    [visibleEntities, config.entityMap, resolvedRooms, role],
  );

  // A scene spans categories — allow running one if the profile may control ANY.
  const canRunScenes = !!role && CATEGORY_ORDER.some((c) => isCategoryAllowed(role, c));

  // Hidden via Settings, or nothing to show. (The view-mode/default-view
  // buttons used to live in a left section here — they're back to always
  // rendering standalone via HUD instead, see ViewControls' own docstring —
  // so this bar goes back to being purely the device/scene tiles.)
  if (config.showSummaryBar === false || (!deviceTiles.length && !scenes.length)) return null;

  return (
    <>
      <div className="summary-bar" role="toolbar" aria-label="Quick controls and summaries">
        {deviceTiles.map((t) => <Tile key={t.id} t={t} onOpen={setOpenGroup} />)}
        {scenes.length > 0 && (
          <SceneMenu
            scenes={scenes}
            canRun={canRunScenes}
            apply={(s) => {
              // Running a scene changes several rooms at once and the
              // result is usually not visible from where you tapped —
              // the strongest case in the app for a confirming haptic.
              successFeedback();
              void callService("scene", "turn_on", {}, { entity_id: s.entityId });
            }}
          />
        )}
      </div>
      {openGroup && (
        <SummaryGroupPanel
          group={{ title: openGroup.title, icon: openGroup.icon, entityIds: openGroup.entityIds }}
          canControl={openGroup.canControl}
          mappedEntityIds={mappedEntityIds}
          onClose={() => setOpenGroup(null)}
          // Deliberately DON'T close the group when drilling into one of its
          // rows — leave this modal mounted underneath. Both this panel and
          // the entity's own detail panel (rendered later in Dashboard's
          // tree, so it stacks visually on top at the same z-index) share the
          // same .modal-backdrop system, so the group modal is genuinely
          // still there, just covered — closing the entity panel (its own X,
          // unrelated to this component) reveals the group again with no
          // extra "return to parent" bookkeeping needed. Only the group's OWN
          // X (onClose above) actually clears this state.
          onOpenEntity={onOpenEntity}
        />
      )}
    </>
  );
}
