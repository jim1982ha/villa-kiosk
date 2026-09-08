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

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useSceneConfirm } from "@/hooks/useSceneConfirm";
import { useProfile } from "@/auth/ProfileContext";
import { isCategoryAllowed } from "@/auth/permissions";
import { CATEGORY_ORDER, categorySurface, type DeviceSurfaceState } from "@/config/EntityCategories";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import type { HaSceneInfo } from "@/config/haScenes";
import SummaryGroupPanel from "@/components/panels/SummaryGroupPanel";
import type { HassEntity } from "@/types/ha.types";
import { useBackToClose } from "@/hooks/useBackToClose";
import { deriveTiles, type SummaryTile } from "@/components/hud/summaryTiles";


/** One rendered tile. Clicking it opens a SummaryGroupPanel listing (and
 *  controlling) the `entityIds` it represents. `value`/`tone` are the at-a-
 *  glance summary; `title`/`icon` head the modal; `canControl` gates the
 *  modal's inline controls for the active profile. */
// ⚠️ THE TILE RULES MOVED TO `summaryTiles.ts` (2.955.0). 178 lines of pure,
// villa-describing logic — whether the doors are locked, how warm the house is,
// what it is drawing — in a file `node` refuses outright. Its own `POOL_WORD`
// comment named `SWITCH_PURPOSE_HINTS` as the same substring-collision bug
// class, and that table IS pinned character-for-character in `villa_rules.ts`
// while its acknowledged sibling was pinned nowhere.


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
  const { entities, suppressedEntityIds } = useHA();
  const { ask: askScene, dialog: sceneDialog } = useSceneConfirm();
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
            // ⚠️ ASKS FIRST SINCE 2.972.0, THROUGH THE SHARED HOOK. This used
            // to send the scene on the tap that selected it. The haptic and the
            // call now live in `useSceneConfirm` so this surface and the room
            // panel's scene row cannot answer the same question differently —
            // which is ADR-0003's rule about two surfaces and the same acts.
            apply={askScene}
          />
        )}
      </div>
      {sceneDialog}
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
