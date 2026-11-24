// src/components/canvas/PictureView.tsx
// THE VILLA PICTURES (owner, 2026-11-24): what a device too weak for the 3D villa (utils/deviceVerdict) shows in its
// place. A still picture of each floor (villaPictures.ts: made by a capable device, stored on the add-on), 2F stacked
// over 1F, in the area the 3D view leaves free of the HUD; over it, in HTML, the badges this profile may see, live
// from the villa's system, and the rooms glowing by the 3D view's own rules (motionRouting). No Babylon here: this
// file and everything it imports are loaded by a device that never downloads the 3D engine.
//
// A badge does what the 3D badge does: a tap is Dashboard's onEntityPicked (the profile decides look or control), a
// hold its onEntityLongPressed. Badges that would touch are ONE group badge (pictureLayout.groupBadges: nothing on the
// map overlaps, owner's rule), its count in the room chip's pill and its members' most urgent mark; a tap or a hold
// opens its devices' list, as a tapped group card does on the 3D map (onClusterPicked). A TV is driven by a remote:
// every badge is a button, the arrows move between them, OK (Enter) taps and holding it holds.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { useProfile } from "@/auth/ProfileContext";
import { panelMapping, profileView, roleCan } from "@/auth/permissions";
import { ROLE_LABELS, ROLE_ORDER } from "@/auth/roles";
import { desiredVariantWord, orderVariantWords, pickNearestVariant } from "@/babylon/meshVariants";
import { iconKeyFor } from "@/babylon/badgeIconKeys";
import { motionLit, motionRouting, type MotionRouting } from "@/babylon/motionRouting";
import { effectiveCategory, subjectOf } from "@/config/EntityCategories";
import { cameraMotionId } from "@/config/BinarySensorClasses";
import { deviceRoom } from "@/config/devicePlace";
import { roomKey } from "@/config/roomKey";
import { clampIconScale } from "@/config/AppConfig";
import { badgeImage, markImage } from "@/babylon/badgeIcons";
import { countBadgeImage } from "@/babylon/countPills";
import { healthPill } from "@/babylon/healthPill";
import { roomHealth } from "@/babylon/summaryLook";
import { badgeMetricsFor, SUMMARY_TEXT_OF_HEIGHT } from "@/babylon/badgeMetrics";
import { BADGE_CORNER_FRACTION, PICTURE_SCALE } from "@/babylon/badgeLook";
import { categorySurface } from "@/config/EntityCategories";
import { formatCountBadge } from "@/utils/countBadge";
import {
  badgeOwnerOf, deviceLook, drawsBadge, groupLook, isUrgent, lookMarks, storeLookSource, type DeviceMarks,
} from "@/utils/deviceActivity";
import { STATUS_COLOR } from "@/utils/stateColors";
import { modelLifecycle } from "@/utils/modelLifecycle";
import { readAddonConfig } from "@/utils/centralModel";
import { backendFetch } from "@/auth/sessionLost";
import { parseManifest, viewUrl, type PicturesManifest } from "@/utils/villaPictures";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useNow } from "@/hooks/useInterval";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { useLongPress } from "@/hooks/useLongPress";
import { LONG_PRESS_MS } from "@/utils/tapThresholds";
import type { CoverRect } from "@/components/hud/mapCover";
import {
  badgeToward, containRect, floorBands, groupBadges, groupMark, roomAt, showsNight, type Arrow, type DrawnItem, type Rect,
} from "./pictureLayout";

/** What the pictures tell the page of the villa's devices: which ones are drawn ("on the map", as the 3D model's
 *  objects say it) and the room a drawn one stands in, for a device the villa's system gives no area. */
export interface PicturePlaces { mapped: Set<string>; roomOf: (entityId: string) => string | null }

interface Props {
  onEntityPicked: (entityId: string, clientX: number, clientY: number) => void;
  onEntityLongPressed: (entityId: string, clientX: number, clientY: number) => void;
  /** A group badge, tapped or held: its devices' list (Dashboard's handleClusterHeld, as a 3D group card's tap). */
  onClusterPicked: (room: string, entityIds: string[], roomNames: string[]) => void;
  /** The map's marks (VillaModel `marks`), as the 3D badges wear them. */
  marks: DeviceMarks;
  /** What the HUD covers of the map (mapCover): the pictures are drawn clear of it. */
  cover: CoverRect[];
  onPlaces: (places: PicturePlaces | null) => void;
}

/** Who makes the pictures, by the role table's own names (a role in text comes from its setting): every profile that
 *  may manage the model ("the Owner"). */
const MAKERS = ROLE_ORDER.filter((r) => roleCan(r, "manageModel")).map((r) => `the ${ROLE_LABELS[r]}`).join(" or ");

/** No pictures yet: asked again this often, so a screen left on shows them once a capable device has made them. */
const RECHECK_MS = 5 * 60_000;
/** Between the floors, and around the free area. */
const GAP_PX = 10;

type Pictures = { kind: "loading" } | { kind: "none" } | { kind: "ready"; manifest: PicturesManifest; version: string | undefined };

/** The add-on's manifest of the pictures (viewUrl, stamped with the version it reports), asked again every
 *  RECHECK_MS while there is none. */
function usePictures(): Pictures {
  const [got, setGot] = useState<Pictures>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async (fresh: boolean) => {
      // the first look shares the page's one answer; a later one asks again (the version moves when pictures are made)
      const cfg = fresh ? await readAddonConfig().then((a) => (a.ok ? a.cfg : null)) : await modelLifecycle.addonConfig();
      const version = cfg?.views_version;
      let manifest: PicturesManifest | null = null;
      // "" is the add-on saying there are none; absent, an add-on that does not say: asked anyway
      if (version !== "") {
        try {
          const r = await backendFetch(viewUrl("manifest.json", version), { credentials: "same-origin" });
          if (r.ok) manifest = parseManifest(await r.json());
        } catch { /* not there yet: the empty screen */ }
      }
      if (!alive) return;
      if (manifest) { setGot({ kind: "ready", manifest, version }); return; }
      setGot({ kind: "none" });
      timer = setTimeout(() => void look(true), RECHECK_MS);
    };
    void look(false);
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return got;
}

/** The element's size, kept as it changes. */
function useBoxSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    sync();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    watch?.observe(el);
    window.addEventListener("resize", sync);
    return () => { watch?.disconnect(); window.removeEventListener("resize", sync); };
  }, [ref]);
  return size;
}

/** The map's free area: the viewport less the bars across its top and bottom (the top bar, the summary tiles). */
function freeArea(w: number, h: number, cover: readonly CoverRect[]): Rect {
  let top = 0, bottom = h;
  for (const r of cover) {
    if (r.right - r.left < w / 2) continue;
    if (r.top <= h / 3) top = Math.max(top, r.bottom);
    else if (r.bottom >= (2 * h) / 3) bottom = Math.min(bottom, r.top);
  }
  if (bottom - top < 4 * GAP_PX) { top = 0; bottom = h; }
  return { x: GAP_PX, y: top + GAP_PX, w: Math.max(0, w - 2 * GAP_PX), h: Math.max(0, bottom - top - 2 * GAP_PX) };
}

/** A picture's rect in its band, moved clear of the narrow HUD pieces on the left (the presence rail) when it would
 *  run under one. */
function pictureRect(band: Rect, picW: number, picH: number, cover: readonly CoverRect[], viewW: number): Rect {
  const rect = containRect(band, picW, picH);
  const rail = cover.filter((r) => r.right - r.left < viewW / 2 && r.left < viewW / 4
    && r.bottom > band.y && r.top < band.y + band.h && r.right > rect.x);
  if (rail.length === 0) return rect;
  const left = Math.max(...rail.map((r) => r.right)) + GAP_PX;
  return containRect({ x: left, y: band.y, w: band.x + band.w - left, h: band.h }, picW, picH);
}

/** What one button shows: a badge's picture, or a group's count pill and corner mark. */
type Drawn = DrawnItem & { src: string; pill: string | null; mark: ReturnType<typeof groupMark> };

/** A group's count pill, as a fraction of a badge's square: larger than the 3D room chip's (badgeMetrics'
 *  countPillFraction) so its number reads from across a room on a TV. Its number at the chip's own proportion. */
const GROUP_PILL_OF_SQUARE = 0.74;
const CHIP = badgeMetricsFor("coarse");
const PILL_FONT_OF_SIZE = (SUMMARY_TEXT_OF_HEIGHT * CHIP.countFontFraction) / CHIP.countPillFraction;

/** A group's list title: its room when its devices share one, else the rooms it spans ("<room-a> and <room-b>",
 *  "<room-a> and 2 more rooms"), else "Devices here". */
function groupName(item: DrawnItem, roomOf: (id: string) => string | null): string {
  if (item.room) return item.room;
  const rooms = [...new Set(item.ids.map(roomOf).filter((r): r is string => !!r))];
  if (rooms.length === 0) return "Devices here";
  if (rooms.length === 1) return rooms[0];
  if (rooms.length === 2) return `${rooms[0]} and ${rooms[1]}`;
  return `${rooms[0]} and ${rooms.length - 1} more rooms`;
}

/** A badge's size on screen: legible from a sofa on a TV (960x540), not crowding a phone (390x844), the HUD's label
 *  size stepper applied as on the 3D map. */
function badgeSizePx(w: number, h: number, scale: number): number {
  const base = Math.min(40, Math.max(26, 0.052 * Math.min(w, h)));
  return Math.round(Math.min(72, Math.max(18, base * clampIconScale(scale))));
}

export default function PictureView({ onEntityPicked, onEntityLongPressed, onClusterPicked, marks, cover, onPlaces }: Props) {
  const pictures = usePictures();
  const { config, resolvedRooms } = useConfig();
  const { entities } = useHA();
  const { role } = useProfile();
  const label = useEntityLabel();
  useResolvedTheme(); // the badge pictures are baked in the theme's colours: drawn again when it changes
  const now = useNow(60_000);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const { w, h } = useBoxSize(boxRef);
  const manifest = pictures.kind === "ready" ? pictures.manifest : null;

  // the drawn devices and their rooms, for the page (Dashboard: "on the map", the room of a device with no area)
  useEffect(() => {
    if (!manifest) { onPlaces(null); return; }
    const at = new Map(manifest.badges.map((b) => [b.id, b]));
    onPlaces({
      mapped: new Set(at.keys()),
      roomOf: (id) => { const b = at.get(id); return b ? roomAt(manifest.rooms, b.floor, b.u, b.v) : null; },
    });
  }, [manifest, onPlaces]);

  const night = showsNight(new Date(now), config, config.render?.dayNightPreview ?? "auto",
    entities["sun.sun"] ? entities["sun.sun"].state === "above_horizon" : null);

  // ── The room glow: the 3D view's routing (EntityVisuals.routeMotion), every sensor as it stands now ─────────────
  // A camera's detector glows the camera's room (the pictures draw no cones: motionRouting's fallback for a camera
  // with no cone). Its colour is the status table's: a room in use red, an alarm's room amber (RoomHighlight).
  const watchers = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const m of Object.values(config.entityMap)) {
      if (!m.linkedEntityId) continue;
      out.set(m.linkedEntityId, [...(out.get(m.linkedEntityId) ?? []), m.entityId]);
    }
    return out;
  }, [config.entityMap]);
  const lit = useMemo(() => {
    const routes: MotionRouting[] = [];
    const denied = !profileView(role).motion;
    for (const [id, e] of Object.entries(entities)) {
      if (!id.startsWith("binary_sensor.")) continue;
      const deviceClass = e.attributes?.device_class as string | undefined;
      routes.push(motionRouting({
        entityId: id, deviceClass, on: e.state === "on",
        type: config.entityMap[id]?.type ?? (manifest?.badges.some((b) => b.id === id) ? "binary_sensor" : undefined),
        room: deviceRoom(resolvedRooms, id),
        cameras: (watchers.get(id) ?? []).filter((cam) => cameraMotionId(config.entityMap[cam], () => deviceClass) === id),
        hasBeam: () => false,
        cameraRoom: (cam) => deviceRoom(resolvedRooms, cam),
        denied, enabled: config.roomGlowAndCones,
      }));
    }
    return motionLit(routes);
  }, [entities, config.entityMap, config.roomGlowAndCones, resolvedRooms, role, watchers, manifest]);

  // ── Each cover's pose now, where it is not open (the 3D view's pick: pickNearestVariant over its authored words) ──
  const coverPoses = useMemo(() => {
    const byId = new Map<string, NonNullable<typeof manifest>["covers"]>();
    for (const c of manifest?.covers ?? []) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
    return [...byId].flatMap(([id, poses]) => {
      const entity = entities[id];
      if (!entity || !poses?.length || !panelMapping(id, config.entityMap, role, entity, { control: false })) return [];
      const words = [...poses.map((c) => c.word), "open"];
      const chosen = pickNearestVariant(orderVariantWords(words), desiredVariantWord(entity), words);
      return poses.filter((c) => c.word === chosen);
    });
  }, [manifest, entities, config.entityMap, role]);

  // ── The badges this profile may see, as the 3D map draws them (EntityVisuals.updateLabel, classic style) ────────
  const size = badgeSizePx(w, h, config.entityIconScale);
  // a group's count pill: the room chip's proportion of a badge's square (the picture's square is PICTURE_SCALE
  // smaller than its control: badgeLook's pill margin), made larger so its number reads from a sofa
  const pillPx = Math.round((size / PICTURE_SCALE) * GROUP_PILL_OF_SQUARE);
  const looks = useMemo(() => storeLookSource(entities, { ...config, ...lookMarks(marks) }), [entities, config, marks]);
  const layout = useMemo(() => {
    if (!manifest || w === 0 || h === 0) return [];
    const area = freeArea(w, h, cover);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return floorBands(area, manifest.floors, GAP_PX).map(({ floor, band }) => {
      const rect = pictureRect(band, floor.width, floor.height, cover, w);
      const drawn = manifest.badges.filter((b) => b.floor === floor.floor).flatMap((b) => {
        const entity = entities[b.id];
        if (!panelMapping(b.id, config.entityMap, role, entity, { control: false })) return [];
        if (!drawsBadge(b.id, looks)) return [];
        const owner = badgeOwnerOf(b.id, config.entityMap);
        const type = looks.typeOf(owner);
        const category = effectiveCategory(subjectOf(owner, config.entityMap[owner], entities[owner], type));
        if (config.hiddenCategories.includes(category)) return [];
        const { face, mark, linkPill } = deviceLook(b.id, looks);
        const src = badgeImage({
          category, iconKey: iconKeyFor(type, entities[owner]), state: face, mark, linkPill,
          color: config.entityMap[owner]?.badgeColor ?? config.entityMap[b.id]?.badgeColor,
          ring: "baked", bakePx: size * dpr,
        });
        const urgent = isUrgent({ mark, linkPill });
        return [{ id: b.id, x: rect.x + b.u * rect.w, y: rect.y + b.v * rect.h, rank: urgent ? 2 : mark ? 1 : 0, src,
          room: deviceRoom(resolvedRooms, b.id) }];
      });
      const src = new Map(drawn.map((d) => [d.id, d.src]));
      const items = groupBadges(drawn, size, rect).map((item): Drawn => {
        if (item.ids.length === 1) return { ...item, src: src.get(item.ids[0])!, pill: null, mark: null };
        // ── A GROUP: the room chip's count pill in its room's health colour (summaryLook.roomHealth over groupLook's
        // count rule) and its members' most urgent corner mark, so an alarm in it still shows and pulses ──────────
        const memberLooks = item.ids.map((id) => deviceLook(id, looks));
        const health = roomHealth(groupLook(memberLooks, { showingDevices: false }));
        const pill = countBadgeImage({
          text: formatCountBadge(item.ids.length), ...healthPill(health),
          drawnPx: Math.round(pillPx * dpr), fontOfSize: PILL_FONT_OF_SIZE,
        });
        return { ...item, src: "", pill, mark: groupMark(memberLooks) };
      });
      return { floor, rect, items };
    });
  }, [manifest, w, h, cover, entities, config, role, looks, size, pillPx, resolvedRooms]);

  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const allItems = useMemo(() => layout.flatMap((f) => f.items), [layout]);
  // a remote's arrows go from badge to badge, group badges included
  const moveFocus = useCallback((from: DrawnItem, arrow: Arrow) => {
    const next = badgeToward(from, allItems.filter((b) => b.key !== from.key).map((b) => ({ id: b.key, x: b.x, y: b.y })), arrow);
    if (next) buttons.current.get(next)?.focus();
  }, [allItems]);
  const groupTitle = useCallback((item: DrawnItem) => groupName(item, (id) => deviceRoom(resolvedRooms, id)), [resolvedRooms]);

  return (
    <div ref={boxRef} className="picture-view">
      {pictures.kind === "none" && (
        <div className="picture-view-empty" role="status">
          <div className="body-text">The pictures of the villa are not ready yet.</div>
          <div className="muted body-text">They are made the next time {MAKERS} opens VESTA UI on a computer or phone.</div>
        </div>
      )}
      {pictures.kind === "loading" && (
        <div className="picture-view-empty"><div className="spinner" role="status" aria-label="Loading the villa pictures" /></div>
      )}
      {layout.map(({ floor, rect }) => (
        <div key={floor.floor} className="picture-floor"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
          <img className="picture-floor-image" alt={`Floor ${floor.label}`} draggable={false}
            src={viewUrl(night ? floor.night : floor.day, pictures.kind === "ready" ? pictures.version : undefined)} />
          <svg className="picture-rooms" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {/* ⚠️ A CURTAIN SHOWS AS IT IS (owner, 2026-11-25): the pictures show every cover open, so the pose its
                state asks for now (the 3D view's rule: meshVariants) is drawn over it, outlined, unless it is open */}
            {coverPoses.filter((c) => c.floor === floor.floor).map((c) => (
              <rect key={c.id} className="picture-cover" x={c.u0} y={c.v0} width={Math.max(c.u1 - c.u0, 0.004)}
                height={Math.max(c.v1 - c.v0, 0.004)} />
            ))}
            {manifest!.rooms.filter((r) => r.floor === floor.floor && lit.rooms.has(roomKey(r.name))).map((r) => (
              <polygon key={r.name} className="picture-room-glow" points={r.pts.map(([u, v]) => `${u},${v}`).join(" ")}
                fill={lit.alarms?.has(roomKey(r.name)) ? STATUS_COLOR.warn : STATUS_COLOR.active}
                stroke={lit.alarms?.has(roomKey(r.name)) ? STATUS_COLOR.warn : STATUS_COLOR.active} />
            ))}
          </svg>
          {/* ⚠️ A LAMP ON SHOWS ON THE PICTURE (owner, 2026-11-25: "i can't see the light ON on the villa map"): the
              picture is taken with every lamp dark (EntityVisuals.lampsOff), so each lamp this profile may see that is
              on now (the 3D view's own lamp set: entity-map type "light") is a warm pool drawn at its spot */}
          {manifest!.badges.filter((b) => b.floor === floor.floor && entities[b.id]?.state === "on"
            && looks.typeOf(b.id) === "light" && panelMapping(b.id, config.entityMap, role, entities[b.id], { control: false }))
            .map((b) => (
              <span key={b.id} className="picture-lamp-pool"
                style={{ left: `${b.u * 100}%`, top: `${b.v * 100}%`, width: size * 2.4, height: size * 2.4 }} />
            ))}
          {manifest!.badges.filter((b) => b.floor === floor.floor && entities[b.id]?.state === "on"
            && looks.typeOf(b.id) === "fan" && panelMapping(b.id, config.entityMap, role, entities[b.id], { control: false }))
            .map((b) => (
              <span key={b.id} className="picture-fan-turn"
                style={{ left: `${b.u * 100}%`, top: `${b.v * 100}%`, width: size * 1.8, height: size * 1.8 }} />
            ))}
          <span className="picture-floor-label">{floor.label}</span>
        </div>
      ))}
      {allItems.map((b) => {
        const setRef = (el: HTMLButtonElement | null) => { if (el) buttons.current.set(b.key, el); else buttons.current.delete(b.key); };
        if (b.ids.length === 1) {
          return (
            <PictureBadge key={b.key} b={b} size={size} label={label(b.ids[0])} setRef={setRef}
              onTap={(x, y) => onEntityPicked(b.ids[0], x, y)} onHold={(x, y) => onEntityLongPressed(b.ids[0], x, y)}
              onArrow={(arrow) => moveFocus(b, arrow)} />
          );
        }
        const title = groupTitle(b);
        const open = () => onClusterPicked(title, b.ids, []);
        return (
          <PictureBadge key={b.key} b={b} size={size} setRef={setRef}
            label={`${b.ids.length} devices${b.room ? ` in ${b.room}` : ""}, open their list`}
            onTap={open} onHold={open} onArrow={(arrow) => moveFocus(b, arrow)} />
        );
      })}
    </div>
  );
}

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** One badge: a button at its spot. A tap, a click, OK (Enter) or Space taps; a hold of the finger, the mouse, OK or
 *  Space holds (the 3D map's LONG_PRESS_MS); an arrow moves to the next badge that way. */
function PictureBadge({ b, size, label, setRef, onTap, onHold, onArrow }: {
  b: Drawn; size: number; label: string;
  setRef: (el: HTMLButtonElement | null) => void;
  onTap: (x: number, y: number) => void; onHold: (x: number, y: number) => void; onArrow: (arrow: Arrow) => void;
}) {
  const el = useRef<HTMLButtonElement | null>(null);
  const centre = (): [number, number] => {
    const r = el.current?.getBoundingClientRect();
    return r ? [r.left + r.width / 2, r.top + r.height / 2] : [b.x, b.y];
  };
  const hold = useLongPress(() => onHold(...centre()), { holdMs: LONG_PRESS_MS, nativeButton: true });
  // OK on a remote is Enter, whose native click comes on the key's DOWN: timed here instead (HUD's floor buttons),
  // so holding it is a hold and a press a tap
  const enter = useRef<{ timer: ReturnType<typeof setTimeout> | null; held: boolean }>({ timer: null, held: false });
  return (
    <button ref={(x) => { el.current = x; setRef(x); }} type="button"
      className={`picture-badge${b.rank === 2 ? " urgent" : ""}${b.pill !== null ? " picture-group" : ""}`}
      data-entity={b.ids.length === 1 ? b.ids[0] : undefined} data-group={b.ids.length > 1 ? b.ids.join(" ") : undefined}
      aria-label={label} title={label}
      style={{ left: b.x - size / 2, top: b.y - size / 2, width: size, height: size }}
      onClick={() => { if (!hold.consumeClick()) onTap(...centre()); }}
      onPointerDown={hold.onPointerDown} onPointerUp={hold.onPointerUp} onPointerLeave={hold.onPointerLeave}
      onPointerCancel={hold.onPointerCancel} onPointerMove={hold.onPointerMove}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (ARROWS.has(e.key)) { e.preventDefault(); onArrow(e.key as Arrow); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.repeat || enter.current.timer) return;
          enter.current.held = false;
          enter.current.timer = setTimeout(() => { enter.current.timer = null; enter.current.held = true; onHold(...centre()); }, LONG_PRESS_MS);
          return;
        }
        hold.onKeyDown(e);
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter") {
          // a tap only for a press this badge timed (not the end of one that began elsewhere)
          if (enter.current.timer) { clearTimeout(enter.current.timer); enter.current.timer = null; onTap(...centre()); }
          enter.current.held = false;
          return;
        }
        hold.onKeyUp();
      }}>
      {b.pill === null ? <img src={b.src} alt="" draggable={false} /> : <GroupFace pill={b.pill} mark={b.mark} />}
    </button>
  );
}

/** A group badge's face: a resting badge's square (its surface and hairline, at the badge picture's own square inside
 *  its pill margin), its count pill in the middle and its members' most urgent mark on the corner a badge wears it. */
function GroupFace({ pill, mark }: { pill: string; mark: Drawn["mark"] }) {
  const rest = categorySurface("others", "off");
  const corner = mark ? markImage(mark) : null;
  return (
    <span className="picture-group-square" style={{ background: rest.fill, borderColor: rest.ring ?? "transparent",
      inset: `${(1 - 1 / PICTURE_SCALE) * 50}%`, borderRadius: `${BADGE_CORNER_FRACTION * 100}%` }}>
      <img className="picture-group-count" src={pill} alt="" draggable={false}
        style={{ width: `${GROUP_PILL_OF_SQUARE * 100}%`, height: `${GROUP_PILL_OF_SQUARE * 100}%` }} />
      {corner && (
        <img className="picture-group-mark" src={corner.src} alt="" draggable={false} style={{
          width: `${corner.size * 100}%`, top: `${-corner.out * 100}%`, right: `${-corner.out * 100}%` }} />
      )}
    </span>
  );
}
