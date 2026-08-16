// src/babylon/EntityVisuals.ts
// Reflect HA entity states onto their 3D meshes. Driven imperatively by
// HAStateStore.subscribeAll (NOT React), then requests a render frame.
//
// Visual feedback per entity type (all driven by the binding's resolved type,
// which is editable in the Config Editor):
//   light         -> the bound object glows AND a real PointLight illuminates
//                    the room; colour follows hs/kelvin, intensity follows
//                    brightness, off = dark.
//   fan           -> emissive teal tint while on.
//   lock          -> green (locked) / red (unlocked) diffuse+emissive tint
//                    (skipped on a pose mesh — see below, its pose already
//                    shows the state).
//   switch/media  -> emissive "active" tint when on/playing.
//   binary_sensor -> pulsing red when triggered (e.g. leak/motion/etc),
//                    skipped on a pose mesh for the same reason lock's tint
//                    is.
//
// POSE SWAP (mesh variants) — ONE rule, every entity type, no exceptions:
//   OPT-IN: if an object was authored as 2+ alternate meshes named
//   "<entity_id>__<word>" (see EntityMap.extractVariantSuffix), the one
//   matching live state is shown and the rest hidden. A villa with just the
//   plain, unsuffixed mesh is unaffected — that mesh stays visible always,
//   exactly as if this didn't exist.
//
//   The word is simply the entity's LIVE STATE, sanitised the same way a mesh
//   suffix is parsed (lowercased, non-alphanumerics stripped —
//   sanitizeVariantWord), so "__on"/"__off" for a switch or binary_sensor,
//   "__open"/"__closed" for a cover, "__locked"/"__unlocked" for a lock,
//   "__clean"/"__dirty" for a pool sensor, one pose per value for any
//   enum-like sensor. There is NO per-type vocabulary and no translation
//   table: what HA reports is what you name the mesh.
//
//   "half" is the single VIRTUAL word — no HA state string produces it — and
//   it is available to EVERY type, not just cover: an entity is "part-way"
//   when a numeric level attribute (current_position / brightness /
//   percentage / volume_level) sits between its extremes, or when its state
//   is transitional (opening/closing/locking/…). So "cover.x__half" and
//   "light.y__half" mean the same thing through the same code.
//
//   A state nobody authored a mesh for — including "unavailable"/"unknown"
//   and a lock's "jammed" — resolves to the LOWEST-ranked authored pose (see
//   WORD_RANK), i.e. the rest/off/closed/locked one. That one rule replaces
//   every previous per-type fail-safe.
//
//   See desiredVariantWord / orderVariantWords / applyStateNamedVariant.

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
// Imported for its REFRESHRATE_* constants only (see syncEntityShadow). Adds
// nothing to the bundle — ShadowGenerator already pulls this module in.
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { Viewport } from "@babylonjs/core/Maths/math.viewport";
// Type-only: annotates the viewport cullLabels already computes and passes to
// Vector3.ProjectToRef. A `import type` adds no runtime import, so it cannot
// disturb the side-effect import discipline this file depends on elsewhere.
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
// Side-effect only: patches the renderOutline/renderOverlay setters onto
// Mesh.prototype (used below for the climate red outline). @babylonjs/core's
// barrel used to pull this in for free; a deep import doesn't — see
// SceneManager.ts's own copy of this import for the fuller explanation and
// the sibling-file convention (Ray/beginDirectAnimation) this follows.
import "@babylonjs/core/Rendering/outlineRenderer";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { StackPanel } from "@babylonjs/gui/2D/controls/stackPanel";
import { Image } from "@babylonjs/gui/2D/controls/image";
import { Control } from "@babylonjs/gui/2D/controls/control";
import type { AppConfig } from "@/config/AppConfig";
import { roomKey, NO_ROOM_LABEL } from "@/config/roomKey";
import { chipProportions } from "@/config/chipProportions";
import {
  badgeMetricsFor, detectPointerClass, observePointerClass, type BadgeMetrics, CHIP_MAX_VIEWPORT_FRACTION, CARD_MAX_VIEWPORT_FRACTION,
  PHONE_MAX_CSS_WIDTH, PHONE_MAX_TOTAL_CHIPS,
} from "./badgeMetrics";
import { badgeRank } from "./badgePriority";
import {
  viewBasis, projectToView, VIEW_BASIS_STEPS,
  type ViewBasis, type ProjectedPoint, type ProjectionMode,
} from "./badgeProjection";
import {
  solvePlacement, markContacts, createPlacementScratch,
  mergeCollidingPiles, buildCliques,
  type PlacementItem, type PlacementScratch, type PlacementStats,
} from "./badgePlacement";
import { clampIconScale } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";
import { resolveMeshToMapping, extractVariantSuffix, inferTypeFromEntityId } from "@/config/EntityMap";
import { groupMemberIds, groupForPrimary } from "@/config/deviceGroups";
import { effectiveCategory, categorySurface, categorySurfaceRinged } from "@/config/EntityCategories";
import { badgeKindFor, badgeFaceAndRing } from "@/utils/deviceActivity";
import type { BadgeKind } from "@/utils/deviceActivity";
import { hsToRgb, kelvinToRgb } from "@/utils/colorUtils";
import { isUnavailable } from "@/utils/stateColors";
import { phantomEntity } from "@/utils/phantomEntity";
import { tapDebug } from "@/utils/tapDebug";
import { debugFlagEnabled } from "@/utils/devLog";
import { beginSpan } from "@/utils/perfSpans";
import { clipPolygonToConvex, distanceToPolygonBoundary, pointInPolygon, type Pt2 } from "@/utils/geometry";
import { formatCountBadge } from "@/utils/countBadge";
import { RoomHighlight } from "./RoomHighlight";
import { CameraBeams, type BeamSource } from "./CameraBeams";
import { blocksCameraBeam } from "./meshRoles";
import { FloorProbe } from "./floorProbe";
import { axisWorldScale } from "./meshUnits";
import { LightPool, poolFootprint } from "./LightPools";
import { badgeImageDataUrl, BADGE_INSET_CARD, BADGE_CORNER_FRACTION } from "./badgeIcons";
import { badgeText } from "./badgeText";
import {
  arrange, gridCells, MAX_TOTAL_CHIPS, MAX_GRID_CHIPS, PHONE_MAX_GRID_CHIPS,
  type CardArrangement,
} from "./badgeCard";
import { iconKeyFor } from "./badgeIconKeys";
import { ALERT_RED, ALERT_RED_HEX, UNAVAILABLE_AMBER, AVAILABLE_GREEN_HEX } from "./colors";
import { COSMETIC_MAPPING_FIELDS } from "./entityMapDiff";
// Pose-word resolution (which "__<word>" mesh variant a live state asks for)
// — pure logic, extracted to keep this file to the things that actually touch
// the scene. See meshVariants.ts for the vocabulary rules themselves.
import {
  pickNearestVariant, desiredVariantWord, orderVariantWords,
} from "./meshVariants";
// Pure label/chip overlap geometry — see labelLayout.ts.
import { chipWidthPx, fitChipLabel } from "./labelLayout";

const WARM_GLOW = new Color3(1.0, 0.89, 0.63);
const MAX_LIGHT_INTENSITY = 1.3;
// Baseline emissive for an UNWIRED light marker (no HA state yet). SweetHome
// ceiling spots / LED strips export as small placeholder spheres; at the old
// 0.18 they were almost invisible — especially the clustered ones (Bedroom 1
// ceiling, the living-room LED strips) where 12 faint 10 cm dots at the ceiling
// read as "missing". Lifted so every fixture reads as a real object before it's
// wired; applyToMesh still overrides this from live HA state (on = bright, off
// = black).
const LIGHT_BASELINE_GLOW = 0.5;
// Room-scale reach for a fixture's PointLight. An early value (8 m) lit straight
// through walls into the next room because point lights have no occlusion of
// their own — only the entity's REPRESENTATIVE light is wall-blocked by the
// per-entity shadow below; any extra un-shadowed markers of a multi-marker strip
// rely purely on this range to stay out of the adjacent room. 4 m is a deliberate
// middle ground (rooms were reading as barely lit at the old 2.8 m) — if a light
// starts bleeding into a neighbouring room, especially at night, shrink this
// back down rather than raising it further.
const LIGHT_RANGE = 4;
// Floor-pool radius for BAKED-mode lights (see LightPools.ts) — a separate
// knob from LIGHT_RANGE above, which only matters for the real PointLight
// non-baked villas get (baked structure is unlit and can't be reached by a
// PointLight at all, at any range/intensity — that's the whole reason the
// pool trick exists).
const LIGHT_POOL_RADIUS = 1.8;
/** Floor for the radius of a pool that belongs to NO room polygon and so is
 *  bounded by the nearest room's edge instead (see reshapeLightPools). Without
 *  a floor, a fixture standing right on a boundary would shrink to nothing and
 *  read as an unlit lamp; a small pool is a better answer than none. */
/**
 * The cell ceiling for a FOCUSED group's card — the one a room chip's tap
 * produces.
 *
 * MAX_TOTAL_CHIPS (6) is set by the summary-vs-summary clearance test: a wide
 * arrangement claims a wide disc and starts escalating rooms to their chip. A
 * focused group is seated UNCONDITIONALLY and can never escalate its room, so
 * that test — the entire reason for the cap — does not apply to it.
 *
 * ⚠️ 2.304.0 let a focused pile exceed the cap and fall through to a COUNT
 * badge, and wrote it up as a deliberate trade against overlapping cards. It
 * was neither deliberate nor a trade the user had left open: tapping a room
 * must show that room's DEVICES, which had been stated twice, and an "8" in
 * the middle of the pool is the same answer the chip already gave. Both had to
 * go, and the way to have both is a card that can actually draw its members.
 *
 * The real bound is physical and already exists — the width budget, which
 * `arrange` wraps into — so a focused group has NO cell ceiling of its own.
 *
 * ⚠️ There WAS one, `FOCUS_MAX_CHIPS = 12`, and it was chosen as "high enough
 * that the viewport is what decides". It wasn't. A focused pile of nineteen
 * (a Living Room tap) hit it, `gridCells` refused anything over its max by
 * returning ZERO cells, and zero cells is a count badge — so the one code path
 * that must never produce a number produced a "19". A fixed ceiling next to a
 * physical one is always a second bound that can bind first, and the fix is
 * not a bigger number: it is no number. `cellMax` returns the group's own
 * membership for a focused group, so the clamp can never be the thing that
 * refuses, and the budget stays the only bound.
 */
const POOL_MIN_RADIUS = 0.4;
/** How far a pool sits above the floor it was probed onto. Enough to clear
 *  z-fighting with the floor polygon, small enough that it still reads as
 *  lying ON it rather than hovering. */
const POOL_FLOOR_LIFT = 0.02;
/** Clamp a per-light intensity override (Advanced Settings, -100%..+100%,
 *  stored as -1..1) to a safe range — a stale/hand-edited config value
 *  outside that range must not blow the fixture out or invert it. */
function clampRatio(ratio: number | undefined): number {
  return Math.max(-1, Math.min(1, ratio ?? 0));
}


// A SweetHome "line light" (the Sweet Home Light plugin's linear LED strip) is
// mounted flush against a ceiling/wall. A PointLight placed ON the strip sits
// centimetres from that surface, so it prints a hard bright pool right there —
// and sampling several lights along the strip (tried in v2.4.72) just prints a
// CHAIN of pools, reading as separate bulbs instead of a line. The continuous
// "LED line" look must come from the strip mesh's own emissive colour
// (view-independent), NOT from dynamic lights. The dynamic light's only
// job is the soft ambient wash on the room, so for elongated strips we push it
// DOWN toward the floor, well clear of the mounting surface, where its pool is
// wide and soft instead of a tight hotspot.
const STRIP_MIN_LENGTH = 1.5; // metres — fixture meshes longer than this are "strips"
const STRIP_DROP_FRACTION = 0.45; // drop the light this fraction of the way to the floor
const STRIP_DROP_MAX = 1.1; // metres — cap the drop so tall rooms don't put it at knee height
// SweetHome's Led Line asset is modelled just 1 cm wide (and 3 cm tall) — from
// almost any camera angle/distance that's under a pixel on screen, so the
// rasteriser only lights a handful of scattered sub-pixel samples along its
// 2.5-3 m length. WHICH samples survive depends on the exact camera position,
// so the visible line looks patchy and seems to shift/break up as the camera
// moves — this is the actual mechanism behind "the light beams changing based
// on camera position", not the dynamic PointLight (fixed in v2.4.73, didn't
// help because it was never the cause). Fix at the geometry: thicken the
// mesh's thinnest axis to a minimum so it always covers several pixels.
const MIN_STRIP_THICKNESS = 0.06; // metres (6 cm) — still reads as a slim cove strip
// The Led Line asset's baked material ("LedLineSource") is a bright, near-white
// self-lit surface — meant to look like a light source in SweetHome's OWN
// renderer. While the filament was sub-pixel-thin (the bug just fixed above)
// that base colour never mattered; now that inflateThinStrip gives it real
// ~6cm geometry, that same bright base reads as a solid glossy white tube
// whenever the light is OFF (applyToMesh only ever overrides the EMISSIVE
// channel for on/off, never this base colour). Applied ONLY to meshes
// inflateThinStrip actually inflates (the genuine filament pieces), so real
// fixture geometry (lamp bodies, housings with their own baked look) keeps
// its authored material.
//
// The colour is deliberately a soft plaster-grey, NOT a dark "housing" tone:
// a dark strip against white ceilings/walls is maximal contrast — from the
// overview it printed as bold black frames above the beds, worse than the
// white tube it replaced. Off-state unobtrusiveness comes from
// STRIP_OFF_VISIBILITY below, not from the colour; the colour's only job is
// to blend with the ceiling around it for whatever alpha remains.
const LED_HOUSING_COLOR = new Color3(0.8, 0.79, 0.77);
// The inflated ~6cm bar is sized for the ON state, where the emissive core
// needs several on-screen pixels to read as one continuous line. When the
// light is OFF that same bar is just dead geometry, and no
// base colour can make a 6cm slab at ceiling height look like the ~1cm
// recessed channel it really is. So the OFF state turns the strip
// see-through — the SAME technique as window glass (ModelLoader): material
// alpha + MATERIAL_ALPHABLEND + forceDepthWrite. Material-level alpha rather
// than mesh.visibility on purpose: forceDepthWrite is a material flag, and
// without depth writing Babylon sorts transparent meshes back-to-front per
// frame, which can flip against the (also transparent) glass walls as the
// camera moves — the exact appear/disappear glitch ModelLoader documents for
// glass vs. strips. Transparency does not affect pickability, so an off
// strip stays clickable exactly where its faint trace shows. Every light
// fixture mesh gets this treatment now, strip or not (see applyToMesh) — a
// smart light should read as "off" the instant HA says so, not stay a
// permanently solid, statically-coloured prop just because it happens to be
// nicely modelled geometry rather than stand-in placeholder geometry.
// When the light is ON, applyToMesh restores alpha 1 + MATERIAL_OPAQUE, so
// the on-state render path is byte-identical to before this existed.
const STRIP_OFF_ALPHA = 0.25; // slightly clearer than window glass (0.38)
// A rectangular LED cove (dining-table/sofa perimeter) is built from 4
// separate straight strip pieces (top/bottom/left/right), one per side. Their
// authored endpoints don't always reach far enough to overlap at the
// corners — confirmed straight from the .sh3d source coordinates (not a
// camera-angle or occlusion effect): the sofa rectangle's top-right corner
// has the top piece ending at y≈654.05 while the right piece only starts at
// y≈654.84, a real ~0.8cm gap baked into the model. There's no emissive
// geometry in that gap, so it reads as a hard, camera-angle-
// INDEPENDENT "cut" in the line — easy to mistake for the nearby furniture
// blocking it, when nothing is actually occluding anything. Stretch every
// strip mesh belonging to a multi-piece light entity past its own modelled
// endpoints by this margin (safely bigger than the largest gap measured
// above) so adjacent pieces always overlap at their shared corner. Skipped
// for single-mesh light entities — there's no joint to close, and no camera
// angle where this could look wrong (the extension is a fixed absolute
// distance, not a scale, so it can't blow up — same lesson as
// inflateThinStrip's earlier bug).
const STRIP_JOINT_EXTENSION = 0.02; // metres (2 cm) past each modelled endpoint
// Cube shadow maps for point lights are 6 faces each, so keep them small. We cast
// ONE per light ENTITY (the markers of a strip are clustered, so a single occluder
// covers them) and only while the light is on, so an idle/off light costs nothing.
const LIGHT_SHADOW_SIZE = 256;
// Climate-running outline: same forward-pass outline+overlay technique as the
// blue "clickable" highlight (see SceneManager.applyHighlight for why — a
// Mesh.renderOutline/renderOverlay pair, not a screen-space EffectLayer).
// Always on while the thermostat is running, independent of the "highlight
// clickable objects" preference — this is a live status signal, not a
// discoverability hint.
// Same red as the room-presence glow / badge alert ring — see colors.ts.
const CLIMATE_ON_COLOR = ALERT_RED;
const CLIMATE_OUTLINE_WORLD_WIDTH = 0.04; // metres, matches the blue outline's rim
// World-space clearance added above a mesh-bound entity's bounding-box top when
// placing its state-label anchor, so the badge floats just clear of the
// geometry instead of sitting flush on it.
const LABEL_ANCHOR_MARGIN = 0.12;
// Every badge DIMENSION now lives in badgeMetrics.ts, in CSS pixels, chosen by
// pointer class — including the container height, the value pill, the badge
// diameter and the card block that used to sit below. They were literals here
// and they were in RENDER pixels, so "44px, the app-wide --touch-min, because
// this is a wall tablet operated standing up by someone who has never seen it
// before" painted 22 CSS px on that tablet. That file's header has the full
// account; what matters here is that a dimension may no longer be written down
// in this one, or the two spaces drift apart again.

// Every piece of text this file draws is created by badgeText() — the font
// stack, the weight, the centring and the optical correction all live there,
// because five properties had to be set on each of four TextBlocks and one of
// them (resizeToFit) had quietly drifted apart between them. `new TextBlock`
// does not belong in this file; see badgeText.ts for the whole argument.

// The app-wide --touch-min (styles.css), in CSS px. pickBadgeAt expands a
// badge's hit area up to this whenever the PAINTED badge is smaller — which
// is the whole point of letting a fine pointer have a smaller badge.
const TOUCH_MIN_CSS_PX = 44;
// Floor on that expansion, so a badge already at or above --touch-min still
// forgives a slightly-off tap exactly as it did before this was derived.
const TAP_SLOP_MIN_CSS_PX = 10;
// Unit offsets for pickBadgeAt's two sampling rings: the exact hit, then 8
// directions at half slop, then the same 8 at full slop. Flat [cos,sin,...]
// pairs so a tap allocates nothing at all.
const TAP_RING_UNIT: readonly number[] = (() => {
  const out: number[] = [0, 0];
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 8; k++) {
      const a = (Math.PI / 4) * k;
      out.push(Math.cos(a), Math.sin(a));
    }
  }
  return out;
})();

// ── "card" badge style (config.badgeStyle==="card") — a horizontal category-
// coloured card with an icon chip + value, instead of the classic vertical
// squircle+pill. Both are the SAME LabelControls (container/badge/glyph/
// valueWrap/valueText), just arranged differently; `badge` stays the single
// tappable region (badgeContaining hit-tests it), so pickBadgeAt is unchanged.
// The card is filled from categorySurface's state-driven colour (neutral by
// default, category- or danger-tinted only when active/alerting — see
// VESTA-DESIGN.md §0), carrying the baked squircle icon (badgeImageDataUrl,
// whose glyph stroke matches that same state) and white text.
// The CLASSIC style's value pill is a dark stadium of its own, so its text is
// fixed white regardless of theme. The CARD style has no such backing — its
// text sits directly on the badge surface, which is now neutral and
// theme-driven (see categorySurface), so a fixed white there is white-on-white
// in the light theme. Card text takes the surface's own glyph colour instead;
// this constant is only the classic pill's.
const PILL_TEXT = "#f8fafc";

// Entity types compactValue() can EVER return non-empty text for — must stay
// in sync with that switch. Used by labelBoxes to reserve pill-sized
// clearance around these regardless of whether the current state actually
// has a pill showing (see the long comment there for why "capable of" beats
// "currently has one" for collision-box sizing).
const PILL_CAPABLE_TYPES = new Set<EntityType>(["light", "fan", "cover", "climate", "sensor"]);

/**
 * Badge layout: EVERY visible badge sits at a fixed pixel offset directly
 * above its own anchor — never nudged, never resized to dodge a neighbour.
 * That offset is a pure function of (anchor projection, icon scale): with
 * the camera and scale held still it is bit-for-bit identical every frame,
 * and with the camera orbiting it moves ONLY because the anchor's own screen
 * projection moved, exactly like every other object glued to the 3D scene.
 * A device's badge is therefore always in the same place relative to that
 * device — the whole point being that a user builds finger memory for where
 * a given device's badge lives and that memory is never invalidated by
 * rotating the view.
 *
 * An earlier design instead nudged colliding badges apart with a force
 * relaxation. That solver is only stable while a non-overlapping layout for the exact
 * current badge set actually EXISTS. Zoomed out far enough, or from certain
 * angles, it doesn't: the solver never converges, and — because "which axis
 * has least penetration" and "which way do I push" are knife-edge branches
 * whose flips cascade through the whole cluster — lands in a completely
 * different equilibrium on every frame, or drifts continuously as the
 * camera orbits and neighbours' positions shift. On a moving camera that
 * reads as badges "dancing" (reported from the field, twice, with screen
 * recordings, even after capping the nudge distance). Any amount of
 * per-badge nudging reintroduces some version of this, so badges now use
 * NONE at all.
 *
 * What used to be solved by nudging-then-dropping is solved instead by
 * grouping: when a room's own badges collide with anything on screen (each
 * other, or a neighbouring room's), ALL of that room's currently-visible
 * badges hide together and one room-cluster chip (updateClusters) takes
 * their place, anchored at the room's world-space centroid — a fixed 3D
 * point, so the chip is exactly as stable as the badges are. A room with
 * room to breathe keeps every one of its badges pinned at their exact
 * anchors; only a genuinely crowded room gives way to its chip.
 *
 * There is no hysteresis on that transition, and there must never be — the
 * next block explains why the flicker it was once added to damp is a symptom
 * of screen-space grouping rather than a thing to be damped.
 */
/**
 * Grouping thresholds. The ONE decision they govern: when a room's own badges
 * give way to that room's cluster chip.
 *
 * ── Why this is NOT measured in true perspective screen space ─────────────
 *
 * Every previous version tested whether badges overlapped in the renderer's
 * own projection. That is the intuitive test, and it is the reason two
 * separate field bugs kept coming back, because it is a function of the whole
 * camera pose — POSITION included:
 *
 *   - Panning/orbiting silently re-grouped rooms, since the projected gap
 *     between two fixed 3D points changes with viewing angle.
 *   - Worse, returning to the EXACT view you started from did not restore
 *     the state you started with, because the enter/exit hysteresis that
 *     stopped the resulting flicker made grouping depend on the PATH taken,
 *     not just the destination. Reported verbatim: badges group while
 *     sliding the camera, then stay grouped once you slide back.
 *
 * Hysteresis cannot fix that — it IS that. Path-dependence is what
 * hysteresis means. So the fix is to remove the need for it: make grouping
 * a pure function of inputs that DON'T change when the camera merely moves.
 *
 * This is exactly what every serious map engine does (Google/Apple Maps,
 * Mapbox's Supercluster, Google Earth): markers are clustered in geographic
 * space against a radius derived from the ZOOM LEVEL alone. Panning and
 * rotating a map never re-cluster it; only zooming does, and zooming back
 * out reproduces precisely the clusters you had before. That is the
 * behaviour being asked for here, arrived at for the same reason.
 *
 * So: badges are grouped by their distance ON THE VIEW PLANE — their world
 * anchors ORTHOGRAPHICALLY projected through the camera's quantised view
 * direction and quantised zoom, in the same GUI pixels the badge is drawn in
 * (babylon/badgeProjection). Camera POSITION cannot influence it at all,
 * because an orthographic projection of a difference vector is invariant to
 * it: panning and dollying regroup nothing. Zoom and view direction can, and
 * both do so reversibly. No hysteresis anywhere, so the same view always
 * renders the same way.
 *
 * Between 2.114.0 and 2.286.0 this was a WORLD distance with only the vertical
 * axis foreshortened, and it was measurably wrong: it credited the depth axis —
 * horizontal, running along the view — with up to 5.9x the separation the view
 * actually draws, and could not express the case where depth and height cancel
 * onto the same screen axis. Measured on hardware in 2.286.0, overlapping drawn
 * badges went from zero near top-down to 5 on a laptop and 20-30 on a phone as
 * the camera approached horizontal. badgeProjection has the derivation.
 *
 * Until 2.114.0 this was the GROUND PLANE only (X/Z), on the reasoning that a
 * villa is a floor plan so ground distance proxies on-screen separation. It
 * does — for two devices at similar heights. It fails where mounting heights
 * differ by metres: a ceiling fan and the table lamp under it are the SAME
 * POINT on the ground plane, so they grouped, while the full 3D projection
 * that DRAWS them put them far apart on screen. Height is now part of the
 * distance. Note what did NOT change: the inputs are still anchor positions
 * and zoom, both independent of where the camera is looking from, so the
 * screen-space coupling that six earlier attempts died on is still absent.
 *
 * ── What may move a badge: NOTHING (2.206.0) ─────────────────────────────
 * A badge sits on its anchor's projection, or it is not drawn. 2.175.0 did
 * allow one exception — a pile opened out onto a ring — on the reasoning that
 * reshuffling rather than movement was the real fault, and that a ring seated
 * by world bearing could not reshuffle. That reasoning was wrong for a reason
 * it did not anticipate, and the ring is gone. See the "A BADGE NEVER MOVES"
 * block in cullLabels for what it was and why no budget above zero survives.
 */
/**
 * THE KILL SWITCH for 2.232.0's placement change.
 *
 * `"priority"` ranks a crowded pile and keeps the devices that matter as real
 * badges; `"legacy"` restores 2.231.0 exactly — any pile of two or more
 * summarises whole. One word, one rebuild, and the old behaviour is back,
 * which is the safety a subsystem with six failed rewrites behind it should
 * ship with when everything lands in a single release.
 *
 * The `as` is load-bearing: without it TypeScript narrows the constant to its
 * literal type and reports the other branch as unreachable under
 * `noUnusedLocals`, so the switch would stop compiling the moment it was
 * needed. Do not "clean it up".
 */
const BADGE_PLACEMENT = "priority" as "priority" | "legacy";

/** Zoom is quantised to steps of 1/N of a doubling before it feeds the
 *  grouping radius — the direct equivalent of a map engine clustering per
 *  discrete zoom level. Inside a step nothing re-groups at all, so a slow
 *  pinch can't sit exactly on a threshold and chatter; crossing one is a
 *  single clean change, and crossing back undoes it exactly. */
const GROUP_ZOOM_STEPS_PER_DOUBLING = 3;
/**
 * ⚠️ VERTICAL_FORESHORTEN_STEPS lived here and is GONE (2.287.0). It quantised
 * the COSINE of the tilt into 8 steps, and it was only half a correction: it
 * foreshortened world HEIGHT and left world DEPTH — the horizontal axis running
 * ALONG the view — credited at full length, which at this camera's shallowest
 * tilt is 5.9x more separation than the view actually draws. Placement now
 * projects onto the view plane instead (see babylon/badgeProjection, which
 * carries the derivation, the hardware measurements that graded the bug by
 * tilt, and the trap waiting for anyone tempted to reinstate the old constant).
 *
 * The kill switch for that whole change. `"world3d"` restores the pre-2.287.0
 * geometry — depth at full length on its own axis, height foreshortened, added
 * in quadrature — everywhere, including the orbit camera.
 *
 * BADGE_PLACEMENT does NOT protect against the projection: legacy mode still
 * calls `conflicts`, and what changed is the space `conflicts` measures in. A
 * subsystem with six failed rewrites behind it does not land its seventh
 * without a one-word revert of its own.
 *
 * The `as` cast is load-bearing under noUnusedLocals — it keeps the other arm
 * of the union reachable to the type checker. Do not "clean it up".
 */
const VIEW_METRIC = "plane" as ProjectionMode;
/** Reused, because getDirectionToRef takes the local axis by reference. */
const CAMERA_LOCAL_FORWARD = new Vector3(0, 0, 1);
/**
 * How much of its own width a badge ICON may overlap a neighbour before the
 * two count as piled together.
 *
 * This is THE control over how large badges can get before a room summarises,
 * and there are only ever three ways to resolve two badges that want the same
 * pixels: let them overlap, move one, or merge them. Moving is ruled out (it
 * is the fan, removed in 2.159.0 — see the file header), so the choice is
 * between this number and how early the room chip appears. They are the same
 * dial read from two ends.
 *
 * Back to ZERO in 2.173.0, and it should stay there. It was raised to half a
 * width in 2.168.0 as the only lever available while badges were pinned to
 * their anchors — the size ceiling had to be bought from somewhere, and
 * overlap was all there was. 2.169.0 let badges move again, which buys the
 * same headroom without the cost, so the tolerance became a licence to
 * overlap that nothing needed. Reported, correctly, as badges sitting on top
 * of each other.
 */
const GROUP_OVERLAP_ALLOW_WIDTHS = -0.15;
/*
 * ── WHY IT IS NEGATIVE (2.292.0), AND WHY THAT IS NOT THE 2.168.0 MISTAKE ──
 * Read as written, this is "how much of its own width a badge may overlap a
 * neighbour". A NEGATIVE value is the opposite request: every clearance test
 * must reserve 15% MORE than the ink it is protecting. It is the same dial,
 * turned the other way, and the paragraph above — which says the tolerance
 * should stay at zero — is a warning about raising it, not about lowering it.
 *
 * It pays for the one thing 2.287.0 bought its correctness with. Placement is
 * measured on an orthographic view plane at ONE pixels-per-world for the whole
 * scene; the renderer divides every drawn thing by its OWN depth. Two objects
 * further from the camera than the zoom rung's reference depth therefore draw
 * closer together than the plane predicted, by the ratio of those depths, and
 * nothing inside a position-invariant metric can know that ratio — knowing it
 * is precisely what "invariant to where the camera stands" forbids.
 *
 * So it is not an error to be removed, it is a bounded approximation to be
 * covered, and 15% is what the field numbers cost: after 2.291.0 the residual
 * was one to five overlapping badge pairs out of twenty to thirty-four drawn,
 * one summary pair inside a narrow band of tilt, and one or two things over a
 * room chip — small, and always in the direction of the plane over-estimating
 * separation. This buys all three at once because all three read `allow`.
 *
 * The cost is stated: everything merges very slightly earlier, so a crowded
 * corner reaches its summary card, and a summary reaches its room chip, at a
 * marginally wider zoom than before. That is the trade this dial has always
 * been — "how large badges can get before a room summarises" — and it is the
 * right side of it, because a badge that has merged is still reachable through
 * its card while a badge drawn under another one is not.
 *
 * ZERO restores the pre-2.292.0 geometry exactly.
 */
/**
 * Do room chips take part in the collision they were the answer to?
 *
 * Until 2.290.0 they did not, and the omission was invisible because it looks
 * like a completed cascade: a crowded room hands its badges to a chip, and the
 * chip is the tier of last resort, so nothing checks it against anything. But
 * `updateClusters` only ever tested chips against OTHER CHIPS. A chip sits at
 * its room's device centroid, which is nobody's badge position and nobody's
 * card position, and it is far wider than either — so a neighbouring room's
 * badge or summary lands on top of it routinely. That is the card sitting on
 * "Staircase" in the top-down screenshots.
 *
 * The resolution is the same one every other tier uses: the thing that can
 * escalate does. A drawn badge or a placed card overlapping a chip sends its
 * OWN room(s) to their own chip — never the other way round, because a chip is
 * already the last tier and has nowhere to go. Rooms are only ever added to
 * `roomClustered`, so the loop is monotone and terminates in at most one round
 * per room.
 *
 * Two spaces, deliberately, and this must not be "tidied up" into one:
 * chip-vs-chip MERGING stays in true perspective (it is cosmetic, post-hoc,
 * cannot feed back into the solve, and being exact there is free), while
 * chip-vs-badge/card ESCALATION uses the view plane, because it decides what
 * is drawn and must stay invariant to where the camera is standing.
 *
 * ⚠️ THAT SENTENCE WAS A LIE FROM 2.290.0 TO 2.298.0, and 2.299.0 is what
 * makes it true. Escalation did use the plane — for the chips' POSITIONS. But
 * the chips it was handed were the MERGED ones, and which chips exist, how
 * many there are and where each sits are all decided by the perspective merge
 * above. A camera-position-dependent computation therefore chose the obstacle
 * set for the one test that decides what is drawn, which is the exact property
 * six rewrites died protecting. Escalation now collides against the UNMERGED
 * per-room chips — one box per chipped room, at that room's own centroid, at
 * its own text width — and merging is applied afterwards, to the render set
 * only, where it genuinely is cosmetic and genuinely cannot feed back.
 *
 * The leak was not theoretical. Merging is a function of screen distance, so
 * zooming in SPLITS a merged pill, and the pieces do not stay where the pill
 * was: each drops onto its own room's centroid, which may be somewhere the
 * obstacle set previously had nothing at all. A room that had decluttered into
 * a summary card then collides with a chip that only just appeared under it,
 * escalates, and collapses back to a chip — one rung after it expanded. That
 * is the reported "Living Room goes chip → entities → chip → entities as I
 * zoom in", captured in sources/files/zoom_in.gif. Panning did the same thing
 * for the same reason and would have been reported as badges dancing again.
 *
 * Unmerged obstacles also restore monotonicity in ZOOM, which the merged set
 * could not have: each box is a fixed pixel size at a fixed world point, so a
 * higher rung strictly increases every separation, and `roomClustered` only
 * shrinks between rungs. Nothing that has expanded can re-collapse without the
 * view direction itself changing.
 *
 * `false` restores the pre-2.290.0 behaviour exactly. It is here because this
 * is the tier that spends chips, and how many chips is too many is a judgement
 * only a screenshot can make.
 */
const CHIP_COLLISION = true as boolean;



/**
/*
 * The minimum clear gap between two badges' drawn footprints now lives in
 * badgeMetrics as `minGapPx` — it is a badge DIMENSION, and keeping it here
 * while the rest moved is how the two spaces drifted apart in the first place.
 * It is a GAP, not an overlap tolerance (see GROUP_OVERLAP_ALLOW_WIDTHS): two
 * badges that merely kiss are legible but read as a smudge from across a room,
 * which is the distance this app is used at.
 */
/* The room chip's and entity group's geometry is DERIVED from the badge's —
 * see EntityVisuals.summaryMetrics. They used to be independent constants here
 * (30px tall, 15px text, floored at their own 0.8 scale) and drifted, drawing
 * a summary noticeably larger than the badges it stood in for. */
/** Neutral slate — NOT the app's own sky-blue accent (tried first: read as
 *  belonging to the Energy category, whose active-state hue is that same
 *  blue — see categoryColor("energy") — a room summary shouldn't look like a device
 *  category), and lighter than the translucent near-black tried before that
 *  (read as "just black" at a glance). Deliberately outside every category
 *  hue (green/orange/purple/gold/blue) so a chip reads as UI chrome — a
 *  navigation affordance, not a device — rather than any category's badge. */
const CLUSTER_BG_COLOR = "#475569"; // fallback only — see --chip-surface
/** Breathing room required between two chips. Chips are never nudged — this is
 *  purely the threshold at which two of them are judged too close and MERGE
 *  into one (see updateClusters). */
const CLUSTER_GAP_PX = 6;
/**
 * One room chip as DERIVED — everything needed to decide where it lands and
 * what it swallows, before a single GUI control is touched.
 *
 * Lifted out of `updateClusters` when that method split into `deriveChips`
 * (pure) and `renderChips`: CHIP_COLLISION has to re-derive the chips several
 * times in one pass, and a function that also writes to the GUI cannot be run
 * in a loop.
 */
interface RoomChip {
  /** roomKey() — identity, and the key its GUI controls live under. */
  key: string;
  /**
   * EVERY roomKey this chip stands for, its own included, growing as it merges.
   * `key` alone was enough while nothing outside the merge loop asked what a
   * chip covered; the collision pass does, and `roomNames` cannot answer it —
   * those are printable spellings, and roomKey() exists precisely because a
   * printable spelling is not an identity.
   */
  keys: string[];
  /** The raw name this chip stands for — the identity a person reads and the
   *  modal title. NOT necessarily what is drawn: see `label`. */
  room: string;
  /**
   * The string actually PRINTED, i.e. `room` (+ any "+N") after truncation to
   * the viewport budget. Set by `measure` so the width the merge test reserves
   * and the width `renderChips` paints are the same string through the same
   * estimator — reserving one width and painting another is this subsystem's
   * oldest rule broken.
   */
  label: string;
  ids: string[]; centre: Vector3; rooms: number; roomNames: string[];
  ringRed: boolean; unavailable: boolean;
  /** True-perspective screen position and half-extents — the merge test only.
   *  The collision test re-projects `centre` onto the view plane instead; see
   *  CHIP_COLLISION for why the two spaces are not the same one. */
  x: number; y: number; halfW: number; halfH: number;
}
/** A merged chip says so with "+N", so the count pill's total is never
 *  mistaken for one room's device count. */
/** The "+N" a chip carries when it has swallowed other rooms, or "" when it
 *  names exactly one. Kept SEPARATE from the room name because fitChipLabel
 *  must never truncate it — see that function. */
const chipSuffixOf = (c: RoomChip) => (c.rooms > 1 ? `+${c.rooms - 1}` : "");
/**
 * ── The summaries are ONE family, built from ONE unit ────────────────────
 * A summary is never given a size of its own. Every dimension of the room
 * chip, the count badge and the pictogram card is derived from
 * summaryMetrics(), whose unit IS the badge being replaced: the chip is one
 * unit tall and as wide as the name it prints, the count badge is one unit
 * square, and a card is an integer number of units on each axis (badgeCard's
 * `cols` x `rows`, capped at 2x2). A card's edge margin and the gap between
 * its chips both fall out of `cardIconFraction`, so they cannot disagree with
 * each other or with the badge.
 *
 * The rule that has to hold is DERIVATION FROM ONE UNIT, not literal equality
 * of size — the chip has always been a variable-width pill, and both recorded
 * regressions were failures of derivation rather than of squareness:
 *
 *   * the group once shipped at the 44px badge size against the chip's 30px,
 *     putting a group half again as tall as the chip beside it;
 *   * then both sat on their own 30px/15px constants and their own 0.8 scale
 *     floor while badges moved to CSS pixels and a 0.7 far-zoom cap, so a
 *     summary was drawn visibly larger than the badges it stood in for.
 *
 * The second ROW a 3-4 device card takes is bought explicitly and bounded in
 * badgeCard; anything wanting a third has to justify it at that constant
 * rather than inherit it, which is exactly what 2.261.0 did before it painted
 * a card the full width of the screen.
 *
 * ── What the extra row costs, stated rather than hidden ──────────────────
 * A card is anchored bottom-edge-on-anchor like a badge, so a two-row card
 * reaches TWO badge-heights above its anchor — while placeEntityGroups still
 * measures it against badges as a disc of half a unit centred on that anchor
 * (deliberately: see `fits`). It can therefore be drawn over a badge belonging
 * to another pile. SceneManager's tap and long-press paths both ask the badges
 * before answering for a card cell that is empty, so a covered badge is still
 * reachable; nothing makes it un-covered.
 *
 * The remaining differences are shape and content, and both carry meaning: a
 * group is a SQUIRCLE (it stands in for squircle badges, at a badge's own
 * corner rounding) holding pictograms or a count, the chip is a PILL (it names
 * a place) holding a room name. Not a category colour either way — CLAUDE.md
 * reserves the category hues for categories, and a summary covers several.
 */
// Character-advance estimates for text this file has to MEASURE before Babylon
// has laid it out live in `labelLayout.chipWidthPx`, whose docstring explains
// why an estimate is the right answer here. The per-style values used by
// labelBoxes travel with the rest of the badge geometry — see badgeMetrics.

/** A badge that survived the per-entity culls (category / floor / enabled),
 *  with BOTH its world-space anchor and its projected screen position. */
interface ShownLabel {
  id: string;
  lbl: LabelControls;
  /** Projected screen position of the anchor, in render pixels. */
  x: number;
  y: number;
  /** World-space anchor position. `wy` (mounting HEIGHT) counts as much as the
   *  ground axes: an anchor sits just above its own geometry
   *  (buildLabelAnchors), so a ceiling fan's is ~2.7m up while a table lamp's
   *  is barely off the floor. Kept because two things genuinely need a world
   *  position — quantisedPixelsPerWorldUnit's distance to the camera, and
   *  solveRoomZoomRadius's framing — and because it is what the projection
   *  projects. */
  wx: number;
  wy: number;
  wz: number;
  /** Where the badge's BOX IS DRAWN on this pass's view plane, in GUI pixels —
   *  THE input to grouping. The anchor projected (see badgeProjection for why
   *  the decision is made in this plane rather than in world space or in true
   *  perspective) and then lifted by the badge's own `cy`, because a badge
   *  hangs above its anchor by an amount that differs between badges. Written
   *  by placementItems, the one place the projection happens. */
  sx: number;
  sy: number;
  sz: number;
  /** Anchor is in front of the camera, i.e. has a valid screen position at
   *  all. Purely a RENDER gate — deliberately not an input to grouping. */
  inFront: boolean;
}

// Status/enum SENSOR states (a text sensor like an AP's connectivity state).
// NOMINAL = "all good, nothing to report" — its value is hidden (the badge is
// neutral by default, so "Connected" is just clutter). ALERT states (which
// drive the badge ring — see utils/deviceActivity's SENSOR_ALERT_STATES,
// shared with badgeKind below) are the mirror image: their value stays
// SHOWN, so a real change is never silently swallowed. An unrecognised enum
// value (e.g. a weather "sunny") is neither: it's shown, un-ringed, as before.
const SENSOR_NOMINAL_STATES = new Set([
  "connected", "online", "ok", "okay", "normal", "nominal", "available",
  "ready", "clear", "operational", "up", "good", "healthy", "active",
]);

// Pulse animation speed in radians per second (was 0.06 per frame at ~60 fps).
// Advanced by real elapsed time so the alert pulse breathes at the same rate on
// a 60 Hz tablet and a 120 Hz phone.
const PULSE_RAD_PER_SEC = 3.6;

// Ceiling-fan spin: angular speed (rad/s) at full fan percentage. A whole-mesh
// spin reads as "blades turning" at kiosk distance; ~1 rev/s is lively without
// strobing. Scaled down by the fan's percentage (min 15%) when reported.
const FAN_MAX_RAD_PER_SEC = 6.2;
// A ceiling fan is exported as ONE fused mesh (mount + motor + blades all one
// piece, one material — no separate "blade" sub-object to isolate), so the
// whole thing has to spin together; see updateFanSpin/computeFanSpin. The top
// fraction of its height (the ceiling mount/canopy) is reliably the one part
// that's round and centred exactly on the true axle, so its own vertices —
// not the whole mesh's bounding box — decide WHERE that axle sits. Get this
// right and the mount+pole (rotationally symmetric) reads as motionless even
// though it's technically rotating with the blades; get it wrong (the old
// plain bbox-midpoint) and the pole visibly orbits in a small circle instead
// of spinning in place.
const FAN_AXIS_TOP_SLICE = 0.25;

/** Bucket name for badges whose entity has no room configured — they still
 *  cluster together rather than each becoming its own singleton chip. */

interface LabelControls {
  container: StackPanel;
  badge: Rectangle;
  glyph: Image;
  valueWrap: Rectangle;
  valueText: TextBlock;
  anchor: TransformNode;
  type: EntityType;
  category: Category;
}

/** One room's collapsed stand-in, shown only in the "clusters" band. Its
 *  node sits at the world-space centroid of the room's badge anchors — a
 *  fixed point, which is what makes the chip immune to the jitter that
 *  motivated all of this. The device count renders as its own small red
 *  pill (countBadge/countText) rather than being folded into the room-name
 *  text — the same "small red pill for a count" convention the HUD's
 *  unavailable-devices/facility icons use (DOM's .icon-btn-count); see
 *  utils/countBadge.ts for the one piece of that actually shareable across
 *  a DOM icon and a Babylon GUI chip (a canvas control can't consume CSS). */
interface ClusterControls {
  container: Rectangle;
  text: TextBlock;
  countBadge: Rectangle;
  countText: TextBlock;
  node: TransformNode;
  entityIds: string[];
  /** The raw room name to show a person. The Map key is a roomKey(), which is
   *  normalised and must never reach the UI — see EntityVisuals.clusters. */
  displayName: string;
  /** Every room this chip stands for — one unless chips merged. */
  roomNames: string[];
}

/** One entity group: several of a room's badges drawn as a single badge,
 *  because no ring inside the travel budget could separate them. Distinct
 *  from ClusterControls above — that one covers a WHOLE room and carries its
 *  name; this covers a SUBSET and draws one cell per device.
 *
 *  It used to be able to carry a COUNT instead of cells, and that field is
 *  gone (2.363.0) rather than merely unused: a control that exists is one a
 *  later edit can make visible again. */
interface EntityGroupControls {
  container: Rectangle;
  node: TransformNode;
  entityIds: string[];
  room: string;
  /** The visible card(s). The container itself is a transparent positioning
   *  HOST — these carry the surface, the ring, the rounding and the shadow, so
   *  a summary of five can draw a 2x2 beside a 1x1 with real space between
   *  them rather than one wide box. Grow-only, like the rest. */
  cards: Rectangle[];
  /** One device pictogram per drawn cell. Grow-only pool: a group's membership
   *  changes as devices come and go, and rebuilding controls on that boundary
   *  is a flicker with no upside. */
  chips: Image[];
  /** Invisible equal-width hit zones, one per chip — the strip's tap split.
   *  Children of the container, so Control.contains() resolves them through
   *  the same transform stack the drawn card uses, which is the only hit-test
   *  this file trusts (see pickBadgeAt). A chip's own box would be a meaner
   *  target than the card can afford to offer; the zones TILE, so every tap
   *  inside the card belongs to exactly one device. */
  zones: Rectangle[];
  /** Cells drawn this pass, or 0 for a count. Also how many zones are live
   *  for hit-testing. */
  gridN: number;
}

/** An entity group decided this frame, before it has been checked for
 *  clearance and given controls. */
interface PendingEntityGroup {
  /** Stable identity across frames: room + the lowest entity id in the pile.
   *  Membership is a pure function of world positions and quantised zoom, so
   *  the same pile yields the same key on every device and every frame. */
  key: string;
  /** The room's name as it will be PRINTED (raw, from HA), carrying the room
   *  chip's own "+N" suffix when the group straddles a boundary — see
   *  badgePlacement's DeferralBucket.rooms for why it now can. */
  room: string;
  /** Every room the group covers, as Map keys — see EntityVisuals.roomClustered
   *  for why the printable and the key form are carried separately rather than
   *  derived at each use. A group that cannot be placed escalates ALL of them,
   *  because all-or-nothing per room is what makes a chip readable. */
  roomKeys: string[];
  members: number[];
  /** The members' world centroid — the ONLY stored position. The card RENDERS
   *  here (linkWithMesh on a node at this point). */
  wx: number; wy: number; wz: number;
  /** The same point, projected into this pass's plane. DERIVED from wx/wy/wz by
   *  the same projection every badge uses, never accumulated in parallel: the
   *  projection is affine, so the plane centroid of the members IS the
   *  projection of their world centroid, and that identity is what makes "the
   *  card is measured where it is drawn" a fact rather than a discipline. */
  sx: number; sy: number; sz: number;
  /**
   * How many device pictograms this group asks to draw, or 0 for a count.
   *
   * The card is an integer number of badge boxes on each axis (see
   * babylon/badgeCard), so every cell's tap zone is exactly the box of the
   * badge it stands in for. Decided where the group is made and never revoked:
   * the size is not a clearance decision. It was once, and because clearance
   * depends on the quantised ZOOM the same pair drew as a full-size card at one
   * rung and a half-scale one at the next — one situation, two objects, which
   * is not a distinction anybody reading a floor plan can act on.
   *
   * `badgeCard.gridCells` is the cap, applied by the layout itself rather than
   * trusted to this field: a card is one badge per column, so an unbounded
   * count is an unbounded card.
   */
  grid: number;
  /**
   * Made inside the FOCUSED room (see pairFocusedRoom), not by the main solve.
   *
   * It skips the clearance test and can never escalate a room to its chip:
   * it stands in for two badges that were already being drawn on top of each
   * other, so refusing it would put back the very overlap it exists to
   * remove, and chipping the room the user just asked to see would break the
   * one promise the focus makes.
   */
  focused: boolean;
}

/* The state ring's stroke lives in badgeMetrics (`ringThicknessPx`) — it is a
 * badge dimension and has to scale with the badge, because Babylon's Rectangle
 * insets its children by it and a fixed value costs a small card far more of
 * its icon than a large one. The card style needs an explicit border at all
 * (the classic badge bakes its ring into the glyph image), and Babylon GUI has
 * no dashed border, so the card's unavailable ring falls back to the same
 * solid stroke as active/alert — a small, deliberate degradation from the
 * classic badge's genuinely dashed one.
 */

export class EntityVisuals {
  private scene: Scene;
  private config: AppConfig;
  private requestRender: () => void;
  private requestAnimationRender: () => void;
  /** performance.now() of the last animation step — see registerBeforeRender. */
  private lastAnimTickAt = 0;

  /** entity_id -> meshes (one entity can drive several meshes, e.g. curtains). */
  private byEntity = new Map<string, AbstractMesh[]>();

  /**
   * The mesh→entity index `indexMeshes` already built, read-only.
   *
   * Exposed for `SceneManager.calibrateRooms`, which was resolving all ~856
   * meshes a SECOND time through `resolveMeshToMapping` moments after this map
   * was filled — the measured cost of that duplicate pass was the single
   * longest block of the whole load (2.4s on the phone, 2.7s on an M1, which is
   * how it was identified: work that does not care about the hardware).
   */
  meshesByEntity(): ReadonlyMap<string, AbstractMesh[]> {
    return this.byEntity;
  }
  private mapping = new Map<string, EntityMapping>();
  /** entity_id -> variant word -> its mesh(es) — see desiredVariantWord/
   *  applyMeshVariant. ONLY meshes with a recognised "__<word>" pose suffix are
   *  registered here; an unsuffixed base mesh (e.g. a physical lock device) is
   *  never a pose and is left out entirely. So this has 2+ words only for an
   *  entity actually authored with alternate "__<variant>" meshes; a single
   *  authored pose gives exactly one word, and everything else (the common
   *  case) has no entry at all — applyMeshVariant treats <2 words as "nothing
   *  to toggle". */
  private meshVariants = new Map<string, Map<string, AbstractMesh[]>>();
  private pulsing = new Set<AbstractMesh>();

  // ── Badge-layout frame budget (2.113.0) ──────────────────────────────────
  // cullLabels() runs from registerBeforeRender, i.e. on EVERY rendered frame,
  // and the render loop does NOT idle whenever anything is animating: a
  // spinning ceiling fan (animateFans) or a triggered alert (animatePulse)
  // each call requestRender() every frame, which re-arms the loop forever. A
  // villa with one fan left on therefore renders continuously for weeks — and
  // recomputed the entire badge layout, allocating several hundred objects per
  // frame, the whole time. That sustained garbage is the best candidate for
  // the ~37MB/hour idle drift autoReload.ts was written to paper over.
  //
  // Two defences, both here:
  //   1. SKIP the pass entirely when nothing that can move a badge has
  //      changed. A fan's blades spinning does not move its badge (the anchor
  //      deliberately sits on the fan's NON-rotating parent — see
  //      detachFanLabelAnchor) and a pulse only changes emissive colour, so
  //      neither has any effect on layout. The view-projection matrix is the
  //      honest test for "did anything about the camera change", covering
  //      pan/orbit/zoom/fov in one comparison; `layoutDirty` covers everything
  //      else (see markLayoutDirty's callers).
  //   2. When it DOES run, reuse the working arrays and their element objects
  //      instead of rebuilding them, so a genuine camera move costs CPU but
  //      not a fresh heap allocation per badge per frame.
  // The grouping ALGORITHM is untouched — same inputs, same world-space /
  // zoom-only decision, same outputs. Only allocation and scheduling change.
  private layoutDirty = true;
  private lastVpM: Float32Array | null = null;
  private lastVpW = -1;
  private lastVpH = -1;
  /** Grow-only store of ShownLabel objects, reused across frames. Kept
   *  SEPARATE from `shown` (which is truncated to the live count each pass) so
   *  truncation cannot drop the objects and force reallocation next frame. */
  private shownPool: ShownLabel[] = [];
  private shown: ShownLabel[] = [];
  private boxesPool: { halfW: number; halfH: number; cy: number }[] = [];
  private boxes: { halfW: number; halfH: number; cy: number }[] = [];
  /** Scratch for Vector3.ProjectToRef — avoids a Vector3 per badge per frame. */
  private projTmp = new Vector3();
  /** Scratch for currentViewBasis()'s camera forward direction. */
  private camForward = new Vector3();
  /** Scratch for projectToView. Reused because it runs once per badge per
   *  layout pass and per rung of solveRoomZoomRadius's ~40-rung ladder. */
  private projPlane: ProjectedPoint = { px: 0, py: 0, pz: 0 };

  /** Something that can change WHERE or WHETHER a badge draws has happened —
   *  recompute the layout on the next frame. Cheap and deliberately generous:
   *  a false positive costs one recomputed frame, a false negative leaves a
   *  badge visibly stale, so every caller that touches label content, the
   *  label set, scale, floor or category filtering calls this. */
  private markLayoutDirty(): void {
    this.layoutDirty = true;
  }
  /** entity_id → angular speed (rad/s) for a CEILING fan currently spinning. */
  private spinningFans = new Map<string, number>();
  /** entity_id → total accumulated spin angle (radians, wrapped to 2π) — the
   *  rotation is recomputed FRESH from this absolute angle every frame (never
   *  accumulated incrementally), so there is no possible drift. */
  private fanAngles = new Map<string, number>();
  /** entity_id → per-mesh spin rig, set up once (lazily, on first "on") via
   *  setupFanRig: `pivot` is an invisible TransformNode sitting at the mesh's
   *  own true axle (see setupFanRig) that the mesh got REPARENTED under —
   *  animateFans only ever rotates `pivot`, never the mesh's own transform,
   *  so the mesh's local bounding info / pivot matrix (which the badge's
   *  linkWithMesh tracking reads) stay exactly what they always were. */
  private fanRigs = new Map<string, { mesh: AbstractMesh; pivot: TransformNode; axisLocal: Vector3 }[]>();
  private pulseT = 0;
  /** Scratch for animatePulse — see its comment. */
  private pulseColor = new Color3(0, 0, 0);

  // Real light sources for `light` entities. Keyed by MESH uniqueId (not entity
  // id) so an entity whose fixture is several distinct meshes — e.g. the two
  // bedside lamps that share one HA entity, or the four Led Line meshes of a
  // perimeter strip — gets a real light at EACH piece. ONE light per mesh, no
  // more: materials cap simultaneous lights (ModelLoader), and every light past
  // the cap is silently dropped, which reads as patchy/arbitrary illumination.
  private meshLights = new Map<number, PointLight>();
  /** Baked-mode counterpart to meshLights — see LightPools.ts for why a real
   *  PointLight is pointless there (the structure renders unlit) and what
   *  this fakes instead. Keyed the same way, one per fixture mesh. A compact
   *  fixture gets a single pool; an elongated strip gets an ARRAY — one
   *  full-intensity pool at its centre plus two half-intensity pools at its
   *  ends, so two strips meeting at a corner light that corner too instead of
   *  leaving it dark between their centres (see the light-creation block). */
  private meshLightPools = new Map<number, LightPool[]>();
  /** config.render.lightPoolIntensity, cached — see setLightPoolIntensity. */
  private lightPoolStrength = 1;
  /** One wall-blocking cube shadow map per light ENTITY, keyed by entity_id and
   *  attached to that entity's representative light. Created lazily while the
   *  light is on; a 12-marker strip therefore costs a single shadow map, not 12. */
  private lightShadows = new Map<string, ShadowGenerator>();
  /** Structural meshes (walls/floors/shell) that occlude entity-light shadows. */
  private shadowCasters: AbstractMesh[] = [];
  /** Fullscreen GUI layer for state labels. */
  private labelLayer: AdvancedDynamicTexture | null = null;
  private labels = new Map<string, LabelControls>();
  /** Per-entity invisible anchor node for mesh-bound labels, positioned at the
   *  entity's actual bounding-box top-centre (elevation + height combined),
   *  computed once from real geometry — see buildLabelAnchors(). Replaces
   *  linking straight to the mesh + a hand-tuned pixel offset, which put the
   *  badge at a fixed screen-space height regardless of how tall the asset
   *  actually was or how high up it sat. */
  private labelAnchors = new Map<string, TransformNode>();
  /** Last seen HA state per entity, so a label rebuild (toggle on / icon edit)
   *  can repaint badges immediately instead of waiting for the next push. */
  private lastState = new Map<string, HassEntity>();
  /** User size multiplier (Settings slider) and live bird's-eye zoom factor;
   *  the badge container is scaled by their product. */
  /** Last line emitted by logPlacement, so the pass logs only on CHANGE. */
  private lastPlaceLog = "";

  /** `?debug` only: badges pulled into a summary because they were underneath
   *  it (see the absorb phase in placeEntityGroups). */
  private absorbed = 0;
  /** Summaries made inside the focused room — pair cards and counts alike
   *  (see pairFocusedRoom). One per pile, so this is also "how many piles the
   *  focused room had", which is the number worth watching: it should be small
   *  after the zoom solver has framed the room. */
  private focusPairs = 0;
  /** Rooms chipped THIS pass purely because another room holds the focus —
   *  the third way a chip can appear, and the only one the solver never sees.
   *  Reported in the `place` line beside the solver's own two. */
  private focusChipped = 0;
  private iconUserScale = 1;
  private iconZoomScale = 1;
  /** Every badge dimension, in CSS px, for the pointer currently driving this
   *  device. Read by BOTH labelBoxes and rebuildLabels — see badgeMetrics. */
  private metrics: BadgeMetrics = badgeMetricsFor(detectPointerClass());
  private offPointerClass: (() => void) | null = null;
  /** The layout pass's own solver workspace. solveRoomZoomRadius keeps a
   *  SEPARATE one — see PlacementResult's warning about pooled returns. */
  private placeScratch: PlacementScratch = createPlacementScratch();
  /** Solver input for the focused room's own pass — see pairFocusedRoom. */
  private focusItems: PlacementItem[] = [];
  /** shown-index per focusItems slot, pooled: this runs per frame while a room
   *  is focused, and the steady state should allocate nothing. */
  private focusIdx: number[] = [];
  private zoomScratch: PlacementScratch = createPlacementScratch();
  /** Grow-only pools for the per-pass placement input and its groups. */
  private placeItems: PlacementItem[] = [];
  private pendingGroups: PendingEntityGroup[] = [];
  /** `this.labels` newest-first, for badgeContaining's hit test. Refreshed in
   *  rebuildLabels, the only place this.labels is mutated. */
  private labelsNewestFirst: Array<[string, LabelControls]> = [];
  /** Scratch for quantisedPixelsPerWorldUnit's median. */
  private distPool: Float64Array = new Float64Array(0);
  /** Entities the owner removed as "no longer in HA" — see badgeEligible. */
  /** ?debug-only solver workspaces — see assertPlacementInvariants. Separate
   *  from the live ones because a PlacementResult is pooled and a second solve
   *  would rewrite the result the pass is still using. */
  private debugScratchA: PlacementScratch = createPlacementScratch();
  private debugScratchB: PlacementScratch = createPlacementScratch();
  /** Which rooms are showing their cluster chip instead of individual badges.
   *  Recomputed from scratch every frame by cullLabels — deliberately NOT
   *  carried over as state: grouping is a pure function of world positions
   *  and zoom now, and the previous frame's answer must never influence this
   *  one (that path-dependence was the "stays grouped when I slide back"
   *  bug — see the grouping thresholds' comment). Kept as a field only so
   *  updateClusters and pickClusterAt can read the current frame's result. */
  /**
   * Rooms summarised into a chip this frame.
   *
   * Per ROOM, deliberately: when a room collapses it takes ALL of its badges
   * with it. 2.166.0 briefly clustered per PILE instead — a chip swallowed
   * only the devices that actually overlapped and left the room's other
   * badges in place, the way a map clusters markers. It is a defensible model
   * and it was rejected: a room that is half chip and half loose badges asks
   * the user to work out which of its devices the chip stands for, and a
   * count that covers some of a room but not the rest is not a fact anyone
   * can use. All-or-nothing per room is the readable contract — the chip
   * means "this room, summarised", every time.
   *
   * Keyed by roomKey(), never the raw name. It used to be the raw name while
   * roomShownCount and the one-room test next to it already used roomKey(),
   * and rooms come from HA Area names whose casing and padding are whatever
   * HA has — so "Master Bedroom" and "master bedroom " counted as ONE room
   * for the denominator and TWO for this flag. That combination can collapse
   * one spelling and leave the other's badges drawn: a half-chip, half-badges
   * room, which is exactly the state the paragraph above says must never
   * exist. Per CLAUDE.md the key is a Map key only; every displayed name
   * stays the raw one (see roomDisplay).
   */
  private roomClustered = new Map<string, boolean>();
  /** roomKey() → the raw room name to PRINT for it. The lexicographically
   *  smallest spelling seen in the current pass, so two casings of one room
   *  cannot make a chip's label flip between frames. */
  private roomDisplay = new Map<string, string>();
  /** Room-cluster chips, keyed by roomKey(). Built lazily the first time a
   *  room clusters; disposed with everything else in rebuildLabels. */
  private clusters = new Map<string, ClusterControls>();
  /**
   * The room the user asked to SEE (tapped its chip), as a roomKey — or null.
   *
   * ── Why an exemption exists at all ────────────────────────────────────────
   * "Tap a room, see its devices" was implemented four times as a search for a
   * zoom at which that room's badges happen not to collide, and it kept coming
   * back as "I still see the chip". The last of those attempts is why: two
   * devices mounted at ONE 3D point (a ceiling fan and its own light kit) are
   * separated by no zoom level that exists, so for those rooms the promise is
   * unkeepable by construction — no amount of solving finds a distance that
   * is not there.
   *
   * The requirement is not "try hard to declutter". It is: tapping a room ALWAYS
   * shows that room's badges, never a summary of them. So the focused room is
   * simply exempt from grouping: its badges take no part in the pile-building
   * at all (see groupBadges), which makes them individually drawn as a matter
   * of fact rather than as an outcome the camera has to earn. The zoom solve
   * still runs and still picks the tightest shot that separates them where one
   * exists — it just no longer decides WHETHER the user gets what they asked
   * for.
   *
   * The trade-off is explicit: for a room whose devices genuinely cannot be
   * separated, its two badges will overlap at the chosen zoom. That is the
   * honest presentation of "these two things are in the same place", and it is
   * what was asked for over a chip that hides both.
   */
  private focusedRooms = new Set<string>();
  /** The quantised zoom the focus was granted at. The focus lasts exactly as
   *  long as that zoom does — see cullLabels — so panning around a focused
   *  room keeps it open, and zooming away lets the map behave normally again
   *  without needing any camera-event plumbing to tell us the user did it. */
  private focusedAtZoom = 0;

  /** Entity groups drawn this frame, keyed by PendingEntityGroup.key. Same
   *  lazy-build / dispose-with-rebuildLabels lifecycle as `clusters`. */
  private entityGroups = new Map<string, EntityGroupControls>();
  /** Entity ids currently standing behind an entity group, so cullLabels'
   *  visibility pass hides them exactly like a room-clustered badge. */
  private entityGrouped = new Set<string>();
  /** Each room's real drawn polygon (world-space X/Z, original casing) — the
   *  geometric signal roomForEntity uses to auto-fill a freshly detected
   *  entity's room on first sight (see getDetectedMappings). Stored as the
   *  actual point list because containment testing needs it. */
  private roomPolys: { name: string; pts: { x: number; z: number }[] }[] = [];
  /** Active storey from FloorManager (1-based). Floors below it stay rendered
   *  (cumulative visibility), so enabled-state alone can't cull their badges —
   *  cullLabels compares each label's stamped floorIndex against this. */
  private activeFloor = 1;

  /** Baked-lighting GLB loaded (see ModelLoader). All lighting — including
   *  every fixture's contribution to the room — is already painted into the
   *  structure's texture, and the structure is unlit, so a runtime PointLight
   *  can't brighten it anyway; per-entity lights and their cube shadow maps
   *  would be pure cost with no visible effect. Skipped entirely in baked
   *  mode. The fixture's own emissive glow is KEPT — that's surface glow
   *  on the fixture itself (the on/off signal the user reads), not light
   *  transport. */
  private bakedMode = false;

  /** camera entity_id -> world-space unit facing direction (may include a
   *  vertical tilt component from SweetHome's `pitch`), computed by
   *  SceneManager from the sh3d plan `angle`/`pitch` (see setCameraDirections). */
  private cameraDirections = new Map<string, { x: number; y: number; z: number }>();
  /** Camera motion-detection cones — mesh lifecycle owned by CameraBeams;
   *  this class only decides WHICH cameras get a beam and when it pulses. */
  private beams: CameraBeams;
  // Two indexes, two DISTINCT source fields, two distinct visuals — see
  // EntityMapping's notes on why these must not be merged again:
  //   motionEntityId  -> beam / room glow  ("detection fired", from HA)
  //   linkedEntityId  -> badge ring        ("armed", user-toggled)
  // Both map driver entity_id -> the device entity_ids it drives, so a state
  // change is a single lookup regardless of which side owns a 3D mesh.
  /** motionEntityId -> camera entity_ids whose beam it drives. Rebuilt from
   *  config.entityMap on every indexMeshes() (structural entityMap edits
   *  re-trigger that already). */
  private motionToCameraIds = new Map<string, string[]>();
  /** linkedEntityId -> device entity_ids whose badge ring it drives. Generic
   *  over ANY entity type on either side. */
  private linkedEntityIndex = new Map<string, string[]>();
  /** Devices whose linkedEntityId is currently "on" — rings red, applied
   *  uniformly for every entity type in badgeKind (see there). */
  private linkActiveIds = new Set<string>();
  /** Floor-glow overlay for physical (non-camera) motion/presence sensors —
   *  a room, not a direction, is the natural signal for those. */
  private roomHighlight: RoomHighlight;
  /** entity_id -> room name, pushed by Dashboard.tsx (see SceneManager.
   *  setResolvedRooms) — HA's own Area assignment wins whenever a device has
   *  one, geometric room-polygon detection (roomForEntity, below) is the
   *  fallback for whatever HA hasn't organised into an Area yet. Replaces
   *  EntityMapping.room, which used to be a stored/user-editable field; this
   *  one is live-computed and carries no state of its own beyond "whatever
   *  Dashboard last pushed". Empty for an entity nothing has resolved yet. */
  private resolvedRooms: Record<string, string> = {};

  constructor(
    scene: Scene,
    config: AppConfig,
    requestRender: () => void,
    /** Re-arm the loop for a CONTINUOUS animation (fan spin, alert pulse).
     *  Rate-capped by the caller so a fan left on doesn't hold the GPU at the
     *  display's full rate for weeks — see SceneManager.requestAnimationRender.
     *  Falls back to requestRender when not supplied. */
    requestAnimationRender?: () => void,
  ) {
    this.scene = scene;
    this.config = config;
    this.requestRender = requestRender;
    this.requestAnimationRender = requestAnimationRender ?? requestRender;
    this.probe = new FloorProbe(scene);
    // The probe can only key by ROOM once calibration has produced the world
    // polygons; until then roomContaining returns null and it falls back to the
    // grid, exactly as every load did before 2.300.0 (see floorProbe.ts).
    this.probe.setRoomResolver((x, z) => this.roomContaining(x, z));
    this.roomHighlight = new RoomHighlight(scene, requestRender, this.probe, this.requestAnimationRender);
    this.beams = new CameraBeams(scene);
    scene.registerBeforeRender(() => {
      // Elapsed time measured HERE, not from engine.getDeltaTime().
      //
      // Babylon sets its delta in beginFrame(), which its render loop calls on
      // every requestAnimationFrame tick — BEFORE the loop body decides whether
      // to actually render. So getDeltaTime() reports tick-to-tick (~16.7ms at
      // 60Hz) rather than render-to-render, and the moment continuous animation
      // became rate-capped (SceneManager.ANIMATION_FRAME_MS) every animation
      // was told 16.7ms had passed when 33ms really had — running at half speed
      // while idle and snapping back to full speed during interaction, which
      // reads as a fan surging. This clock counts real time between the frames
      // these animations are actually stepped on, whatever the cadence.
      const now = performance.now();
      // Clamped: the on-demand loop can idle for seconds, and a raw delta after
      // such a gap would make everything jump. First tick has no predecessor.
      const dtMs = this.lastAnimTickAt ? Math.min(now - this.lastAnimTickAt, 100) : 16;
      this.lastAnimTickAt = now;
      this.animatePulse(dtMs);
      this.animateFans(dtMs);
      this.cullLabels();
    });
    // A mouse plugged into a tablet, or a 2-in-1 folded over, changes which
    // badge geometry is correct. Unlike a hardware-scaling change (which only
    // needs applyIconScale) this one needs a full REBUILD: the painted sizes
    // are baked into each control's height/cornerRadius/fontSize, and leaving
    // them while the layout used the new metrics is exactly the mismatch this
    // subsystem has been bitten by before. Rare enough to afford it.
    this.offPointerClass = observePointerClass((p) => {
      const next = badgeMetricsFor(p);
      if (next === this.metrics) return;
      this.metrics = next;
      this.rebuildLabels();
    });
  }

  /** MUST be called before indexMeshes() — that's where lights are created. */
  setBakedMode(baked: boolean): void {
    this.bakedMode = baked;
  }

  /** Repaint every badge from the current config (per-entity colour + glyph).
   *  Called when only badge COLOURS changed, so a colour pick doesn't pay for
   *  the full indexMeshes pass (its several-second hitch is what made the colour
   *  modal feel laggy). Goes through rebuildLabels — which recreates each badge's
   *  GUI Image fresh (a data-URL swap on the existing Babylon Image does NOT
   *  reliably re-render the GUI texture, so the map badge kept its old colour)
   *  and re-applies each entity's cached state — but skips the material re-clone
   *  / per-light recreation that makes indexMeshes heavy. */
  repaintBadges(): void {
    this.rebuildLabels();
    this.requestRender();
  }

  /** Every entity that actually resolved to geometry in the loaded model —
   *  i.e. the devices genuinely visible on the 3D map. The UI uses this to
   *  distinguish a device you can SEE in the villa from one that only exists
   *  in Home Assistant (see SummaryGroupPanel's "not on the map" styling).
   *  Derived from byEntity, which indexMeshes fills from real mesh bindings,
   *  so it can't drift from what's drawn. */
  /** The fullscreen GUI textures this layer owns, for the render probe to
   *  switch off and re-measure (see babylon/perfProbe.ts). Read-only access to
   *  an existing layer — never creates one. */
  guiLayers(): AdvancedDynamicTexture[] {
    return this.labelLayer ? [this.labelLayer] : [];
  }

  mappedEntityIds(): string[] {
    return [...this.byEntity.keys()];
  }

  /** Copy the cosmetic (non-structural) fields of every cached mapping across
   *  from the freshly-applied config. Returns the entity ids whose per-light
   *  intensity override changed, so the caller can re-derive just those
   *  lights instead of every light in the villa.
   *
   *  Driven off COSMETIC_MAPPING_FIELDS rather than naming fields here: that
   *  list is the definition of "safe to skip re-indexing for", and this is
   *  what makes the claim true for a field whose consumer reads the cached
   *  mapping. Entries are REPLACED, not mutated — resolveMeshToMapping can
   *  hand back the config's own object, and writing through it would edit the
   *  previous config in place. */
  private refreshCosmeticMappings(): string[] {
    const relight: string[] = [];
    for (const [entityId, map] of this.mapping) {
      const next = this.config.entityMap[entityId];
      if (!next) continue;
      const current = map as unknown as Record<string, unknown>;
      const source = next as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      let changed = false;
      for (const field of COSMETIC_MAPPING_FIELDS) {
        if (source[field] === current[field]) continue;
        patch[field] = source[field];
        changed = true;
        if (field === "lightIntensityRatio") relight.push(entityId);
      }
      if (changed) this.mapping.set(entityId, { ...map, ...patch } as EntityMapping);
    }
    return relight;
  }

  updateConfig(config: AppConfig): void {
    const prevGroups = this.config.deviceGroups;
    const prevBadgeStyle = this.config.badgeStyle;
    const prevEntityMap = this.config.entityMap;
    this.config = config;
    // hiddenCategories gates the layout pass's first cull and badgeStyle
    // switches labelBoxes to a different geometry entirely — neither is
    // observable through the view-projection matrix.
    this.markLayoutDirty();
    // Both link indexes are otherwise only built by indexMeshes() — but
    // editing linkedEntityId/motionEntityId is now classed as a COSMETIC
    // change (see SceneManager's COSMETIC_MAPPING_FIELDS), which deliberately
    // SKIPS that whole structural pass to keep Advanced Settings responsive.
    // Rebuilding here keeps the badge ring and camera beam correct after such
    // an edit; both are plain iterations over entityMap, orders of magnitude
    // cheaper than a re-index, so doing it on any entityMap change is fine.
    let needsRepaint = false;
    let relight: string[] = [];
    if (config.entityMap !== prevEntityMap) {
      // The per-entity mappings cached here are built ONLY by indexMeshes()
      // — the structural pass a cosmetic edit deliberately skips — so every
      // consumer of this.mapping kept reading the values from the last
      // re-index. The per-light intensity override was the visible casualty:
      // moving that slider changed nothing at all, and could not, until a
      // model reload or an unrelated structural edit happened to rebuild the
      // map. Refreshing the cosmetic fields in place is the missing half of
      // the promise COSMETIC_MAPPING_FIELDS makes; driving it off that same
      // list means a future cosmetic field is covered automatically.
      relight = this.refreshCosmeticMappings();
      this.buildMotionToCameraIndex();
      this.buildLinkedEntityIndex();
      // buildLinkedEntityIndex already SEEDS linkActiveIds from each linked
      // entity's cached last-known state (so a link added while the linked
      // entity is already "on" doesn't need to wait for a fresh state_changed
      // event that may never come) — but seeding the Set alone doesn't redraw
      // anything. Without this, "I just linked a device that's already on"
      // showed no ring until something else happened to touch that badge.
      needsRepaint = true;
    }
    // Entity-light wall occlusion is always-on: walls block lamp light out of
    // the box, so there is nothing to tear down here when config changes.
    // Apply the user's size multiplier.
    const wantScale = clampIconScale(config.entityIconScale);
    if (wantScale !== this.iconUserScale) {
      this.iconUserScale = wantScale;
      // The size stepper feeds the grouping radius directly (a badge's own
      // width is what that radius is built from), and grouping carries no
      // state between frames, so stepping + then − lands back exactly where
      // it started with nothing to reset here. That symmetry used to need an
      // explicit "ignore the hysteresis once" flag; removing hysteresis
      // removed the need for it.
      this.applyIconScale();
    }
    // Labels are always shown; rebuild when a device group is created/edited
    // (a member's badge must appear/disappear without needing a full
    // re-index — see rebuildLabels' hiddenMembers), OR when entityMap itself
    // changed (see needsRepaint above). One call covers both rather than two
    // separate rebuildLabels() passes when both happen to change together.
    if (needsRepaint || config.deviceGroups !== prevGroups || config.badgeStyle !== prevBadgeStyle) {
      this.rebuildLabels();
    }
    // A per-light override changed. Nothing will emit a state_changed for
    // that entity, so without this the edit is simply invisible. Re-apply
    // through the NORMAL path rather than recomputing the formula here: the
    // override feeds the fixture's own emissive glow as well as the light it
    // casts, and a resync that moved only one of the two would leave a bulb
    // looking unchanged in a room that got darker. Usually one entity, and
    // the edit is debounced, so the full path is affordable here — unlike the
    // global strength slider, which drags across every light at once and
    // keeps its lighter resync.
    for (const entityId of relight) {
      const state = this.lastState.get(entityId);
      if (state) this.apply(state);
    }
    if (typeof config.render?.lightPoolIntensity === "number") {
      this.setLightPoolIntensity(config.render.lightPoolIntensity);
    }
  }

  /** Settings' "Light effect strength" slider — mirrors setRenderConfig's
   *  live-drag-preview pattern for the other render sliders (see
   *  SceneManager.setRenderConfig), except this reaches a value EntityVisuals
   *  owns rather than RenderEnhancements/SunController, so it's wired here
   *  directly instead of through the render pipeline. Re-applies immediately
   *  (using each entity's last known state) to every currently-on light —
   *  BOTH kinds: baked-mode decal pools AND the real PointLights a non-baked
   *  GLB illuminates its rooms with (the slider used to only reach the
   *  pools, making it a silent no-op on a non-baked model) — so dragging
   *  the slider previews live on any light that's already on. */
  setLightPoolIntensity(value: number): void {
    if (value === this.lightPoolStrength) return;
    this.lightPoolStrength = value;
    this.resyncLightIntensities();
  }

  /** Re-derive EVERY light's brightness from its entity's last known state and
   *  the current config — pools and dynamic PointLights together, since a
   *  fixture may drive either. Call after anything that changes an input to
   *  the brightness formula without an accompanying state_changed event: the
   *  global "Light effect strength" slider, or a per-light intensity override
   *  edited in Advanced Settings. */
  private resyncLightIntensities(): void {
    this.forEachLightPoolState((pool, on, colour, brightnessFrac) =>
      pool.setState(on, colour, brightnessFrac * this.lightPoolStrength));
    this.resyncDynamicLightIntensities();
    this.requestRender();
  }

  /** Re-derive every dynamic PointLight's intensity from its entity's last
   *  known state — the non-baked counterpart of forEachLightPoolState's pool
   *  resync, for when a GLOBAL factor (lightPoolStrength) changes without
   *  any entity state change. Mirrors applyToMesh's light branch exactly
   *  (same effectiveFrac/lightShare formula) so a slider drag and the next
   *  real state_changed event land on identical values. */
  private resyncDynamicLightIntensities(): void {
    if (this.meshLights.size === 0) return; // nothing to resync (no fixtures)
    for (const [entityId, map] of this.mapping) {
      if (map.type !== "light") continue;
      const state = this.lastState.get(entityId);
      const meshes = this.byEntity.get(entityId);
      if (!state || !meshes) continue;
      const on = state.state === "on";
      const brightnessFrac = state.attributes.brightness ? state.attributes.brightness / 255 : 1;
      const effectiveFrac = brightnessFrac * (1 + clampRatio(map.lightIntensityRatio));
      const lightShare =
        new Set(meshes.map((m) => this.meshLights.get(m.uniqueId)).filter(Boolean)).size || 1;
      for (const mesh of meshes) {
        const light = this.meshLights.get(mesh.uniqueId);
        if (light) {
          light.intensity = on
            ? (MAX_LIGHT_INTENSITY * effectiveFrac * this.lightPoolStrength) / lightShare
            : 0;
        }
      }
    }
  }

  /** Every light entity's pool, resolved to its floor-and-state-correct on/off
   *  + colour + brightness right now — shared by anything that needs to
   *  resync ALL pools at once (a floor change, the "Light effect strength"
   *  slider) rather than just the one entity apply() is currently handling.
   *  `on` already folds in the fixture mesh's live enabled state, so a light
   *  left on behind a now-hidden floor comes back off instead of staying lit. */
  private forEachLightPoolState(
    fn: (pool: LightPool, on: boolean, colour: Color3, brightnessFrac: number) => void,
  ): void {
    for (const [entityId, map] of this.mapping) {
      if (map.type !== "light") continue;
      const state = this.lastState.get(entityId);
      const meshes = this.byEntity.get(entityId);
      if (!state || !meshes) continue;
      const on = state.state === "on";
      const colour = this.lightColour(state);
      const brightnessFrac = state.attributes.brightness ? state.attributes.brightness / 255 : 1;
      const effectiveFrac = brightnessFrac * (1 + clampRatio(map.lightIntensityRatio));
      for (const mesh of meshes) {
        const pools = this.meshLightPools.get(mesh.uniqueId);
        if (pools) for (const pool of pools) fn(pool, on && mesh.isEnabled(), colour, effectiveFrac);
      }
    }
  }

  /** Where indexMeshes' time actually went, for the load telemetry.
   *
   *  indexMeshes is the single heaviest post-processing step (742–4,070 ms in
   *  the field) and has been reported as ONE number, which is enough to know
   *  it matters and not enough to fix it. Optimising a renderer this app took
   *  months to stabilise on iOS, on a guess about which pass dominates, is how
   *  a working villa becomes a broken one — so the split gets measured on real
   *  devices first. Plain counters, no timers left running. */
  private stats = { probeMs: 0, probeRays: 0, probeHits: 0, labelsMs: 0 };
  /** Last pass's breakdown; read by SceneManager into the `load` event. */
  indexStats(): Readonly<{ probeMs: number; probeRays: number; probeHits: number; labelsMs: number }> {
    // probeMs/Rays/Hits live on the shared FloorProbe now — merged here rather
    // than mirrored into this.stats so there is exactly one counter per thing
    // counted, and ?debug's probeRays-vs-probeHits ratio still reads as the
    // bucketing's real hit rate.
    return {
      labelsMs: this.stats.labelsMs,
      probeMs: Math.round(this.probe.stats.probeMs),
      probeRays: this.probe.stats.probeRays,
      probeHits: this.probe.stats.probeHits,
    };
  }

  /**
   * The one place that answers "what is the floor height here?" — shared with
   * SceneManager and RoomHighlight since 2.300.0, and keyed by ROOM rather than
   * by a 4-metre grid. See floorProbe.ts for why that distinction was a real
   * field bug and not a tidiness exercise.
   */
  private probe!: FloorProbe;

  /** Reuse the previous load's probes when the geometry is byte-identical —
   *  the key is the VERSIONED model URL, so a stale answer cannot outlive the
   *  model it describes. Null disables persistence. */
  setProbeCacheKey(key: string | null): void {
    this.probe.setCacheKey(key);
    // The camera beams' clip lengths ride the same model key — same premise
    // (a pure function of this GLB's geometry), same ~21ms raycasts.
    this.beams.setCacheKey(key);
  }

  /** The shared floor probe, for SceneManager's own storey queries — one
   *  module owns the ray, the predicate and the cache (see floorProbe.ts). */
  get floorProbe(): FloorProbe { return this.probe; }

  /**
   * The pixel size a badge's baked squircle is DRAWN at, for the two styles.
   *
   * One expression, called by both the control that sets `glyph.width` and the
   * bake that fills it, because those two numbers agreeing IS the fix in
   * 2.301.0: the image is composited on a canvas and then drawn by Babylon GUI
   * with `drawImage`, and WebKit resamples that with a single bilinear tap
   * where Chrome mip-filters. Baked at 128 and drawn at 34 it staircased on
   * Safari and looked fine on Chrome. Baked at the drawn size it cannot
   * resample at all. If these two ever drift apart the blur comes straight
   * back, so they read the same expression rather than the same constant.
   */
  private glyphPxFor(card: boolean): number {
    const m = this.metrics;
    if (!card) return m.badgeDiameterPx;
    // The card's WORST-CASE inner box: Babylon insets a Rectangle's children
    // by its border, heaviest (ringThicknessPx) while the device is active or
    // alerting. Sizing the icon to anything larger clips it in exactly those
    // states — see the fuller note at the control's own construction.
    const cardMaxInnerH = m.cardHeightPx - 2 * m.ringThicknessPx;
    return Math.min(Math.round(m.cardHeightPx * m.cardIconFraction), cardMaxInnerH);
  }

  /**
   * The size a glyph is actually PAINTED at, which is what its bitmap must be
   * baked at — and it is not `glyphPxFor`.
   *
   * ⚠️ `this.metrics` is UNSCALED. Every badge control is built in base CSS
   * pixels and the whole container is then transform-scaled by
   * `effectiveScale()` (see applyIconScale), so a control whose `width` says 44
   * covers 44·s render pixels. 2.301.0 made the bake read the same expression
   * as the control's width and called that "baked at the size it is drawn" —
   * true of the two NUMBERS, and false of the pixels, because both are on the
   * unscaled side of a transform. On any retina device cssToGui() alone makes
   * s≈2 (a fact this file already states, in labelBaseOffsetY), so every badge
   * has been baking a 44px bitmap and painting it across ~88 render pixels.
   * That is a 2x upscale of the artwork before the canvas is composited, and
   * on WebKit — one bilinear tap, no mips — it is the whole reported "the
   * entity icons are very low resolution", on iPad and iPhone alike.
   *
   * ⚠️ It deliberately does NOT include `iconZoomScale`. Re-baking means
   * rebuildLabels (a data-URL swap on a live Babylon Image does not reliably
   * re-render the GUI texture — see repaintBadges), and the bird's-eye zoom
   * factor moves continuously, so including it would hitch the map every time
   * the ladder crossed a rung mid-pinch. It is capped at 1, so excluding it can
   * only ever leave the bitmap LARGER than the paint — a mild downscale, which
   * is the direction BAKE_LADDER's headroom exists to absorb and the direction
   * WebKit handles acceptably. The two factors that are left change only when
   * the resolution valve fires or the user moves the size stepper, and both of
   * those already repaint.
   */
  private glyphBakePx(card: boolean): number {
    return this.glyphPxFor(card) * this.iconUserScale * this.bestCssToGui();
  }

  /**
   * The HIGHEST css→GUI conversion this device will ever render at — its own
   * devicePixelRatio — rather than whatever the resolution valve has settled
   * on right now.
   *
   * ⚠️ It must not be the LIVE value, and 2.320.0's was. The engine's scaling
   * moves: the valve eases it down on a slow device, 2.317.0's measured step
   * raises it, and 2.321.0's idle sharpening now toggles it every time the
   * camera stops. Baking against the live value means every one of those has
   * to re-bake, and re-baking means rebuildLabels — acceptable once a session,
   * absurd every time you stop panning.
   *
   * Baking for the best case makes a scaling change cost a container re-scale
   * and nothing else. The bitmap is then larger than the paint whenever the
   * device is running below native, which is a DOWNSCALE — the direction
   * BAKE_LADDER's headroom exists to absorb and the direction WebKit handles
   * acceptably — and exactly 1:1 on the sharp idle frame, which is the frame
   * anyone actually reads a badge on.
   */
  private bestCssToGui(): number {
    return Math.max(1, window.devicePixelRatio || 1);
  }

  /** Y of the first structure surface below (x, y, z) — see FloorProbe.below.
   *  Kept as a one-line wrapper rather than inlining the probe at every call
   *  site so `exclude` (the fixture must not pick itself) stays impossible to
   *  forget. */
  private surfaceBelow(x: number, y: number, z: number, exclude?: AbstractMesh): number | null {
    return this.probe.below(x, y, z, exclude);
  }

  /** Build the reverse index entity_id -> meshes from the loaded GLB. */
  indexMeshes(meshes: AbstractMesh[]): void {
    // The single heaviest synchronous step in the app (measured at 1.1-3.4s on
    // a real villa) and therefore the first suspect for any reported freeze —
    // see perfSpans for why a named span rather than a profiler.
    const endSpan = beginSpan("indexMeshes");
    try {
      this.indexMeshesInner(meshes);
    } finally {
      endSpan();
    }
  }

  private indexMeshesInner(meshes: AbstractMesh[]): void {
    // Every anchor, mesh binding and label is rebuilt below.
    this.markLayoutDirty();
    // Restore the previous load's probes when they describe THIS geometry
    // (see setProbeCacheKey); otherwise this is a plain clear, as before.
    this.probe.load();
    this.probe.resetStats();
    this.stats = { probeMs: 0, probeRays: 0, probeHits: 0, labelsMs: 0 };
    // Dispose previously created light sources + shadow maps before re-indexing.
    this.disposeLights();
    this.disposeLabelAnchors();
    this.beams.dispose();
    this.pulsing.clear();
    this.spinningFans.clear();
    // TransformNode.dispose() with no args is RECURSIVE — it disposes the
    // whole descendant hierarchy, not just the node itself. Each fan mesh is
    // a child of its pivot (see setupFanRig's `m.setParent(pivot)`), so
    // disposing the pivot outright silently destroyed the fan mesh forever
    // on every structural re-index after the fan had ever been spun (any
    // Advanced Settings edit that touches entityMap triggers one). The mesh
    // must be moved back out onto the pivot's original parent FIRST — same
    // world-preserving setParent() used to rig it — so only the now-childless
    // pivot gets disposed.
    for (const rig of this.fanRigs.values()) {
      for (const r of rig) {
        r.mesh.setParent(r.pivot.parent);
        r.pivot.dispose();
      }
    }
    this.fanRigs.clear();
    this.fanAngles.clear();
    this.byEntity.clear();
    this.mapping.clear();
    this.meshVariants.clear();
    this.shadowCasters = [];

    // Creating dozens of PointLights one-by-one makes Babylon re-flag every
    // material's shader as dirty on each add — an O(lights × materials) storm of
    // shader recompiles that dominates load time on a fixture-dense villa. Batch
    // it: suspend the dirty mechanism while we build, then flush once at the end.
    const scene = this.scene;
    scene.blockMaterialDirtyMechanism = true;

    const endScan = beginSpan("indexScan");
    for (const m of meshes) {
      const map = resolveMeshToMapping(
        m.name, this.config.entityMap, this.config.meshBindings, this.config.deniedTypes,
      );
      if (!map) {
        // Everything that isn't a bound entity is villa shell / furniture: it can
        // block a lamp's light, so keep it as a potential shadow caster. Skip the
        // helper meshes (markers, halos, labels) that aren't real geometry.
        if (m.getTotalVertices() > 0 && !/^(halo_|label_|marker)/i.test(m.name)) {
          this.shadowCasters.push(m);
        }
        continue;
      }
      const list = this.byEntity.get(map.entityId) ?? [];
      list.push(m);
      this.byEntity.set(map.entityId, list);
      this.mapping.set(map.entityId, map);

      // Multi-mesh visual variants (see the pose-swap notes at the top of
      // this file) — UNIVERSAL: grouped purely by suffix presence, for EVERY
      // type. (There used to be a per-type vocabulary gate here, meaning "no
      // entry for
      // this type = never grouped at all", which is what silently no-op'd
      // pose-swap for switch/light/fan/etc even after apply()'s DISPATCH
      // logic was generalised to handle them — dispatch and grouping have to
      // agree, and grouping is the one that actually decides whether a pose
      // is ever recognised in the first place.)
      //
      // ONLY a mesh carrying a "__<word>" pose suffix is a pose. An
      // UNSUFFIXED mesh (no "__word") is NOT a pose — it's the entity's
      // always-present base geometry, e.g. the physical lock/keypad DEVICE
      // modelled as "lock.front_door" alongside the door leaf poses
      // "lock.front_door__locked"/"__unlocked". It used to be bucketed under
      // vocab.default, which quietly folded it INTO one pose's bucket — so
      // applyMeshVariant then hid the device whenever the OTHER pose was
      // active (the "device vanishes when unlocked" bug), and its state tint
      // disappeared with it. Leaving it out of meshVariants keeps it
      // permanently visible AND still state-tinted (applyToMesh tints any
      // unsuffixed lock; the pose meshes are the ones that skip the tint).
      const suffix = extractVariantSuffix(m.name);
      if (suffix) {
        let byWord = this.meshVariants.get(map.entityId);
        if (!byWord) { byWord = new Map(); this.meshVariants.set(map.entityId, byWord); }
        const wordList = byWord.get(suffix) ?? [];
        wordList.push(m);
        byWord.set(suffix, wordList);
      }

      // ISOLATE the material so state visuals can't bleed across meshes.
      // The Blender pipeline fuses non-entity geometry and the glTF exporter
      // DEDUPLICATES materials, so one Material instance is shared by every mesh
      // painted with it — e.g. a wooden wall-switch fixture and the living-room
      // chairs both reference the same wood material. Mutating emissive/diffuse
      // to show this entity's state (light glow, fan/lock/switch tint, sensor
      // pulse) would then recolour EVERY mesh sharing that material — which is
      // exactly why turning the master-bedroom light on also lit the living-room
      // chairs. Give each bound entity mesh its OWN clone (textures are shared by
      // reference, so this is cheap) so its visuals stay strictly local. Done
      // once per mesh (flagged in metadata) so a rebind re-index is idempotent.
      if (m.material && !m.metadata?.__entityMatCloned) {
        const clone = m.material.clone(`${m.material.name || "mat"}__e${m.uniqueId}`);
        if (clone) {
          m.material = clone;
          m.metadata = { ...(m.metadata ?? {}), __entityMatCloned: true };
        }
      }

      // For lights, create a real (initially off) PointLight at EACH fixture mesh
      // — one per lamp, so two bedside lamps under one entity both illuminate.
      if (map.type === "light") {
        // Geometry-less SweetHome "virtual light" markers (e.g. ceiling spots,
        // LED strips) are exported by blender_pipeline as small placeholder
        // spheres. Newer GLBs carry a baked VillaLightMarker material (cloned
        // above); older ones have NO material. Either way the baked baseline is
        // too faint to read as a fixture — which is why the Bedroom 1 ceiling and
        // the living-room LED strips (12 clustered 10 cm dots each) looked
        // "missing" while lights with real lamp geometry looked fine. Ensure an
        // emissive-capable material exists, then lift its baseline to a clearly
        // visible level for EVERY light mesh so it reads as a real object before
        // it's wired to HA. applyToMesh still overrides emissive from live state
        // (on = bright colour, off = black). Idempotent across re-index via the
        // same __entityMatCloned flag as the clone path.
        if (!m.material) {
          const lit = new StandardMaterial(`litemarker_${m.uniqueId}`, this.scene);
          lit.diffuseColor = WARM_GLOW.scale(0.5);
          lit.specularColor = Color3.Black();
          m.material = lit;
          m.metadata = { ...(m.metadata ?? {}), __entityMatCloned: true };
        }
        const setBaseline = this.emissiveOf(m);
        if (setBaseline) setBaseline(WARM_GLOW.scale(LIGHT_BASELINE_GLOW));
        // A glossy fixture housing catches specular highlights from the sun/room
        // lights that visibly slide across the surface as the camera moves —
        // easy to mistake for the fixture's OWN light looking inconsistent, when
        // it's actually unrelated reflection. Fixtures should read as diffuse
        // emitters, not mirrors, regardless of whatever material SweetHome/the
        // Blender pipeline attached.
        const mat = m.material;
        if (mat instanceof StandardMaterial) mat.specularColor = Color3.Black();
        else if (mat instanceof PBRMaterial) { mat.metallic = 0; mat.roughness = 1; }
        // Use bounding-box centre: when the model came from an OBJ (Blender
        // pipeline), the node position is (0,0,0) for every entity mesh and the
        // actual 3D location is encoded only in vertex data.
        m.computeWorldMatrix(true);
        this.inflateThinStrip(m);
        // EVERY light fixture mesh — marker sphere, inflated strip, or a
        // fully modelled bulb/fixture from the SweetHome catalog — gets the
        // same off-state alpha treatment in applyToMesh (see STRIP_OFF_ALPHA):
        // a smart light should read as "off" (translucent) the instant HA
        // says so, not stay a permanently opaque, statically-coloured prop.
        // That toggle needs depth writing while alpha-blended (see the
        // window-glass/strip depth-sort note by STRIP_OFF_ALPHA), so set it
        // here, once, for every light mesh — not only the ones inflateThinStrip
        // happens to touch.
        if (mat) mat.forceDepthWrite = true;
        // A real (diffuse-only, shadowless) PointLight at the fixture — created
        // in BOTH modes now. In non-baked mode it lights the whole room. In
        // BAKED mode the structure renders unlit (ModelLoader sets mat.unlit =
        // true), so this light does NOT touch the already-baked walls/floor —
        // it falls only on the separate furniture/entity meshes below the
        // fixture, which the bake never covered. That's the fix for baked night
        // scenes where furniture under an ON light stayed pitch-black while the
        // floor around it was lit (the floor gets the pool below; the 3D assets
        // get this light). Shadow maps stay OFF in baked mode (ensureLightShadow
        // returns early), so the only added cost is the lights themselves — and
        // they're disabled until their entity turns on, so an all-off villa pays
        // nothing.
        const bb = m.getBoundingInfo().boundingBox;
        const pos = bb.centerWorld.clone();
        // Elongated strips are mounted flush against a ceiling or wall; a light
        // AT the strip prints a hard hotspot on that surface (or a chain of
        // them). Drop the light partway toward whatever is below so its pool is
        // a wide soft wash instead — the visible "LED line" itself stays the
        // mesh's emissive + glow, not this light.
        const size = bb.maximumWorld.subtract(bb.minimumWorld);
        const longest = Math.max(size.x, size.y, size.z);
        if (longest >= STRIP_MIN_LENGTH) {
          const surfaceY = this.surfaceBelow(pos.x, pos.y, pos.z, m);
          const distance = surfaceY === null ? 0 : pos.y - surfaceY;
          if (distance > 0.3) {
            pos.y -= Math.min(STRIP_DROP_MAX, distance * STRIP_DROP_FRACTION);
          }
        }
        const light = new PointLight(`elight_${m.name}_${m.uniqueId}`, pos, this.scene);
        light.intensity = 0;
        light.range = LIGHT_RANGE;
        light.diffuse = WARM_GLOW.clone();
        // No specular: on glossy surfaces (the tiled floor) a point light's
        // white specular lobe is a bright glint that SLIDES as the camera moves
        // — easily mistaken for the light itself flickering. Diffuse-only keeps
        // the wash identical from every viewpoint.
        light.specular = Color3.Black();
        // Start DISABLED, not just intensity 0. A disabled light is dropped from
        // every material's shader light-loop entirely, so an off fixture costs
        // nothing to compile or shade; it's re-enabled in applyToMesh when the
        // entity turns on. With most lights off at load, this slashes the active
        // light count the first frame has to compile shaders for.
        light.setEnabled(false);
        this.meshLights.set(m.uniqueId, light);

        // Baked mode ALSO gets the floor glow pool: the unlit baked floor can't
        // be lit by the PointLight above, so the pool paints the on-floor wash
        // while the PointLight handles the 3D furniture. (see LightPools.ts —
        // same floor-finding raycast; scene-wide predicate because every mesh is
        // already in the scene even though this loop hasn't reached them all.)
        //
        // An elongated strip (e.g. one side of a rectangular LED ceiling cove)
        // only lighting its OWN centre left the CORNERS dark where two adjoining
        // strips' ends meet — each strip's single pool fades out well before
        // reaching that far. Fixed by giving a strip THREE pools instead of one:
        // full-intensity at its centre (unchanged), plus two half-intensity
        // pools at its own ends. At a shared corner, the two adjoining strips'
        // half-intensity end-pools land on (almost) the same spot and sum back
        // to roughly the centre's brightness — lighting the corner without
        // doubling it into a hotspot. A compact (non-strip) fixture is
        // unaffected: it still gets exactly one full-intensity pool.
        if (this.bakedMode) {
          const min = bb.minimumWorld, max = bb.maximumWorld;
          const cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
          const horiz = Math.max(size.x, size.z);
          const isStrip = longest >= STRIP_MIN_LENGTH && horiz >= STRIP_MIN_LENGTH;
          const spots: { x: number; z: number; scale: number }[] = isStrip
            ? (size.x >= size.z
              ? [{ x: cx, z: cz, scale: 1 }, { x: min.x, z: cz, scale: 0.5 }, { x: max.x, z: cz, scale: 0.5 }]
              : [{ x: cx, z: cz, scale: 1 }, { x: cx, z: min.z, scale: 0.5 }, { x: cx, z: max.z, scale: 0.5 }])
            : [{ x: cx, z: cz, scale: 1 }];

          const pools = spots
            .map(({ x, z, scale }, i) => {
              const fixturePos = new Vector3(x, bb.centerWorld.y, z);
              const surfaceY = this.surfaceBelow(fixturePos.x, fixturePos.y, fixturePos.z, m);
              // No floor found within the probe's reach: the old fallback
              // placed the pool 1m below the fixture regardless — a glow
              // patch floating at roughly window/furniture height instead of
              // on the floor, reported (accurately) as "a disk floating in
              // the air" and traced to surfaceBelow's predicate accepting
              // furniture as a floor hit (now fixed via isStructureMesh — see
              // that method). No pool at all — this one spot just reads as
              // an unlit fixture — is a far smaller miss than a wrongly-
              // placed glow, and with structure-only hits plus a 20m ray and
              // the seam-nudge retry, an actual miss here should now mean
              // there is genuinely no floor within reach (an outdoor fixture
              // over water, say). Logged rather than silently swallowed so
              // that rarer case is still visible on the kiosk itself via
              // ?debug, without needing devtools.
              if (surfaceY === null) {
                tapDebug(
                  `light pool: no floor found below ${m.name} at world `
                  + `(${fixturePos.x.toFixed(2)}, ${fixturePos.y.toFixed(2)}, ${fixturePos.z.toFixed(2)}) `
                  + `even after the seam-nudge retry — fixture skipped (was a floating disc before this fix).`,
                );
                return null;
              }
              const floorPos = new Vector3(fixturePos.x, surfaceY + POOL_FLOOR_LIFT, fixturePos.z);
              // Built as its plain footprint here, deliberately. Room polygons
              // do not exist yet — SceneManager calibrates AFTER indexMeshes,
              // post-first-frame, because the fit's raycasts are too heavy for
              // the load path — so clipping happens later, in reshapeLightPools,
              // which keeps all of the new work off the critical path.
              const pool = new LightPool(this.scene, `${m.name}_${m.uniqueId}_${i}`, floorPos, LIGHT_POOL_RADIUS);
              pool.intensityScale = scale;
              pool.probeFromY = fixturePos.y;
              return pool;
            })
            .filter((p): p is LightPool => p !== null);
          this.meshLightPools.set(m.uniqueId, pools);
        }
      }
    }
    endScan();
    // ── SUB-SPAN: the per-mesh pass, apart from what follows it ────────────
    // `indexMeshes` is now the longest block of the load (1057ms on an M1,
    // ~1350ms on the phone) and, like the duplicate resolve before it, barely
    // moves between the two — single-threaded work again. But "indexMeshes"
    // names a whole function, and the fix depends on WHICH half: this loop
    // resolves and buckets 856 meshes and builds a PointLight per fixture,
    // while everything after it is badge and pool construction. Guessing
    // between them is what the Draco note in ModelLoader warns about.
    //
    // Delete this span once it has answered — it is a diagnostic, not a
    // permanent boundary.

    this.extendStripJoints();
    this.mergeStripEntityLights();
    scene.blockMaterialDirtyMechanism = false;

    this.buildLabelAnchors();

    // Safety net for multi-variant entities (see meshVariants):
    // default each one to its type's default pose RIGHT NOW, rather than
    // leaving every authored pose visible at once — their raw as-imported
    // visibility — until a live HA state arrives for it. applyMeshVariant is
    // normally the ONLY thing that hides the other poses, and it only ever
    // runs from apply(), which needs a real state_changed event (or an
    // initial get_states snapshot entry) to fire at all. An entity that's
    // been modelled with 2-3 poses but isn't wired to a real HA entity yet —
    // or simply hasn't reported in before this index ran — would otherwise
    // show ALL of them overlapping, indefinitely, with nothing left to ever
    // correct it. Reuses applyMeshVariant itself (not a parallel visibility
    // pass) so this gets the exact same label-anchor re-parenting fix too.
    // Visible with ?debug — the "did my __closed/__half/__open naming
    // actually get grouped as ONE entity with several poses, or as several
    // separate (probably 'Unmapped') entities that never get toggled at
    // all" question is otherwise near-impossible to answer on a real kiosk
    // with no console access. Only entities that reached 2+ recognised poses
    // are worth a line — every ordinary single-mesh cover/lock in the villa
    // (the common case) would otherwise print one too, burying the ones
    // actually worth looking at.
    const variantSummary: string[] = [];
    for (const [entityId, byWord] of this.meshVariants) {
      // The vocabulary + default word to show before any live state has
      // arrived. cover/lock (and an opening-class binary_sensor) have a real,
      // fixed vocab — its named default. Everything else (a generic
      // binary_sensor, any sensor) has none at all, so the default is simply
      // whichever authored word sorts first — arbitrary but DETERMINISTIC,
      // and only ever visible for the instant before apply() replays this
      // entity's real (or phantom-"unavailable") state via the exact same
      // resolver, which is what keeps the two from ever disagreeing.
      const resolved = this.variantWordsFor(entityId);
      if (byWord.size >= 2 && resolved) this.applyMeshVariant(entityId, resolved.order, resolved.default);
      // Report EVERY entity that picked up a variant bucket, size-1 included:
      // a pose that escaped grouping into its OWN single-mesh entity (e.g.
      // "cover.x__open" resolving separately from "cover.x") is the exact
      // "one pose always visible while the rest toggle" bug, and it shows up
      // here as a lonely size-1 group next to the real multi-pose one.
      const counts = Array.from(byWord, ([w, ms]) => `${w}:${ms.length}`).join(", ");
      variantSummary.push(
        `${entityId} -> {${counts}}${byWord.size < 2 ? "  (SIZE 1 — escaped grouping?)" : `, default "${resolved?.default}"`}`,
      );
    }
    // Also flag any entity whose id STILL carries a "__<variant>" suffix — a
    // sign normalisation didn't collapse it onto its base (stale config, or a
    // mesh-name mangling stripExportArtifacts didn't catch).
    const orphanIds = Array.from(this.byEntity.keys()).filter((id) => /__[a-z0-9]+$/i.test(id));
    if (variantSummary.length || orphanIds.length) {
      tapDebug(
        `mesh variant groups:\n  ${variantSummary.join("\n  ") || "(none)"}`
        + (orphanIds.length ? `\n  ORPHAN un-collapsed entities: ${orphanIds.join(", ")}` : ""),
      );
    }

    this.buildMotionToCameraIndex();
    this.buildLinkedEntityIndex();
    // Rebuild the camera beams we disposed at the top of this method. Without
    // this they were gone for good: only setCameraDirections built them, and
    // that runs once, during calibration after the model loads. So the FIRST
    // re-index after load silently killed every beam — which is why a beam
    // would appear at startup and then never again in the same session. The
    // direction data survives on this.cameraDirections, and byEntity has just
    // been rebuilt above, so everything the build needs is in place.
    this.buildCameraBeams();
    const tLabels = performance.now();
    this.rebuildLabels(); // labels are always shown
    this.stats.labelsMs = Math.round(performance.now() - tLabels);
    this.probe.save();
  }

  /** A rectangular LED cove (e.g. the dining-table or sofa-area perimeter) is
   *  modelled as SEVERAL separate elongated strip meshes — one per side — so
   *  the per-mesh loop above gives it one PointLight per side: 4 distinct
   *  light "pools" instead of one even wash ("I want to keep seeing a light
   *  line, not separate light bulbs"). When EVERY mesh of a light
   *  entity is an elongated strip, merge their individual PointLights into
   *  ONE shared light at the merged bounding box's centre — one soft,
   *  even room-fill instead of N hotspots. Genuinely separate fixtures under
   *  one entity (e.g. two bedside lamps) don't pass the "every mesh is a
   *  strip" test, so each keeps its own light exactly as before. */
  private mergeStripEntityLights(): void {
    // Runs in BOTH modes now — baked mode gained per-fixture PointLights (to
    // light furniture), so a multi-piece LED strip would otherwise spawn one
    // light per side here too. Pools are per-marker and untouched by this merge.
    for (const [entityId, meshes] of this.byEntity) {
      const map = this.mapping.get(entityId);
      if (!map || map.type !== "light" || meshes.length < 2) continue;
      const allStrips = meshes.every((m) => {
        const size = m.getBoundingInfo().boundingBox.maximumWorld.subtract(
          m.getBoundingInfo().boundingBox.minimumWorld);
        return Math.max(size.x, size.y, size.z) >= STRIP_MIN_LENGTH;
      });
      if (!allStrips) continue;

      const bounds = this.mergedWorldBounds(meshes);
      if (!bounds) continue;
      const pos = Vector3.Center(bounds.min, bounds.max);
      const surfaceY = this.surfaceBelow(pos.x, pos.y, pos.z, meshes[0]);
      const distance = surfaceY === null ? 0 : pos.y - surfaceY;
      if (distance > 0.3) {
        pos.y -= Math.min(STRIP_DROP_MAX, distance * STRIP_DROP_FRACTION);
      }

      const seen = new Set<PointLight>();
      for (const m of meshes) {
        const l = this.meshLights.get(m.uniqueId);
        if (l && !seen.has(l)) { seen.add(l); l.dispose(); }
      }
      const shared = new PointLight(`elight_${entityId}_merged`, pos, this.scene);
      shared.intensity = 0;
      shared.range = LIGHT_RANGE;
      shared.diffuse = WARM_GLOW.clone();
      shared.specular = Color3.Black();
      shared.setEnabled(false);
      for (const m of meshes) this.meshLights.set(m.uniqueId, shared);
    }
  }

  /** Stretch every strip mesh of a multi-piece light entity past its own
   *  modelled endpoints by STRIP_JOINT_EXTENSION, so adjacent pieces (e.g.
   *  the 4 sides of a rectangular LED cove) always overlap at their shared
   *  corner even when the source .sh3d placed them with a small (sub-cm) gap
   *  — see the constant's comment for the measured evidence this is real,
   *  not a camera-angle artifact. Runs on the LONG axis (the one
   *  inflateThinStrip does NOT touch — that one only thickens the SHORT
   *  axis), so the two passes complement rather than fight each other. */
  private extendStripJoints(): void {
    for (const [entityId, meshes] of this.byEntity) {
      const map = this.mapping.get(entityId);
      if (!map || map.type !== "light" || meshes.length < 2) continue;
      for (const m of meshes) {
        // The extension is ADDITIVE on the vertex data, and indexMeshes()
        // re-runs on config changes — without this flag every re-index would
        // stretch the strip another 2 cm per end.
        if (m.metadata?.__stripJointExtended) continue;
        const bb = m.getBoundingInfo().boundingBox;
        const size = bb.maximum.subtract(bb.minimum);
        const unit = axisWorldScale(m);
        const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
        // World metres for the checks, local units for the vertex edit — the
        // local data is in the model's own (cm) units, see axisWorldScale.
        const worldSize = {
          x: size.x * unit.x, y: size.y * unit.y, z: size.z * unit.z,
        };
        const longAxis = axes.reduce((a, b) => (worldSize[b] > worldSize[a] ? b : a));
        if (worldSize[longAxis] < STRIP_MIN_LENGTH || unit[longAxis] <= 0) continue; // not a strip piece (e.g. a small marker)

        const positions = m.getVerticesData(VertexBuffer.PositionKind);
        if (!positions) continue;
        const idx = longAxis === "x" ? 0 : longAxis === "y" ? 1 : 2;
        const center = (bb.minimum[longAxis] + bb.maximum[longAxis]) / 2;
        const extension = STRIP_JOINT_EXTENSION / unit[longAxis];
        for (let i = idx; i < positions.length; i += 3) {
          const sign = positions[i] < center ? -1 : 1;
          positions[i] += sign * extension;
        }
        m.setVerticesData(VertexBuffer.PositionKind, positions, true);
        m.refreshBoundingInfo(false, false);
        m.metadata = { ...(m.metadata ?? {}), __stripJointExtended: true };
      }
    }
  }

  /** Build a "driver entity_id -> device entity_ids it drives" index from one
   *  EntityMapping field, over the FULL entityMap (not just meshes indexed in
   *  THIS glb) so a link works regardless of which side has a 3D mesh — the
   *  driver very often has none at all (a motion sensor is rarely a modelled
   *  object). Cheap rebuild, safe to redo on every index. Shared by both
   *  indexes since they differ ONLY in which field they read and whether
   *  they're camera-scoped. */
  private buildLinkIndex(
    target: Map<string, string[]>,
    driverOf: (map: EntityMapping) => string | undefined,
  ): void {
    target.clear();
    for (const map of Object.values(this.config.entityMap)) {
      const driver = driverOf(map);
      if (!driver) continue;
      const list = target.get(driver) ?? [];
      list.push(map.entityId);
      target.set(driver, list);
    }
  }

  private buildMotionToCameraIndex(): void {
    // Camera-scoped: motionEntityId is meaningless on any other type (nothing
    // else has a beam), so a stray value elsewhere must not build an entry.
    this.buildLinkIndex(this.motionToCameraIds,
      (m) => (m.type === "camera" ? m.motionEntityId : undefined));
  }

  private buildLinkedEntityIndex(): void {
    this.buildLinkIndex(this.linkedEntityIndex, (m) => m.linkedEntityId);
    // Seed the ring set from whatever state already arrived — unlike the
    // camera beam index (which needs a REBUILT beam mesh before it can
    // replay), this is just a Set, so it's always safe to resync here rather
    // than waiting on the next state_changed event, which may never come
    // again if the linked entity was already on before this index existed.
    for (const [linkedId, ids] of this.linkedEntityIndex) {
      const on = this.lastState.get(linkedId)?.state === "on";
      for (const id of ids) {
        if (on) this.linkActiveIds.add(id);
        else this.linkActiveIds.delete(id);
      }
    }
  }

  // axisWorldScale moved to ./meshUnits — shared with SceneManager's outline
  // width, which hit the exact same local-cm-vs-world-metre trap (see there).

  /** Thicken EVERY local axis of a mesh that's below MIN_STRIP_THICKNESS
   *  (not just the single thinnest one — see below), symmetric about its own
   *  centre on that axis, by editing vertex positions directly (no node
   *  scaling — scaling around the wrong pivot would shift the whole strip
   *  sideways instead of just thickening it). No-op for anything not
   *  razor-thin (normal lamp/fixture meshes) and for the LONG axis (a
   *  strip's length, which is exactly what should stay untouched here).
   *  All size comparisons happen in WORLD metres and all vertex edits in
   *  LOCAL units via axisWorldScale — see that helper for why.
   *
   *  A SweetHome Led Line piece is typically authored 1cm wide AND 3cm tall —
   *  TWO separate thin dimensions, not one. Only fixing the SINGLE thinnest
   *  axis (the original v2.4.74 fix) leaves the other one still sub-pixel
   *  from steep-enough viewing angles: from a near-overhead camera looking
   *  down at a low cove strip, which of the two short axes actually
   *  determines the strip's on-screen thickness depends on the exact camera
   *  elevation/zoom — so a segment could render fine at one zoom level (the
   *  now-thick 6cm axis dominates its screen footprint) and vanish at another
   *  (the OTHER, still-thin axis takes over as the dominant screen-space
   *  dimension). That's what made the exact broken segment shift between two
   *  screenshots of the very same wall at slightly different zoom — a
   *  single-axis fix was never going to fully solve this since the strip had
   *  two independent thin dimensions to begin with.
   *
   *  Pushes each vertex to a FIXED distance from centre (±MIN_STRIP_THICKNESS/2)
   *  rather than multiplying its offset by a scale factor. A multiplicative
   *  scale (MIN_STRIP_THICKNESS / size[axis]) is unbounded as size[axis] shrinks
   *  towards zero — and it does, in practice: Draco compression quantises
   *  vertex positions, so a strip modelled 1cm thick in SweetHome can come out
   *  of the GLB at a fraction of a millimetre. That produced scale factors in
   *  the hundreds, blowing a thin fixture mesh up into a vertical column
   *  punching through the floor and ceiling — the giant glowing "light beam"
   *  artifact, not a lighting bug at all, just this function over-stretching
   *  the mesh it was supposed to gently thicken. A fixed target offset is
   *  bounded for any input, including exactly zero, so it can't recur. */
  private inflateThinStrip(mesh: AbstractMesh): void {
    const bb = mesh.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    const unit = axisWorldScale(mesh);
    const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
    // Compare in WORLD metres — local sizes are in the model's own units (cm).
    const worldSize = {
      x: size.x * unit.x, y: size.y * unit.y, z: size.z * unit.z,
    };
    const longAxis = axes.reduce((a, b) => (worldSize[b] > worldSize[a] ? b : a));
    const thinAxes = axes.filter(
      (a) => a !== longAxis && unit[a] > 0 && worldSize[a] < MIN_STRIP_THICKNESS);
    if (thinAxes.length === 0) return;

    // This mesh is a genuine filament we're artificially thickening — mute its
    // baked "self-lit" base colour to a ceiling-matched grey and tag it so
    // applyToMesh can fade it out when the light is OFF (see
    // STRIP_OFF_VISIBILITY). The dynamic on/off glow is carried entirely by
    // the emissive channel, untouched by this.
    const mat = mesh.material;
    if (mat instanceof StandardMaterial) mat.diffuseColor = LED_HOUSING_COLOR.clone();
    else if (mat instanceof PBRMaterial) mat.albedoColor = LED_HOUSING_COLOR.clone();
    // Same depth-sort fix as window glass (see ModelLoader): while the strip
    // is alpha-blended (OFF state), keep writing depth so its draw order
    // can't flip against the glass walls as the camera moves. Harmless while
    // opaque (ON) — opaque geometry writes depth anyway. Set once here; the
    // per-state alpha/transparencyMode toggle lives in applyToMesh.
    if (mat) mat.forceDepthWrite = true;

    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;
    for (const axis of thinAxes) {
      const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      const center = (bb.minimum[axis] + bb.maximum[axis]) / 2;
      // Convert the metre target into this mesh's LOCAL units for the edit.
      const halfTarget = MIN_STRIP_THICKNESS / 2 / unit[axis];
      for (let i = idx; i < positions.length; i += 3) {
        const sign = positions[i] < center ? -1 : 1;
        positions[i] = center + sign * halfTarget;
      }
    }
    mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
    mesh.refreshBoundingInfo(false, false);
  }

  /** Tear down all entity light sources and their shadow generators. */
  private disposeLights(): void {
    this.lightShadows.forEach((g) => g.dispose());
    this.lightShadows.clear();
    // A merged strip entity (mergeStripEntityLights) stores the SAME light
    // instance under several mesh keys — dedupe before disposing.
    const seen = new Set<PointLight>();
    this.meshLights.forEach((l) => { if (!seen.has(l)) { seen.add(l); l.dispose(); } });
    this.meshLights.clear();
    this.meshLightPools.forEach((arr) => arr.forEach((p) => p.dispose()));
    this.meshLightPools.clear();
  }

  /** World-space bounding box spanning ALL of an entity's meshes merged (e.g.
   *  a curtain rail + fabric, or several bedside lamps under one entity) —
   *  shared by the label-anchor and camera-beam placement, both of which need
   *  "the whole asset's" box, not just whichever mesh happened to be first. */
  private mergedWorldBounds(meshes: AbstractMesh[]): { min: Vector3; max: Vector3 } | null {
    let min: Vector3 | null = null;
    let max: Vector3 | null = null;
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      min = min ? Vector3.Minimize(min, bb.minimumWorld) : bb.minimumWorld.clone();
      max = max ? Vector3.Maximize(max, bb.maximumWorld) : bb.maximumWorld.clone();
    }
    return min && max ? { min, max } : null;
  }

  /** One invisible anchor per mesh-bound entity, positioned at the top-centre
   *  of that entity's WHOLE bounding box, plus a small clearance margin. This
   *  is real geometry, computed once from the loaded model, so the label
   *  naturally sits close to each asset regardless of how tall it is or how
   *  high up it's mounted — no per-object hand-tuning. */
  private buildLabelAnchors(): void {
    for (const [entityId, meshes] of this.byEntity) {
      if (!meshes.length) continue;
      const bounds = this.mergedWorldBounds(meshes);
      if (!bounds) continue;
      const { min, max } = bounds;
      const node = new TransformNode(`lblAnchor_${entityId}`, this.scene);
      node.position.set((min.x + max.x) / 2, max.y + LABEL_ANCHOR_MARGIN, (min.z + max.z) / 2);
      // Parent to the entity's mesh (world position preserved) so the anchor
      // inherits enabled-state: when FloorManager hides a floor, the label
      // culler sees the disabled anchor and hides the badge with the device.
      node.setParent(meshes[0]);
      this.labelAnchors.set(entityId, node);
    }
  }

  private disposeLabelAnchors(): void {
    this.labelAnchors.forEach((n) => n.dispose());
    this.labelAnchors.clear();
  }

  /** Full teardown for scene disposal. scene.dispose() reclaims most of what
   *  this owns (meshes, lights, the GUI texture as a scene texture), but the
   *  fullscreen AdvancedDynamicTexture holds its OWN 2D canvas + backing WebGL
   *  texture that is safest disposed explicitly, and the sub-controllers
   *  (beams, roomHighlight) have their own dispose(). Called by
   *  SceneManager.dispose(); safe to run before scene.dispose(). */
  dispose(): void {
    this.offPointerClass?.();
    this.offPointerClass = null;
    this.disposeLights();
    this.disposeLabelAnchors();
    this.beams.dispose();
    this.roomHighlight.dispose();
    for (const rig of this.fanRigs.values()) {
      for (const r of rig) r.pivot.dispose();
    }
    this.fanRigs.clear();
    this.pulsing.clear();
    this.spinningFans.clear();
    this.labels.clear();
    this.labelsNewestFirst.length = 0;
    this.lastState.clear();
    this.labelLayer?.dispose();
    this.labelLayer = null;
  }

  /** Replace the calibrated room polygons (world space) — forwarded straight
   *  to RoomHighlight. Called by SceneManager after every plan→world re-fit
   *  (load + mirror-flip toggles), same trigger as the teleport grid. */
  setRoomPolygons(polys: { name: string; pts: { x: number; z: number }[]; floorY?: number; conform?: { positions: number[]; indices: number[] } }[]): void {
    this.roomHighlight.setRooms(polys);
    // Each room's ground WIDTH used to be cached here too, as the "is there
    // space here?" denominator for laying a pile of badges out across a room.
    // Nothing lays badges out any more (2.159.0 — badges sit on their anchors
    // or their room summarises), so the room's own size no longer takes part
    // in any grouping decision and the cache is gone with the fan.
    this.roomPolys = polys.filter((p) => p.pts.length >= 3).map((p) => ({ name: p.name, pts: p.pts }));
    // Everything below depends on these polygons and nothing above does, so
    // this is the earliest moment either half of the 2.300.0 fix can run.
    this.reshapeLightPools();
  }

  /**
   * Give every light pool its room's shape and its room's floor height, once
   * the plan→world calibration has produced the polygons that make both
   * answerable. Fixes two reported defects at once, and they were reported
   * together because they share a cause — a fixture near a wall:
   *
   *   - the pool drawn THROUGH the wall into the next room. A horizontal disc
   *     passes straight through the base of a vertical wall, so a fixture
   *     within LIGHT_POOL_RADIUS of one painted glow on both sides of it.
   *     Inherent to the primitive; no radius both covers the walkway and stops
   *     at its edge. The pool is now its ROOM clipped to its own footprint, so
   *     the wall bounds it by construction.
   *   - the pool NOT VISIBLE under a lit fixture. Its floor height came from a
   *     4-metre-bucketed probe that merged across walls, so the fixture
   *     inherited the neighbouring room's floor and the disc ended up under the
   *     one it was meant to sit on. Re-probing here gets a ROOM-keyed answer
   *     (see floorProbe.ts).
   *
   * Runs once per calibration, after first paint — never on a state change.
   * A tap still costs exactly what it always did: LightPool.setState is
   * setEnabled plus two material writes, and nothing here is on that path.
   */
  private reshapeLightPools(): void {
    if (this.meshLightPools.size === 0 || this.roomPolys.length === 0) return;
    // The memoised answers were keyed by grid (no resolver was available during
    // indexMeshes); the persisted ones are keyed by whatever they were computed
    // under. Dropping the in-memory map lets the same points be re-asked now
    // that the resolver can name their room — a few dozen rays, post-reveal.
    this.probe.clearMemo();
    for (const pools of this.meshLightPools.values()) {
      for (const pool of pools) {
        const x = pool.mesh.position.x, z = pool.mesh.position.z;
        const room = this.roomPolys.find((r) => pointInPolygon(x, z, r.pts));
        let radius = LIGHT_POOL_RADIUS;
        let shape: Pt2[] | undefined;
        if (room) {
          // Room = SUBJECT (may be L-shaped), footprint = CLIP (convex). That
          // order is the correctness argument — see clipPolygonToConvex.
          const clipped = clipPolygonToConvex(room.pts, poolFootprint(x, z, radius));
          if (clipped.length >= 3) shape = clipped;
        } else {
          // Outside every polygon — open ground, or a fixture whose anchor sits
          // just past a wall. There is no room to clip to, so bound the radius
          // by the nearest room boundary instead: still cannot cross a wall,
          // and a fixture far from everything keeps its full pool.
          let nearest = Infinity;
          for (const r of this.roomPolys) {
            nearest = Math.min(nearest, distanceToPolygonBoundary(x, z, r.pts));
          }
          if (Number.isFinite(nearest)) radius = Math.min(radius, Math.max(POOL_MIN_RADIUS, nearest));
        }
        const surfaceY = this.surfaceBelow(x, pool.probeFromY, z);
        pool.reshape(shape, radius, surfaceY === null ? undefined : surfaceY + POOL_FLOOR_LIFT);
      }
    }
    this.probe.save();
    this.requestRender();
  }

  /** Replace the resolved entity->room map (see the field's own docstring) —
   *  called by SceneManager whenever Dashboard recomputes it (HA registry
   *  change, or the scene's plan-to-world calibration changing). Cheap: a
   *  reference swap, no re-index. Badge grouping/clustering and motion-
   *  routing's room-highlight both read this on their next pass, not
   *  retroactively — same as every other config-driven visual here. */
  setResolvedRooms(rooms: Record<string, string>): void {
    this.resolvedRooms = rooms;
    // MUST mark dirty (regression from 2.113.0's frame-skip). roomOf() reads
    // this map, and it is what every grouping/clustering decision keys on —
    // but room resolution only lands AFTER the reveal (calibrateRooms runs in
    // loadModel's deferred post-first-frame block, because its raycasts are
    // too heavy for the load path). Before 2.113.0 cullLabels ran every frame
    // and picked the new map up on the next one; afterwards it only runs when
    // something marks the layout dirty, and this setter did not. The badges
    // therefore kept a layout computed while EVERY entity still resolved to
    // NO_ROOM_LABEL — i.e. ungrouped and overlapping — until some unrelated
    // event happened to dirty the layout, which is the reported "badges sit
    // on top of each other for a few seconds, then rearrange by themselves".
    this.markLayoutDirty();
  }

  /** Which drawn room polygon (if any) contains this world-space ground
   *  point — the geometric half of roomForEntity's room auto-fill. Straight
   *  linear scan: called only once per freshly detected entity right after a
   *  model load, never per-frame, so the room count (a couple dozen at most)
   *  costs nothing worth caching further. */
  private roomContaining(x: number, z: number): string | null {
    for (const room of this.roomPolys) {
      if (pointInPolygon(x, z, room.pts)) return room.name;
    }
    return null;
  }

  /** Geometric room fallback: which real drawn room polygon this entity's
   *  own mesh anchor sits inside, or null if it sits outside every polygon
   *  (open ground between rooms, a fixture whose anchor sits just past a
   *  wall) or the entity has no anchor yet. Purely geometric — reads only
   *  this villa's own calibrated floor plan, so it generalises to any
   *  install with zero per-site tuning. Called by Dashboard.tsx's room-
   *  resolution effect for whatever HA hasn't organised into an Area (see
   *  resolvedRooms) — HA's own Area assignment wins whenever a device has
   *  one; this is only ever consulted for the entities it doesn't cover. */
  roomForEntity(entityId: string): string | null {
    const anchor = this.labels.get(entityId)?.anchor;
    if (!anchor) return null;
    const p = anchor.getAbsolutePosition();
    return this.roomContaining(p.x, p.z);
  }

  /** World-space XZ bounding box (plus a floor height) of a room's registered
   *  entity ANCHORS — the fallback used by SceneManager.navigateTo when this
   *  room has no real drawn polygon (CameraController.getRoomBounds returns
   *  null), e.g. a point-only teleport spot. Null if the room has no
   *  registered entities either (nothing to frame). Matched the same
   *  case/whitespace-insensitive way as the polygon lookup, so a room whose
   *  config spelling differs only in case still frames correctly. */
  getRoomEntityBounds(
    room: string,
  ): { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number } | null {
    const key = roomKey(room);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    // Anchors hang above their device, so the LOWEST one is the closest
    // available stand-in for the room's floor.
    let minY = Infinity;
    let found = false;
    for (const [id, lbl] of this.labels) {
      if (roomKey(this.roomOf(id)) !== key) continue;
      const p = lbl.anchor.getAbsolutePosition();
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
      if (p.y < minY) minY = p.y;
      found = true;
    }
    return found ? { minX, maxX, minZ, maxZ, floorY: minY } : null;
  }

  /**
   * Grant (or drop) a room's exemption from grouping — see focusedRoom.
   *
   * Called when the user taps that room's chip. `null` drops it. Idempotent
   * apart from marking the layout dirty, which it must, since the exemption
   * changes what the very next pass will draw.
   */
  setFocusedRooms(rooms: readonly string[] | null): void {
    const keys = (rooms ?? []).map(roomKey).filter(Boolean);
    if (keys.length === this.focusedRooms.size && keys.every((k) => this.focusedRooms.has(k))) return;
    this.focusedRooms = new Set(keys);
    // Stamped on the NEXT pass, once the camera has actually been moved to the
    // solved pose — reading the zoom here would capture the pre-flight one and
    // clear the focus on arrival.
    this.focusedAtZoom = 0;
    this.markLayoutDirty();
    this.requestRender();
  }

  /** The rooms currently exempt from grouping (roomKey form). */
  focusedRoomKeys(): string[] {
    return [...this.focusedRooms];
  }

  /**
   * The closest camera radius at which every one of this room's badges is
   * drawn INDIVIDUALLY and lands FULLY on screen — the answer behind "tap a
   * room, see its devices".
   *
   * ── Why this searches instead of solving (2.211.0) ────────────────────────
   * Three releases tried to derive this distance in closed form, and each was
   * exact arithmetic on a wrong input: a margin that approximated the zoom
   * quantiser, a cap that approximated the framing limit, then badge sizes
   * measured at the camera's CURRENT zoom rather than the destination's. Every
   * one of them was invisible in review — the formula reads correctly, the
   * value going in does not — and every one of them shipped, because the only
   * test available was a person tapping a room chip on a phone.
   *
   * The derivation is the part that keeps being wrong, so it is gone. This
   * walks the SAME discrete zoom ladder the renderer quantises to and, at each
   * rung, asks the two questions literally:
   *
   *   * would groupBadges group anything here? — the identical pairwise reach
   *     test, in world units, against the identical quantised zoom;
   *   * is every badge inside the frame? — anchor distance from the shot's
   *     centre, plus that badge's own drawn reach converted at THIS rung's
   *     zoom, against the visible half-extent.
   *
   * and returns the first rung that satisfies both. There is no margin, no
   * cap and no fudge factor, because there is nothing being approximated: the
   * predicates are the same ones that will run when the camera arrives. It is
   * the rule this file has already learned the hard way — whatever decides a
   * thing must BE the thing that does it. Held literally here: the rung loop
   * calls badgePlacement's own `conflicts`, not a copy of it.
   *
   * Cost is ~40 rungs x pairs, once, on a tap. Nothing here runs per frame.
   *
   * Returns null when the room has nothing to solve for (fewer than two
   * badges), and `fitOnly` when no rung can declutter it but one can frame it
   * — two devices sharing a 3D point never separate at any zoom, and the
   * caller would rather show the room properly than chase a rung that does
   * not exist.
   */
  solveRoomZoomRadius(
    room: string,
    view: {
      /** Render-target height in px — the units quantisedPixelsPerWorldUnit uses. */
      vpH: number;
      /** Render-target width in px — the other half of the frame test. */
      vpW: number;
      /** Vertical field of view in radians (Babylon's FOVMODE_VERTICAL_FIXED). */
      vFov: number;
      /** The DESTINATION's view plane, UNQUANTISED. "Is this badge on screen"
       *  is a per-axis question about a pose that is already known exactly, so
       *  it is asked through the exact basis — the quantised one exists to keep
       *  GROUPING stable and is still what `dir` below builds for that. */
      frame: ViewBasis;
      /** The shot's orbit centre, i.e. what the badges are measured against. */
      cx: number; cy: number; cz: number;
      /** Search bounds, world units. */
      minRadius: number; maxRadius: number;
      /** The DESTINATION's view direction (unit, world space). The shot forces
       *  a top-down tilt, so this is not the direction the camera is pointing
       *  while the ladder runs — see currentViewBasis's parameter. */
      dir?: { x: number; y: number; z: number };
    },
  ): { radius: number; declutters: boolean } | null {
    if (!(view.vpH > 0) || !(view.vpW > 0) || !(view.vFov > 0)) return null;
    // ── EVERY eligible badge, not just this room's ────────────────────────
    // groupBadges runs over the whole shown set and is deliberately NOT
    // filtered by what is currently framed, so a pile can span rooms — and a
    // pile that spans rooms sends BOTH of them to their chips (cullLabels'
    // tier list). A solver that only looked at this room's own badges
    // therefore promised shots it could not deliver: the room's two badges
    // separated perfectly, one of them still touched a neighbour's badge just
    // outside the frame, and the chip the user tapped was still there when the
    // camera arrived. Same tap, different answer depending on where the
    // neighbours happened to be — which is exactly the inconsistency reported.
    const key = roomKey(room);
    const hidden = this.config.hiddenCategories;
    const all: { lbl: LabelControls; wx: number; wy: number; wz: number; mine: boolean }[] = [];
    for (const [id, lbl] of this.labels) {
      if (!this.badgeEligible(id, lbl, hidden)) continue;
      const p = lbl.anchor.getAbsolutePosition();
      all.push({ lbl, wx: p.x, wy: p.y, wz: p.z, mine: roomKey(this.roomOf(id)) === key });
    }
    const members = all;
    if (members.filter((m) => m.mine).length < 2) return null;

    // ── Measure the badges the DECISION will see ──────────────────────────
    // Two corrections, both of which were previously wrong in ways that read
    // fine in review:
    //   * ICON-ONLY. cullLabels drops a colliding badge's value readout before
    //     it tests grouping, so the boxes that decide are always icon-only,
    //     while these were whatever happened to be showing at the moment of
    //     the tap.
    //   * DESTINATION SCALE. getIconZoomCap shrinks badges (to 0.7) while the
    //     camera is zoomed OUT past the villa fit — which is exactly where it
    //     is when a room chip is tapped — and returns 1 at the fit or closer,
    //     where this shot always lands. Measuring at the live scale sized the
    //     badges up to 1.43x too small, so the camera flew to a distance
    //     computed for badges that then grew on arrival and re-collided.
    const wasVisible = members.map((m) => m.lbl.valueWrap.isVisible);
    for (const m of members) m.lbl.valueWrap.isVisible = false;
    // Destination scale: the zoom cap is 1 where this shot lands, so only
    // the user size and the CSS→GUI conversion apply.
    const mScale = this.iconUserScale * this.cssToGui();
    const boxes = this.labelBoxes(members, [], [], mScale);
    for (let i = 0; i < members.length; i++) members[i].lbl.valueWrap.isVisible = wasVisible[i];

    const allow = 1 - GROUP_OVERLAP_ALLOW_WIDTHS;
    const gapPx = this.metrics.minGapPx * mScale;
    // The destination's accessibility floor. The zoom cap is 1 where this shot
    // lands, so only the FAR-ZOOM CAP can shrink it — which is to say nothing
    // does, here. It reads `iconZoomScale` and not `iconUserScale` because
    // that is what screenClearance reads: this expression used to carry
    // `Math.min(1, this.iconUserScale)` while its own comment claimed to match
    // screenClearance, which had dropped that term in 2.232.0. Since the user
    // scale is at most 1 there, the ladder was demanding LESS separation than
    // the renderer would, i.e. promising a shot the renderer then declines —
    // the exact bug this solver exists to prevent.
    const minSepPx = this.metrics.minCentrePitchPx
      * this.cssToGui() * Math.min(1, this.iconZoomScale);
    const n = members.length;
    // Solver input, built once and re-projected per rung. The loop INVERTED in
    // 2.287.0: `reach` used to be the rung-dependent term and the anchors fixed.
    // Now `reach` is a drawn pixel count that no rung can change, and the plane
    // coordinates scale with that rung's pxPerWorld — so the plane offsets are
    // precomputed once in world units here and multiplied through below.
    //
    // The basis is the DESTINATION's, and since 2.325.0 that is no longer the
    // live one: computeRoomOverviewPose keeps the current alpha but forces beta
    // to the camera's top-down limit, so the ladder MUST be walked through the
    // direction the camera will arrive at, not the one it is leaving. It is
    // handed in for exactly that reason. markContacts below is then the SAME test the
    // renderer will run — a rung that predicted a clean shot under different
    // geometry from the one that draws it is the bug this whole solver was
    // written to avoid. `fromCentre` above stays in real world units: framing a
    // room is a 3D question, not a screen-overlap one.
    const basis = this.currentViewBasis(view.dir);
    // Its own object per member, not the frame loop's shared scratch: these
    // have to survive the whole rung walk. This runs once per tap, so the
    // allocation is not on any hot path.
    const plane = members.map(
      (mm) => projectToView(basis, mm.wx, mm.wy, mm.wz, { px: 0, py: 0, pz: 0 }));
    const items: PlacementItem[] = members.map(() => ({
      sx: 0, sy: 0, sz: 0,
      // rank/sortKey/category/room are unused by markContacts (it is a
      // symmetric contact sweep, not the ranked solve, and it never runs the
      // pull-back) — only the geometry matters here.
      reach: 0, rank: 0, sortKey: "", category: "", room: "", exempt: false,
    }));
    // Each anchor's offset from the shot's centre, ON THE DESTINATION'S VIEW
    // PLANE, in world units — one coordinate per SCREEN axis. Only THIS room's
    // badges have to be in frame: a neighbour's badge sitting off screen is
    // fine and expected, and demanding it be visible would push every shot out
    // to frame the whole villa.
    //
    // This was a single radial `hypot` against one half-extent until 2.364.0,
    // which is a circle inscribed in the frame — it asks a badge near the top
    // of a tall portrait screen to be as close to centre as one near the side,
    // and so held the camera at the same distance the isotropic wall fit did.
    // A screen has two axes and a badge box has two half-extents; both are
    // tested separately here.
    const framePlane = members.map((m) =>
      projectToView(view.frame, m.wx - view.cx, m.wy - view.cy, m.wz - view.cz,
        { px: 0, py: 0, pz: 0 }));
    const mine: number[] = [];
    for (let i = 0; i < n; i++) if (members[i].mine) mine.push(i);

    const q = GROUP_ZOOM_STEPS_PER_DOUBLING;
    const tanV = Math.tan(view.vFov / 2);
    // The frame's own half-extents, in the same drawn pixels the badge boxes
    // are measured in — so the test is literally "is this box on the glass".
    const halfWpx = view.vpW / 2;
    const halfHpx = view.vpH / 2;
    // Walk the rungs from CLOSEST outward and take the first that works, so the
    // answer is the tightest shot rather than merely a valid one.
    const lo = Math.max(view.minRadius, 0.1);
    const hi = Math.max(lo, view.maxRadius);
    const kLo = Math.floor(Math.log2(lo) * q);
    const kHi = Math.ceil(Math.log2(hi) * q);
    let firstFitting: number | null = null;
    // ── The two conditions pull in OPPOSITE directions, and that is the whole
    //    shape of this problem ────────────────────────────────────────────
    // `fits` (every badge on screen) gets easier as the camera backs off: the
    // world-space frame grows while a badge stays the same pixel size. `clean`
    // (no badge touching another) gets easier as it comes in: separations are
    // world-space and scale with pxPerWorld while the clearance is fixed
    // pixels. So each holds on one side of a threshold, and there are two
    // cases — they overlap, or they do not.
    //
    // Until 2.365.0 a rung that failed `fits` was skipped before `clean` was
    // ever evaluated, which silently made framing the hard constraint and
    // decluttering a hope. When the two did not overlap the shot landed on the
    // closest rung that framed every badge — reported as "I click the room and
    // then have to zoom in a little more myself", with the badges arriving as
    // a cluster of grouped cards and separating into readable ones a rung or
    // two closer. That is the opposite of this solver's stated purpose, and of
    // the comment in computeRoomOverviewPose promising that a room whose badges
    // only separate at maximum zoom is taken to maximum zoom.
    //
    // So `clean` is now evaluated at EVERY rung, and framing is the preference
    // it was written to be:
    //   * both hold somewhere → the TIGHTEST such rung (unchanged, and still
    //     the common case);
    //   * they never overlap → the WIDEST clean rung, i.e. the readable shot
    //     that crops least. A device at the room's edge may hang off the frame;
    //     that beats every device in the room being illegible;
    //   * nothing is clean at any zoom → the old framing fallback, unchanged.
    let widestClean: number | null = null;
    for (let k = kLo; k <= kHi; k++) {
      const radius = Math.pow(2, k / q);
      if (radius < lo || radius > hi) continue;
      // The zoom the renderer will actually quantise to at this radius.
      const raw = view.vpH / (2 * radius * tanV);
      if (!(raw > 0)) continue;
      const pxPerWorld = Math.pow(2, Math.round(Math.log2(raw) * q) / q);

      // Every badge fully inside the frame? Per screen axis, in drawn pixels,
      // against the box the renderer will actually paint — including the `cy`
      // by which it hangs above its anchor, which is asymmetric and so cannot
      // be folded into a single radial reach.
      let fits = true;
      for (const i of mine) {
        const sx = framePlane[i].px * pxPerWorld;
        const sy = framePlane[i].py * pxPerWorld + boxes[i].cy;
        if (Math.abs(sx) + boxes[i].halfW > halfWpx
          || Math.abs(sy) + boxes[i].halfH > halfHpx) { fits = false; break; }
      }
      if (fits && firstFitting === null) firstFitting = radius;

      // Is every badge of THIS room drawn on its own here? "Clear of every
      // other eligible badge" is the exact test — against neighbours from
      // other rooms too, since those are what put the room back in a chip.
      //
      // markContacts, not a copy of its arithmetic: whatever decides a thing
      // must BE the thing that does it, and a rung solver that promised a shot
      // the renderer then declined is a bug this file has already produced.
      // Its own scratch, because the layout pass may be holding a live result
      // from the shared one (see PlacementResult).
      for (let i = 0; i < n; i++) {
        items[i].sx = plane[i].px * pxPerWorld;
        // `cy` here for the same reason placementItems adds it: the box the
        // renderer paints hangs above the anchor, by an amount that differs
        // between badges. This ladder must run the identical test.
        items[i].sy = plane[i].py * pxPerWorld + boxes[i].cy;
        items[i].sz = plane[i].pz * pxPerWorld;
        items[i].reach = boxes[i].halfW * allow;
      }
      const touching = markContacts(items, gapPx, minSepPx, this.zoomScratch);
      let clean = true;
      for (const i of mine) if (touching[i]) { clean = false; break; }
      // The rungs ascend, so the last write is the widest clean one. Recorded
      // rather than derived from a threshold: `clean` is very nearly monotone
      // in radius but not exactly, because pxPerWorld is quantised onto the
      // renderer's ladder, and taking the widest rung that actually tested
      // clean is correct either way.
      if (clean) widestClean = radius;
      // Tightest rung that both frames and declutters — the happy case, and
      // the first one reached because the walk starts from the closest.
      if (clean && fits) return { radius, declutters: true };
    }
    if (widestClean !== null) return { radius: widestClean, declutters: true };
    return firstFitting === null ? null : { radius: firstFitting, declutters: false };
  }

  /** Replace the named-viewpoint "rooms" (config.teleportPoints) that don't
   *  have a real room polygon — forwarded to RoomHighlight for a synthetic
   *  patch. Called on every re-fit AND live whenever config.teleportPoints
   *  changes (e.g. the user just added "Staircase" via the Rooms menu — that
   *  shouldn't need a model reload to start glowing). */
  setRoomPoints(points: { name: string; x: number; z: number; floorY: number }[]): void {
    this.roomHighlight.setPointRooms(points);
  }

  /** Replace camera facing directions (world-space unit vectors, may include
   *  vertical tilt) and rebuild every beam mesh. Called by SceneManager right
   *  after setRoomPolygons, from the same re-fit — a camera's direction
   *  depends on the same plan→world transform the room polygons do. */
  setCameraDirections(dirs: Map<string, { x: number; y: number; z: number }>): void {
    this.cameraDirections = dirs;
    this.buildCameraBeams();
  }

  /** One beam per camera entity that has BOTH a resolved mesh position
   *  (byEntity, from indexMeshes) and a facing direction (from
   *  setCameraDirections) — cameras with no sh3d angle data yet simply get no
   *  beam, rather than guessing a direction. This class decides WHICH cameras
   *  qualify; CameraBeams owns the cone geometry and wall clipping. */
  private buildCameraBeams(): void {
    const { sources, occluders } = this.collectBeamSources();
    this.beams.rebuild(sources, occluders);
    this.replayBeamMotion();
  }

  /** WHICH cameras qualify, and what may block their cones — the decision half,
   *  shared by the synchronous build and the chunked one. */
  private collectBeamSources(): { sources: BeamSource[]; occluders: Set<AbstractMesh> } {
    const sources: BeamSource[] = [];
    // Visible, production-safe diagnostic (tapDebug, not devLog — this needs
    // to be readable on the actual kiosk tablet via ?debug, not just in a dev
    // console) for exactly the failure mode "I set a real rotation and still
    // see no beam at all": report WHICH cameras qualified and which were
    // skipped, and why, instead of leaving it a silent no-op.
    const skipped: string[] = [];
    for (const [entityId, meshes] of this.byEntity) {
      const map = this.mapping.get(entityId);
      if (!map || map.type !== "camera") continue;
      if (!meshes.length) { skipped.push(`${entityId}: no mesh`); continue; }
      const dir2 = this.cameraDirections.get(entityId);
      if (!dir2) { skipped.push(`${entityId}: no sh3d angle data`); continue; }
      // dir2 already comes out of SceneManager as a unit vector (it composes
      // the yaw's unit horizontal direction with cos/sin(pitch), so its own
      // magnitude is always ~1 regardless of tilt) — re-normalise defensively
      // rather than gating on the horizontal-only length like before, which
      // would wrongly read "no rotation" for a camera tilted close to
      // straight down/up (cos(pitch) shrinks the horizontal part near zero
      // even though a real direction — mostly vertical — exists).
      const mag = Math.hypot(dir2.x, dir2.y, dir2.z);
      if (mag < 1e-6) { skipped.push(`${entityId}: angle is 0 (no rotation authored)`); continue; }

      const bounds = this.mergedWorldBounds(meshes);
      if (!bounds) { skipped.push(`${entityId}: no world bounds`); continue; }
      sources.push({
        entityId,
        origin: Vector3.Center(bounds.min, bounds.max),
        direction: new Vector3(dir2.x / mag, dir2.y / mag, dir2.z / mag),
      });
    }
    if (sources.length || skipped.length) {
      tapDebug(`camera beams: ${sources.length} built [${sources.map((s) => s.entityId).join(", ")}]`
        + (skipped.length ? ` | skipped: ${skipped.join("; ")}` : ""));
    }
    // NOT the full shadowCasters set — that includes every static mesh
    // (furniture blocks light too, legitimately, for shadows), but a beam's
    // edge-ray sampling takes the MINIMUM reach across rays around the cone's
    // surface, so a single piece of furniture, curtain, or door frame grazed
    // by just one of those rays collapsed the WHOLE cone to a stub — worse
    // the wider the cone is (field report right after the beam was
    // deliberately widened). Restrict to real structure, classified from the
    // mesh's own pipeline metadata rather than its name — see meshRoles.ts.
    const beamOccluders = new Set(this.shadowCasters.filter(blocksCameraBeam));
    return { sources, occluders: beamOccluders };
  }

  /**
   * The same build, one camera per yield.
   *
   * Called from SceneManager's post-calibration tail. 13 cameras × 9 clipping
   * raycasts measured at ~1000ms in a single task — off the load block since
   * 2.350.0, but still a second-long freeze on a villa that is already up,
   * which is the same complaint one step later. Beams simply appear over a
   * few frames instead.
   */
  async buildCameraBeamsChunked(
    yieldFrame: () => Promise<void>,
    stale: () => boolean,
  ): Promise<void> {
    const collected = this.collectBeamSources();
    this.beams.dispose();
    for (const source of collected.sources) {
      await yieldFrame();
      if (stale()) return;
      // Spanned PER BEAM, around the work only. A single span across the whole
      // loop would include the waiting between frames — the same error
      // `yieldAndDiscount` exists to correct — and would then falsely "cover"
      // any freeze landing in that window, which is worse than not measuring
      // it. A dozen-odd entries cannot thrash the 64-entry ring.
      const end = beginSpan("lateBeam");
      try { this.beams.addBeam(source, collected.occluders); }
      finally { end(); }
    }
    this.beams.saveCache();
    this.replayBeamMotion();
  }

  /** Set the directions without building, for a caller that will drive the
   *  chunked build itself. */
  setCameraDirectionsOnly(dirs: Map<string, { x: number; y: number; z: number }>): void {
    this.cameraDirections = dirs;
  }

  private replayBeamMotion(): void {
    // Re-assert current motion state onto the freshly-built beams. Beams are
    // (re)built by setCameraDirections, which runs AFTER the first batch of HA
    // states has already been applied — so a camera whose motion sensor was
    // already "on" at load fired setBeamActive against a beam that didn't
    // exist yet (a logged no-op), and without this its beam would stay dark
    // until the sensor's NEXT state change. Replay from lastState so a beam
    // built while its sensor is on lights up immediately, not one toggle late.
    for (const [motionId, camIds] of this.motionToCameraIds) {
      const st = this.lastState.get(motionId);
      if (st?.state === "on") for (const camId of camIds) this.setBeamActive(camId, true);
    }
  }

  /** Turn a camera's beam on/off (driven by its linked motion sensor state).
   *  Returns whether a beam mesh actually existed to activate — see
   *  applyMotionRouting's fallback for why callers need to know that. */
  private setBeamActive(entityId: string, on: boolean): boolean {
    if (!this.beams.has(entityId)) {
      tapDebug(`beam ${entityId}: motion ${on ? "ON" : "off"} but NO BEAM MESH exists for this camera`);
      return false;
    }
    this.beams.setActive(entityId, on);
    this.requestRender();
    return true;
  }

  hasEntity(entityId: string): boolean {
    return this.byEntity.has(entityId);
  }

  /** All entity mappings resolved during the last indexMeshes call. */
  getDetectedMappings(): EntityMapping[] {
    return Array.from(this.mapping.values());
  }

  /** Called for every state change. */
  apply(entity: HassEntity): void {
    // Motion/presence routing (camera beam or room glow) runs regardless of
    // whether THIS entity has a mesh of its own — a plain HA binary_sensor
    // driving either effect typically isn't a modelled 3D object at all.
    this.applyMotionRouting(entity);
    this.applyLinkedEntityRouting(entity);

    // Cache EVERY entity's latest state up front — even one with no badge of
    // its own (a hidden device-group member, e.g. the humidity half of a
    // temp+humidity combo). That lets its group PRIMARY's badge read and show
    // the member's reading (see groupedValue), and refreshes that primary
    // badge when only the member changed.
    this.lastState.set(entity.entity_id, entity);
    const owningGroup = this.config.deviceGroups.find((g) =>
      g.memberEntityIds.includes(entity.entity_id));
    if (owningGroup && this.labels.has(owningGroup.primaryEntityId)) {
      const pst = this.lastState.get(owningGroup.primaryEntityId);
      const pmap = this.mapping.get(owningGroup.primaryEntityId);
      if (pst && pmap) {
        this.updateLabel(owningGroup.primaryEntityId, pmap.type, pst);
        this.requestRender();
      }
    }

    const meshes = this.byEntity.get(entity.entity_id);
    const map = this.mapping.get(entity.entity_id);
    if (!meshes || !map) {
      if (entity.entity_id.startsWith("cover.") || entity.entity_id.startsWith("lock.")) {
        tapDebug(`apply(${entity.entity_id}): NO MESH/MAPPING — meshes=${!!meshes} map=${!!map}. This entity's live state changed but nothing in the model resolves to it, so no variant could ever be shown for it.`);
      }
      return;
    }
    if (
      (entity.entity_id.startsWith("cover.") && map.type !== "cover") ||
      (entity.entity_id.startsWith("lock.") && map.type !== "lock")
    ) {
      tapDebug(`apply(${entity.entity_id}): resolved mesh(es) but map.type="${map.type}" — a variant pose will NEVER be applied while the type mismatch stands (check Advanced Settings' Type field for this entity).`);
    }
    // Normalise by the number of DISTINCT light objects, not meshes — a merged
    // strip entity (mergeStripEntityLights) shares ONE light across several
    // meshes, so it must get the full intensity, not 1/N of it.
    const lightShare = map.type === "light"
      ? new Set(meshes.map((m) => this.meshLights.get(m.uniqueId)).filter(Boolean)).size || 1
      : 1;
    for (const mesh of meshes) this.applyToMesh(mesh, map, entity, lightShare);
    if (map.type === "fan") this.updateFanSpin(entity, meshes);
    if (map.type === "light") {
      this.syncEntityShadow(entity.entity_id, meshes, entity.state === "on");
    }
    // Pose selection — ONE call, no type branch at all. A cover, a lock, a
    // switch, a sensor and any future type all resolve their pose the same
    // way (see desiredVariantWord). A pure no-op for the overwhelming common
    // case: a plain mesh with no "__word" siblings.
    // Both report whether they changed anything the LAYOUT depends on. This
    // used to end with an unconditional markLayoutDirty(), which meant every
    // HA state event — a temperature ticking, a power meter counting — forced
    // a full relayout on the next frame even with the camera dead still, and
    // cullLabels runs inside scene.render(). A pose swap counts because it
    // changes which mesh (and so which anchor) a badge reads its position and
    // enabled state from; a colour change does not.
    const poseChanged = this.applyStateNamedVariant(entity.entity_id, entity);
    this.updateLabel(entity.entity_id, map.type, entity);
    if (poseChanged) this.markLayoutDirty();
    // Unconditional: a badge that only changed COLOUR still needs a frame.
    this.requestRender();
  }

  /** Show exactly one "visual variant" mesh for an entity and hide the rest
   *  — see EntityMap.extractVariantSuffix's docstring for the underlying
   *  naming convention this reflects. A no-op unless this entity actually
   *  has 2+ DISTINCT variant meshes registered (see indexMeshes): the common
   *  case — one plain mesh, or none at all — is left completely untouched,
   *  which is what makes this fully opt-in. `order` is the type's full
   *  ordering (see orderVariantWords), used only for the nearest-available
   *  fallback when `active`'s exact mesh wasn't authored. */
  /** This entity's authored pose words, ordered rest → part-way → active
   *  (orderVariantWords), plus the word to show before any live state has
   *  arrived: the rest pose, i.e. order[0]. No type branch — identical for a
   *  cover, a lock, a switch and anything future. Shared by the
   *  construction-time default pass and applyStateNamedVariant so the two
   *  can never resolve a different ordering for the same entity. */
  private variantWordsFor(entityId: string): { order: string[]; default: string } | null {
    const byWord = this.meshVariants.get(entityId);
    if (!byWord) return null;
    const order = orderVariantWords(byWord.keys());
    // The default is the lowest-ranked AUTHORED word — order can contain the
    // virtual "half" slot (see orderVariantWords), which has no mesh and so
    // must never be handed out as a pose to show.
    const first = order.find((w) => byWord.has(w));
    return first ? { order, default: first } : null;
  }

  /** Pose selection for ANY entity: desiredVariantWord() turns its live state
   *  (or a part-way level / transitional state) into the wanted word, and the
   *  available words come entirely from whichever "__word" meshes were
   *  actually authored — a curtain with closed/half/open, a switch with
   *  on/off, a light with a "__half" dimmed pose, a pool sensor with
   *  clean/dirty. Opt-in throughout: an entity with fewer than 2 registered
   *  poses is untouched (applyMeshVariant's own no-op), so this is safe to
   *  call unconditionally for every entity. */
  /** @returns whether a pose actually swapped — which moves the anchor a badge
   *  reads its position and enabled-state from, so the layout must re-run. */
  private applyStateNamedVariant(entityId: string, entity: HassEntity): boolean {
    const resolved = this.variantWordsFor(entityId);
    if (!resolved) return false;
    return this.applyMeshVariant(entityId, resolved.order, desiredVariantWord(entity));
  }

  private applyMeshVariant(entityId: string, order: string[], active: string): boolean {
    const byWord = this.meshVariants.get(entityId);
    if (!byWord || byWord.size < 2) {
      tapDebug(`applyMeshVariant(${entityId}): SKIPPED — only ${byWord?.size ?? 0} variant group(s) registered (need 2+); requested="${active}"`);
      return false;
    }
    const chosen = pickNearestVariant(order, active, byWord.keys());
    tapDebug(`applyMeshVariant(${entityId}): requested="${active}" -> chosen="${chosen}" from {${Array.from(byWord.keys()).join(",")}}`);
    // Exclusivity is driven by `isVisible`, NOT `setEnabled` — deliberately.
    // FloorManager owns `setEnabled` on every mesh to hide/show whole storeys,
    // AND estimateFloorY/buildRoomConform (room calibration) SAVE, force-
    // enable, then RESTORE every floor mesh's setEnabled around a raycast. If
    // variant exclusivity ALSO used setEnabled, all three would fight over the
    // one flag: a floor switch re-enabled a curtain's other poses, and a
    // calibration whose save-snapshot happened to capture "all poses enabled"
    // restored them all — the exact intermittent "the open pose won't
    // disappear" the naming was reported for, its appearance depending purely
    // on timing. A mesh renders only when isEnabled() AND isVisible are both
    // true, so putting pose selection on isVisible makes the two concerns
    // orthogonal: FloorManager's setEnabled handles WHICH FLOOR, this handles
    // WHICH POSE, and neither can ever clobber the other. Nothing else in the
    // app sets isVisible on an entity mesh (only trigger/teleport/ceiling
    // meshes), so a hidden pose stays hidden through every floor switch and
    // recalibration with no resync needed.
    let poseChanged = false;
    for (const [word, meshes] of byWord) {
      const show = word === chosen;
      for (const mesh of meshes) {
        if (mesh.isVisible !== show) poseChanged = true;
        mesh.isVisible = show;
      }
    }
    // A pose swap is one of the two things that genuinely changes which
    // geometry occludes a lamp — an opened door or drawn curtain casts a
    // different shadow — so the (otherwise render-once) shadow maps have to
    // be redrawn. Gated on an ACTUAL change: this function runs for every
    // state event on every pose-capable entity, and re-arming on a no-op
    // would put the per-frame cost straight back.
    if (poseChanged) this.invalidateShadowMaps();
    // Read the flags straight back off the mesh objects (not just "what we
    // just set") so this answers "is __open ACTUALLY hidden right now" with
    // zero ambiguity — a mesh only renders if BOTH isVisible AND isEnabled()
    // are true, so this also catches a floor-visibility (setEnabled) conflict
    // that isVisible alone wouldn't reveal.
    const postState = Array.from(byWord, ([word, meshes]) =>
      `${word}:[${meshes.map((m) => `${m.isVisible ? "V" : "-"}${m.isEnabled() ? "E" : "-"}`).join(",")}]`
    ).join(" ");
    tapDebug(`applyMeshVariant(${entityId}): after toggle (V=visible E=enabled, need BOTH to render) -> ${postState}`);
    // buildLabelAnchors parents the badge anchor to meshes[0] — arbitrarily
    // whichever pose indexMeshes saw first. Re-anchor it to the chosen
    // (visible) pose so the badge tracks that pose's exact position; its
    // floor-driven show/hide still rides the chosen mesh's setEnabled (owned
    // by FloorManager), unaffected by the isVisible pose toggle above.
    const anchor = this.labelAnchors.get(entityId);
    const chosenMesh = byWord.get(chosen)?.[0];
    if (anchor && chosenMesh && anchor.parent !== chosenMesh) {
      anchor.setParent(chosenMesh);
    }
    return poseChanged;
  }

  /** Route a state change to whichever motion-driven visual it feeds:
   *  - linked to a camera's motionEntityId  -> that camera's detection beam
   *  - otherwise, a binary_sensor with a Room set -> that room's floor glow
   *  A sensor already driving a camera beam does NOT also glow its room —
   *  the two are separate treatments for separate device kinds (see the
   *  camera-vs-physical-sensor design discussion), not a doubled-up alert.
   *
   *  EXCEPT: a camera only gets a beam mesh at all when its SweetHome3D
   *  placement was given a real facing rotation (see buildCameraBeams — a
   *  deliberate "no data, no beam" choice, never a guessed direction). A
   *  camera left at its default/unrotated placement — an easy authoring step
   *  to miss, and the single most common reason this whole feature looks
   *  broken — has no beam mesh, so setBeamActive is a silent no-op and motion
   *  on that camera would otherwise show NOTHING at all. Fall back to glowing
   *  the CAMERA's own room instead (not the sensor's — a camera's built-in
   *  motion detector is typically only ever referenced by entity_id via
   *  motionEntityId, not separately added as its own mapped/roomed entity,
   *  so the sensor's own fallback below usually has nothing to work with
   *  either). Still real, still opt-in (only fires when the camera's own
   *  Room is set), never a guess about WHERE the camera is aiming. */
  private applyMotionRouting(entity: HassEntity): void {
    const on = entity.state === "on";
    const cameraIds = this.motionToCameraIds.get(entity.entity_id);
    if (cameraIds) {
      // Beam (or room-glow fallback) ONLY — motion deliberately does not ring
      // the camera's badge. The ring means "detection is armed" and is driven
      // by linkedEntityId (see applyLinkedEntityRouting); this means
      // "detection just fired". Two states, two visuals, so both stay
      // readable at once instead of one overwriting the other.
      let anyBeam = false;
      for (const camId of cameraIds) {
        if (this.setBeamActive(camId, on)) anyBeam = true;
      }
      if (!anyBeam) {
        for (const camId of cameraIds) {
          const camRoom = this.resolvedRooms[camId];
          if (camRoom) this.roomHighlight.setActive(camRoom, on);
        }
      }
      return;
    }
    const map = this.config.entityMap[entity.entity_id];
    const room = this.resolvedRooms[entity.entity_id];
    if (map?.type === "binary_sensor" && room) {
      this.roomHighlight.setActive(room, on);
    }
  }

  /** Counterpart to applyMotionRouting for EntityMapping.linkedEntityId: when
   *  a linked entity changes state, ring red every device that references it
   *  (that device's OWN badge, not the linked entity's — e.g. a camera whose
   *  detection switch was just armed). Fully independent of the beam path
   *  above: different source field, different visual, no shared state. */
  private applyLinkedEntityRouting(entity: HassEntity): void {
    const linkedIds = this.linkedEntityIndex.get(entity.entity_id);
    if (!linkedIds) return;
    const on = entity.state === "on";
    for (const id of linkedIds) {
      if (on) this.linkActiveIds.add(id);
      else this.linkActiveIds.delete(id);
      const st = this.lastState.get(id);
      const map = this.mapping.get(id);
      if (st && map) this.updateLabel(id, map.type, st);
    }
  }

  // ---------------------------------------------------------------------------
  // State labels (BJS GUI fullscreen overlay)
  // ---------------------------------------------------------------------------

  /** An entity's map-filter category: whatever the user set in the Config
   *  Editor (persisted on its EntityMapping), falling back to the type-based
   *  default (config/EntityCategories.ts) for entities that don't have one
   *  yet (see bindingUtils). Public: SceneManager's applyHighlight (the blue
   *  "clickable" glow) reuses this exact resolution instead of its own
   *  effectiveCategory() call, which used to omit device_class — the same
   *  entity could disagree with itself (badge under Network, glow only
   *  under Energy) since only THIS call site had the live device_class
   *  needed to resolve an enum sensor like a UniFi AP's "State" correctly. */
  categoryOf(entityId: string, type: EntityType): Category {
    const dc = this.lastState.get(entityId)?.attributes?.device_class as string | undefined;
    return effectiveCategory(entityId, type, this.config.entityMap[entityId]?.category, dc);
  }

  /** Follow FloorManager's floor toggle — only the active floor's badges are
   *  drawn (see cullLabels). Called by SceneManager on every floor change,
   *  AFTER FloorManager has already re-applied mesh.setEnabled() per floor. */
  setActiveFloor(floor: number): void {
    if (floor === this.activeFloor) return;
    this.activeFloor = floor;
    // Badges are culled per storey, and FloorManager's setEnabled sweep is not
    // otherwise visible to the layout pass.
    this.markLayoutDirty();
    this.resyncLightPoolsToFloor();
    // Mesh variants (curtain/lock poses) need NO floor resync: their
    // exclusivity rides `isVisible`, which FloorManager's per-floor
    // `setEnabled` never touches — see applyMeshVariant's docstring.
    //
    // The shadow maps DO need it: FloorManager's setEnabled sweep just changed
    // which storey's geometry exists to occlude a lamp, and those maps render
    // once and then hold (see syncEntityShadow).
    this.invalidateShadowMaps();
    this.requestRender();
  }

  /** A baked-villa light's floor "pool" (see LightPools.ts) is a freestanding
   *  decal mesh that FloorManager never indexes or toggles — unlike the
   *  fixture mesh itself, it doesn't automatically vanish when its floor is
   *  hidden. Without this, a 2F light left on stayed visible (floating,
   *  unoccluded) while viewing 1F. Re-derive each pool's on/off state from
   *  its fixture mesh's CURRENT enabled state (already floor-correct by the
   *  time this runs) whenever the active floor changes. */
  private resyncLightPoolsToFloor(): void {
    if (this.meshLightPools.size === 0) return;
    this.forEachLightPoolState((pool, on, colour, brightnessFrac) =>
      pool.setState(on, colour, brightnessFrac * this.lightPoolStrength));
  }

  /** Live bird's-eye zoom factor (1 = default fit). Driven per-frame by
   *  SceneManager from the overview camera; ignored (reset to 1) elsewhere. */
  setIconZoomScale(z: number): void {
    if (Math.abs(z - this.iconZoomScale) < 0.02) return; // skip imperceptible jitter
    this.iconZoomScale = z;
    this.applyIconScale();
  }

  /**
   * CSS pixels → the GUI layer's own space.
   *
   * Babylon's fullscreen ADT is sized from `engine.getRenderWidth/Height()`,
   * and SceneManager runs the engine at `1/min(dpr,2)` hardware scaling — so
   * the GUI's "pixels" are RENDER pixels, and one of them is smaller than one
   * CSS pixel on every retina device. badgeMetrics is written in CSS px (its
   * header explains why the old render-px constants were a defect rather than
   * a choice), so everything from it passes through here.
   *
   * Read live rather than cached: `SceneManager.easeResolution` changes
   * hardware scaling mid-session on a slow device, and a cached value would
   * leave the badges sized for a resolution the engine has stopped using.
   */
  private cssToGui(): number {
    return 1 / (this.scene.getEngine().getHardwareScalingLevel() || 1);
  }

  /**
   * The ONE multiplier every badge dimension passes through — user size ×
   * bird's-eye zoom × the CSS→GUI conversion.
   *
   * Both the renderer (applyIconScale, via container.scaleX/scaleY) and the
   * layout (labelBoxes) use this exact value, which is what makes "a layout
   * decision may never use different geometry from the renderer" structural
   * rather than a rule to remember.
   */
  private effectiveScale(): number {
    return this.iconUserScale * this.iconZoomScale * this.cssToGui();
  }

  /**
   * How big a summary is drawn: EXACTLY the size of the badges it replaces.
   *
   * A room chip and an entity group both stand in for badges, so they take the
   * current style's badge height and the current style's own text size. 2.232.0
   * left them on their own constants (30px tall, 15px text) while badges moved
   * to CSS pixels, and on top of that gave them a separate CLUSTER_MIN_SCALE
   * floor of 0.8 against the badges' 0.7 far-zoom cap — so at the zoom where
   * summaries actually appear they were drawn ~14% larger than the badges as
   * well, and read as a different class of object. Reported exactly that way.
   *
   * Deriving both from the badge means the relationship cannot drift again: one
   * scale, one height, one text size, at every zoom and icon-size setting.
   */
  private summaryMetrics(): {
    size: number; font: number; countSize: number; countFont: number;
  } {
    const m = this.metrics;
    const card = this.isCardStyle();
    const size = card ? m.cardHeightPx : m.badgeDiameterPx;
    const font = card ? m.cardValueFontPx : m.pillValueFontPx;
    return {
      size,
      font,
      countSize: Math.round(size * m.countPillFraction),
      countFont: Math.round(font * m.countFontFraction),
    };
  }

  /** Scale every badge container by user-size × zoom, around its anchor point. */
  private applyIconScale(requestFrame = true): void {
    // Scale feeds labelBoxes' every dimension.
    this.markLayoutDirty();
    const s = this.effectiveScale();
    for (const lbl of this.labels.values()) {
      lbl.container.scaleX = s;
      lbl.container.scaleY = s;
    }
    if (requestFrame && this.labels.size) this.requestRender();
  }

  /** The engine's hardware scaling changed (easeResolution's quality valve, or
   *  a DPR change on a moved window), so cssToGui() has moved under every
   *  badge. Cheap: re-scales the existing controls, no rebuild. */
  notifyRenderScaleChanged(requestFrame = true): void {
    // Re-scale ONLY. No repaint: since 2.321.0 the bake targets the device's
    // best-case resolution (glyphBakePx / bestCssToGui), so it does not depend
    // on where the valve currently sits and nothing has to be re-baked when
    // that moves. 2.320.0 repainted here, which was correct for a live-valued
    // bake and would now hitch the map on every idle sharpen.
    //
    // ⚠️ `requestFrame: false` is not an optimisation, it breaks a LOOP.
    // applyIconScale asks for a frame, which is right when the caller is the
    // resolution valve (nothing else is going to redraw). It is fatal when the
    // caller is the render loop's own idle branch: the request re-arms the
    // interactive branch, that branch un-sharpens, un-sharpening re-scales,
    // re-scaling asks for another frame — a device that had gone quiet would
    // render forever, alternating resolutions. Callers that are ABOUT to draw
    // pass false and let their own render pick the new scale up.
    this.applyIconScale(requestFrame);
  }

  // ANSWERED and de-instrumented (2.356.0). The census read
  // `rebuildLabels:2:65` on an M1: two runs per load, 65ms TOTAL, of which the
  // indexMeshes call was 63 — so the second run has essentially nothing to do
  // and there is no expensive repetition here to fix. Against a ~2.9s load
  // whose largest term is a 1.7s GLB parse, this is not where the time is.
  private rebuildLabels(): void {
    // The label SET itself is about to change — every pooled slot below is
    // re-derived from scratch on the next pass.
    this.markLayoutDirty();
    // Bail if the engine is gone. rebuildLabels can be reached from
    // updateConfig on a React commit that lands AFTER a WebGL context loss has
    // torn the engine down, and the first `new Image(...)` below then throws
    // "Invalid engine. Unable to create a canvas." out of a promise nobody
    // awaits — an unhandled rejection, seen in the field.
    const engine = this.scene.getEngine();
    if (!engine || engine.isDisposed) return;

    // Ensure the GUI layer exists.
    if (!this.labelLayer) {
      this.labelLayer = AdvancedDynamicTexture.CreateFullscreenUI("entityLabels", true, this.scene);
    } else {
      // DISPOSE the previous controls — do not merely detach them.
      //
      // This was a substantial memory leak. clearControls() only removes
      // controls from the container; it releases nothing. Every rebuild
      // orphaned roughly five controls per entity (panel, badge, glyph Image,
      // value wrapper, value text) — around 420 of them on this villa — and
      // each GUI Image carries its own backing canvas. Nothing referenced them
      // afterwards, but Babylon still held them, so they were never collected.
      //
      // Rebuilds are frequent: every indexMeshes, and every repaintBadges,
      // which until the entityMapDelta fix ran on each window focus. Field
      // telemetry showed a tab climbing from ~400MB to over 2GB across a
      // session of ordinary use, ending in a WebGL context loss and a failed
      // load. Container.dispose() is recursive over children, so disposing the
      // direct children of the root releases the whole tree; the array is
      // copied first because dispose() mutates it as it goes.
      for (const child of this.labelLayer.rootContainer.children.slice()) {
        child.dispose();
      }
      this.labelLayer.rootContainer.clearControls();
    }
    // The dispose loop above already freed the cluster chips (they're children
    // of the same root) — drop the map's now-dangling references and the
    // TransformNodes they anchored to, or ensureCluster would hand back a
    // disposed control and the chips would silently stop rendering.
    for (const c of this.clusters.values()) c.node.dispose();
    this.clusters.clear();
    // Same reasoning for the entity groups: their controls were children of
    // the cleared root, so the map holds disposed references and
    // ensureEntityGroup would hand one back.
    for (const c of this.entityGroups.values()) c.node.dispose();
    this.entityGroups.clear();
    this.entityGrouped.clear();
    this.roomClustered.clear();
    this.labels.clear();
    this.labelLayer.rootContainer.isVisible = true;

    // Every mesh-bound entity feeds the same badge pipeline, anchored at its
    // own bounding-box top (see buildLabelAnchors) — except an entity folded
    // into a device group as a non-primary member (config.deviceGroups):
    // its reading lives in the primary's detail view instead (see
    // DeviceGroupPanel), so it gets no badge of its own.
    const hiddenMembers = groupMemberIds(this.config.deviceGroups);
    const sources: { entityId: string; anchor: TransformNode; type: EntityType }[] = [];
    for (const [entityId, meshes] of this.byEntity) {
      if (!meshes.length) continue;
      if (hiddenMembers.has(entityId)) continue;
      const map = this.mapping.get(entityId);
      if (!map) continue;
      const anchor = this.labelAnchors.get(entityId) ?? meshes[0];
      sources.push({ entityId, anchor, type: map.type });
    }

    for (const { entityId, anchor, type } of sources) {
      const category = this.categoryOf(entityId, type);
      // A compact column: a category-coloured squircle icon badge (see
      // badgeIcons.ts) over an optional value pill. The device CATEGORY reads
      // from the badge's fixed background colour, the device TYPE from its
      // glyph, the STATE from an outline ring around it (see updateLabel),
      // and the value pill only appears for entities with a meaningful
      // reading (%, °, sensor value). Children are top-aligned in a
      // fixed-height panel so the badge never shifts when the pill shows/hides.
      const card = this.isCardStyle();
      const m = this.metrics;
      // ── THE CONTAINER IS THE CARD (2.253.0) ──────────────────────────
      // In card mode the value lives INSIDE the card, so the container holds
      // exactly one child and has nothing to be taller than it for. It was
      // 34 against a 28-tall card — a leftover of the classic layout, where
      // the container really does stack a badge, a gap and a pill.
      //
      // Those 6 units were not harmless. A vertical StackPanel top-aligns its
      // children, so all of the slack sat BELOW the card; and the container's
      // bottom edge is what lands on the anchor (linkOffsetY = -h/2 cancels
      // Babylon's own -height/2, see labelBaseOffsetY), so the card floated
      // six units clear of the point it is supposed to sit on. Reported as
      // the icon looking high in the badge, with visibly more room under the
      // art than over it — which is exactly what a box with all its slack at
      // the bottom looks like.
      //
      // It also put labelBoxes out of step with the renderer: its `cy` needed
      // a hand-tuned `- 4` to approximate the offset, and still landed 7 units
      // from where the card actually drew. Layout geometry may never differ
      // from render geometry; with one height there is nothing to keep in step.
      const labelH = card ? m.cardHeightPx : m.labelHeightPx;
      // ── The card's INNER height, which is not its height ─────────────────
      // Babylon's Rectangle insets its children by its border on all four
      // sides (rectangle.js: `_measureForChildren.height -= 2 * thickness`),
      // so a card carrying the 3px state ring has only cardHeightPx - 6 of
      // usable box. Sizing the glyph to the card's OUTER height put a 34px
      // icon in a 28px area: it overflowed and was clipped 3px top and
      // bottom, losing 18% of its height, which reads as an icon jammed
      // against the badge's edges rather than centred in it. Reported exactly
      // that way, and only ever for the card style — the classic badge bakes
      // its ring into the image and runs thickness 0, so its children get the
      // whole control.
      //
      // Reserved UNCONDITIONALLY, not only while a ring is showing: the ring
      // comes and goes with state, and sizing the icon off the current one
      // would resize the glyph every time a device turned on. Same rule the
      // pill-capable collision box already follows — measure what it can be,
      // not what it happens to be.
      // The card's WORST-CASE inner box: Babylon's Rectangle insets its
      // children by its border, and that border is at its heaviest
      // (ringThicknessPx) whenever the device is active or alerting. Sizing
      // the icon area to anything larger would clip it in exactly those
      // states. Kept as the CEILING on the glyph rather than as the icon
      // area's height — see glyphPx, which is the one number both the row
      // and the value box are built from now.
      // Sized off the CARD, and DELIBERATELY smaller than its inner box.
      //
      // Two mistakes are encoded here, both reported. Tying the icon to
      // cardInnerH made it a function of the RING, so a fine pointer's thinner
      // ring drew a different icon-to-card ratio than a touch card's thicker
      // one — the same build showing different badges on two devices. And
      // filling the inner box exactly left NO PADDING at all: the art sat
      // flush on the border with its rounded corners colliding with the
      // card's, which reads as a clipped icon rather than one sitting in a
      // badge. The fraction is of the CARD and leaves real space on all four
      // sides; see badgeMetrics.cardIconFraction.
      // The bottom bar's own proportions, read from the tokens it is styled
      // with (see config/chipProportions). The chip's CONTROL is the card
      // minus its ring; the glyph drawn inside it is that fraction of the
      // chip, exactly as `.summary-tile-icon svg` is of `.summary-tile-icon`.
      const chip = chipProportions();
      // CLAMPED to the worst-case inner box rather than merely documented as
      // fitting it: cardIconFraction is a design decision and ringThicknessPx
      // is a drawing constraint, and the two are tuned independently. A future
      // heavier ring, or a more generous fraction, would otherwise clip the
      // icon in the active state only — the state nobody screenshots, because
      // the badge looks fine at rest.
      const glyphPx = this.glyphPxFor(card);
      // Half the card's leftover height: the same clear space on all four
      // sides of the chip, and it makes a bare-icon card square (see below).
      const iconPadX = card ? (m.cardHeightPx - glyphPx) / 2 : 0;

      const container = new StackPanel(`lbl_${entityId}`);
      container.isVertical = true;
      container.width = "180px";
      container.height = `${labelH}px`;
      container.spacing = 3;
      this.labelLayer.addControl(container);
      container.linkWithMesh(anchor);
      // The anchor already sits at (or just above) the asset's own top edge —
      // see buildLabelAnchors — so the only pixel offset needed is to lift
      // the WHOLE container clear of that point
      // (rather than centering it on the point), not the large hand-tuned
      // constant this used to be.
      // Overwritten every layout pass by labelBaseOffsetY (which explains why
      // the lift is scaled); this is just the pre-first-pass value.
      container.linkOffsetYInPixels = -(labelH / 2) * this.effectiveScale();

      // `badge` is the single tappable region either way (badgeContaining
      // hit-tests it) — classic: a transparent squircle whose fill is the
      // composited category+glyph image, showing state as an outline ring.
      // card: a SOLID state-coloured rounded card (neutral by default, see
      // categorySurface) holding an icon chip + value inline (its fill/ring
      // are driven in updateLabel).
      const badge = new Rectangle(`lbl_badge_${entityId}`);
      badge.height = `${card ? m.cardHeightPx : m.badgeDiameterPx}px`;
      badge.cornerRadius = (card ? m.cardHeightPx : m.badgeDiameterPx) * chip.radius;
      badge.thickness = 0;
      // Apply the style's resting fill NOW, not only in updateLabel: an entity
      // that has never reported (or is UNAVAILABLE and so never pushed a state
      // this session) would otherwise keep the transparent default and render
      // with NO card at all — reading as "this badge ignores the card style".
      // updateLabel re-applies the same value whenever a state does arrive.
      badge.background = card
        ? categorySurface(category, "off", this.config.entityMap[entityId]?.badgeColor).fill
        : "transparent";
      badge.shadowColor = "rgba(0,0,0,0.55)";
      badge.shadowBlur = 6;
      // ── SYMMETRIC. A canvas shadow does NOT ride the CTM ────────────────
      // shadowBlur/shadowOffset are applied in device pixels regardless of the
      // container's scale (see CLAUDE.md), so a 2px downward offset is a fixed
      // skirt of extra dark under the card at every zoom. On a dark badge over
      // a bright floor that skirt reads as part of the badge, which makes the
      // card look taller at the bottom than the top and its contents look
      // high — an optical offset no amount of centring the CONTENTS can
      // answer, because the contents were centred. A drop shadow with a
      // direction is a DOM idiom borrowed from a surface that has a light
      // source; a badge floating over a 3D villa does not, so the halo is
      // even.
      badge.shadowOffsetY = 0;
      // Tap/long-press handling is NOT wired here — see pickBadgeAt()'s
      // docstring for why. The badge is a purely visual control now.
      if (card) {
        // The card hugs its icon+value row. Top/bottom breathing room is the
        // glyph image's baked-in margin (BADGE_INSET_CARD); left/right come
        // from the padding below.
        badge.adaptWidthToChildren = true;
        // ── PADDING IN BABYLON GUI SUBTRACTS. THIS FLAG IS WHAT ADDS IT ────
        // The single defect behind ~15 releases of "the icon and the text have
        // no padding and are not centred in the card", and it is not a number
        // anywhere — it is which side of the box the padding lands on.
        //
        // Babylon's default is an INSET: control.js:1645-1674 subtracts a
        // control's own padding from its own _currentMeasure. Meanwhile
        // container.js:369 ADDS that same padding to the width PROPERTY when
        // adaptWidthToChildren is on. The two cancel at a stable fixed point
        // that is silently wrong — the property read 28 while the card was
        // DRAWN 22 wide against a fixed 28 height. Portrait, 0.79 aspect, with
        // cornerRadius computed off the height (7.9px = 36% of the 22 actually
        // drawn) so it rounded like a vertical capsule instead of a squircle.
        // Inside it, the chip sat flush on the left border with 0px of margin
        // and 3px on the right of the value: exactly the report, and exactly
        // why adjusting the icon's SIZE, the ring, the inset or the fraction
        // never helped. Every one of those fixes computed a correct number
        // that was then subtracted instead of added.
        //
        // descendantsOnlyPadding is Babylon's CSS-padding mode
        // (control.js:1536-1541): the padding is applied to the measure handed
        // to the CHILDREN and left out of this control's own box. The property
        // and the drawing now agree, so a bare-icon card is 28x28 — square by
        // construction at any icon size, on either pointer class — and a card
        // with a value reads pad | chip | gap | value | pad.
        badge.descendantsOnlyPadding = true;
        // Half the card's leftover height, so the chip's clear space is the
        // same on all four sides and width equals height when there is no
        // value. The icon-to-text gap is a different measurement and lives on
        // the value below.
        badge.paddingLeft = `${iconPadX}px`;
        badge.paddingRight = `${iconPadX}px`;
      } else {
        badge.width = `${m.badgeDiameterPx}px`;
      }
      container.addControl(badge);

      // Card mode lays the icon + value in a horizontal row INSIDE the card;
      // classic keeps the glyph as the badge's full fill and the value in a
      // separate pill below.
      const row = card ? new StackPanel(`lbl_row_${entityId}`) : null;
      if (row) {
        row.isVertical = false;
        // ONE height for everything inside the card, and it is the glyph's
        // own size. It used to be `cardHeightPx - 2 * ringThicknessPx`
        // computed separately here and again for the value box — two
        // derivations of one quantity that happened to agree, and that stopped
        // describing the drawn card at all in 2.252.0, when the ring became
        // 0px, 1px or ringThicknessPx depending on state. The glyph is what
        // this box exists to hold, so the glyph is what sizes it.
        row.height = `${glyphPx}px`;
        row.adaptWidthToChildren = true;
        badge.addControl(row);
      }

      // BOTH styles use the SAME baked squircle image (badgeImageDataUrl) at
      // the SAME inset — 0, so the art fills its control. The card used to
      // bake a margin of its own on top of the border it already draws, which
      // is two frames around one icon; see the glyph source below.
      const glyph = new Image(`lbl_glyph_${entityId}`,
        // The card bakes a 10% inset so its squircle sits as a CHIP with the
        // card showing around it; the classic badge fills its own control
        // (inset 0). 2.241.0 removed this on the reasoning that the card's own
        // border made a second frame redundant — but the reference the design
        // was always measured against has the chip, and without it the art had
        // no padding of its own and sat flush on the border.
        badgeImageDataUrl(category, iconKeyFor(type, this.lastState.get(entityId)), "off",
          this.config.entityMap[entityId]?.badgeColor, card ? BADGE_INSET_CARD : 0,
          // Card: the Rectangle above strokes the edge, so the chip bakes no
          // ring of its own — see updateLabel for the doubled outline this
          // stops. Classic: the image IS the badge and carries its own.
          // Card only: the glyph is bolder there — see ICON_STROKE_VIEWBOX_BOLD.
          undefined, card, glyphPx, card));

      glyph.width = `${glyphPx}px`;
      glyph.height = `${glyphPx}px`;
      glyph.stretch = Image.STRETCH_UNIFORM;
      (row ?? badge).addControl(glyph);

      // Value: classic → a dark rounded pill BELOW the badge; card → inline
      // text to the RIGHT of the icon chip, on the coloured card itself.
      const valueWrap = new Rectangle(`lbl_valwrap_${entityId}`);
      valueWrap.thickness = 0;
      valueWrap.adaptWidthToChildren = true;
      // Same reason as the card above, and it bit BOTH styles: this wrap is an
      // adaptWidthToChildren container with its own left/right padding, so
      // without this its padding cancelled to nothing. The classic style's
      // dark pill was drawn exactly as wide as its text — pillPadXPx: 10 was
      // being subtracted straight back out, which is why the value looked like
      // it was touching the stadium's rounded ends.
      valueWrap.descendantsOnlyPadding = true;
      if (card) {
        valueWrap.height = `${glyphPx}px`;
        valueWrap.background = "transparent";
        // The icon-to-text gap, as a fraction of the CHIP rather than a flat
        // constant — the bottom bar's tiles run a 46px chip with a 13px gap,
        // i.e. 28% of the chip, and that is the proportion this is measured
        // against because it is the same object drawn in the DOM. A flat 4px
        // came out at 18% and read as the text crowding the chip's edge.
        valueWrap.paddingLeft = `${Math.round(glyphPx * chip.gap)}px`;
        // NONE. The card's own right padding (iconPadX) is the value's right
        // margin, which makes the card's two outer margins equal — the chip
        // has iconPadX to its left and the value has iconPadX to its right,
        // with the gap between them the only asymmetric measurement, as it
        // should be. This carried `gap - iconPadX` while padding was still
        // being subtracted rather than added; keeping it now would put the
        // whole gap on the right a second time.
        valueWrap.paddingRight = "0px";
        valueWrap.isVisible = false;
        row!.addControl(valueWrap);
      } else {
        valueWrap.height = `${m.valueChipHeightPx}px`;
        valueWrap.cornerRadius = m.valueChipHeightPx / 2;
        valueWrap.background = "rgba(15,23,42,0.85)";
        // Padding must clear the stadium's corner radius (VALUE_CHIP_HEIGHT/2) or
        // the text crowds the rounded ends and reads as touching the edges.
        valueWrap.paddingLeft = `${m.pillPadXPx}px`;
        valueWrap.paddingRight = `${m.pillPadXPx}px`;
        valueWrap.shadowColor = "rgba(0,0,0,0.5)";
        valueWrap.shadowBlur = 4;
        valueWrap.isVisible = false;
        container.addControl(valueWrap);
      }

      // Card: the surface's glyph colour, so it stays legible on a neutral
      // badge and shifts with state exactly as the icon does. Classic: white,
      // on its own dark pill. updateLabel re-applies the card case per state.
      const valueText = badgeText(`lbl_value_${entityId}`, {
        fontPx: card ? m.cardValueFontPx : m.pillValueFontPx,
        color: card
          ? categorySurface(category, "off", this.config.entityMap[entityId]?.badgeColor).ink
          : PILL_TEXT,
        weight: "600",
        metrics: m,
      });
      valueWrap.addControl(valueText);

      this.labels.set(entityId, { container, badge, glyph, valueWrap, valueText, anchor, type, category });

      // Repaint from the last known state so a rebuild (toggle on / icon edit)
      // shows live status immediately instead of an idle default. An entity
      // with NO cached state has never received a single live update from HA
      // — apply() (the only caller of updateLabel outside this constructor)
      // fires exclusively off real HA state events, so an entity_id that's
      // misconfigured or was removed/renamed in HA generates none, EVER. Left
      // as "no cached state, do nothing", such a badge stayed frozen at this
      // constructor's plain full-colour default forever — impossible to
      // distinguish from a genuinely healthy device on the map. A synthetic
      // "unavailable" stub routes it through the exact same updateLabel path
      // (dim/desaturated glyph, no ring) as a real device HA lost contact
      // with — the SAME convention isUnavailable() already uses elsewhere
      // (entity == null counts as unavailable), just applied here too.
      const cached = this.lastState.get(entityId) ?? phantomEntity(entityId);
      this.updateLabel(entityId, type, cached);
      // Same reasoning, but for the MESH itself (emissive glow, on/off alpha
      // fade — see applyToMesh): that only ever runs from apply(), which
      // fires exclusively off real HA state events. A light whose entity_id
      // has never once received one (freshly added in SweetHome, not yet
      // wired up in HA, or just never toggled since the app started) sat at
      // this constructor's plain opaque baseline forever — indistinguishable
      // from a genuinely broken fixture, and exactly why newly added light
      // assets looked "stuck" solid-coloured while identical, already-toggled
      // fixtures correctly went translucent when off. Replaying against the
      // same cached-or-phantom state used for the badge above means a mesh's
      // FIRST paint is already correct, with no live event required.
      const meshesForEntity = this.byEntity.get(entityId);
      const mapForEntity = this.mapping.get(entityId);
      if (meshesForEntity?.length && mapForEntity) {
        const lightShare = mapForEntity.type === "light"
          ? new Set(meshesForEntity.map((m) => this.meshLights.get(m.uniqueId)).filter(Boolean)).size || 1
          : 1;
        for (const mesh of meshesForEntity) this.applyToMesh(mesh, mapForEntity, cached, lightShare);
      }
    }
    // The label set is now final for this build — refresh the hit-test view.
    this.labelsNewestFirst = [...this.labels].reverse();
    this.applyIconScale(); // honour current size + zoom on freshly built badges
  }

  /**
   * Repaint one badge from a state, and report whether anything that AFFECTS
   * LAYOUT changed.
   *
   * The distinction earns its keep: `apply()` runs on every HA state event, a
   * villa pushes them constantly, and this used to end with an unconditional
   * markLayoutDirty() — so a thermometer ticking from 21.4°C to 21.5°C forced
   * a full relayout of every badge on the next frame, with the camera dead
   * still. cullLabels runs inside scene.render(), so that cost lands squarely
   * in the frame time.
   *
   * Only three things here can move a box: the CATEGORY (it gates visibility
   * through hiddenCategories), the value pill's VISIBILITY, and the value's
   * TEXT LENGTH — length, not content, because labelBoxes measures characters.
   * 21.4°C → 21.5°C is the overwhelmingly common event and changes none of
   * them. Everything else this method touches — fill, ring, glyph, alpha — is
   * colour at fixed geometry.
   */
  private updateLabel(entityId: string, type: EntityType, entity: HassEntity): boolean {
    const lbl = this.labels.get(entityId);
    if (!lbl) return false;
    const prevCategory = lbl.category;
    const prevLen = lbl.valueText.text.length;
    const prevVisible = lbl.valueWrap.isVisible;
    // Re-resolve the filter category now that this state may carry the
    // device_class (e.g. an enum sensor → Network) — cullLabels reads it live.
    lbl.category = effectiveCategory(
      entityId, type, this.config.entityMap[entityId]?.category,
      entity.attributes.device_class as string | undefined);
    // FACE from this device's own state, RING from its linked entity — two
    // independent facts, two independent sets of pixels. See badgeFaceAndRing.
    // (badgeKind still folds the linked signal into ONE value for everything
    // else that reads it — the alert pulse, a room chip's ring, an entity
    // group's — because those all mean "is anything here demanding attention",
    // which a linked entity being on genuinely is.)
    const { face: state, ring: ringState } =
      badgeFaceAndRing(type, entity, this.linkActiveIds.has(entityId));
    const iconKey = iconKeyFor(type, entity);
    const override = this.config.entityMap[entityId]?.badgeColor;

    // Neutral-by-default state (fill/glyph/ring) now IS the unavailable
    // signal (a muted glyph + dashed amber ring, see categorySurface) — no
    // extra whole-badge alpha wash needed, unlike the old always-on-gradient
    // design which had to dim the fixed category colour to show "not
    // reporting" some other way.
    lbl.glyph.alpha = 1; // never set elsewhere now — no cascading ambiguity

    if (this.isCardStyle()) {
      // ── NEUTRAL CARD, COLOURED CHIP ──────────────────────────────────
      // The bottom bar's tiles are the same arrangement drawn in the DOM, and
      // they invert what this used to do: `.summary-tile` is transparent while
      // `.summary-tile-icon` carries `--tile-fill`. That is exactly what makes
      // its chip read as a deliberate object.
      //
      // This card used to take the STATE fill itself, and the baked chip took
      // the same one — so the chip was the same colour as the surface behind
      // it and only its ring separated them, which drew as a faint vertical
      // seam beside the value rather than as a chip. Reported as the icon and
      // text having no padding and, later, as the rendering simply being
      // wrong; the spacing was only half of it.
      //
      // So: the card is always the RESTING surface, and the chip below carries
      // the state. The card's ring still shows state, because that is the
      // attention signal and a neutral card must not swallow it.
      const surface = categorySurfaceRinged(lbl.category, state, ringState, override);
      lbl.badge.background = categorySurface(lbl.category, "off", override).fill;
      // ── EXACTLY ONE RING, AT THE WEIGHT THE STATE ASKS FOR ─────────────
      // Two independent things were drawing it: this Rectangle's border, and
      // the ring baked into the chip image below. They are the same colour a
      // few pixels apart with the same fill on both sides of the gap, so every
      // card badge carried a nested-square outline — clearest on a RESTING
      // badge, where the only thing either outline contributes is a faint grey
      // rectangle drawn twice. The dashed unavailable state was already
      // recognised as needing exactly one of them; it was true of every other
      // state too.
      //
      // The Rectangle wins, because it is the one that can follow the control's
      // own corner radius and scale. `unavailable` is the single exception:
      // Babylon GUI has no dashed border, so that dash can only come from the
      // canvas — there the image spans the full control (inset 0) and this
      // Rectangle stands down instead, which puts the dash on the badge's outer
      // edge where every other state's ring is.
      //
      // The WEIGHT was a second defect in the same line. `ringThicknessPx`
      // went on unconditionally, so an idle badge — whose surface asks for a
      // 1px hairline (categorySurface's `ringHairline`) — was stroked at the
      // full state weight. That is what made a resting badge read as heavily
      // outlined rather than quiet, and it is the same rule the room chip and
      // the entity group already follow (`ringRed ? ringThicknessPx : 1`).
      const dashed = !!surface.ringDashed;
      lbl.badge.thickness = !surface.ring || dashed
        ? 0
        : surface.ringHairline ? 1 : this.metrics.ringThicknessPx;
      lbl.badge.color = surface.ring ?? "transparent";
      lbl.glyph.source = badgeImageDataUrl(
        lbl.category, iconKey, state, override,
        dashed ? 0 : BADGE_INSET_CARD, ringState, !dashed, this.glyphBakePx(true),
        // This whole branch IS the card style, so the heavier glyph weight is
        // unconditional here — see ICON_STROKE_VIEWBOX_BOLD.
        true);
      // Neutral ink, on a now-neutral card — the bottom bar's value is
      // `--text-primary` beside a coloured chip, not the chip's own hue. The
      // state is carried by the chip and the ring; the number is just a number.
      lbl.valueText.color = categorySurface(lbl.category, "off", override).ink;
    } else {
      // Classic style bakes fill + ring straight into the glyph image itself
      // (see badgeIcons.ts) — the wrapping Rectangle stays a plain
      // transparent hit-target, not a second ring drawn on top of the baked one.
      lbl.badge.background = "transparent";
      lbl.badge.thickness = 0;
      lbl.badge.color = "transparent";
      lbl.glyph.source = badgeImageDataUrl(
        lbl.category, iconKey, state, override, 0, ringState, false, this.glyphBakePx(false));
    }
    lbl.badge.alpha = 1;
    // The value pill is never shown for an unavailable entity anyway
    // (compactValue short-circuits to "" for every type when state is
    // unavailable/unknown — see below), so it needs no alpha of its own.

    const value = this.groupedValue(entityId, this.compactValue(type, entity));
    lbl.valueText.text = value;
    lbl.valueWrap.isVisible = value.length > 0;
    const dirty = lbl.category !== prevCategory
      || lbl.valueText.text.length !== prevLen
      || lbl.valueWrap.isVisible !== prevVisible;
    if (dirty) this.markLayoutDirty();
    return dirty;
  }

  /**
   * Does this badge take part in the layout at all?
   *
   * ONE definition, because there were two: cullLabels applied category,
   * mesh-enabled and floor filters inline, and the zoom-to-room solver
   * (solveRoomZoomRadius) applied a looser set of its own. So the solver could
   * promise a shot that decluttered a set of badges the renderer was never
   * going to draw, or miss one it was — which is how "tap a room" came out
   * differently on consecutive taps.
   *
   * Deliberately NOT filtered: suppressedEntityIds (hidden-in-HA /
   * config-diagnostic). A previous version hid the badge entirely for any
   * suppressed entity, which regressed every UniFi access-point "State"
   * sensor (diagnostic-category by the integration's own convention) off the
   * map even though each was deliberately bound to real geometry. The map
   * represents physical devices spatially; HA's "diagnostic" classification is
   * about decluttering a flat SETTINGS list, a different concern entirely. The
   * room chip's COUNT is filtered instead (updateClusters), which is the only
   * place a mismatch against SummaryGroupPanel's list actually mattered.
   *
   * Enabled-state and floorIndex come from the entity's bound MESH (byEntity),
   * not the anchor's own parent chain: most anchors are parented straight to
   * their mesh (buildLabelAnchors) so the two agree, but a fan's anchor is
   * deliberately detached onto its spin pivot's non-rotating parent
   * (detachFanLabelAnchor) so the badge doesn't spin with the blades — and
   * that parent is a shared container FloorManager never touches, so it always
   * reads "enabled" with no floorIndex. Reading the anchor's parent for THAT
   * case silently stopped culling the fan's badge on the other floor.
   */
  private badgeEligible(id: string, lbl: LabelControls, hidden: readonly Category[]): boolean {
    if (hidden.includes(lbl.category)) return false;
    // ── DISMISSAL DOES NOT HIDE A BADGE (2.254.0) ────────────────────────
    // It used to: `if (dismissedEntityIds.has(id)) return false`, added so the
    // map would stop disagreeing with the room's own modal about a device
    // whose integration had been removed from HA. That killed the
    // disagreement in the wrong direction. The mesh is still in the model and
    // still resolves through resolveMeshToMapping, so it kept its blue
    // "clickable" outline and still opened a panel — the app knew about a
    // device it then refused to name anywhere, and the only visible evidence
    // was geometry that glowed and led to a dead end.
    //
    // A device the model carries and Home Assistant does not is a FACT worth
    // reporting, not noise to suppress. It draws as unavailable — the dashed
    // amber ring, from the phantom state rebuildLabels already paints it with
    // — and every list files it under "Not in Home Assistant", its own
    // heading beside "Not on the map" (SummaryGroupPanel).
    //
    // Dismissal keeps the meaning it was actually built for: it still strips
    // the id from Dashboard's effectiveMappedEntityIds, so a dismissed device
    // is not counted against Facility readiness and does not sit in the HUD's
    // unavailable-devices alert. "Remove" means "stop nagging me", which it
    // always did; it never needed to mean "pretend the geometry is not there".
    //
    // Nothing here makes a room chip red over it, either: both the chip's and
    // the group's unavailable signal read `lastState`, and an entity HA has
    // never reported has no entry in it.
    const mesh = this.byEntity.get(id)?.[0];
    if (!(mesh ? mesh.isEnabled() : lbl.anchor.isEnabled())) return false;
    // Floors below the active one stay RENDERED (cumulative floors: the 2F
    // view keeps the 1F shell underneath), but badges are GUI overlay and
    // would draw straight through the 2F slab — only the active floor's.
    const floorIdx = (mesh?.metadata as { floorIndex?: number } | null)?.floorIndex
      ?? (lbl.anchor.metadata as { floorIndex?: number } | null)?.floorIndex
      ?? (lbl.anchor.parent?.metadata as { floorIndex?: number } | null)?.floorIndex;
    return floorIdx === undefined || floorIdx === this.activeFloor;
  }

  /** Decide which badges are visible, then group the ones whose room is too
   *  crowded to show individually behind that room's cluster chip instead
   *  (updateClusters) — never nudged, so a shown badge
   *  is always at the exact same spot relative to its device. Hidden
   *  regardless: anchors projecting behind the camera (z outside [0,1]),
   *  categories filtered off in the HUD, and entities on a hidden floor. */
  private cullLabels(): void {
    if (this.labels.size === 0) return;
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const eng = this.scene.getEngine();
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const tm = this.scene.getTransformMatrix();
    const hidden = this.config.hiddenCategories;

    // ── Frame budget: is this pass needed at all? (see layoutDirty) ─────────
    // The view-projection matrix answers "did the camera change" completely —
    // position, orbit, zoom and fov all land in it — and the viewport size
    // catches a resize. Compared BEFORE any allocation, so the common
    // animating-but-static-view frame (a spinning fan, a pulsing alert) costs
    // 16 float comparisons instead of a full relayout.
    const m = tm.m;
    if (!this.layoutDirty && this.lastVpM && this.lastVpW === vp.width && this.lastVpH === vp.height) {
      let same = true;
      for (let i = 0; i < 16; i++) {
        if (this.lastVpM[i] !== m[i]) { same = false; break; }
      }
      if (same) return;
    }
    if (!this.lastVpM) this.lastVpM = new Float32Array(16);
    for (let i = 0; i < 16; i++) this.lastVpM[i] = m[i];
    this.lastVpW = vp.width;
    this.lastVpH = vp.height;
    this.layoutDirty = false;

    // Every badge that passes the non-view culls (category / floor / enabled).
    // Deliberately NOT filtered by what is currently framed — see groupBadges.
    // Reused across frames (see shownPool) rather than rebuilt.
    const shown = this.shown;
    let shownCount = 0;

    for (const [id, lbl] of this.labels) {
      if (!this.badgeEligible(id, lbl, hidden)) {
        lbl.container.isVisible = false;
        continue;
      }
      // NOTE: suppressedEntityIds (hidden-in-HA / config-diagnostic) is
      // deliberately NOT filtered here. A previous version hid the badge
      // entirely for any suppressed entity — which regressed every UniFi
      // access-point "State" sensor (diagnostic-category by the integration's
      // own convention) off the map, even though each was deliberately bound
      // to real geometry. The map represents physical devices spatially; HA's
      // "diagnostic" classification is about decluttering a flat SETTINGS
      // list, a different concern entirely — a device someone bothered to
      // bind to a mesh should stay tappable regardless of it. The room-
      // cluster CHIP's count is filtered instead (see updateClusters), which
      // is the only place a mismatch against SummaryGroupPanel's list
      // actually mattered.
      // The badge must vanish with its device when FloorManager hides that
      // floor. Read enabled-state/floorIndex from the entity's actual bound
      // mesh (byEntity), not the anchor's OWN parent chain: most anchors are
      // parented straight to their mesh (see buildLabelAnchors) so the two
      // agree, but a fan's anchor is deliberately detached onto its spin
      // pivot's non-rotating parent (see detachFanLabelAnchor) so the badge
      // doesn't spin with the blades — that parent is a shared container
      // FloorManager never touches, so it's always "enabled" with no
      // floorIndex of its own. Reading the anchor's parent for THAT case
      // silently stopped culling the fan's badge on the other floor.
      // The anchor's WORLD position is what grouping runs on (see groupBadges);
      // its projection is only needed to draw it. Anchors projecting behind
      // the camera (z outside [0,1]) have no valid screen position, so they
      // can't be drawn — but they still take part in grouping, exactly so
      // that turning the camera can't change how a room is presented.
      const wp = lbl.anchor.getAbsolutePosition();
      const p = this.projTmp;
      Vector3.ProjectToRef(wp, Matrix.IdentityReadOnly, tm, vp, p);
      // Reuse this slot's object if the pool already has one — only a badge
      // count above the high-water mark ever allocates, so the steady state
      // allocates nothing at all.
      let s = this.shownPool[shownCount];
      if (!s) {
        s = { id, lbl, x: 0, y: 0, wx: 0, wy: 0, wz: 0, sx: 0, sy: 0, sz: 0, inFront: false };
        this.shownPool[shownCount] = s;
      }
      s.id = id;
      s.lbl = lbl;
      s.x = p.x;
      s.y = p.y;
      s.wx = wp.x;
      s.wy = wp.y;
      s.wz = wp.z;
      s.inFront = p.z >= 0 && p.z <= 1;
      shown[shownCount] = s;
      shownCount++;
    }
    // Truncate to this frame's count. The objects themselves stay alive in
    // shownPool, so refilling next frame reuses them.
    shown.length = shownCount;

    // ── The focus lasts as long as you stay at least as close ──────────────
    // Resolved BEFORE any grouping runs, so a single pass cannot group with a
    // focus it is about to drop. No camera-event plumbing, and nothing that has
    // to tell "the user zoomed" from "we flew there": the exemption is stamped
    // with the quantised zoom of the first pass after it was granted, and
    // dropped once the view gets FARTHER than that. Panning keeps it (the zoom
    // is unchanged, and looking around a room you asked to see should not
    // collapse it); zooming out ends it, which is exactly when a summary
    // becomes the right answer again.
    //
    // ⚠️ `z < focusedAtZoom`, NOT `z !== focusedAtZoom`, and the difference is
    // a reported bug. Tapping the Swimming Pool chip expanded the room; zooming
    // IN by one rung changed z, dropped the exemption, and the room collapsed
    // straight back to the very chip that had just been tapped — then expanded
    // again a rung later, once the badges genuinely separated. Zooming in
    // strictly increases the distance between anchors: it is the one direction
    // that can never make a room less legible, so it must never be the thing
    // that takes it away. The original stamp stays the floor rather than
    // re-stamping on the way in, which is what makes "at least as close as when
    // you asked" the literal rule.
    //
    // ⚠️ CSS PIXELS, and that is the second half of the same rule. This is the
    // only place the measure is compared BETWEEN frames, so it is the only
    // place the resolution valve can forge a zoom change — see
    // quantisedPixelsPerWorldUnit for the full symptom. Grouping keeps render
    // pixels because it compares within one frame against boxes in the same
    // units; this must not.
    // ── The focus has TWO consequences and they expire differently ─────────
    // The EXEMPTION — the focused room's own badges drawn individually — keeps
    // the rule above: it survives zooming in, because coming closer can never
    // make a room less legible.
    //
    // The SUPPRESSION added in 2.368.0 — every OTHER room held at its chip —
    // must not. It exists to stop the neighbours competing for the frame at the
    // moment you ask for a room, and that is all it is for. Left to share the
    // exemption's lifetime it became sticky: focus a room, pan across to
    // another, and that one stayed a chip at every zoom, because the pass was
    // still forcing it clustered. Reported as "the other room badge never
    // declutters into entity icons".
    //
    // So it holds only while the camera is AT OR WIDER THAN the zoom the focus
    // was granted at. Zoom in from there and every room is back under the
    // ordinary rules, decluttering by zoom exactly as it did before — which is
    // the property being asked for, expressed as the one condition that already
    // means "you have not yet earned the space to draw these".
    let suppressOthers = false;
    if (this.focusedRooms.size > 0) {
      const z = this.quantisedPixelsPerWorldUnit(shown, true);
      if (this.focusedAtZoom === 0) this.focusedAtZoom = z;
      else if (z < this.focusedAtZoom) { this.focusedRooms.clear(); this.focusedAtZoom = 0; }
      suppressOthers = this.focusedRooms.size > 0 && z <= this.focusedAtZoom;
    }

    // ── Layout ───────────────────────────────────────────────────────────
    // Grouping is decided in world space against the current zoom alone, so
    // panning/orbiting cannot change it and the same view always renders the
    // same way (see the thresholds' comment). Piles too big to read are
    // summarised into their room's chip; smaller huddles are fanned apart.
    const baseY = this.labelBaseOffsetY();
    // ── Tier 1 → 2: drop the READOUT before summarising the room ──────────
    // The full box includes the value text, whose width is a function of how
    // many characters the reading happens to have: a card showing
    // "26.4°C · 66%" measures ~155px wide while its tappable icon is ~54px.
    // Grouping on that meant two sensors whose ICONS were comfortably apart —
    // obvious empty space between them — summarised their whole rooms because
    // their TEXT boxes touched. Reported as the room badge appearing far too
    // early, with plenty of room left for individual badges.
    //
    // What must never overlap is the TAP TARGET. The readout is secondary and
    // is always one tap away in the device panel, so it is what gets dropped
    // first — the same order every map engine degrades in, where the marker
    // survives and its label is the thing that goes. The badge does not move
    // or shrink; it just stops carrying its number.
    for (const s of shown) {
      s.lbl.valueWrap.isVisible = s.lbl.valueText.text.length > 0;
    }
    const clearance = this.screenClearance(shown);
    if (clearance) {
      const withText = this.placementItems(shown, this.labelBoxes(shown), clearance);
      const touching = markContacts(withText, clearance.gap, clearance.minSep, this.placeScratch);
      for (let i = 0; i < shown.length; i++) {
        if (touching[i]) shown[i].lbl.valueWrap.isVisible = false;
      }
    }
    // ── Tier 2 → 3: only now, if the ICONS THEMSELVES still collide ───────
    // Re-measured AFTER the readouts above are hidden, so this pass sees the
    // boxes that will actually be drawn rather than the ones that would have
    // been — the 2.152.0 rule that a layout decision may never use different
    // geometry from the renderer. labelBoxes reads valueWrap.isVisible for its
    // width, so hiding the value IS the icon-only measurement; there is no
    // second, parallel definition of a badge's size to drift out of step.
    const boxes = this.labelBoxes(shown);

    // ── The last tiers: the entity group, then the room's chip ────────────
    // Four tiers, in order, and a badge holds its SIZE through all of them —
    // it is never shrunk, because a badge below the ~44px touch target is a
    // control nobody can hit, which is a worse answer than a chip that is at
    // least honestly tappable and says how many devices it covers:
    //
    //   1. badge on its device
    //   2. badge without its readout        (the text is dropped first)
    //   3. the badges that LOST as one badge (entity group)
    //   4. the room's chip
    //
    // ── Tier 3 RANKS rather than merging wholesale (2.232.0) ──────────────
    // Until 2.231.0 a collision took the whole pile: any badges whose
    // footprints touched joined one connected component, and every member of
    // it disappeared behind a single summary. Five colliding devices meant
    // five devices two taps away, and the fifth was no more crowded than the
    // first — the pile had no way to say which of its members mattered.
    //
    // Now the pile is ordered by a STATIC rank (badgePriority: controllable
    // beats read-only, then category, then entity_id) and placed greedily. The
    // winners keep real badges at their own anchors; only the losers merge.
    // That is what every serious label renderer does — Mapbox places in
    // `symbol-sort-key` order and the first symbol into the collision index
    // wins, deck.gl takes a `getCollisionPriority`, Google Maps has
    // OPTIONAL_AND_HIDES_LOWER_PRIORITY — because a map with its important
    // labels showing beats a map of blobs.
    //
    // The rank is static SPECIFICALLY so the same devices win every time. A
    // rank that moved with state or with use would spend the muscle memory
    // this whole subsystem exists to build. See badgePriority for the three
    // dynamic inputs that were considered and rejected.
    //
    // ── The cross-room rule is GONE (2.232.0) ────────────────────────────
    // A pile spanning rooms used to send EVERY room it touched straight to a
    // chip, on the reasoning that a group badge covering two rooms could not
    // be labelled honestly. The reasoning about labelling was right; the
    // remedy was far too broad. One badge in the living room touching one in
    // the kitchen hid both rooms entirely — twenty badges lost to two that
    // overlapped — and in an open-plan villa that fires constantly. It was the
    // single biggest cause of "everything is an aggregate badge".
    //
    // A cross-room pile now resolves like any other: rank decides and the
    // winner keeps its badge.
    //
    // ── …and the loser summarises with the badge it LOST TO (2.250.0) ─────
    // 2.232.0 sent each loser to a group in ITS OWN room, on the reasoning
    // that a group spanning two rooms could not be labelled honestly. That
    // reasoning was still the old one, and it still cost too much — just less
    // visibly. A badge whose only near neighbour is across a boundary has no
    // room-mate to summarise with, so it fell through "a group of one is not a
    // group" and took its whole room to the chip, INCLUDING badges metres away
    // that had conflicted with nothing. Reported with two screenshots one icon
    // step apart: a living room with three badges and acres of empty floor
    // collapsing to a single chip, because one camera on the bedroom wall lost
    // to a bedroom device.
    //
    // Deferrals are bucketed by PILE now, so a group holds the badges that
    // actually competed, whatever rooms they are in. The labelling objection is
    // answered rather than avoided: a multi-room group prints the room chip's
    // own "Living Room +1" form, and its tap opens the same device list, which
    // names every member anyway. What it no longer does is spend the
    // bystanders.
    //
    // ── A BADGE NEVER MOVES (2.206.0) ─────────────────────────────────────
    // There used to be a tier between 2 and 3: a collided pile was opened out
    // onto a RING around its own centre, and only grouped when no ring fitted
    // inside a travel budget. It is gone, and it should not come back.
    //
    // The ring's seats were world points on a circle in the GROUND plane, so
    // orbiting the camera viewed that circle from a different azimuth: the
    // same four badges read as a vertical column from one heading and a 2x2
    // block from another. Nothing had moved in world space — but on screen it
    // is indistinguishable from the badges rearranging themselves, which is
    // the one thing this subsystem exists to prevent. Reported three times
    // across 2.169.0-2.205.0 with screenshots one orbit apart, and each time
    // the answer was to tighten the budget rather than to notice that ANY
    // budget above zero shows some of it.
    //
    // Tightening it to zero is what removes the whole class of report. So: a
    // badge is drawn at its device or not at all, and every collision resolves
    // by ranking and then merging the losers. The intermediate state — some of
    // a pile spread, some not — cannot occur because there is no spreading.
    //
    // Rules that keep the group from becoming a second, competing concept:
    //   * ONE PILE ONLY, so a group always stands among the badges it replaced
    //     rather than at the midpoint of two unrelated clusters.
    //   * A SINGLE-ROOM group that would cover ALL of its room's badges IS the
    //     room, so it renders as the room chip instead. Two renderings of the
    //     same content is how a viewer learns to distrust both. The
    //     single-room qualifier matters: a bucket holding both of a room's
    //     badges plus one of the next room's is not that room, and collapsing
    //     it to that room's chip would mislabel it and lose the third badge.
    //   * A group of ONE is not a group: a lone loser pulls its nearest
    //     accepted PILE-MATE down with it (bounded, so the summary cannot land
    //     where neither device is). Because it deferred by losing to something
    //     accepted in its own pile, a partner always exists and is always in
    //     range. This is what keeps a fan and its own light rendering as the
    //     group of 2 they were before ranking existed.
    //   * A group badge must clear everything a real badge must clear, or
    //     every room it covers falls to the chip.
    //
    // Tier 4 still takes the WHOLE room with it, never a subset: a room that is
    // half chip and half loose badges asks the viewer to work out which devices
    // the chip covers, and a count over part of a room is not actionable.
    //
    // There used to be a middle tier: a collided pile was laid out side by
    // side ("fanned") near its devices, and only summarised when that layout
    // could not be made to fit. It was removed in 2.159.0 after a report with
    // two screenshots one zoom step apart — four badges in a diagonal line
    // became a 2x2 block, in a different order.
    //
    // That was inherent to the idea, not a tuning problem. The fan re-slotted
    // a pile into a sqrt(n) grid ordered by entity_id, so a badge's position
    // was a function of how many neighbours it happened to collide with and
    // where its id sorted — not of where its device is. Stability under camera
    // movement is the one thing this subsystem exists to guarantee (see the
    // file header), and the fan was spending it to avoid a chip.
    //
    // Zooming in shrinks every badge's world-space reach, so any two devices at
    // DISTINCT points separate at some zoom and the group opens on its own.
    // Two devices at the SAME point (a fan and its own light, a socket and its
    // power meter) never separate at any zoom — those show as a group of 2
    // always, which is the honest answer: there is no view in which both could
    // be read, and drawing one on top of the other hides a device without
    // saying so.
    this.roomClustered.clear();
    this.roomDisplay.clear();
    this.entityGrouped.clear();
    for (const s2 of shown) {
      const raw = this.roomOf(s2.id);
      const k = roomKey(raw);
      // Smallest spelling wins, so a chip's label cannot depend on which badge
      // of the room happened to be projected first.
      const seen = this.roomDisplay.get(k);
      if (seen === undefined || raw < seen) this.roomDisplay.set(k, raw);
    }

    // ── A FOCUSED ROOM GETS THE SCREEN TO ITSELF (2.368.0) ─────────────────
    // Tapping a room chip or picking a room from the radial menu means "show me
    // THIS room". Until now the solver still ran over the whole villa, so the
    // rooms around the one you asked for kept drawing their own badges and
    // summary cards into the same frame — and, worse, a pile could straddle a
    // wall and produce a card labelled "Living Room +1" that is half yours and
    // half the neighbour's.
    //
    // Every room except the focused one(s) is therefore chipped up front, which
    // is the ONE thing that has to happen and everything else follows from the
    // existing tiers rather than from a new code path (writing a second
    // escalation path is how the orphan bug was made — see dropEscalatedGroups):
    //   * the focused room's badges are `exempt`, so they never enter a pile
    //     and are drawn individually — a cross-room group involving them is now
    //     not expressible at all;
    //   * every other badge's room is clustered, so the visibility rule at the
    //     end of this pass hides it;
    //   * any group made of those badges is dropped by dropEscalatedGroups,
    //     because all of its rooms are clustered;
    //   * and each of those rooms still draws its CHIP, so nothing is lost —
    //     the neighbours remain named, counted and tappable, which is the whole
    //     reason this is a chip and not a delete.
    // Only while the camera is still at the zoom the focus was granted at — see
    // `suppressOthers`. Past that the neighbours are on their own merits again.
    this.focusChipped = 0;
    if (suppressOthers) {
      for (const k of this.roomDisplay.keys()) {
        if (!this.focusedRooms.has(k)) {
          this.roomClustered.set(k, true);
          this.focusChipped++;
        }
      }
    }

    const pending: PendingEntityGroup[] = this.pendingGroups;
    pending.length = 0;
    this.focusPairs = 0;
    this.absorbed = 0;
    let solved: PlacementStats | null = null;
    if (clearance) {
      const items = this.placementItems(shown, boxes, clearance);
      const result = solvePlacement(
        items, clearance.gap, clearance.minSep, BADGE_PLACEMENT, this.placeScratch,
        this.drawableMax(),
      );
      solved = result.stats;
      for (const room of result.chipRooms) this.roomClustered.set(room, true);
      for (let b = 0; b < result.bucketCount; b++) {
        const bucket = result.buckets[b];
        let wx = 0, wy = 0, wz = 0;
        for (const i of bucket.members) {
          wx += shown[i].wx; wy += shown[i].wy; wz += shown[i].wz;
          this.entityGrouped.add(shown[i].id);
        }
        const n = bucket.members.length;
        // Keyed by the PILE alone. It was `room|pileKey`, which was stable only
        // while a bucket's room was — and a bucket's room can now change (a
        // cross-room pile loses a member and becomes single-room), which would
        // have rebuilt the group's GUI controls mid-zoom and flickered.
        // pileKey is the pile's lowest entity_id, so it is already unique.
        const primary = this.roomDisplay.get(bucket.room) ?? bucket.room;
        pending.push({
          key: `grp|${bucket.pileKey}`,
          // The room chip's own convention for "and others" (see chipLabel), so
          // a summary spanning two rooms reads the same way whichever tier
          // drew it.
          room: bucket.rooms.length > 1 ? `${primary} +${bucket.rooms.length - 1}` : primary,
          roomKeys: bucket.rooms.slice(),
          // Members are indices into `shown`, which lives exactly as long as
          // this pass — copied because placeEntityGroups may drop a group and
          // the pooled bucket is about to be reused. Sorted into the cell order
          // a card draws them in; see sortCardMembers for why that is not the
          // order the solver hands them over in.
          members: this.sortCardMembers(shown, bucket.members.slice()),
          wx: wx / n, wy: wy / n, wz: wz / n,
          // Derived from the world centroid just above, by the same projection
          // every badge went through — never accumulated alongside it. See
          // PendingEntityGroup.sx.
          ...this.planeOf(clearance, wx / n, wy / n, wz / n),
          // Every device, always: `gridCells` turns an over-cap ask into the
          // count badge itself, so no producer restates the cap (see there —
          // the one that did not restate it truncated its card and hid a
          // device).
          grid: n,
          focused: false,
        });
      }
      this.pairFocusedRoom(shown, items, clearance, pending);
    }

    // Placed only after every bucket is known: a group's clearance is measured
    // against the badges that were ACCEPTED, and which those are is not
    // settled until the solve above has finished.
    if (clearance) this.placeEntityGroups(shown, boxes, pending, clearance);

    // Chips are derived and drawn LAST, but which rooms have one is settled
    // here — a chip can push a neighbour's badge or card to its own room's
    // chip, and every visibility flag below has to be this pass's final answer.
    const chips = this.settleChips(shown, boxes, pending, clearance);

    for (const s of shown) {
      // ZERO X offset and a FIXED Y lift that centres every badge over its
      // own anchor — the same value for all of them, so nothing here can move
      // one badge relative to another. This is the "a badge never moves"
      // invariant expressed literally rather than as a budget that happens to
      // be small: there is no per-badge displacement to set.
      s.lbl.container.linkOffsetXInPixels = 0;
      s.lbl.container.linkOffsetYInPixels = baseY;
      s.lbl.container.isVisible = s.inFront
        && !this.roomClustered.get(roomKey(this.roomOf(s.id)))
        && !this.entityGrouped.has(s.id);
    }
    this.renderChips(chips);
    this.updateEntityGroups(shown, pending);
    if (debugFlagEnabled()) this.logPlacement(shown, clearance, solved, pending);
    // Last, so every visibility flag it reads is this pass's, not the previous
    // frame's.
    if (debugFlagEnabled() && clearance) {
      this.assertPlacementInvariants(shown, boxes, clearance, pending, chips, tm, vp);
    }
  }

  /** A badge's room, normalised — the single definition every grouping,
   *  chip and hit-test path reads, so none of them can disagree. */
  private roomOf(entityId: string): string {
    return this.resolvedRooms[entityId]?.trim() || NO_ROOM_LABEL;
  }

  /**
   * Pixel lift that hangs a badge container above its anchor point.
   *
   * SCALED, because `linkOffsetYInPixels` is in the GUI layer's own space
   * while the container is scaled about its centre: at scale s a container of
   * height H spans [anchor − H/2 − Hs/2, anchor − H/2 + Hs/2], so only
   * −H·s/2 puts its bottom edge exactly on the anchor. An unscaled lift left
   * the badge straddling its device at s>1 and floating at s<1 — a latent
   * drift at extreme entityIconScale settings that became universal once
   * cssToGui() made s≈2 on every retina display. The chip and group paths
   * were always right about this (`-(CLUSTER_HEIGHT_PX / 2) * scale`); the
   * badge path was the one that disagreed.
   */
  private labelBaseOffsetY(): number {
    const card = this.isCardStyle();
    const h = card ? this.metrics.cardHeightPx : this.metrics.labelHeightPx;
    return -(h / 2) * this.effectiveScale();
  }

  /**
   * Group badges into spatial piles — THE grouping decision, and the reason
   * this app finally behaves consistently under camera movement.
   *
   * Runs on world-space 3D distance (X/Y/Z) against a radius derived from
   * the current zoom alone, so camera rotation, tilt and panning cannot
   * influence the outcome at all, and returning to a view always reproduces
   * exactly what that view showed before. See the thresholds' comment above
   * for the full reasoning and the map-engine precedent. It was GROUND
   * distance (X/Z) until 2.114.0 — see the height note at the test itself for
   * why mounting height had to count, and why including it does NOT weaken
   * the camera-independence this whole design exists to guarantee.
   *
   * Every eligible badge takes part, including ones currently off-screen or
   * behind the camera: a room's presentation must not depend on how much of
   * it happens to be framed right now. Piles cross room boundaries on
   * purpose — a crowded room's badges genuinely do sit on top of a quiet
   * neighbour's, and the caller resolves every room represented in an
   * over-sized pile.
   *
   * Returns each pile as a list of indices into `shown`.
   */
  /**
   * The camera's view direction, decomposed and snapped — the basis every
   * placement distance this pass is measured through.
   *
   * Read from the forward VECTOR rather than from any one camera's own angle
   * property, so it is one rule for the orbit camera and the walk camera. Which
   * of the two is active decides only the METRIC (see VIEW_METRIC and
   * projectToView): orthographic is an approximation about the view axis, and
   * the orbit camera looks AT the villa while the walk camera stands IN it.
   */
  private currentViewBasis(
    /** Measure through a direction the camera has NOT reached yet. Only the
     *  zoom-to-room solver passes this, and it must: that solver answers "will
     *  these badges be legible after the camera arrives", so its basis has to
     *  be the DESTINATION's. Feeding it the live direction while the shot
     *  changes the tilt is precisely the "predicted a clean shot under
     *  different geometry from the one that draws it" bug this file's
     *  docstrings keep warning about. */
    dir?: { x: number; y: number; z: number },
  ): ViewBasis {
    const cam = this.scene.activeCamera;
    if (!cam) return viewBasis(0, 0, 1, VIEW_BASIS_STEPS, VIEW_METRIC);
    if (!dir) cam.getDirectionToRef(CAMERA_LOCAL_FORWARD, this.camForward);
    const f = dir ?? this.camForward;
    const len = Math.hypot(f.x, f.y, f.z);
    if (!(len > 0)) return viewBasis(0, 0, 1, VIEW_BASIS_STEPS, VIEW_METRIC);
    // Duck-typed for the same reason quantisedPixelsPerWorldUnit is: only
    // ArcRotateCamera has a `radius`, and this file imports neither concrete
    // camera class. The walk camera keeps the pre-2.287.0 metric because the
    // plane one discards its depth axis entirely — projectToView has the
    // worked case.
    const orbit = typeof (cam as unknown as { radius?: number }).radius === "number";
    const mode: ProjectionMode = VIEW_METRIC === "plane" && orbit ? "plane" : "world3d";
    return viewBasis(f.x / len, f.y / len, f.z / len, VIEW_BASIS_STEPS, mode);
  }

  /**
   * The distance between two ALREADY-PROJECTED points — plain pixels, no
   * conversion, because both sides are on the glass by the time they get here.
   *
   * THE rule, and it is applied in exactly two places. Here, for the
   * comparisons EntityVisuals makes itself (a summary against a badge, a
   * summary against another summary, the absorb sweep); and in
   * `placementItems`, which projects once so that every distance the solver
   * computes — `conflicts`, the spatial hash, the lone-deferral pull-back —
   * inherits it without a single call site of its own having to remember.
   * One meaning: "how far apart are these two on the glass".
   */
  private drawnDistance(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): number {
    return Math.hypot(ax - bx, ay - by, az - bz);
  }

  /**
   * The pass's clearance numbers, or null if the projection is not usable this
   * frame.
   *
   * Everything the solver consumes is in GUI PIXELS, which is what "too close
   * to read" and "too close to tap" both actually mean. It used to convert them
   * DOWN into world units and measure there; the projection does that job now
   * and does it correctly on all three axes, so the conversion is gone and
   * `reach`, `gap` and `minSep` are simply the numbers badgeMetrics states.
   * `pxPerWorld` is still returned — the PROJECTION needs it even though none
   * of the clearances do.
   */
  private screenClearance(
    shown: ShownLabel[],
  ): { pxPerWorld: number; gap: number; minSep: number; allow: number; basis: ViewBasis } | null {
    const pxPerWorld = this.quantisedPixelsPerWorldUnit(shown);
    if (!(pxPerWorld > 0)) return null;
    const scale = this.effectiveScale();
    // The accessibility floor decays with the FAR-ZOOM CAP only.
    //
    // Not with the user's size preference, which 2.232.0 got wrong. Folding
    // iconUserScale in here meant raising the icon size raised the floor as
    // well as the badge, so a single quarter-step took the required centre
    // separation from 39 to 49 CSS px and whole rooms collapsed to their chip
    // in one click. An accessibility floor is a fixed quantity on the glass:
    // it is the tap target, and the tap target does not grow because someone
    // asked for bigger icons. Growing badges already demand more room through
    // the reach term, which is the honest reason for them to group.
    const shrink = Math.min(1, this.iconZoomScale);
    return {
      pxPerWorld,
      gap: this.metrics.minGapPx * scale,
      minSep: this.metrics.minCentrePitchPx * this.cssToGui() * shrink,
      allow: 1 - GROUP_OVERLAP_ALLOW_WIDTHS,
      basis: this.currentViewBasis(),
    };
  }

  /**
   * Convert this pass's badges into solver input, into a grow-only pool.
   *
   * `reach` is the badge's own drawn half-width, straight from labelBoxes — no
   * conversion, because the anchors arrive on the glass too. That is the whole
   * simplification the projection buys: the quantity the subsystem turns on is
   * now the same number the renderer draws with, and labelBoxes is also where
   * the renderer's geometry comes from, so a layout decision cannot be made
   * about a badge of a different size from the one on screen.
   *
   * The PROJECTION happens here, once per badge, and every distance the solver
   * goes on to compute inherits it — see drawnDistance. The result is also
   * written back onto the ShownLabel, because placeEntityGroups needs the same
   * plane coordinates and projecting twice is how two spaces drift apart.
   *
   * ── AND THE BOX IS CENTRED WHERE IT IS DRAWN, NOT ON THE ANCHOR ───────
   * `boxes[i].cy` is added in. A badge HANGS above its anchor, and by how
   * much depends on the badge: the classic style sits 56 CSS px up without a
   * value readout and 45.5 with one, so two neighbours in different states are
   * drawn 10.5 CSS px apart vertically — more than 20 render px on a retina
   * tablet — while a test that compared their ANCHORS called them level.
   *
   * The file's oldest rule is that a layout decision may never use different
   * geometry from the renderer. That was only ever enforced for a badge's SIZE.
   * Its POSITION was exempt by omission, which is the same bug in a second
   * place, and 2.287.0's screen-space counters are what made it visible.
   */
  private placementItems(
    shown: ShownLabel[],
    boxes: { halfW: number; halfH: number; cy: number }[],
    clearance: { pxPerWorld: number; allow: number; basis: ViewBasis },
  ): PlacementItem[] {
    const pool = this.placeItems;
    const focus = this.focusedRooms;
    const k = clearance.pxPerWorld;
    const p = this.projPlane;
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      let it = pool[i];
      if (!it) {
        it = { sx: 0, sy: 0, sz: 0, reach: 0, rank: 0, sortKey: "", category: "", room: "", exempt: false };
        pool[i] = it;
      }
      projectToView(clearance.basis, s.wx, s.wy, s.wz, p);
      s.sx = p.px * k; s.sy = p.py * k + boxes[i].cy; s.sz = p.pz * k;
      it.sx = s.sx; it.sy = s.sy; it.sz = s.sz;
      it.reach = boxes[i].halfW * clearance.allow;
      it.rank = badgeRank(s.lbl.type, s.lbl.category);
      it.sortKey = s.id;
      // Tiebreak only, never a gate — see PlacementItem.category.
      it.category = s.lbl.category;
      it.room = roomKey(this.roomOf(s.id));
      it.exempt = focus.has(it.room);
    }
    pool.length = shown.length;
    return pool;
  }

  /**
   * Project a world point into this pass's plane, in GUI pixels, shaped as the
   * `sx`/`sy`/`sz` a PendingEntityGroup carries.
   *
   * The ONE way a world position becomes a group's placement coordinate. A card
   * is DRAWN at its members' world centroid and MEASURED at the projection of
   * that same point, and because the projection is affine those are the same
   * point — the plane centroid of the members IS the projection of their world
   * centroid. Never accumulate plane coordinates in parallel with the world
   * ones; that is two computations that can drift where there should be one.
   */
  private planeOf(
    clearance: { pxPerWorld: number; basis: ViewBasis },
    x: number, y: number, z: number,
  ): { sx: number; sy: number; sz: number } {
    const p = projectToView(clearance.basis, x, y, z, this.projPlane);
    const k = clearance.pxPerWorld;
    return { sx: p.px * k, sy: p.py * k, sz: p.pz * k };
  }

  /**
   * `?debug`-only: one line describing what this pass DECIDED, emitted only
   * when the decision changes.
   *
   * Written because the question "why did that room collapse into a chip"
   * could not be answered from any log this app produced. The only signal was
   * `pickBadgeAt`'s `visible=3/90`, which is the END of the pipeline and
   * conflates four independent gates — the category/floor/enabled cull, the
   * behind-the-camera gate, the solver, and the chips — so a report of
   * "everything grouped and there is obviously room" could not be told from
   * "everything is on the other floor". Each gate is now its own number.
   *
   * `rung` is the quantised pixels-per-world-unit the solve actually ran on,
   * and it is the important one: placement is allowed to change when the rung
   * changes and forbidden from changing when it does not. Two lines with the
   * same rung and different verdicts are a purity violation — the exact class
   * of bug six rewrites of this subsystem died of — and no log before this one
   * could show it.
   *
   * Emitted on CHANGE only, so panning at a fixed zoom prints nothing at all.
   * That silence is itself the assertion.
   */
  private logPlacement(
    shown: ShownLabel[],
    clearance: {
      pxPerWorld: number; gap: number; minSep: number; basis: ViewBasis;
    } | null,
    stats: PlacementStats | null,
    placed: PendingEntityGroup[],
  ): void {
    if (!clearance || !stats) { this.lastPlaceLog = ""; return; }
    let behind = 0, drawn = 0;
    for (const s of shown) {
      if (!s.inFront) behind++;
      if (s.lbl.container.isVisible) drawn++;
    }
    const chips: string[] = [];
    for (const [k, on] of this.roomClustered) if (on) chips.push(k);
    chips.sort();
    // Sorted so two frames with identical content produce identical text —
    // otherwise Map iteration order would make this log its own noise source.
    const groups = placed
      .map((g) => `${g.room}:${g.members.length}`)
      .sort()
      .join(", ");
    // How many summaries drew a CARD of each size, against how many drew a
    // count. "every group of 2-4 shows its devices" is a claim, and this is the
    // number that makes it checkable: `cards=` must account for every `:2`,
    // `:3` and `:4` in the list beside it, and `count=` for nothing below five.
    const bySize = new Map<number, number>();
    let counts = 0;
    let split = 0;
    for (const g of placed) {
      const cells = this.drawnCells(g, g.members.length);
      if (cells >= 2) {
        bySize.set(cells, (bySize.get(cells) ?? 0) + 1);
        if (this.cardOf(cells).cards.length > 1) split++;
      } else counts++;
    }
    const cardSizes = [...bySize.entries()].sort(([a], [b]) => a - b)
      .map(([n, c]) => `${n}x${c}`).join(",") || "-";
    const line =
      `place rung=${clearance.pxPerWorld.toFixed(3)} icon=${this.iconUserScale.toFixed(2)}x`
      + ` zoom=${this.iconZoomScale.toFixed(2)} gapPx=${clearance.gap.toFixed(1)}`
      + ` sepPx=${clearance.minSep.toFixed(1)}`
      + ` sinTilt=${clearance.basis.sinPhi.toFixed(3)} az=${clearance.basis.ax.toFixed(3)}`
      + ` metric=${clearance.basis.mode}`
      + ` | badges=${this.labels.size} eligible=${shown.length} behind=${behind} drawn=${drawn}`
      + ` | piles=${stats.piles} exempt=${stats.exempt} accepted=${stats.accepted}`
      + ` deferred=${stats.deferred} pulledBack=${stats.pulledBack}`
      + ` | groups=${placed.length}/${stats.buckets} cross=${stats.crossRoom}`
      + ` cards=${cardSizes} counts=${counts}${split ? `/${split}split` : ""}`
      + (this.absorbed ? ` absorbed=${this.absorbed}` : "")
      + (this.focusPairs ? ` focusGroups=${this.focusPairs}` : "")
      // WHY the chips exist, not just how many. A "the whole villa chipped at
      // one zoom" report is unanswerable from a count: three different rules
      // produce a chip and they fail in opposite directions under zoom.
      // Always printed, including the zeroes — a diagnostic that omits its
      // own null result reads as a missing measurement (see the `place` line's
      // other always-on fields).
      + ` | chipWhy: undrawable=${stats.chipUndrawable}`
      + ` degenerate=${stats.chipDegenerate} focus=${this.focusChipped}`
      + ` [${groups}] chips=${chips.length} [${chips.join(", ")}]`;
    if (line === this.lastPlaceLog) return;
    this.lastPlaceLog = line;
    tapDebug(line);
  }

  /**
   * `?debug`-only: re-derive what the pass just decided and complain if it
   * broke one of the rules the whole subsystem rests on.
   *
   * Runs on the real kiosk, where this subsystem's failures have always been
   * reported and never reproduced in dev — the same reasoning tapDebug itself
   * is built on. Costs nothing when the flag is off.
   *
   * The last check is the important one. Placement must be a pure function of
   * world positions, quantised zoom and static rank, and the one place camera
   * or frame state has historically leaked in is ITERATION ORDER — so it
   * re-solves a reversed copy and demands the identical accepted set. Six
   * rewrites of this subsystem died of exactly that class of bug.
   */
  private assertPlacementInvariants(
    shown: ShownLabel[],
    boxes: { halfW: number; halfH: number; cy: number }[],
    clearance: {
      pxPerWorld: number; gap: number; minSep: number; allow: number; basis: ViewBasis;
    },
    /** The summaries that SURVIVED placement — not the ones the solver asked
     *  for. A dropped one still leaves its members marked as covered. */
    groups: readonly PendingEntityGroup[],
    /** The chips that SURVIVED the same pass, so the tier of last resort is
     *  checked against the tiers it outranks — see CHIP_COLLISION. */
    chips: readonly RoomChip[],
    /** The renderer's OWN view-projection matrix and viewport, passed in
     *  rather than re-derived or stashed on `this`. This method is the one
     *  place in the file allowed to know what actually got painted, and
     *  hiding that in instance state is how it would stop being obvious. */
    tm: Matrix,
    vp: Viewport,
  ): void {
    const items = this.placementItems(shown, boxes, clearance);

    // ── OVERLAP, MEASURED IN THE SPACE A PERSON ACTUALLY SEES ────────────
    // What used to be here fed `placementItems` straight back into
    // `conflicts` — the same items, the same predicate, the same gap and
    // minSep the solver had satisfied a few lines earlier. That is a
    // tautology: it could not fail whatever the screen looked like, and for
    // as long as it existed it reported a clean layout over screenshots full
    // of badges and cards drawn on top of each other. An assertion that
    // restates its subject's own conclusion is worse than no assertion,
    // because it is read as evidence.
    //
    // Everything below is measured from `Vector3.ProjectToRef` — the TRUE
    // perspective projection the GUI layer draws through, which cullLabels
    // has always computed and, until now, never read (ShownLabel.x/y were
    // dead fields; `tsc` does not police unused interface members). It shares
    // no arithmetic at all with the solver, which is the only reason it is
    // able to disagree with it.
    //
    // Everything is in RENDER pixels and that is commensurable by
    // construction: Vector3.Project works in the global viewport, and
    // effectiveScale() carries cssToGui() — the render-pixel conversion —
    // so `boxes` and the card layout are already in the same space as `p`.
    interface ScreenBox { cx: number; cy: number; hw: number; hh: number }
    const onScreen = (b: ScreenBox) =>
      b.cx + b.hw >= vp.x && b.cx - b.hw <= vp.x + vp.width
      && b.cy + b.hh >= vp.y && b.cy - b.hh <= vp.y + vp.height;
    // Ink on ink. No gap, no minimum pitch, no tolerance: two things either
    // cover the same pixels or they don't, and that is the one claim about
    // this subsystem nobody can argue with from a screenshot.
    const hits = (a: ScreenBox, b: ScreenBox) =>
      Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh;

    const scale = this.effectiveScale();
    const focus = this.focusedRooms;
    const p = new Vector3();

    // `container.isVisible` rather than a reconstruction of the same decision
    // from entityGrouped/roomClustered: the renderer's own answer to "is this
    // drawn", read after the visibility loop has run.
    const badgeBoxes: ScreenBox[] = [];
    const badgeExempt: boolean[] = [];
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      if (!s.inFront || !s.lbl.container.isVisible) continue;
      const b: ScreenBox = {
        cx: s.x, cy: s.y + boxes[i].cy, hw: boxes[i].halfW, hh: boxes[i].halfH,
      };
      if (!onScreen(b)) continue; // off-screen overlap is not something anyone sees
      badgeBoxes.push(b);
      badgeExempt.push(focus.has(roomKey(this.roomOf(s.id))));
    }

    // A card is drawn ENTIRELY ABOVE its anchor — updateEntityGroups sets
    // linkOffsetYInPixels = -(lay.height / 2) * scale so the card's bottom
    // edge lands on the anchor, exactly as a badge's does. The LAYOUT models
    // the same card as a disc centred ON the anchor (cardHalfOf), a documented
    // asymmetry; using the layout's model here would report overlaps nobody
    // can see and miss the ones they can, which is the whole failure mode this
    // method just stopped repeating.
    const cardBoxes: ScreenBox[] = [];
    const cardInk: ScreenBox[] = [];
    const cardFocused: boolean[] = [];
    for (const g of groups) {
      const lay = this.layoutOf(g, g.members.length);
      p.set(g.wx, g.wy, g.wz);
      Vector3.ProjectToRef(p, Matrix.IdentityReadOnly, tm, vp, p);
      if (!(p.z >= 0 && p.z <= 1)) continue;
      const hw = (lay.width / 2) * scale;
      const hh = (lay.height / 2) * scale;
      const box: ScreenBox = { cx: p.x, cy: p.y - hh, hw, hh };
      if (!onScreen(box)) continue;
      cardBoxes.push(box);
      // The square INSCRIBED in the card — "is this badge under my ink", the
      // question absorb exists to answer, and a different question from "do we
      // clear each other". Same distinction cardInscribedHalf draws.
      const inner = Math.min(hw, hh);
      cardInk.push({ cx: box.cx, cy: box.cy, hw: inner, hh: inner });
      cardFocused.push(g.focused);
    }

    // (a) Drawn badge vs drawn badge. The headline number.
    //
    // The accessibility PITCH is counted separately from visual overlap on
    // purpose: they mean different things (one is a tap-target rule, the other
    // is legibility) and one of them is much more likely to be non-zero for a
    // legitimate reason. Rolled together, the first excusable case would
    // teach whoever reads this to ignore the line.
    //
    // Focused-room badges get their own bucket rather than being dropped:
    // their overlap is DELIBERATE (the exemption stacks them, which is exactly
    // why pairFocusedRoom exists), so mixing them in would poison the number
    // that matters while hiding the one case where the pairing failed.
    const minSepPx = clearance.minSep;
    let overlaps = 0, tooClose = 0, focusOverlaps = 0;
    for (let i = 0; i < badgeBoxes.length; i++) {
      for (let j = i + 1; j < badgeBoxes.length; j++) {
        const a = badgeBoxes[i], b = badgeBoxes[j];
        const ink = hits(a, b);
        if (badgeExempt[i] || badgeExempt[j]) { if (ink) focusOverlaps++; continue; }
        if (ink) overlaps++;
        else if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < minSepPx) tooClose++;
      }
    }
    if (overlaps) tapDebug(`PLACEMENT: ${overlaps} drawn badge pair(s) OVERLAP on screen`);
    if (tooClose) tapDebug(`PLACEMENT: ${tooClose} drawn badge pair(s) closer than the ${Math.round(minSepPx)}px tap pitch`);
    if (focusOverlaps) tapDebug(`PLACEMENT: ${focusOverlaps} overlapping pair(s) inside the FOCUSED room (expected; pairFocusedRoom's leftovers)`);

    // (b) Drawn badge vs summary card, split in two — and the split is what
    // makes the line actionable. Only the first is a violation: a card MAY be
    // drawn over a badge outside its ink, because gating a card's existence on
    // its full width sends groups to room chips instead (see `fits`). A single
    // undifferentiated counter would be permanently non-zero for a documented
    // reason, and a permanently non-zero assertion is a disabled one.
    let buried = 0, overhung = 0;
    for (let k = 0; k < cardBoxes.length; k++) {
      if (cardFocused[k]) continue; // skips `fits` by design — see PendingEntityGroup.focused
      for (let i = 0; i < badgeBoxes.length; i++) {
        if (badgeExempt[i]) continue;
        if (hits(cardInk[k], badgeBoxes[i])) buried++;
        else if (hits(cardBoxes[k], badgeBoxes[i])) overhung++;
      }
    }
    if (buried) tapDebug(`PLACEMENT: ${buried} drawn badge(s) BURIED under a summary's ink`);
    if (overhung) tapDebug(`PLACEMENT: ${overhung} drawn badge(s) under a card's overhang (allowed)`);

    // (c) Summary vs summary. This one must be EXACTLY ZERO, always — it is
    // the single clearance guarantee `fits` makes without qualification, and
    // nothing has ever verified it. Focused groups are excluded because they
    // never went through `fits` at all.
    let summaryOverlaps = 0;
    for (let i = 0; i < cardBoxes.length; i++) {
      if (cardFocused[i]) continue;
      for (let j = i + 1; j < cardBoxes.length; j++) {
        if (cardFocused[j]) continue;
        if (hits(cardBoxes[i], cardBoxes[j])) summaryOverlaps++;
      }
    }
    if (summaryOverlaps) tapDebug(`PLACEMENT: ${summaryOverlaps} summary pair(s) OVERLAP on screen — fits() promises this cannot happen`);

    // (d) Room chip vs everything the chip outranks. A chip is the tier of
    // last resort and nothing used to test it against anything but another
    // chip — see CHIP_COLLISION. Measured in TRUE perspective like every other
    // counter here, against the chip's DRAWN box (it is lifted by half its own
    // height, exactly as badges and cards are). Focused-room badges are
    // excluded: they are exempt from the escalation pass by design, because
    // tapping a room must not be able to make that room vanish.
    let chipHits = 0;
    for (const c of chips) {
      const box: ScreenBox = { cx: c.x, cy: c.y - c.halfH, hw: c.halfW, hh: c.halfH };
      if (!onScreen(box)) continue;
      for (let i = 0; i < badgeBoxes.length; i++) {
        if (!badgeExempt[i] && hits(box, badgeBoxes[i])) chipHits++;
      }
      for (let k = 0; k < cardBoxes.length; k++) {
        if (!cardFocused[k] && hits(box, cardBoxes[k])) chipHits++;
      }
    }
    if (chipHits) tapDebug(`PLACEMENT: ${chipHits} drawn badge(s)/card(s) OVERLAP a room chip`);

    // A badge never moves: the layout writes one shared lift and no X offset.
    let moved = 0;
    for (const s of shown) if (s.lbl.container.linkOffsetXInPixels !== 0) moved++;
    if (moved) tapDebug(`PLACEMENT: ${moved} badge(s) have a non-zero X offset`);

    // A chipped room hands over ALL of its badges, never a subset.
    let leaked = 0;
    for (let i = 0; i < shown.length; i++) {
      if (!this.roomClustered.get(roomKey(this.roomOf(shown[i].id)))) continue;
      if (shown[i].lbl.container.isVisible) leaked++;
    }
    if (leaked) tapDebug(`PLACEMENT: ${leaked} badge(s) visible inside a chipped room`);

    // ── EVERY BADGE IS DRAWN, INSIDE A DRAWN SUMMARY, OR CHIPPED ─────────
    // The one whole-system promise: a device the map knows about is always
    // reachable. `entityGrouped` marks a badge as "hidden because a summary
    // stands for it", but a summary can be DROPPED after the fact — a
    // cross-room group whose other room chipped is removed at the end of
    // placeEntityGroups while its members stay marked, so a badge in the room
    // that did NOT chip ends up hidden with nothing in its place. There has
    // never been a check for it; the 2x2 card makes the path more reachable,
    // because a bigger card fails `fits` more often and every failure
    // escalates a room.
    const covered = new Set<string>();
    for (const g of groups) for (const i of g.members) covered.add(shown[i].id);
    let orphaned = 0;
    for (const s of shown) {
      if (s.lbl.container.isVisible) continue;
      if (!s.inFront) continue; // off screen is not the same as unreachable
      if (this.roomClustered.get(roomKey(this.roomOf(s.id)))) continue;
      if (covered.has(s.id)) continue;
      orphaned++;
    }
    if (orphaned) {
      tapDebug(`PLACEMENT: ${orphaned} badge(s) hidden with no summary and no chip`);
    }

    // "Nothing is drawn inside a summary's ink" — the invariant the absorb
    // phase exists to establish — used to be checked separately here, via
    // drawnDistance. That made it circular in exactly the way the badge-pair
    // check was: absorb decides with drawnDistance, so re-asking drawnDistance
    // could only ever agree. It is check (b)'s `buried` counter now, measured
    // against the card's drawn box.

    // Order independence — the purity guard.
    const reversed = items.slice().reverse();
    // The SAME drawableMax as the live solve, or this guard verifies the
    // purity of a function that does not ship.
    const a = solvePlacement(
      items, clearance.gap, clearance.minSep, BADGE_PLACEMENT, this.debugScratchA,
      this.drawableMax(),
    );
    const idsA = new Set<string>();
    for (let i = 0; i < items.length; i++) if (a.accepted[i]) idsA.add(items[i].sortKey);
    const b = solvePlacement(
      reversed, clearance.gap, clearance.minSep, BADGE_PLACEMENT, this.debugScratchB,
      this.drawableMax(),
    );
    const idsB = new Set<string>();
    for (let i = 0; i < reversed.length; i++) if (b.accepted[i]) idsB.add(reversed[i].sortKey);
    let differing = idsA.size !== idsB.size;
    if (!differing) for (const id of idsA) if (!idsB.has(id)) { differing = true; break; }
    if (differing) {
      tapDebug(`PLACEMENT: ORDER DEPENDENT — ${idsA.size} vs ${idsB.size} accepted on a reversed input`);
    }
  }



  /**
   * Screen pixels per world unit at the camera's working distance, snapped to
   * discrete zoom steps (GROUP_ZOOM_STEPS_PER_DOUBLING).
   *
   * Deliberately reads the ORBIT RADIUS on the bird's-eye camera rather than
   * any per-badge distance: orbiting and panning both leave the radius
   * untouched, which is precisely the invariance grouping needs.
   *
   * The first-person camera has no orbit radius, so it uses the MEDIAN
   * distance to the badges themselves. That is measured from real scene data
   * rather than assumed, is likewise unchanged by looking around on the spot
   * (turning doesn't move you, so no distance changes), and shifts smoothly
   * as you actually walk — which is the correct behaviour there: walking up
   * to a group of devices SHOULD separate them, the same way zooming does.
   * Median rather than mean so one far-off badge can't skew the whole scale.
   */
  private quantisedPixelsPerWorldUnit(shown: ShownLabel[], cssPixels = false): number {
    const cam = this.scene.activeCamera;
    if (!cam) return 0;
    const engine = this.scene.getEngine();
    // ⚠️ RENDER pixels by default, CSS pixels for any caller that compares this
    // ACROSS FRAMES — and that distinction is a reported bug.
    //
    // The render height is not a property of the camera. The resolution valve
    // moves it every time the camera starts and stops moving (SceneManager's
    // sharpen/unsharpen), so on a device whose devicePixelRatio exceeds
    // HW_START_CAP the same pose measures 1.5x more pixels-per-world-unit while
    // idle than while being dragged — a phone at dpr 3 sharpens to 1/3 and
    // moves at 1/2.
    //
    // Within ONE frame that is harmless and must stay: the badge boxes it is
    // compared against are render pixels too, so both sides scale together and
    // `fits` is unaffected. It is fatal ACROSS frames. The focus retention rule
    // stamps this value when a room is focused and drops the focus once the
    // view gets farther — so the stamp was taken sharpened, the first frame of
    // the pinch that followed was un-sharpened, and the 1.5x drop read as
    // "zoomed out" and destroyed the exemption before any zoom-in could offset
    // it. Symptom: tapping a room in the menu showed its devices, starting to
    // zoom IN collapsed them to the very chip that had just been expanded, and
    // they only came back a rung or two later once the badges genuinely fitted
    // — entities, chip, entities, going one direction. Reproduces only where
    // dpr > HW_START_CAP, which is why a dpr-1.6 laptop never showed it.
    const vpH = cssPixels
      ? engine.getRenderHeight() * engine.getHardwareScalingLevel()
      : engine.getRenderHeight();
    const fov = cam.fov || 0.8;
    // Duck-typed rather than instanceof-checked so this file needs no import
    // of the concrete camera classes: only ArcRotateCamera exposes `radius`.
    const orbitRadius = (cam as unknown as { radius?: number }).radius;
    let dist = typeof orbitRadius === "number" ? orbitRadius : 0;
    if (!(dist > 0)) {
      if (shown.length === 0) return 0;
      // Pooled: this runs on EVERY camera-moving frame in first person, and a
      // fresh .map().sort() there allocated an array per frame for a single
      // median.
      if (this.distPool.length < shown.length) this.distPool = new Float64Array(shown.length * 2);
      const ds = this.distPool;
      for (let i = 0; i < shown.length; i++) {
        ds[i] = Math.hypot(shown[i].wx - cam.position.x, shown[i].wz - cam.position.z);
      }
      const view = ds.subarray(0, shown.length);
      view.sort();
      dist = view[shown.length >> 1];
    }
    if (!(dist > 0) || vpH <= 0) return 0;
    const raw = vpH / (2 * dist * Math.tan(fov / 2));
    if (!(raw > 0)) return 0;
    const q = GROUP_ZOOM_STEPS_PER_DOUBLING;
    return Math.pow(2, Math.round(Math.log2(raw) * q) / q);
  }

  /** Each label's collision box in screen px, relative to its anchor point —
   *  ONE definition, shared by the placement solver, the room-cluster
   *  chips and solveRoomZoomRadius, so none can disagree about how much room a
   *  badge actually needs. */
  /** `out`/`pool` default to the render loop's own reused buffers. The one
   *  caller OUTSIDE the frame path (solveRoomZoomRadius, driven by the UI's
   *  "zoom to this room") passes its own so it can never clobber a layout pass
   *  mid-flight — the two do not currently interleave, but sharing a mutable
   *  buffer across a UI-driven method and the render loop is precisely the
   *  coupling that stops being true after some later edit. */
  private labelBoxes(
    shown: { lbl: LabelControls }[],
    out: { halfW: number; halfH: number; cy: number }[] = this.boxes,
    pool: { halfW: number; halfH: number; cy: number }[] = this.boxesPool,
    /** Measure at a scale OTHER than the live one. Only "zoom to this room"
     *  passes this, and it must: see measurementScale(). */
    scaleOverride?: number,
  ): { halfW: number; halfH: number; cy: number }[] {
    const scale = scaleOverride ?? this.effectiveScale();
    const card = this.isCardStyle();
    const m = this.metrics;

    // Classic layout (unscaled, anchor at 0, y grows downward, hangs ABOVE):
    //   badge  → centre −56, half 20         (BADGE_DIAMETER 40, container 76 tall)
    //   pill   → centre −24, half 9          (VALUE_CHIP_HEIGHT 18, under the badge)
    // Card layout: one horizontal card (CARD_HEIGHT tall inside a
    // CARD_LABEL_HEIGHT container), hanging above the anchor; width = the
    // glyph (rendered at the card height) + left pad + any inline value.
    // Filled in place from a grow-only pool (see boxesPool) instead of a fresh
    // .map() array of fresh objects every frame — same values, no allocation
    // in the steady state.
    const boxes = out;
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      let b = pool[i];
      if (!b) { b = { halfW: 0, halfH: 0, cy: 0 }; pool[i] = b; }
      boxes[i] = b;
      if (card) {
        const hasVal = s.lbl.valueWrap.isVisible;
        const valW = hasVal
          ? s.lbl.valueText.text.length * m.cardValueCharPx + m.cardValuePadPx
          : 0;
        const cardW = m.cardPadLeftPx + m.cardHeightPx + valW;
        b.halfW = (cardW / 2) * scale;
        b.halfH = (m.cardHeightPx / 2 + 1) * scale;
        // The card IS the container now, so its centre is the container's
        // centre: exactly half a card above the anchor. No magic constant to
        // approximate a gap that no longer exists.
        b.cy = -(m.cardHeightPx / 2) * scale;
        continue;
      }
      const hasPill = s.lbl.valueWrap.isVisible;
      // Reserve the WITH-PILL footprint (halfH/cy) for any type that can EVER
      // grow one (see compactValue) even while it currently has none — not
      // just when hasPill is true right now. Two fixtures mounted close
      // together in the model (e.g. a ceiling fan + its own temperature
      // sensor) sit fine when both are pill-less, but the moment the fan
      // (pill-capable) turns off and drops its pill, ITS box shrank while the
      // sensor's didn't, so they got pushed apart less than before and ended
      // up nearly touching/overlapping — reading as "the badge got smaller"
      // when it was really "got less clearance from its neighbour". Sizing
      // the box off pill-CAPABILITY instead of current visibility keeps the
      // same spacing regardless of which of a pair happens to have a reading
      // at this exact moment. Only the WIDTH still adapts to the actual pill
      // text when one is shown (a wide value still needs proportionally more
      // horizontal room than a narrow one).
      const pillCapable = PILL_CAPABLE_TYPES.has(s.lbl.type);
      const pillHalfW = hasPill
        ? (s.lbl.valueText.text.length * m.pillValueCharPx + m.pillValuePadPx) / 2
        : 0;
      b.halfW = Math.max(m.badgeDiameterPx / 2, pillHalfW) * scale;
      b.halfH = (pillCapable ? m.classicHalfHWithPillPx : m.classicHalfHPx) * scale;
      // Box centre Y relative to the anchor.
      b.cy = (pillCapable ? m.classicCyWithPillPx : m.classicCyPx) * scale;
    }
    boxes.length = shown.length;
    return boxes;
  }

  // ── Entity groups (tier 4 — several of a room's badges as one) ────────────

  /**
   * Decide which pending entity groups may actually be drawn, and drop the
   * rest to their room's chip.
   *
   * A group badge is a badge: it has to clear everything a badge has to clear,
   * or it is just a new way to draw two things on top of each other — the
   * exact failure the whole subsystem exists to prevent. It is checked against
   * the three things that can be in its way, all in WORLD space against the
   * quantised zoom, like every other decision here:
   *
   *   * badges that were ACCEPTED — every one of them is at its own anchor,
   *     because nothing in this file moves a badge, so the anchor is the
   *     position to test and there is no seat to look up;
   *   * other groups, in a fixed order so each pair meets exactly once.
   *
   * The centroid being inside the pile's own hull makes a collision unlikely
   * but not impossible — a point interior to a hull can sit closer to an
   * outside badge than any vertex does — so it is checked rather than assumed.
   *
   * Mutates `this.entityGrouped` (which badges hide) and `this.roomClustered`
   * (which rooms escalate), and prunes `pending` in place to what survived.
   */
  private placeEntityGroups(
    shown: ShownLabel[],
    boxes: { halfW: number; halfH: number; cy: number }[],
    pending: PendingEntityGroup[],
    /** This pass's own clearance — passed in rather than re-derived, so the
     *  absorb sweep re-projects a moved centroid through exactly the basis and
     *  rung the members were projected with. */
    clearance: { pxPerWorld: number; basis: ViewBasis },
  ): void {
    if (pending.length === 0) return;
    const pxPerWorld = clearance.pxPerWorld;
    const scale = this.effectiveScale();
    if (pxPerWorld <= 0) {
      // No usable projection this frame — fall back to the tier that needs
      // none rather than drawing groups at unverified positions.
      for (const g of pending) for (const k of g.roomKeys) this.roomClustered.set(k, true);
      pending.length = 0;
      return;
    }
    const gapPx = this.metrics.minGapPx * scale;
    const allow = 1 - GROUP_OVERLAP_ALLOW_WIDTHS;
    // Everything below compares PIXELS to PIXELS. Groups and badges alike
    // arrive already projected onto this pass's view plane (see
    // badgeProjection), which is the space both of these comparisons — a
    // summary against a badge, a summary against another summary — are
    // actually asking about: what overlaps ON SCREEN.
    // The larger of the two half-extents, because a neighbour can lie in any
    // direction and this is a radial test rather than a box overlap.
    const halfOf = (i: number) => Math.max(boxes[i].halfW, boxes[i].halfH);
    // A group is drawn at the badge scale and at the badge size (see
    // summaryMetrics), so this measures it with the same numbers the renderer
    // uses — no second scale to keep in step. There used to be one: the group
    // was floored at CLUSTER_MIN_SCALE while badges took the 0.7 far-zoom cap,
    // which made a summary bigger than the badges it replaced AND forced this
    // method to reason in a scale of its own. Both went together.
    const sm = this.summaryMetrics();
    const squareHalf = (sm.size / 2) * scale * allow;
    // From the SAME function that draws it — the width a group is TESTED at
    // has to be the width it is DRAWN at, which is this file's oldest rule.
    // ── THE CIRCUMSCRIBED RADIUS, not half the width ────────────────────
    // This test is a DISC — it works in world distance scaled by the quantised
    // zoom, and knowing which way a neighbour lies relative to the card would
    // need the camera, the one dependency this subsystem is built without. A
    // disc of half the WIDTH is honest for a card that is wider than it is
    // tall and badly dishonest for a square one: two 2x2 cards two units apart
    // on the diagonal would each be 1.41 units away on both axes and overlap
    // in both, while the test called them clear. `hypot` is the smallest disc
    // that actually contains the card.
    //
    // "A summary must clear other summaries" is the one thing this test still
    // promises absolutely (see `fits`), so it is the one place that cannot be
    // approximated downward.
    const cardHalfOf = (g: PendingEntityGroup) => {
      const lay = this.layoutOf(g, g.members.length);
      return (Math.hypot(lay.width, lay.height) / 2) * scale * allow;
    };
    /**
     * The plane Y where the card's INK actually is: its anchor lifted by half
     * its OWN height, exactly as updateEntityGroups sets linkOffsetYInPixels.
     *
     * Two cards of different heights are lifted by different amounts, so a test
     * that compared their ANCHORS was measuring points up to half a card apart
     * from where the ink is. Circumscribed discs at the anchors are no defence:
     * shifting one box relative to the other closes the gap the discs were
     * counting on, and 2.287.0's counters found real pairs doing it — up to
     * five at once on a phone, against a promise `fits` makes absolutely.
     *
     * Same rule as the badge's `cy` (see placementItems): measure the card
     * where it is drawn.
     */
    const cardCentreY = (g: PendingEntityGroup) => {
      const lay = this.layoutOf(g, g.members.length);
      return g.sy - (lay.height / 2) * scale;
    };
    /**
     * The largest disc that fits INSIDE the card — "is this badge underneath
     * my ink", which is a different question from "do we clear each other".
     *
     * It has to be the inscribed radius and not `cardHalfOf`'s circumscribed
     * one. A 2x2 card's circumscribed disc is 1.41 units while its ink only
     * reaches 1.0 on either axis, and `fits` accepts a badge from about 1.0
     * plus a gap — so absorbing at 1.41 would swallow badges that are visibly
     * clear of the card. That is deleting devices from the map to fix a bug
     * about the opposite. Inscribed leaves exactly a `gapPx`-wide annulus
     * between "absorbed" and "fits passes", which is the right amount of
     * nothing.
     */
    const cardInscribedHalf = (g: PendingEntityGroup) => {
      const lay = this.layoutOf(g, g.members.length);
      return (Math.min(lay.width, lay.height) / 2) * scale * allow;
    };
    // A group is measured against OTHER GROUPS at the width it is actually
    // DRAWN at — the file's oldest rule. Against badges it is measured at the
    // count's box instead; see `fits` for why that asymmetry is deliberate.
    const groupHalf = (g: PendingEntityGroup) =>
      (this.drawnCells(g, g.members.length) >= 2 ? cardHalfOf(g) : squareHalf);

    // Fixed order (the key is stable and total), so which of two conflicting
    // groups survives never depends on the order the solver emitted them in.
    // Byte order, not localeCompare: collation is environment-dependent, and
    // two clients must resolve the same conflict the same way.
    pending.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const placed: PendingEntityGroup[] = [];
    /**
     * Does this group clear every drawn badge, and every OTHER placed group, at
     * whatever width `g.pair` currently asks for?
     *
     * `others` is passed rather than closed over because this runs in two
     * passes and they need different sets — see below.
     */
    const focus = this.focusedRooms;
    const fits = (g: PendingEntityGroup, others: PendingEntityGroup[]): boolean => {
      const mineHalf = groupHalf(g);
      // ── A SUMMARY MUST CLEAR OTHER SUMMARIES; IT MAY OVERLAP A BADGE ─────
      // Against BADGES a group is measured at the count's single-badge box,
      // not at the card it draws. That is a deliberate, stated cost, and it
      // grew when the card gained a second row: a 2x2 card occupies four badge
      // boxes and reaches two badge-heights above its anchor, so it can be
      // drawn over a badge that this test called clear.
      //
      // It stays anyway. Gating a card's EXISTENCE on its full box sends
      // groups to their room's chip that a count would have seated, which is
      // the outcome this whole tier exists to avoid — one visible regression
      // traded for a worse one. What makes it survivable is that a covered
      // badge is still REACHABLE: SceneManager's tap and long-press paths both
      // ask the badges before answering for a card cell that is empty.
      //
      // (An earlier version of this comment justified the asymmetry with "the
      // card is half as tall, so most of what it refused was a neighbour above
      // or below it". That was true of a one-row card and is not true of a
      // square one; it is corrected rather than left standing beside the
      // opposite fact.)
      //
      // Two SUMMARIES on top of each other is a different matter and is still
      // refused, at the card's circumscribed radius: that is two controls each
      // claiming to stand for the other's devices, and it is the one thing
      // this test still promises absolutely.
      const vsBadge = squareHalf;
      for (let j = 0; j < shown.length; j++) {
        // Only badges that are actually DRAWN can be in the way, and a drawn
        // badge is always at its own anchor because nothing here moves one —
        // so the anchor is the position to test and there is no seat to look
        // up. A badge already behind this or another summary is not on screen;
        // testing it anyway made one room's chip push another room's group to
        // a chip it never needed, an escalation cascade driven by geometry
        // nobody could see. Safe to read both here: every solver decision is
        // final by the time this runs.
        if (this.entityGrouped.has(shown[j].id)) continue;
        if (this.roomClustered.get(roomKey(this.roomOf(shown[j].id)))) continue;
        // A FOCUSED room's badge blocks nobody — the same contract the `others`
        // loop below already honours for focused groups, and the one
        // PlacementItem.exempt states in the solver: "accepted unconditionally,
        // AND never counted as a blocker for anyone else". This loop was the
        // one place it was not honoured, so a focused room could push a
        // NEIGHBOURING room's group to its chip while the focus lasted — the
        // focus renegotiating the rest of the map, which is exactly what the
        // exemption exists to prevent.
        if (focus.has(roomKey(this.roomOf(shown[j].id)))) continue;
        const d = this.drawnDistance(
          g.sx, cardCentreY(g), g.sz, shown[j].sx, shown[j].sy, shown[j].sz);
        if (d < vsBadge + halfOf(j) * allow + gapPx) return false;
      }
      for (const o of others) {
        if (o === g) continue;
        // A focused pair blocks nobody, exactly as the badges it replaces did
        // not (see PlacementItem.exempt). The focus is a deliberate, temporary
        // state and it does not get to renegotiate the rest of the map.
        if (o.focused) continue;
        const d = this.drawnDistance(
          g.sx, cardCentreY(g), g.sz, o.sx, cardCentreY(o), o.sz);
        if (d < mineHalf + groupHalf(o) + gapPx) return false;
      }
      return true;
    };

    // ── ONE PASS. THE WIDTH IS NOT A DECISION ANY MORE ────────────────────
    // A group of two is ALWAYS the full-size card, so there is nothing to
    // upgrade and nothing to decline: one situation, one appearance, one
    // behaviour, everywhere on the map.
    //
    // Two earlier shapes of this are worth remembering, because both were
    // attempts to have it both ways. 2.256.0 asked for the wide card and
    // settled for a smaller one per group, in key order — which let an early
    // group's upgrade demote a later one. 2.257.0 fixed the unfairness with a
    // seat-then-upgrade pass, and 2.259.0 made the fallback a half-scale card
    // rather than a digit. What none of them fixed is that the SAME situation
    // then drew as two visibly different objects depending on how crowded its
    // corner of the villa happened to be, which is not a distinction anybody
    // reading a floor plan can act on. Reported exactly that way, with both
    // forms on screen at once.
    //
    // The cost is stated rather than hidden: a pair card may now OVERLAP a
    // badge where the clearance test would have shrunk it. That test is a DISC
    // of the card's half-WIDTH while the card is half as tall, so most of what
    // it refused was a neighbour directly above or below — rejected on a
    // distance the card does not occupy. It has to be a disc: it works in
    // world distance scaled by the quantised zoom, and knowing which way a
    // neighbour lies relative to the card's long axis would need the camera,
    // which is the dependency this whole subsystem exists without.

    // ── ABSORB: NOTHING IS LEFT DRAWN UNDERNEATH A SUMMARY ───────────────
    // The bug this closes, in full, because it is not obvious and it survived
    // a long time: for a pile of CO-LOCATED devices the solver accepts the
    // highest-ranked one — still drawn, at its own anchor — and defers the
    // rest. The card for those losers is drawn at THEIR centroid, which for a
    // co-located pile is the same world point as the badge still drawn there.
    // `fits` then measured `d = 0` against a requirement in fixed pixels, so
    // `0 < requirement` held at EVERY zoom rung and the card was always
    // refused, escalating the room to its chip.
    //
    // That is why zooming right in on such a room never decluttered it. Two
    // points at the same place project to the same place at any zoom; no rung
    // could ever satisfy the test. Every OTHER refusal in `fits` is a real
    // separation that grows as the camera closes in, which is the behaviour
    // people expect and were not getting.
    //
    // So: a summary swallows the drawn badges that lie inside its own ink,
    // and only those (see cardInscribedHalf). It is the same reasoning as the
    // solver's lone-deferral pull-back — a summary standing on top of a device
    // it does not represent is a lie — applied at the one place that knows how
    // big the summary is actually drawn.
    //
    // Batched per round, then the centroid is recomputed, then swept again:
    // absorbing one at a time would move the centroid mid-round and make the
    // result depend on which candidate was visited first. Membership only ever
    // grows, so this cannot oscillate; the round bound is belt and braces.
    let absorbed = 0;
    for (const g of pending) {
      // Focused groups already take whole piles and skip `fits`, so they have
      // no badge of their own left to sit on — and eating a NEIGHBOURING
      // pile's focused badge is the one thing the focus forbids.
      if (g.focused) continue;
      for (let round = 0; round <= shown.length; round++) {
        const reach = cardInscribedHalf(g);
        const inkY = cardCentreY(g);
        const take: number[] = [];
        for (let j = 0; j < shown.length; j++) {
          if (this.entityGrouped.has(shown[j].id)) continue;
          const rk = roomKey(this.roomOf(shown[j].id));
          if (this.roomClustered.get(rk)) continue;
          if (focus.has(rk)) continue;
          // ── BOX vs BOX, ON EACH AXIS ─────────────────────────────────
          // Burial is a question about two rectangles of ink, and it has to be
          // tested as one. Two earlier shapes of this were both wrong in the
          // same direction and each left the counter non-zero:
          //
          //   the badge's CENTRE against a disc (pre-2.289.0) — a badge
          //   straddling the ink's edge, centre just outside and half of it
          //   inside, was absorbed by nobody: outside this sweep, and inside
          //   the ring `fits` starts refusing at;
          //
          //   the badge's centre against a disc GROWN by the badge's radius
          //   (2.289.0) — better, but a disc still cannot reach the corners of
          //   a square. `cardInk` in assertPlacementInvariants is the square
          //   INSCRIBED in the card, so its corners stand 41% further out than
          //   any disc of the same half-side, and a badge sitting in one was
          //   still drawn half under the ink. That is the 1–4 the counter kept
          //   reporting on both machines after 2.289.0.
          //
          // So: the same axis-aligned test the assertion uses, against the same
          // square, grown per axis by the badge's own half-extents. Expressible
          // for the same reason the chip test is (see CHIP_COLLISION): since
          // 2.287.0 the plane's axes ARE the screen's axes, so "do these two
          // rectangles overlap" is an exact question here, not one a radius has
          // to stand in for.
          //
          // `sz` is the walk camera's depth residual and is identically 0 under
          // the orbit camera, so keeping it as a third axis leaves first person
          // separating down a corridor exactly as it did.
          const dx = Math.abs(g.sx - shown[j].sx);
          const dy = Math.abs(inkY - shown[j].sy);
          const dz = Math.abs(g.sz - shown[j].sz);
          if (dx < reach + boxes[j].halfW
            && dy < reach + boxes[j].halfH
            && dz < reach + halfOf(j)) take.push(j);
        }
        if (take.length === 0) break;
        for (const j of take) {
          g.members.push(j);
          // Claimed immediately, before any `fits` runs — otherwise the badge
          // blocks its own group, and a second group in key order could claim
          // it as well.
          this.entityGrouped.add(shown[j].id);
          const rk = roomKey(this.roomOf(shown[j].id));
          if (!g.roomKeys.includes(rk)) g.roomKeys.push(rk);
        }
        absorbed += take.length;
        // Everything the card reads about itself has to move with its
        // membership. Miss any one of these and the absorbed device is in the
        // group, hidden as a badge, and NOT drawn as a cell — invisible and
        // untappable, which is worse than the overlap this is fixing.
        this.sortCardMembers(shown, g.members);
        // The RAW membership — `gridCells` decides what that draws as. This
        // line shipped as the truncating one: absorb is the only producer that
        // can push a group past the card's capacity, and clamping there would
        // have drawn six of seven devices and left the seventh hidden with no
        // cell to tap.
        g.grid = g.members.length;
        g.roomKeys.sort();
        const primary = this.roomDisplay.get(g.roomKeys[0]) ?? g.roomKeys[0];
        g.room = g.roomKeys.length > 1 ? `${primary} +${g.roomKeys.length - 1}` : primary;
        let wx = 0, wy = 0, wz = 0;
        for (const i of g.members) { wx += shown[i].wx; wy += shown[i].wy; wz += shown[i].wz; }
        g.wx = wx / g.members.length;
        g.wy = wy / g.members.length;
        g.wz = wz / g.members.length;
        // Re-derived, in the same statement as the centroid it comes from.
        // Accumulating plane coordinates separately here is the drift bug in
        // embryo, because absorb runs in ROUNDS.
        const q = this.planeOf(clearance, g.wx, g.wy, g.wz);
        g.sx = q.sx; g.sy = q.sy; g.sz = q.sz;
      }

      // ── A COUNT MUST STAND WHERE ITS DEVICES ARE (2.294.0) ───────────
      // The defect this closes, in full, because it produced the single worst
      // thing this subsystem has ever drawn: a badge reading "50" in the
      // middle of the villa, standing for fifty devices in a dozen rooms, none
      // of them near it and none of them visible.
      //
      // A pile is a CONNECTED COMPONENT of "who overlaps whom" (union-find,
      // badgePlacement). Connectivity is transitive and overlap is not: A may
      // touch B and B touch C while A and C are a screen apart, and all three
      // are one pile. At a wide zoom — or merely at a larger icon size, which
      // is the same thing — the chain closes across the whole floor plan and
      // one pile swallows most of the villa. A deferral bucket is keyed by
      // pile, so that becomes ONE summary; a summary of more than six draws a
      // count; and a count is drawn at its members' CENTROID, which for a
      // chain spanning the villa is a point in the middle of it that no member
      // is anywhere near.
      //
      // Nothing before this noticed, because every existing rule asks about
      // the group's MEMBERSHIP — how many, which rooms, is that the whole room
      // — and none of them asks the question a person asks looking at it:
      // is this number standing anywhere near the things it counts?
      //
      // So that is the test. A count occupies exactly one badge box. A member
      // further from it than that box plus its own plus the gap is a device
      // the count is not covering, merely pointing at from a distance. One
      // such member and this is not a summary of a place, it is room-level
      // crowding wearing a summary's clothes — so every room it covers goes to
      // its own chip, which is named, sits inside the room it names, and opens
      // that room's device list.
      //
      // A genuinely CO-LOCATED pile — a ceiling fan, its own light, the sensor
      // clipped to the same mount, which is what the count badge was designed
      // for — has a spread of nearly zero and keeps its count exactly as
      // before. This narrows the count to the case it was built for rather
      // than removing it.
      //
      // Cards of two to six are deliberately NOT tested. Their members
      // overlapped to be piled at all, so a card is at most a few badge boxes
      // from every one of them, and it draws those devices rather than a
      // number — there is nothing hidden to be dishonest about.
      if (this.drawnCells(g, g.members.length) < 2) {
        const countY = cardCentreY(g);
        let strays = false;
        for (const i of g.members) {
          const d = this.drawnDistance(
            g.sx, countY, g.sz, shown[i].sx, shown[i].sy, shown[i].sz);
          if (d > squareHalf + halfOf(i) + gapPx) { strays = true; break; }
        }
        if (strays) for (const k of g.roomKeys) this.roomClustered.set(k, true);
      }

      // ── The whole-room rule, re-checked against the membership we ended up
      // with. The solver applied it (badgePlacement step 7) against a room
      // count taken BEFORE any of this, so absorb can manufacture a group that
      // covers every badge its room shows. If that group draws a COUNT it is
      // the thing the rule forbids — a number standing for a whole room, next
      // to no room name — so it goes to the chip, which at least says which
      // room. A group that draws its devices is not a duplicate of anything
      // and stays.
      if (g.roomKeys.length === 1 && this.drawnCells(g, g.members.length) < 2) {
        let inRoom = 0;
        for (const s2 of shown) if (roomKey(this.roomOf(s2.id)) === g.roomKeys[0]) inRoom++;
        if (g.members.length >= inRoom) this.roomClustered.set(g.roomKeys[0], true);
      }
    }
    this.absorbed = absorbed;

    // ── SEATING ORDER IS A CHOICE, AND IT WAS BEING MADE AT RANDOM ─────────
    // This is a greedy fill: a card seated early occupies space a later card
    // then cannot have, so which cards survive depends on the order they are
    // tried. That order used to be `pending`'s, which is bucket order, which
    // 2.366.0 established is inherited from the caller's item order — i.e. it
    // carried no meaning at all.
    //
    // It is worth getting right because a refusal is not cheap: a card that
    // cannot be seated hands EVERY room it covers to that room's chip, which
    // hides those rooms' badges too, including ones the solver had already
    // accepted and which were nowhere near the crowding. A `?debug` capture at
    // one zoom rung showed 14 cards built, 4 seated, and 7 rooms chipped as a
    // result — 30 badges accepted by the solver, 9 actually drawn.
    //
    // So the cost of refusing a card is measured in DEVICES, and the biggest
    // groups are the ones worth seating first. Focused groups go ahead of
    // everything (they are seated unconditionally anyway, and their space has
    // to be reserved before anyone else claims it), then member count
    // descending, then `key` — which is `grp|<pileKey>`, already unique and
    // stable, so this is a total order and introduces no new order dependence
    // of the kind 2.366.0 removed.
    const seating = pending.slice().sort((a, b) =>
      (a.focused === b.focused ? 0 : a.focused ? -1 : 1)
      || b.members.length - a.members.length
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const g of seating) {
      // A FOCUSED pair is seated unconditionally. It stands in for two badges
      // that the room exemption was already drawing on top of each other, so a
      // refusal would restore the exact overlap it exists to remove — and it
      // can never escalate the focused room to its chip, which would break the
      // one promise tapping a room makes.
      if (g.focused) { placed.push(g); continue; }
      if (!fits(g, placed)) {
        // Nowhere to stand: this is room-level crowding after all. EVERY room
        // the group covered escalates, not just its primary one — a group that
        // straddles a boundary and then fails to place cannot leave half its
        // members behind a chip and half loose.
        for (const k of g.roomKeys) this.roomClustered.set(k, true);
        continue;
      }
      placed.push(g);
    }
    this.dropEscalatedGroups(placed);
    pending.length = 0;
    for (const g of placed) pending.push(g);
  }

  /**
   * ── A DROPPED GROUP TAKES EVERY ROOM IT COVERED WITH IT ──────────────
   * A group whose room was escalated by a LATER pile must not also draw: the
   * chip already covers its members, and two renderings of the same content
   * is how a viewer learns to distrust both.
   *
   * But dropping it is only half the move. This used to claim "the chip hides
   * every badge in the room regardless, so nothing ends up hidden with
   * nothing in its place", and that is true only of a SINGLE-ROOM group. A
   * group straddling a boundary has members in a room that did not chip, and
   * they stay marked in `entityGrouped` — hidden, with no summary and no
   * chip. Invisible AND untappable, and the field log said so on nearly every
   * pass: `PLACEMENT: N badge(s) hidden with no summary and no chip`.
   *
   * So it escalates all of its rooms, exactly as the `!fits` branch does for
   * the same reason. That costs chips — the honest price of not losing a
   * device — and it has to run to a FIXPOINT, because escalating a room can
   * drop a group that was already past in the sweep, whose own rooms then have
   * to go too. Bounded: every round drops at least one group.
   *
   * Extracted in 2.290.0 because CHIP_COLLISION escalates rooms from OUTSIDE
   * this method and must settle the groups the same way. Writing a second
   * escalation path is how the orphan bug in the paragraph above got made in
   * the first place; there is one.
   *
   * Prunes `placed` IN PLACE.
   */
  private dropEscalatedGroups(placed: PendingEntityGroup[]): void {
    for (let round = 0; round <= placed.length; round++) {
      let dropped = false;
      for (let i = placed.length - 1; i >= 0; i--) {
        const g = placed[i];
        // The focused room is never chipped by its own pass, and another
        // room's escalation must not take its card down either.
        if (g.focused) continue;
        if (!g.roomKeys.some((k) => this.roomClustered.get(k))) continue;
        placed.splice(i, 1);
        for (const k of g.roomKeys) this.roomClustered.set(k, true);
        dropped = true;
      }
      if (!dropped) break;
    }
  }

  /**
   * Pair up the FOCUSED room's own overlapping badges.
   *
   * ── The gap this closes ───────────────────────────────────────────────────
   * Tapping a room grants it an exemption: its badges are accepted
   * unconditionally and are never counted as blockers, because "tap a room,
   * see its devices" is a promise the layout is not allowed to renegotiate,
   * and two devices at ONE point are separated by no zoom that exists. So the
   * zoom solver frames the room, and anything genuinely co-located inside it —
   * a ceiling fan, its own light, the sensor clipped to the same mount — draws
   * stacked.
   *
   * Stacked is where the promise quietly stops being kept. `badgeContaining`
   * returns the TOPMOST control containing the point, so a badge completely
   * covered by another cannot be tapped at all: the device is on screen and
   * unreachable, which is a worse answer than the chip the exemption exists to
   * avoid.
   *
   * A pair card fixes exactly that and nothing else. It shows both
   * pictograms, in their own colours and their own live states, and gives each
   * a tap target — so the room's devices are MORE visible and MORE reachable
   * than the stack was, which is the promise, kept properly.
   *
   * ── Why it is a second pass rather than a change to the first ────────────
   * The exemption is a property of the MAIN pass and has to stay one: a
   * focused badge must not block anybody, and letting exempt items into that
   * graph would make them blockers. So this runs over the focused room alone,
   * with the exemption dropped so its badges are compared with each other, and
   * with the SAME overlap predicate (`conflicts`) and the SAME canonical order
   * the rest of the subsystem uses. Nothing about the main result changes and
   * badgePlacement is untouched.
   */
  private pairFocusedRoom(
    shown: ShownLabel[],
    items: readonly PlacementItem[],
    clearance: { gap: number; minSep: number; pxPerWorld: number; basis: ViewBasis },
    pending: PendingEntityGroup[],
  ): void {
    const focus = this.focusedRooms;
    if (focus.size === 0) return;
    // Indices into `shown`, so a strip's members map straight back.
    const idx = this.focusIdx;
    idx.length = 0;
    const sub = this.focusItems;
    for (let i = 0; i < items.length; i++) {
      if (!focus.has(items[i].room)) continue;
      const src = items[i];
      let it = sub[idx.length];
      if (!it) {
        it = { sx: 0, sy: 0, sz: 0, reach: 0, rank: 0, sortKey: "", category: "", room: "", exempt: false };
        sub[idx.length] = it;
      }
      it.sx = src.sx; it.sy = src.sy; it.sz = src.sz;
      it.reach = src.reach; it.rank = src.rank;
      it.sortKey = src.sortKey; it.category = src.category; it.room = src.room;
      it.exempt = false;
      idx.push(i);
    }
    sub.length = idx.length;
    if (idx.length < 2) return;

    // ── MUTUAL overlap, not TRANSITIVE reachability ──────────────────────
    // The predicate is the same one every other tier uses. What changed is how
    // a set is built out of it.
    //
    // Union-find answers "is there a CHAIN of overlaps from A to B", and inside
    // one room that is almost always yes: A touches B, B touches C, and eleven
    // badges strung across a living room collapse into a single component
    // whose members mostly do not overlap each other at all. Tapping the room
    // then produced one summary reading `11` — the opposite of the promise the
    // focus makes, and the third time this exact chain has bitten (2.261.0
    // painted the same component as a card the width of the screen; capping
    // the card turned it into this digit instead of fixing it).
    //
    // A group here is therefore a CLIQUE: every member overlaps every other
    // member. That is the honest reading of "these cannot be drawn separately",
    // and it is what makes the card's claim true — the devices it hides really
    // were all on top of one another. A chain breaks into the several small
    // groups it always was, and everything else stays a badge of its own.
    //
    // Greedy, in the canonical (rank, entity_id) order every other decision
    // here uses, so the result depends on nothing but geometry and rank. Capped
    // at what a card can DRAW, so a clique never becomes a count: a group that
    // cannot show its devices is not an answer to "show me this room's
    // devices". ⚠️ That is a property of the CLIQUES only — the card-vs-card
    // merge below can still take a pile past the cap, deliberately; see it for
    // the trade.
    //
    // One room's badges, so the plain O(n^2) sweep is cheaper than any index.
    // `sub` is indexed locally; `sortCardMembers` speaks in `shown` indices.
    // Going through it rather than repeating its comparator is the point — one
    // definition of "the canonical order", shared with the card renderer.
    const local = new Map<number, number>();
    for (let k = 0; k < idx.length; k++) local.set(idx[k], k);
    const order = this.sortCardMembers(shown, idx.slice())
      .map((i) => local.get(i) as number);
    // The clique build lives in badgePlacement.buildCliques — pure, and
    // testable for the property that actually broke here: a clique whose
    // members are valid but SPREAD draws its card at a centroid none of them
    // is near. Candidates are offered nearest-first with category as the
    // tiebreak; `order` still seeds and still breaks every remaining tie.
    const piles = buildCliques(sub, order, clearance.gap, clearance.minSep, MAX_TOTAL_CHIPS);

    // ── …and then the CARDS must clear each other ─────────────────────────
    // The cliques above are built from where the BADGES are. What gets drawn
    // is a CARD, and a card is far bigger than the badge it replaces — a 2x2
    // is two badge boxes wide and two tall. So two cliques whose badges never
    // touched can produce two cards that sit right on top of each other, which
    // is what a tapped room actually looked like: a stack of overlapping white
    // boxes where the promise was "your devices, side by side".
    //
    // Nothing here moves; that rule is absolute in this file. Two cards that
    // collide become ONE card, which is the same answer every other tier in
    // this subsystem gives (piles merge, chips merge). Repeated to a fixpoint
    // because merging grows the survivor and can bring it into contact with a
    // third — bounded by the pile count, since every round strictly reduces it.
    //
    // ⚠️ A merged pile CAN now exceed what a card can draw, and then it draws a
    // count. The comment above says a focused room can never show one; that was
    // true while piles were capped, and it is the smaller of the two evils it
    // was weighed against — but overlapping cards is the LARGER one, and a
    // count here is honest in a way the "50" of 2.294.0 was not: these devices
    // are piled by construction, since their own cards could not be told apart.
    if (piles.length > 1) {
      const scale = this.effectiveScale();
      const gapPx = this.metrics.minGapPx * scale;
      const boxOf = (pile: number[]) => {
        let wx = 0, wy = 0, wz = 0;
        for (const k of pile) { const i = idx[k]; wx += shown[i].wx; wy += shown[i].wy; wz += shown[i].wz; }
        const n = pile.length;
        const q = this.planeOf(clearance, wx / n, wy / n, wz / n);
        // The pile's OWN size, not a shared cap: these piles are focused, so
        // the renderer will draw one cell per member (see cellMax), and
        // measuring them against any smaller number sizes a box the card is
        // about to overflow.
        const lay = this.cardOf(pile.length, pile.length, this.cardBudget());
        const hh = (lay.height / 2) * scale;
        // Anchored bottom-edge-on-anchor exactly as the renderer draws it —
        // this file's oldest rule, and the one 2.288.0 had to restate.
        return { cx: q.sx, cy: q.sy - hh, hw: (lay.width / 2) * scale + gapPx, hh: hh + gapPx };
      };
      // ⚠️ The fixpoint itself lives in badgePlacement.mergeCollidingPiles, and
      // it moved there because the loop bound written here was wrong: it read
      // `round < piles.length`, and `piles.length` shrinks on every merge while
      // `round` grows, so the two met in the middle after about half the merges
      // a full collapse needs. Two and three piles happen to need the same
      // number either way, which is why it survived; from four up it exited
      // early and drew the overlapping cards this was written to prevent.
      // Out there it is a pure function over boxes and has a test.
      mergeCollidingPiles(piles, boxOf);
    }

    for (const pile of piles) {
      // ── ONE PILE, ONE CONTROL. THE SIZE DECIDES WHICH ─────────────────
      // A pile is a set of badges that are on top of each other, so it draws
      // as exactly one thing — its devices side by side (up to a 2x2 card), or
      // a count.
      //
      // That is one control per pile, and NOT the stronger claim an earlier
      // version of this comment made ("nothing inside a focused room can
      // overlap"). Pile separation comes from each badge's half-WIDTH, so two
      // piles can sit about a badge apart while each draws a card two badges
      // across and two tall — and focused cards skip `fits` entirely, by
      // design, because refusing one restores the overlap it exists to remove.
      // One control per pile is a large improvement on a stack of four; it is
      // not a guarantee, and saying so here is cheaper than a screenshot.
      //
      // The bound that matters is the CARD's, and it is on the strip below,
      // not here. Three earlier shapes of this got the bound wrong:
      //
      //   2.260.0  took each pile's LOSERS. A pile of three drew an accepted
      //            badge plus a card of the other two at the same point — the
      //            overlap came back with an extra control in it.
      //   2.261.0  took the whole pile as a card of N chips. A focused room
      //            whose badges transitively touch is ONE pile, so it painted
      //            a single card the full width of the screen.
      //   2.262.0  took only piles of exactly two, which left every pile of
      //            three or more stacked — reported, with three cameras and
      //            two lights drawn on top of each other.
      //   2.267.0  capped the CARD instead of the pile, so the screen-wide card
      //            became a summary reading `11` in a room with visible space
      //            all round it — reported as "I expect to see the entities".
      //
      // The whole clique, and the clique is built no larger than a card can
      // draw (see above), so a focused room cannot produce a count badge at
      // all. Bounded where the set is BUILT rather than where it is drawn:
      // capping the drawing only ever turns "too many to show" into "showing
      // none of them".
      if (pile.length < 2) continue;
      // The same cell order the main solve's cards use — one comparator, so
      // the two producers cannot drift.
      const members = this.sortCardMembers(shown, pile.map((k) => idx[k]));
      const pairRooms = [...new Set(members.map((i) => roomKey(this.roomOf(shown[i].id))))];
      let wx = 0, wy = 0, wz = 0;
      let pileKey = shown[members[0]].id;
      for (const i of members) {
        wx += shown[i].wx; wy += shown[i].wy; wz += shown[i].wz;
        if (shown[i].id < pileKey) pileKey = shown[i].id;
        this.entityGrouped.add(shown[i].id);
      }
      const n = members.length;
      pending.push({
        // Distinct namespace from the main solve's `grp|`: the same devices
        // can be a focused strip now and an ordinary group after the focus
        // lapses, and giving them one key would reuse a control whose
        // placement rules just changed.
        key: `fgrp|${pileKey}`,
        // Taken from the MEMBERS, not from "the focused room": with several
        // rooms focused at once (a merged chip's short tap) a pair can straddle
        // two of them, and naming it after whichever was focused first would
        // file it under a room half its devices are not in.
        room: this.roomDisplay.get(pairRooms[0]) ?? pairRooms[0],
        roomKeys: pairRooms,
        members,
        wx: wx / n, wy: wy / n, wz: wz / n,
        // Derived from the world centroid, by the one projection — see planeOf.
        ...this.planeOf(clearance, wx / n, wy / n, wz / n),
        // Same rule as the main solve, and it is badgeCard's rule, not a copy
        // of it: `gridCells` is where "more than a card can hold" becomes the
        // count badge.
        grid: n,
        focused: true,
      });
      this.focusPairs++;
    }
  }

  /**
   * THE geometry of a summary card that carries pictograms — for every form of
   * it, at every size.
   *
   * `unit` is the badge the card is built out of: one chip's worth of card.
   * A card of `n` chips is `n` units wide, its chips are pitched exactly one
   * unit apart, and each chip is `cardIconFraction` of a unit — which is the
   * SAME proportion a card badge gives its own chip. So the margin at the ends
   * and the gap between the chips both fall out of one number and cannot
   * disagree with each other or with the badge.
   *
   * ── Why this is a function and not two sets of constants ────────────────
   * The wide pair and the compact pair each computed their own card width,
   * chip size and pitch inline, from three different places — `sm.size`,
   * `sm.chipSize` or a `compactChip` metric, and `sm.size` or
   * `compactChip + 2` with a bare literal in it. They were not one rule at two
   * sizes; they were two layouts that happened to be reached through the same
   * branch, and they looked it: the same pair of devices drew with a visible
   * gap and honest margins in one form and cramped against the border in the
   * other. Reported exactly that way, with both on screen at once.
   *
   * The compact form is now nothing more than this same layout at HALF the
   * unit, which is what makes it land on the count badge's own footprint
   * (2 chips x half a badge = one badge) while staying recognisably the same
   * object as the wide one.
   */
  /**
   * Order a card's members the way every other decision in this subsystem is
   * ordered: static rank, then entity_id.
   *
   * A cell is a POSITION, so the order is the difference between "this device
   * is always the left one" and "this device is wherever it happened to land
   * this frame". The solver hands its buckets over in DEFERRAL order, and the
   * lone-deferral pull-back APPENDS the badge it rescued — so a pair arrived as
   * [loser, winner], reverse rank, while the focused-room pass had always
   * sorted. Two orderings feeding one renderer; two symmetric chips hid it.
   *
   * A grid would not hide it. This is the same failure that got badge fanning
   * deleted in 2.159.0 — "four badges in a diagonal line became a 2x2 block, in
   * a different order" — and a card whose cells reshuffle between zoom rungs
   * would be that bug wearing different clothes. Sorting here is what lets the
   * card claim, honestly, that a device only moves cell when something that
   * sorts BEFORE it appears or disappears.
   */
  private sortCardMembers(shown: ShownLabel[], members: number[]): number[] {
    return members.sort((x, y) => {
      const a = shown[x], b = shown[y];
      const ra = badgeRank(a.lbl.type, a.lbl.category);
      const rb = badgeRank(b.lbl.type, b.lbl.category);
      return ra !== rb ? ra - rb : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  /**
   * How many cells this group ACTUALLY draws — the one clamp, used by the
   * measuring in placeEntityGroups and by the drawing in updateEntityGroups.
   *
   * They used to clamp separately (only the draw did), so a producer that
   * asked for more than the cap would have been MEASURED at one size and DRAWN
   * at another. That is this file's oldest rule broken quietly, and it was one
   * careless producer away from happening.
   */
  private drawnCells(g: PendingEntityGroup, memberCount: number): number {
    const max = this.cellMax(g);
    const cells = gridCells(Math.min(g.grid, memberCount), max);
    // ⚠️ A FOCUSED group is NEVER refused into a count, and this is the line
    // 2.306.0 was supposed to change and did not — its edit silently matched
    // nothing, which is why an "8" still stood over the pool. The cap doing the
    // refusing was never MAX_TOTAL_CHIPS; it is the viewport one below, and at
    // icon 2.25x it fires at two cells. Tapping a room is a request to SEE the
    // devices, and "too wide" has an answer that always exists — a card that
    // wraps (see layoutOf). The ordinary path keeps the cap: a summary nobody
    // asked for may legitimately collapse to a number rather than eat the
    // screen.
    // ⚠️ A FOCUSED group is NEVER refused into a count. 2.360.0 briefly made a
    // phone do exactly that and it was wrong on the user's own terms: a count
    // badge is a number standing where devices should be, and the answer to
    // "too wide" is to CHANGE THE SHAPE, which always has an answer. On a phone
    // the shape is now pairs side by side rather than a 2x2 — see perCardCap.
    // ── NO SUMMARY IS EVER REFUSED INTO A NUMBER (2.363.0) ───────────────
    // This used to return 0 — "draw your count" — for a group over the
    // viewport cap. The cap itself is not gone and is not weakened: it is
    // `drawableMax`, and the SOLVER uses it, so a bucket too big to draw
    // escalates to its ROOM CHIP before it ever gets here. What is gone is the
    // renderer's fallback of standing a digit where the devices should be.
    //
    // The one path that can still arrive over the cap is the absorb phase,
    // which grows a group's membership after the solve. That group now draws
    // every member and WRAPS into the width budget (see layoutOf) rather than
    // collapsing to a number — wider than ideal, but honest, tappable, and
    // rare, where the digit was none of those.
    return cells;
  }

  /**
   * The most cells an arrangement may draw before it exceeds its share of the
   * viewport — measured with `cardOf`, the same function that lays the card
   * out, so there is no second width formula to keep in step.
   *
   * Cached on the two inputs that can change it. `drawnCells` is called inside
   * loops over every group and every member, and this walks the arrangement
   * sizes; recomputing it per call would be the only measurably expensive
   * thing in the layout pass.
   */
  private capCells = MAX_TOTAL_CHIPS;
  private capScale = -1;
  private capWidth = -1;
  private capMax = -1;
  /** How wide a summary may be DRAWN, in the arrangement's own units. The
   *  render width carries cssToGui and so does `scale`, so the device pixel
   *  ratio cancels and this is a pure fraction of the screen. */
  private cardBudget(): number {
    const width = this.scene.getEngine().getRenderWidth();
    const scale = this.effectiveScale();
    return scale > 0 && width > 0 ? (width * CARD_MAX_VIEWPORT_FRACTION) / scale : 0;
  }

  /**
   * The phone ceiling, in CSS pixels — see PHONE_MAX_TOTAL_CHIPS.
   *
   * Read in CSS px, never render px: the resolution valve moves the render
   * width whenever the camera starts and stops, and a device that stopped
   * being a phone mid-gesture would regroup its badges for no reason. That is
   * the same trap the focus-retention rule fell into in 2.354.0.
   */
  private phoneCellCap(): number {
    const engine = this.scene.getEngine();
    const cssWidth = engine.getRenderWidth() * engine.getHardwareScalingLevel();
    return cssWidth > 0 && cssWidth <= PHONE_MAX_CSS_WIDTH ? PHONE_MAX_TOTAL_CHIPS : MAX_TOTAL_CHIPS;
  }

  private cardCellCap(max = MAX_TOTAL_CHIPS): number {
    const width = this.scene.getEngine().getRenderWidth();
    const scale = this.effectiveScale();
    if (width === this.capWidth && scale === this.capScale && max === this.capMax) return this.capCells;
    this.capWidth = width; this.capScale = scale; this.capMax = max;
    // ⚠️ The phone ceiling belongs HERE and nowhere else. `drawnCells` and
    // `drawableMax` both come through this function, and the comment on
    // drawableMax records what happens when two caps answer the same question
    // separately: the solver keeps a bucket the renderer then refuses, and a
    // count badge survives on a narrow phone at three members.
    let cells = Math.min(max, this.phoneCellCap());
    if (scale > 0 && width > 0) {
      const budget = this.cardBudget();
      // Down to 2 and no further: a pair card is two badge boxes, which fits
      // any screen this app can run on, and stopping there keeps the "a group
      // of two is ALWAYS the full-size card" promise the one-pass placement
      // rests on.
      while (cells > 2 && this.cardOf(cells, max).width > budget) cells--;
    }
    this.capCells = cells;
    return cells;
  }

  /**
   * The largest bucket this renderer can actually draw as a card showing every
   * one of its devices — what `solvePlacement`'s `drawableMax` asks for, and
   * what it must be handed.
   *
   * It used to be handed a bare MAX_TOTAL_CHIPS, which is the cap in BADGE
   * units and is blind to the screen. So the solver kept buckets the renderer
   * then refused at `drawnCells`' viewport cap, and a refused bucket draws a
   * number. Two caps disagreeing about the same question is how a count badge
   * survived on a narrow phone even at three members.
   *
   * Still a plain integer and still camera-INVARIANT: render width and
   * `effectiveScale` are properties of the device and the label-size setting,
   * constant across a frame, and neither is a function of where the camera is
   * or how far away it stands. That is the property `drawableMax`'s docstring
   * protects, and this does not spend it.
   */
  /** The one reading of the badge-style setting. Five sites asked
   *  `config.badgeStyle === "card"` independently, which is fine until a sixth
   *  has to agree with them — the summary card's own cells, which is exactly
   *  the site that got missed. */
  private isCardStyle(): boolean {
    return this.config.badgeStyle === "card";
  }

  private drawableMax(): number {
    return Math.min(MAX_TOTAL_CHIPS, this.cardCellCap());
  }

  /** This group's arrangement — see babylon/badgeCard. A count badge is the
   *  degenerate one-card, zero-cell case, so every summary goes through one
   *  function and there is no second code path to keep in step. */
  private cardOf(cells: number, max = MAX_TOTAL_CHIPS, maxWidth = 0): CardArrangement {
    return arrange(
      Math.max(1, cells), this.summaryMetrics().size,
      this.metrics.cardIconFraction, this.metrics.minGapPx, max, maxWidth,
      this.perCardCap());
  }

  /** Cells per CARD on this screen. A phone gets pairs — see
   *  PHONE_MAX_GRID_CHIPS — so a pile of four is two pair-cards side by side
   *  rather than one 2x2, with nothing hidden and no number drawn. */
  private perCardCap(): number {
    return this.phoneCellCap() === PHONE_MAX_TOTAL_CHIPS
      ? PHONE_MAX_GRID_CHIPS : MAX_GRID_CHIPS;
  }

  /** The arrangement a group actually draws — cells and ceiling in one place,
   *  so no caller can measure a focused card against the ordinary cap. */
  private layoutOf(g: PendingEntityGroup, memberCount: number): CardArrangement {
    // EVERY arrangement is handed the width budget now, not just a focused one.
    // The budget used to cap an ordinary group's cell count instead — and
    // "capped" meant refused into a count. With the digit gone, wrapping is the
    // only remaining answer to "too wide", so both kinds get it. Adapting the
    // shape always has an answer; refusing does not.
    return this.cardOf(this.drawnCells(g, memberCount), this.cellMax(g), this.cardBudget());
  }

  /** The cell ceiling this group is entitled to. A FOCUSED group has none —
   *  it is entitled to a cell per member, and the width budget decides the
   *  shape. See the note where FOCUS_MAX_CHIPS used to be. */
  private cellMax(g: PendingEntityGroup): number {
    return g.focused ? Math.max(1, g.grid) : MAX_TOTAL_CHIPS;
  }

  /**
   * Make sure this group has at least `n` chip+zone pairs, creating any that
   * are missing.
   *
   * Grow-only and never shrunk: a group's membership moves as devices come
   * and go and as the zoom rung changes what fits, and disposing controls on
   * that boundary would flicker for no benefit. Surplus ones are hidden.
   */
  private growGrid(
    c: EntityGroupControls, cells: number, cards: number,
  ): void {
    // ── Z-ORDER IS EXPLICIT, BECAUSE CREATION ORDER IS NOT ────────────────
    // Container.addControl inserts by zIndex and APPENDS within a tie, and
    // these pools are grown lazily — a second sub-card created the first time
    // a group reaches five members would otherwise be appended after the chips
    // and paint straight over them. Cards below, pictograms above.
    for (let k = c.cards.length; k < cards; k++) {
      const r = new Rectangle(`egroupCard${k}_${c.container.name}`);
      r.zIndex = 0;
      r.isPointerBlocker = false;
      r.isVisible = false;
      c.container.addControl(r);
      c.cards.push(r);
    }
    for (let k = c.chips.length; k < cells; k++) {
      const img = new Image(`egroupChip${k}_${c.container.name}`);
      img.zIndex = 1;
      img.stretch = Image.STRETCH_UNIFORM;
      img.isVisible = false;
      c.container.addControl(img);
      c.chips.push(img);

      // Every dimension is written per pass (see updateEntityGroups), in
      // PIXELS from the arrangement's centre — one code path whether the
      // summary is one card or two. The zones TILE each card, so every point
      // on a card belongs to exactly one device; the gap BETWEEN cards belongs
      // to none, and a tap there falls through to whatever is underneath.
      const z = new Rectangle(`egroupZone${k}_${c.container.name}`);
      z.zIndex = 1;
      z.thickness = 0;
      z.background = "";
      z.isPointerBlocker = false;
      c.container.addControl(z);
      c.zones.push(z);
    }
  }

  /** Draw (or hide) one badge-sized control per surviving entity group. */
  private updateEntityGroups(shown: ShownLabel[], groups: PendingEntityGroup[]): void {
    const layer = this.labelLayer;
    if (!layer) return;
    const live = new Set<string>();
    if (groups.length > 0) {
      // Floored like the room chip's, and for the same reason: a group badge
      // that shrinks with the badges it replaced would be unreadable at
      // exactly the zoom where grouping matters most.
      const scale = this.effectiveScale();
      // The SAME resting surface an idle badge wears. categorySurface at
      // "off" is category-independent (see EntityCategories) — it is the
      // app's neutral panel fill, its secondary ink and its 1px hairline — so
      // a summary reads as one of the badges it replaces rather than as a
      // different species. It was a dark slate pill with a heavy warm border
      // sitting among white squircles, which is what "very inconsistent"
      // meant. Re-read every pass, like the badges', so a theme change lands
      // without a rebuild.
      const rest = categorySurface("others", "off");
      const alert = categorySurface("others", "alert");
      const surface = rest.fill;
      const sm = this.summaryMetrics();
      for (const g of groups) {
        live.add(g.key);
        const c = this.ensureEntityGroup(g.key, layer);
        c.entityIds = g.members.map((i) => shown[i].id);
        c.room = g.room;
        c.node.position.set(g.wx, g.wy, g.wz);
        // ── PAIR CARD, or the count ────────────────────────────────────────
        // ── A GROUP NEVER DRAWS A DIGIT IT DOES NOT NEED ─────────────────
        // "2" is the one count in this app that carries no information: two
        // pictograms already say two, and they also say WHICH two. A group of
        // two therefore always shows both devices, and only the TAP degrades
        // when there is no room for the strip:
        //
        //   strip    every device, one tap each (zones tile the card)
        //   count    three or more
        //
        // `strip` is > 2 only inside the FOCUSED room, where the promise is
        // that tapping a room shows its devices — there a pile of three
        // co-located devices becomes one card of three chips rather than
        // three badges the top of which is the only one anybody can tap.
        const n = c.entityIds.length;
        const drawn = this.drawnCells(g, n);
        c.gridN = drawn >= 2 ? drawn : 0;
        // ONE unit, always: a card is an integer number of badge boxes on both
        // axes, and a count badge is the degenerate 1x1 — so every summary,
        // whatever it draws, is laid out by one function.
        // Same ceiling the placement measured with (layoutOf) — this is the
        // "layout geometry must equal render geometry" rule, and a focused
        // card drawn at the ordinary cap would be a different object.
        const lay = this.cardOf(drawn, this.cellMax(g), this.cardBudget());
        c.container.width = `${lay.width}px`;
        // HEIGHT IS PER-PASS, like the width. It used to be written once at
        // construction, which was invisible while every card was one row tall
        // and would have left a stale two-row box the moment a group shrank
        // from four members to two — and a group's membership changing under a
        // stable key is the common path, not an exotic one.
        c.container.height = `${lay.height}px`;
        this.growGrid(c, drawn, lay.cards.length);
        for (let k = 0; k < c.chips.length; k++) {
          c.chips[k].isVisible = k < drawn;
          c.zones[k].isVisible = k < drawn;
        }
        // ── The visible card(s) ──────────────────────────────────────────
        // Every property written every pass, on every pooled control: `m` can
        // fall from two to one when a group loses a member, and a stale box
        // left behind would draw an empty card beside a real one.
        for (let k = 0; k < c.cards.length; k++) {
          const sub = c.cards[k];
          const src = lay.cards[k];
          sub.isVisible = !!src;
          if (!src) continue;
          sub.width = `${src.width}px`;
          sub.height = `${src.height}px`;
          sub.left = `${src.left}px`;
          sub.top = `${src.top}px`;
          sub.cornerRadius = sm.size * BADGE_CORNER_FRACTION;
          sub.shadowColor = "rgba(0,0,0,0.4)";
          sub.shadowBlur = 6;
          sub.shadowOffsetY = 2;
        }
        if (drawn >= 2) {
          // Stable order: the solver's own (rank, entity_id), so the same
          // devices sit the same way round on every device and at every zoom.
          //
          // ALL FOUR geometry properties are written on BOTH controls every
          // pass. The pools are grow-only and never reset, so a chip or a zone
          // that laid out a 2x2 last pass keeps its half-height and its
          // quarter offset unless this overwrites them.
          for (let k = 0; k < drawn; k++) {
            c.chips[k].width = `${lay.chip}px`;
            c.chips[k].height = `${lay.chip}px`;
            c.chips[k].left = `${lay.cellLeft(k)}px`;
            c.chips[k].top = `${lay.cellTop(k)}px`;
            // One badge box, centred on its own chip — in PIXELS, like
            // everything else here, so one code path serves a single card and
            // a split. Percentages could not: half of a two-card arrangement
            // is not a cell.
            c.zones[k].width = `${lay.zoneW}px`;
            c.zones[k].height = `${lay.zoneH}px`;
            c.zones[k].left = `${lay.cellLeft(k)}px`;
            c.zones[k].top = `${lay.cellTop(k)}px`;
            const s2 = shown[g.members[k]];
            const st = this.lastState.get(s2.id) ?? phantomEntity(s2.id);
            const { face, ring } = badgeFaceAndRing(
              s2.lbl.type, st, this.linkActiveIds.has(s2.id));
            c.chips[k].source = badgeImageDataUrl(
              s2.lbl.category, iconKeyFor(s2.lbl.type, st), face,
              this.config.entityMap[s2.id]?.badgeColor,
              // Inset 0: this chip IS the badge here, exactly as the classic
              // style's is. The card behind it is the group's own surface, not
              // a second frame — see updateLabel for the doubled ring that
              // insetting inside a bordered card produced.
              // Same correction as the lone badge's: `lay.chip` is in the
              // arrangement's unscaled units and the group container carries
              // effectiveScale(), so the bitmap has to be baked at the painted
              // size. iconZoomScale is excluded for the same reason — see
              // glyphBakePx.
              0, ring, false, lay.chip * this.iconUserScale * this.bestCssToGui(),
              // A summary card's cells are Card-style badges by definition —
              // they ARE the card. They bake through this call rather than
              // updateLabel's, which is why the Card style's heavier glyph did
              // not reach them in 2.375.0 and the change looked like a no-op on
              // a screen showing a two-cell card. Gated on the setting so the
              // Icon style stays a clean control to compare against.
              this.isCardStyle());
          }
        }
        // ── A SUMMARY'S RING NEVER REPEATS A MEMBER'S OWN SIGNAL ────────────
        // Two cases, because the ring means two different things depending on
        // whether the summary can show what it stands for:
        //
        //   SHOWING ITS DEVICES  every chip already carries its own ring, so
        //     the card's ring is only allowed to say something true of the
        //     WHOLE set: red iff every member is red. A card that went red
        //     because ONE of two devices was armed claimed the pair was armed,
        //     and the other chip sitting there un-ringed said otherwise —
        //     reported with exactly that pair on screen.
        //
        //   DRAWING A COUNT  nothing inside says anything, so the ring is the
        //     only channel there is and it keeps the room chip's rule: red if
        //     ANY member is on or alerting. Same rule as its sibling control,
        //     for the same reason.
        //
        // And when it does show devices it reads the CHIPS' own vocabulary —
        // `badgeFaceAndRing`'s ring, the linked/alert signal — not `badgeKind`,
        // which folds in plain "on". Those disagree: a camera that is merely
        // connected classifies as "on" (see classifyDeviceActivity), so three
        // idle cameras drew three purple-ringed chips inside a red-ringed card
        // that was claiming motion nobody had detected.
        let ringRed = drawn >= 2;
        for (const i of g.members) {
          const st = this.lastState.get(shown[i].id);
          if (!st) { if (drawn >= 2) ringRed = false; continue; }
          if (drawn >= 2) {
            const { ring } = badgeFaceAndRing(
              shown[i].lbl.type, st, this.linkActiveIds.has(shown[i].id));
            if (ring !== "alert") ringRed = false;
          } else {
            const kind = this.badgeKind(shown[i].lbl.type, st);
            if (kind === "on" || kind === "alert") ringRed = true;
          }
        }
        // A badge is never ringless — even at rest it carries the hairline
        // the brand guidelines give the idle state, which is what keeps it a
        // deliberate object rather than a shape on the floor. Same here.
        // ── THE HOST IS TRANSPARENT; THE CARDS CARRY THE SURFACE ─────────
        // The container is a positioning host now, so the visible box can be
        // one card or two with real space between them. `thickness` must be 0
        // as well as the background empty: a Rectangle insets its children by
        // its border, so a host with one would shift every pixel offset below.
        const stroke = ringRed ? this.metrics.ringThicknessPx : 1;
        const strokeColor = (ringRed ? alert.ring : rest.ring) ?? "transparent";
        for (const sub of c.cards) {
          sub.thickness = stroke;
          sub.color = strokeColor;
          sub.background = surface;
        }
        c.container.scaleX = scale;
        c.container.scaleY = scale;
        // Zero X offset and a fixed centring lift, exactly like the room chip:
        // the group sits ON its anchor. It is a summary, not a nudged badge.
        c.container.linkOffsetXInPixels = 0;
        // Half the card's OWN height, so its bottom edge lands on the anchor
        // exactly as a badge's does — a two-row card would otherwise sit half a
        // row too low, straddling the device it stands for.
        c.container.linkOffsetYInPixels = -(lay.height / 2) * scale;
        c.container.isVisible = true;
      }
    }
    for (const [key, c] of this.entityGroups) {
      if (!live.has(key)) c.container.isVisible = false;
    }
  }

  private ensureEntityGroup(key: string, layer: AdvancedDynamicTexture): EntityGroupControls {
    const existing = this.entityGroups.get(key);
    if (existing) return existing;

    const node = new TransformNode(`egroup_${key}`, this.scene);
    const container = new Rectangle(`egroupBadge_${key}`);
    const sm = this.summaryMetrics();
    // Pre-first-pass values only — updateEntityGroups writes both every pass
    // from the card layout, because a group's cell count (and therefore its
    // height) moves with its membership.
    container.width = `${sm.size}px`;
    container.height = `${sm.size}px`;
    // ── A TRANSPARENT POSITIONING HOST ──────────────────────────────────
    // The visible card(s) are its children (see updateEntityGroups), so a
    // summary of five can draw a 2x2 beside a 1x1 with real space between
    // them. Two properties are load-bearing here:
    //
    //   background "" + thickness 0 — a Rectangle insets its children by its
    //     border, so any host stroke would shift every pixel offset below it,
    //     and a host fill would draw a box across the gap between the cards.
    //   clipChildren FALSE — it defaults to true, and a child's shadow is
    //     painted by that child, so the sub-cards' shadows would be scissored
    //     off at the host's edge. Safe to disable: the hit test calls
    //     Control.contains directly rather than going through Babylon's own
    //     picking, and isPointerBlocker is already false.
    container.clipChildren = false;
    // The CARDS are squircles (see updateEntityGroups, which rounds each by
    // BADGE_CORNER_FRACTION — the same fraction the badge canvas uses, so a
    // summary is the badge shape at the badge size and only its CONTENT says
    // it stands for several devices). It shipped as a circle once and read as
    // a foreign object among the squircle badges it replaces and the rounded
    // room chip it escalates into — three different corner languages on one
    // map.
    container.thickness = 0;
    container.background = "";
    container.isPointerBlocker = false; // taps resolve via pickEntityGroupAt

    layer.addControl(container);
    container.linkWithMesh(node);
    container.linkOffsetYInPixels = -sm.size / 2;

    // Chips and zones are grown on demand by `strip()` — see it for why they
    // are not created here.
    const c: EntityGroupControls = {
      container, node, entityIds: [], room: "",
      cards: [], chips: [], zones: [], gridN: 0,
    };
    this.entityGroups.set(key, c);
    return c;
  }

  /** Entity ids behind the entity-group badge at these CSS-pixel client
   *  coords, or null. Same Control.contains() hit test as pickClusterAt /
   *  pickBadgeAt — see pickBadgeAt's docstring for why asking the rendered
   *  control is the only approach that cannot drift from what is on screen.
   *  Its members are hidden exactly while it is visible, so it can never take
   *  a tap from a badge the user can actually see. */
  pickEntityGroupAt(
    clientX: number, clientY: number,
  ): { room: string; entityIds: string[]; entityId: string | null } | null {
    if (this.entityGroups.size === 0) return null;
    const eng = this.scene.getEngine();
    const canvas = eng.getRenderingCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = (clientX - rect.left) * (eng.getRenderWidth() / rect.width);
    const py = (clientY - rect.top) * (eng.getRenderHeight() / rect.height);
    for (const c of this.entityGroups.values()) {
      if (!c.container.isVisible) continue;
      if (!c.container.contains(px, py)) continue;
      // A PAIR CARD resolves to ONE device: the half you tapped. That is the
      // whole point of drawing two pictograms instead of a count — a group of
      // two used to cost a tap to open a list of two, which is a list nobody
      // needs. The zones are real controls inside the card, so contains()
      // resolves them through the same transform stack the card is drawn with,
      // which is the only hit test this file trusts (see pickBadgeAt).
      //
      // A tap that somehow lands in neither half still opens the list rather
      // than guessing, and a LONG press always does (see SceneManager) — the
      // list stays reachable, so nothing this card can do is a dead end.
      let entityId: string | null = null;
      // `gridN` counts the CELLS across all of this summary's cards. Three
      // taps resolve to no single device and fall through to the caller: a
      // count badge (no cells at all), the empty bottom-right of a
      // three-member grid, and the GAP between two cards of a split — which
      // is host, not ink. SceneManager asks the badges next and opens the
      // device list after that, so none of the three is a dead end.
      for (let k = 0; k < c.gridN && k < c.entityIds.length; k++) {
        if (c.zones[k].contains(px, py)) { entityId = c.entityIds[k]; break; }
      }
      return { room: c.room, entityIds: [...c.entityIds], entityId };
    }
    return null;
  }

  // ── Room clusters (the "clusters" LOD band) ───────────────────────────────

  /**
   * Collapse the visible badges into one chip per room, anchored at the
   * world-space centroid of that room's badge anchors. Because the anchor is
   * a fixed point in the SCENE rather than a solved screen position, the chip
   * projects to a continuous screen path as the camera moves — it physically
   * cannot exhibit the jitter this whole mechanism exists to remove.
   *
   * Membership comes from resolvedRooms (roomOf), the same live-resolved room
   * SummaryGroupPanel groups by, so tapping a chip can hand its entity list
   * straight to that existing modal instead of inventing a second grouping
   * concept.
   */
  /**
   * Derive the room chips, then let them take part in the collision they were
   * the answer to — see CHIP_COLLISION for why they did not until 2.290.0 and
   * why only ONE direction of escalation is available here.
   *
   * A drawn badge or a placed card overlapping a chip sends its OWN room(s) to
   * their own chip. Never the reverse: a chip is already the last tier, so
   * "yield to the badge" has nothing to yield to. That asymmetry is what makes
   * this terminate — `roomClustered` only ever gains keys, and there are
   * finitely many rooms, which is the same monotonicity the existing chip
   * cascade runs on.
   *
   * Boxes, not discs, and that is now expressible: a chip is a wide, short
   * pill (a room name plus a count), so a circumscribed disc would reserve
   * most of its own width above and below itself and chip half the villa.
   * Since 2.287.0 the plane's axes ARE the screen's axes, so an exact
   * axis-aligned test is available where a radial approximation used to be the
   * only honest option. The chip-vs-chip merge in `deriveChips` has always
   * tested boxes for the same reason.
   *
   * Returns the chips to draw; `pending` is pruned in place to the groups that
   * survived.
   */
  private settleChips(
    shown: ShownLabel[],
    boxes: { halfW: number; halfH: number; cy: number }[],
    pending: PendingEntityGroup[],
    clearance: { pxPerWorld: number; basis: ViewBasis } | null,
  ): RoomChip[] {
    // UNMERGED inside the loop — see CHIP_COLLISION. The merge is a function of
    // where the camera stands, so a merged obstacle set would hand the one test
    // that decides what is drawn back to the camera's position, and would let a
    // pill splitting at the next zoom rung drop a brand-new box onto a room
    // that had just expanded. Merging happens once, at the end, to the set that
    // is actually rendered.
    let chips = this.deriveChips(shown, false);
    if (!CHIP_COLLISION || !clearance || clearance.pxPerWorld <= 0) {
      return this.deriveChips(shown);
    }
    const scale = this.effectiveScale();
    const gapPx = this.metrics.minGapPx * scale;
    const focus = this.focusedRooms;
    const half = (this.summaryMetrics().size / 2) * scale;
    // One round per room is the worst case: each has to be able to escalate,
    // and nothing can un-escalate. The `<=` is the belt to that braces.
    for (let round = 0; round <= this.roomDisplay.size; round++) {
      // A chip is drawn ENTIRELY ABOVE its anchor — renderChips sets
      // linkOffsetYInPixels to minus half its height, exactly as a badge and a
      // card do. Measured where it is DRAWN, which is this file's oldest rule
      // and the one 2.288.0 had to restate for badges and cards.
      const chipBoxes = chips.map((c) => {
        const q = this.planeOf(clearance, c.centre.x, c.centre.y, c.centre.z);
        return { cx: q.sx, cy: q.sy - half, hw: c.halfW + gapPx, hh: half + gapPx };
      });
      const clears = (cx: number, cy: number, hw: number, hh: number) => {
        for (const b of chipBoxes) {
          if (Math.abs(cx - b.cx) < hw + b.hw && Math.abs(cy - b.cy) < hh + b.hh) return false;
        }
        return true;
      };
      let escalated = false;
      // Drawn badges. The same three exclusions `fits` applies, for the same
      // reasons: a grouped badge is not drawn, a chipped room's badge is not
      // drawn, and a FOCUSED room's badge blocks nobody and is not allowed to
      // spend its own room's chip either — tapping a room must not be able to
      // make that room disappear.
      for (let i = 0; i < shown.length; i++) {
        const s2 = shown[i];
        if (this.entityGrouped.has(s2.id)) continue;
        const rk = roomKey(this.roomOf(s2.id));
        if (this.roomClustered.get(rk)) continue;
        if (focus.has(rk)) continue;
        if (clears(s2.sx, s2.sy, boxes[i].halfW, boxes[i].halfH)) continue;
        this.roomClustered.set(rk, true);
        escalated = true;
      }
      // Placed summaries, measured at the card they actually draw.
      for (const g of pending) {
        if (g.focused) continue;
        if (g.roomKeys.some((k) => this.roomClustered.get(k))) continue;
        const lay = this.layoutOf(g, g.members.length);
        const hh = (lay.height / 2) * scale;
        if (clears(g.sx, g.sy - hh, (lay.width / 2) * scale, hh)) continue;
        for (const k of g.roomKeys) this.roomClustered.set(k, true);
        escalated = true;
      }
      if (!escalated) break;
      // The EXISTING fixpoint, not a second escalation path — a group whose
      // room just chipped has to take every other room it covered with it or
      // its members are hidden with nothing in their place.
      this.dropEscalatedGroups(pending);
      chips = this.deriveChips(shown, false);
    }
    // Only now, and only for the render: the escalation above is settled, so
    // merging can no longer change which badges are drawn — which is the
    // property its own docstring has always claimed.
    return this.deriveChips(shown);
  }

  /**
   * `merge` is false for the collision pass and true (the default) for the set
   * that gets drawn — see CHIP_COLLISION. It is a parameter rather than two
   * functions so the bucketing, the label fitting and the width estimate can
   * only ever be written once: an obstacle measured by a second copy of that
   * arithmetic would drift from the pill the user actually sees, which is the
   * "layout geometry must equal render geometry" rule this file keeps paying
   * for.
   */
  private deriveChips(shown: ShownLabel[], merge = true): RoomChip[] {
    // Bucket by room, accumulating the centroid and worst state as we go —
    // but only for rooms flagged as grouped THIS frame (cullLabels); everyone
    // else keeps their individual badges and gets no chip at all. Off-screen
    // members of a grouped room are included deliberately: a room's chip
    // should report the whole room's device count, not just the part
    // currently framed, and its centroid should stay put rather than sliding
    // around as members cross the viewport edge.
    // NOTE: no suppressedEntityIds filtering here, deliberately. Every `s` in
    // `shown` already has a real badge, i.e. real mesh/geometry (cullLabels
    // no longer excludes suppressed entities — see its own comment) — so
    // every candidate reaching this loop is, by construction, "mapped".
    // Dashboard.tsx's room-cluster modal call passes filterSuppressed={false}
    // for the exact same reason the category browse does: a diagnostic-in-HA
    // entity someone deliberately bound to a mesh (a UniFi AP's "State"
    // sensor) should count and be listed like any other room member: HA's
    // "diagnostic" classification declutters a flat settings LIST, it isn't
    // a verdict on whether a physically-real, mapped device belongs in a
    // room's device count.
    // One group per ROOM: a summarised room hands over ALL of its badges, so
    // the chip's count is the room's device count and never a subset (see
    // roomClustered).
    // Keyed by roomKey() like roomClustered itself, so two spellings of one
    // HA Area produce one chip rather than two overlapping ones.
    const groups = new Map<string, { ids: string[]; sum: Vector3; ringRed: boolean; unavailable: boolean }>();
    for (const s of shown) {
      const key = roomKey(this.roomOf(s.id));
      if (!this.roomClustered.get(key)) continue;
      let g = groups.get(key);
      if (!g) { g = { ids: [], sum: Vector3.Zero(), ringRed: false, unavailable: false }; groups.set(key, g); }
      g.ids.push(s.id);
      g.sum.addInPlace(s.lbl.anchor.getAbsolutePosition());
      const st = this.lastState.get(s.id);
      if (st) {
        const kind = this.badgeKind(s.lbl.type, st);
        // Same rule as the individual badge ring (BADGE_RING): "on" and
        // "alert" both ring red, "unavailable" does not — dimming is that
        // kind's own signal, not a ring (see BADGE_RING's comment).
        if (kind === "on" || kind === "alert") g.ringRed = true;
        if (kind === "unavailable") g.unavailable = true;
      }
    }

    const scale = this.effectiveScale();

    // ── Chips MERGE under pressure; they are never pushed (2.120.0) ────────
    // A force-relaxation solver used to separate them by displacement; it was
    // removed along with its last caller, and labelLayout.ts's header records
    // what it was and how it failed. The short version: it knew only "these
    // must not overlap" and nothing about where the villa was, so it satisfied
    // that by putting the Master Bedroom chip on the lawn (reported with a
    // screenshot).
    //
    // The invariant that was missing: A CHIP MUST NEVER LEAVE THE ROOM IT
    // NAMES. Capping the nudge cannot deliver that AND "never overlap" — at low
    // zoom there is genuinely no room to separate them. So overlapping chips
    // are now MERGED into one (the map-engine answer) instead of displaced:
    // every chip renders at its own anchor with ZERO offset, and the only way
    // an overlap is resolved is by two chips becoming one. Both properties hold
    // literally and at every zoom level.
    //
    // Merging is by worst overlap first and repeats until nothing overlaps, so
    // the outcome does not depend on room iteration order. The survivor keeps
    // the BUSIER room's name (the more informative one) plus a "+N" suffix, its
    // anchor becomes the device-count-weighted centroid of the merged rooms —
    // so it still sits among the devices it represents — and it owns the union
    // of their entity ids, keeping the tap target correct.
    const cam = this.scene.activeCamera;
    const eng = this.scene.getEngine();
    const vp = cam ? cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()) : null;
    const tm = this.scene.getTransformMatrix();

    // How wide a chip may be DRAWN, expressed in the same units chipWidthPx
    // returns: the viewport's share, divided back through the scale the
    // renderer will multiply by. `scale` carries cssToGui, and the render
    // width carries it too, so the device-pixel ratio cancels and this is a
    // pure fraction of the screen — see CHIP_MAX_VIEWPORT_FRACTION.
    const chipBudget = scale > 0
      ? (eng.getRenderWidth() * CHIP_MAX_VIEWPORT_FRACTION) / scale
      : 0;
    const measure = (c: RoomChip) => {
      c.label = fitChipLabel(c.room, chipSuffixOf(c), formatCountBadge(c.ids.length), chipBudget);
      if (vp) {
        const p = Vector3.Project(c.centre, Matrix.IdentityReadOnly, tm, vp);
        c.x = p.x; c.y = p.y;
      }
      // Same width ESTIMATE the old path used (chipWidthPx) — it only has to be
      // close enough to decide overlap, not match the drawn glyphs exactly.
      c.halfW = (chipWidthPx(`${c.label}  ${formatCountBadge(c.ids.length)}`) / 2) * scale;
      c.halfH = (this.summaryMetrics().size / 2) * scale;
    };

    const chips: RoomChip[] = [];
    for (const [key, g] of groups) {
      // Back to the raw spelling for anything a person reads or taps: the key
      // is a Map key only (CLAUDE.md), and roomDisplay holds what to print.
      const room = this.roomDisplay.get(key) ?? key;
      const c: RoomChip = {
        key, keys: [key], room, label: room, ids: g.ids.slice(), centre: g.sum.scale(1 / g.ids.length), rooms: 1, roomNames: [room],
        ringRed: g.ringRed, unavailable: g.unavailable,
        x: 0, y: 0, halfW: 0, halfH: 0,
      };
      measure(c);
      chips.push(c);
    }

    if (merge && vp && chips.length > 1) {
      const gap = CLUSTER_GAP_PX * scale;
      for (;;) {
        let bi = -1, bj = -1, worst = 0;
        for (let i = 0; i < chips.length; i++) {
          for (let j = i + 1; j < chips.length; j++) {
            const a = chips[i], b = chips[j];
            const ox = a.halfW + b.halfW + gap - Math.abs(b.x - a.x);
            const oy = a.halfH + b.halfH + gap - Math.abs(b.y - a.y);
            if (ox <= 0 || oy <= 0) continue; // clear on at least one axis
            const severity = Math.min(ox, oy);
            if (severity > worst) { worst = severity; bi = i; bj = j; }
          }
        }
        if (bi < 0) break; // nothing overlaps — done
        const a = chips[bi], b = chips[bj];
        const keep = a.ids.length >= b.ids.length ? a : b;
        const drop = keep === a ? b : a;
        const na = a.ids.length, nb = b.ids.length;
        keep.centre = a.centre.scale(na / (na + nb))
          .addInPlace(b.centre.scale(nb / (na + nb)));
        keep.ids = keep.ids.concat(drop.ids);
        keep.rooms = a.rooms + b.rooms;
      // Keep the NAMES, not just the count: a merged chip has to be able to
      // offer the rooms it swallowed when it is tapped, and "+2" cannot.
      keep.roomNames = [...a.roomNames, ...b.roomNames];
        keep.keys = [...a.keys, ...b.keys];
        keep.ringRed = a.ringRed || b.ringRed;
        keep.unavailable = a.unavailable || b.unavailable;
        chips.splice(chips.indexOf(drop), 1);
        measure(keep);
      }
    }

    return chips;
  }

  /**
   * Draw the chips `deriveChips` settled on. Split off it in 2.290.0 so the
   * derivation can run repeatedly inside one pass (see CHIP_COLLISION) without
   * repainting the GUI on every round.
   */
  private renderChips(chips: RoomChip[]): void {
    const layer = this.labelLayer;
    if (!layer) return; // no GUI layer yet — nothing to attach chips to
    const scale = this.effectiveScale();
    const chipRest = categorySurface("others", "off");
    const chipAlert = categorySurface("others", "alert");
    for (const chip of chips) {
      const c = this.ensureCluster(chip.key, layer);
      c.entityIds = chip.ids;
      c.displayName = chip.room;
      c.roomNames = chip.roomNames;
      c.node.position.copyFrom(chip.centre);
      // Room name and count render as separate controls (see ensureCluster).
      // A chip that absorbed others says so with a "+N" suffix, so the count
      // pill's total is never mistaken for one room's device count.
      c.text.text = chip.label;
      c.countText.text = formatCountBadge(chip.ids.length);
      // The chip's own ring mirrors the individual badge ring rule exactly
      // (BADGE_RING): red when at least one member is "on" or "alert",
      // otherwise no ring — the only attention signal available once the
      // individual badges are gone.
      c.container.thickness = chip.ringRed ? this.metrics.ringThicknessPx : 1;
      c.container.color = (chip.ringRed ? chipAlert.ring : chipRest.ring) ?? "transparent";
      // The count pill itself carries the room's REPORTING status — red if
      // at least one member is unavailable (HA has lost contact with it),
      // the same "available" green everywhere else otherwise. Separate
      // signal from the ring above: a room can be fully reporting AND have
      // something on (red ring, green pill) at the same time.
      c.countBadge.background = chip.unavailable ? ALERT_RED_HEX : AVAILABLE_GREEN_HEX;
      // Themed here rather than at creation: a chip outlives a theme change,
      // and Babylon GUI cannot consume a CSS variable, so the value has to be
      // read and re-applied. Doing it on the pass that already runs keeps it in
      // step with the badges without a second notification path.
      // Same neutral resting surface as an idle badge — see updateEntityGroups.
      c.container.background = chipRest.fill;
      c.text.color = chipRest.ink;
      c.container.scaleX = scale;
      c.container.scaleY = scale;
      // ZERO horizontal offset, always: the chip sits exactly on its anchor.
      // The only Y offset is the fixed half-height that centres the chip on
      // that anchor (see ensureCluster) — not a nudge.
      c.container.linkOffsetXInPixels = 0;
      c.container.linkOffsetYInPixels = -(this.summaryMetrics().size / 2) * scale;
      c.container.isVisible = true;
    }
    // Chips with no visible member (floor switch, category filter) — and rooms
    // that were merged INTO another chip this frame — must not leave a stale
    // chip floating over the villa.
    // Compared by roomKey on BOTH sides — this.clusters is keyed by it, and
    // Chip.room is the printable spelling, which would match nothing.
    const livingRooms = new Set(chips.map((c) => c.key));
    for (const [key, c] of this.clusters) {
      if (!livingRooms.has(key)) c.container.isVisible = false;
    }
  }

  /** `key` is a roomKey(), not a display name — see this.clusters. The chip's
   *  visible text is written by the caller from Chip.room. */
  private ensureCluster(key: string, layer: AdvancedDynamicTexture): ClusterControls {
    const existing = this.clusters.get(key);
    if (existing) return existing;

    const node = new TransformNode(`cluster_${key}`, this.scene);
    const container = new Rectangle(`clusterChip_${key}`);
    const sm = this.summaryMetrics();
    container.height = `${sm.size}px`;
    container.adaptWidthToChildren = true;
    // The card badge's own corner treatment, not a stadium: a summary is a
    // badge that happens to be wide, so it rounds like one.
    container.cornerRadius = sm.size * BADGE_CORNER_FRACTION;
    // Neutral slate — NOT the app's accent blue (that's the Energy category's
    // badge colour; a room summary shouldn't read as belonging to a device
    // category) and lighter than a translucent near-black (read as "just
    // black" at a glance). Outside every category hue on purpose, so the
    // chip reads as UI chrome rather than any one category's badge.
    container.thickness = 0;
    container.background = CLUSTER_BG_COLOR;
    container.shadowColor = "rgba(0,0,0,0.4)";
    container.shadowBlur = 6;
    container.shadowOffsetY = 2;
    container.isPointerBlocker = false; // taps resolve via pickClusterAt, like badges

    // Room name — the chip's only FLOW content; the count renders as a
    // corner overlay (below), not inline in this row, so it can't widen or
    // otherwise perturb this text's own layout. Right padding is wide enough
    // to reserve the corner badge's own full footprint (diameter + its inset
    // + a small gap) as dead space the text never renders into — an overlay
    // alone doesn't prevent overlap, since the text box itself still spans
    // the container's full width by default; THIS is what stops a long room
    // name's last letters from landing under the badge (reported: "Guest
    // Bathroom" read as "Guest Bathroo[4]" with the badge over the "m").
    const text = badgeText(`clusterText_${key}`, {
      fontPx: sm.font, color: "#ffffff", weight: "600", metrics: this.metrics,
    });
    // Placeholder only: updateClusters overwrites this with chipLabel(chip)
    // (the raw spelling, plus a "+N" when chips merged) on the same pass that
    // created the control, so the key is never what a person reads.
    text.text = key;
    text.paddingLeft = "12px";
    text.paddingRight = `${sm.countSize + 12}px`;
    container.addControl(text);

    // The device count as a small corner-overlay pill — matching the HUD's
    // unavailable-devices/facility icons' .icon-btn-count CONVENTION (small
    // circle, white bold number, tucked into the top-right corner, INSIDE
    // the parent's own bounds rather than hanging off it — see
    // icon-btn-count's own comment for why: fully inside reads as the normal
    // look for a count badge). A Babylon GUI control can't consume CSS, so
    // the shape/position are re-expressed here rather than literally reused,
    // but utils/countBadge.ts's cap-at-99+ formatting is the exact same
    // function both sides call. Added to `container` (not the room-name row)
    // and LAST, so it paints on top as a true overlay instead of sharing the
    // row's flow — the earlier version put it inline in the row, which read
    // as "a second word next to the room name", not a badge. Its background
    // colour is REPORTING status (red = something unavailable, green =
    // everything reporting), set every update in updateClusters — the value
    // here is just the pre-first-update placeholder.
    const countBadge = new Rectangle(`clusterCount_${key}`);
    countBadge.width = `${sm.countSize}px`;
    countBadge.height = `${sm.countSize}px`;
    countBadge.cornerRadius = sm.countSize / 2;
    countBadge.thickness = 0;
    countBadge.background = AVAILABLE_GREEN_HEX;
    countBadge.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    countBadge.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    // Small INWARD inset (negative left pulls it left off the right edge,
    // positive top pushes it down off the top edge) — tucked just inside
    // the chip's own corner, not straddling/hanging off it.
    countBadge.left = "-3px";
    countBadge.top = "3px";
    container.addControl(countBadge);

    const countText = badgeText(`clusterCountText_${key}`, {
      fontPx: sm.countFont, color: "#ffffff", weight: "700", metrics: this.metrics,
    });
    countBadge.addControl(countText);

    layer.addControl(container);
    container.linkWithMesh(node);
    container.linkOffsetYInPixels = -sm.size / 2;

    const c: ClusterControls = {
      container, text, countBadge, countText, node,
      entityIds: [], displayName: key, roomNames: [],
    };
    this.clusters.set(key, c);
    return c;
  }

  /** Entity ids behind the cluster chip at these CSS-pixel client coords, or
   *  null. Mirrors pickBadgeAt's hit-test approach (Control.contains on the
   *  real drawn box) — see its docstring for why that's the only reliable
   *  way. Checked BEFORE badges by SceneManager: a room's individual badges
   *  are hidden exactly while that room's chip is visible (cullLabels), so a
   *  chip can never steal a tap from a badge the user can actually see. */
  pickClusterAt(clientX: number, clientY: number): { room: string; entityIds: string[]; roomNames: string[] } | null {
    if (this.clusters.size === 0) return null;
    const eng = this.scene.getEngine();
    const canvas = eng.getRenderingCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = (clientX - rect.left) * (eng.getRenderWidth() / rect.width);
    const py = (clientY - rect.top) * (eng.getRenderHeight() / rect.height);
    for (const c of this.clusters.values()) {
      if (!c.container.isVisible) continue;
      // displayName, never the Map key: this string is shown in the room
      // sheet and matched against teleport points, both of which want the
      // room as HA spells it.
      if (c.container.contains(px, py)) {
        return {
          room: c.displayName,
          entityIds: [...c.entityIds],
          roomNames: [...c.roomNames],
        };
      }
    }
    return null;
  }

  /**
   * Resolve a tap/long-press at CSS-pixel client coordinates to the visible
   * badge under it (with a small touch-slop ring), or null if none.
   *
   * Badges deliberately do NOT wire their own Babylon GUI pointer
   * observables (onPointerDownObservable etc.) — that event pipeline races
   * with the camera controllers' pointer capture on touch, which is exactly
   * why tap detection for 3D meshes also lives in the controllers (see
   * PickHandler's header comment). Badge taps resolve through that same
   * proven gesture pipeline, calling here BEFORE falling through to
   * PickHandler's 3D raycast (see SceneManager's constructor).
   *
   * The hit test itself is Babylon GUI's own Control.contains(), which
   * inverse-transforms the point through the exact transform chain used to
   * DRAW the badge (linked-mesh position + linkOffset + container scale,
   * parent matrices composed in — see Control._transformMatrix). Earlier
   * versions re-derived badge screen positions from the anchor's projection
   * and hit-tested a circle there; that stored point is where the ANCHOR
   * projects, not where the badge is drawn — the visible circle renders
   * ~56px ABOVE it (linkOffsetY centres the 76px container above the
   * anchor, and the 40px badge sits at the container's top), so a tap dead
   * on the badge always measured ~56px from the stored centre and missed
   * its 20px radius. Asking the rendered control directly cannot drift from
   * what's on screen, at any scale, zoom, or DPI.
   */
  pickBadgeAt(
    clientX: number, clientY: number,
    /**
     * Log the result.
     *
     * OFF by default, and that default is the point. This runs on every
     * pointermove for the hover cursor AND again from PickHandler's own
     * predicate, i.e. ~60 lines a second while a finger is down, and a real
     * field log came back with thousands of `hit=none (visible=34/90)` lines
     * burying the placement decisions it was collected to show. Only a
     * genuine TAP or long-press asks for the line, which is the only moment
     * "did this resolve to a badge, and if not what was on screen" is a
     * question anyone has.
     */
    verbose = false,
  ): string | null {
    if (this.labels.size === 0) {
      if (verbose) tapDebug(`pickBadgeAt: no badges (labels=${this.labels.size})`);
      return null;
    }
    const eng = this.scene.getEngine();
    const canvas = eng.getRenderingCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    // The GUI layer renders at the engine's render-target size, which differs
    // from CSS client pixels whenever hardware scaling != 1 (see
    // SceneManager's setHardwareScalingLevel) — convert the incoming client
    // coords into that space before hit-testing.
    const scaleX = eng.getRenderWidth() / rect.width;
    const scaleY = eng.getRenderHeight() / rect.height;
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top) * scaleY;

    // Exact hit first, then two widening rings of samples around the tap
    // point so a slightly-off finger still lands — every sample uses the same
    // contains() truth, so the slop can never claim screen space the badge
    // doesn't visually own beyond that ring.
    //
    // The slop is DERIVED from the painted badge rather than fixed at 10px,
    // which is what lets the painted size shrink on a fine pointer without
    // the target shrinking with it: expand until the effective target reaches
    // --touch-min, and never below the 10px this always had. Measured, not
    // assumed, so it holds at any DPR, any entityIconScale and any zoom cap.
    // Same decoupling styles.css already applies to the HUD's icon buttons:
    // "the VISUAL size stays 32px and the TOUCH target is expanded to 44 …
    // which is what the accessibility guidance actually measures (the pointer
    // target area, not the painted pixels)".
    const paintedCssPx = this.metrics.badgeDiameterPx
      * this.iconUserScale * this.iconZoomScale;
    const slopCssPx = Math.max(TAP_SLOP_MIN_CSS_PX, (TOUCH_MIN_CSS_PX - paintedCssPx) / 2);
    const slop = slopCssPx * scaleX;
    // The ring OFFSETS are constant unit vectors, so they are a module
    // constant scaled at use rather than 17 fresh tuples per tap — and this
    // runs on every pointermove frame for the hover tooltip, not only on taps.
    for (let sIdx = 0; sIdx < TAP_RING_UNIT.length; sIdx += 2) {
      const r = sIdx === 0 ? 0 : (sIdx <= 16 ? slop * 0.5 : slop);
      const dx = TAP_RING_UNIT[sIdx] * r;
      const dy = TAP_RING_UNIT[sIdx + 1] * r;
      const hit = this.badgeContaining(px + dx, py + dy);
      if (hit) {
        if (verbose) {
          tapDebug(`pickBadgeAt(${px.toFixed(0)},${py.toFixed(0)}) hit=${hit} offset=${Math.hypot(dx, dy).toFixed(0)}px`);
        }
        return hit;
      }
    }
    if (verbose) {
      let visible = 0;
      for (const lbl of this.labels.values()) if (lbl.container.isVisible) visible++;
      tapDebug(`pickBadgeAt(${px.toFixed(0)},${py.toFixed(0)}) hit=none (visible=${visible}/${this.labels.size})`);
    }
    return null;
  }

  /** The visible badge (or its value pill) containing this render-space
   *  point, via the GUI's own transform-accurate Control.contains().
   *  Iterated newest-first: the GUI draws later-added controls on top, so
   *  when badges overlap the tap goes to the one the user actually sees.
   *
   *  Walks a cached reversed view rather than `[...this.labels].reverse()`.
   *  That copied the ENTIRE label map on every call — and pickBadgeAt calls
   *  this up to 17 times per tap, and once per animation frame while the mouse
   *  moves (hoverBadgeAt), so a 200-badge villa was copying 3,400 entries a
   *  frame just to hover. rebuildLabels is the only place this.labels is
   *  mutated, so that is the only place the cache has to be refreshed. */
  private badgeContaining(x: number, y: number): string | null {
    const list = this.labelsNewestFirst;
    for (let i = 0; i < list.length; i++) {
      const lbl = list[i][1];
      if (!lbl.container.isVisible) continue;
      if (lbl.badge.contains(x, y)) return list[i][0];
      if (lbl.valueWrap.isVisible && lbl.valueWrap.contains(x, y)) return list[i][0];
    }
    return null;
  }

  /** Distil any entity's live state into one of the colour-coded badge kinds.
   *  The per-type "on" vocabulary lives in utils/deviceActivity's
   *  classifyDeviceActivity — shared with Dashboard.tsx's panel-header badge
   *  and SummaryGroupPanel's device list, so all three read a device's
   *  activity identically. Only the linkActiveIds overlay below is specific
   *  to the map (a Babylon-side, confirmed-state-only signal). */
  private badgeKind(type: EntityType, s: HassEntity): BadgeKind {
    // The rule itself lives in utils/deviceActivity (badgeKindFor), shared with
    // every DOM list that draws the same squircle — this method only supplies
    // the one input the map holds differently: a live set of "your linked
    // entity is on", fed by state events. A camera's MOTION sensor is
    // deliberately NOT part of it: that drives the beam/room glow
    // (applyMotionRouting), never the ring, so the two read independently.
    return badgeKindFor(type, s, this.linkActiveIds.has(s.entity_id));
  }

  /** For a device-group PRIMARY, combine its own reading with its members'
   *  (e.g. a temp+humidity combo shows "24°C · 58%" on its one badge instead
   *  of just the primary's temperature). A non-primary entity — or a primary
   *  whose members have no readable value — passes through unchanged, so this
   *  is a no-op for every ordinary single badge. Member states come from
   *  lastState, which apply() now caches for hidden members too. */
  private groupedValue(entityId: string, primaryValue: string): string {
    const group = groupForPrimary(this.config.deviceGroups, entityId);
    if (!group) return primaryValue;
    const parts = primaryValue ? [primaryValue] : [];
    for (const member of group.memberEntityIds) {
      const st = this.lastState.get(member);
      if (!st) continue;
      const t = this.config.entityMap[member]?.type ?? inferTypeFromEntityId(member) ?? "sensor";
      const v = this.compactValue(t, st);
      if (v) parts.push(v);
    }
    return parts.join("  ·  ");
  }

  /** Tiny chip text under the badge for entities whose state is a reading, not just on/off. */
  private compactValue(type: EntityType, s: HassEntity): string {
    if (s.state === "unavailable" || s.state === "unknown") return "";
    switch (type) {
      case "light": {
        const b = s.attributes.brightness as number | undefined;
        return s.state === "on" && b ? `${Math.round((b / 255) * 100)}%` : "";
      }
      case "fan": {
        const p = s.attributes.percentage as number | undefined;
        return s.state === "on" && p != null ? `${Math.round(p)}%` : "";
      }
      case "cover": {
        const pos = s.attributes.current_position as number | undefined;
        return pos != null ? `${Math.round(pos)}%` : "";
      }
      case "climate": {
        const cur = s.attributes.current_temperature as number | undefined;
        return cur != null ? `${Math.round(cur)}°` : "";
      }
      case "sensor":
        return this.formatSensorValue(s);
      default:
        return "";
    }
  }

  /**
   * Compact, readable value for the pill — exhaustive across the kinds of state
   * HA reports, so nothing crowds the chip:
   *   • Numbers → rounded to a sensible precision, with large power/energy scaled
   *     to k-units (6570.989 W → "6.6 kW", 25.05 °C → "25.1°C").
   *   • Enum / text states → tidied (underscores→spaces, Sentence case) so a raw
   *     "not_home" reads "Not home", "connected" reads "Connected".
   *   • Anything still long is ellipsised so the pill can never blow out.
   */
  private formatSensorValue(s: HassEntity): string {
    const unit = ((s.attributes.unit_of_measurement as string | undefined) ?? "").trim();
    const n = Number(s.state);

    // ── Non-numeric (enum / status text) ──────────────────────────────────
    if (s.state.trim() === "" || !Number.isFinite(n)) {
      // Hide a NOMINAL/healthy status ("Connected", "OK", "Normal"…) — the
      // badge is already category-coloured, so the word is redundant clutter.
      // Any OTHER value stays shown (and a known-bad one rings red, see
      // badgeKind), so a state change is never silently lost.
      if (SENSOR_NOMINAL_STATES.has(s.state.trim().toLowerCase())) return "";
      const words = String(s.state).replace(/_/g, " ").trim();
      const pretty = words.charAt(0).toUpperCase() + words.slice(1);
      return this.clampPill(pretty);
    }

    // ── Numeric ───────────────────────────────────────────────────────────
    const abs = Math.abs(n);
    const u = unit.toLowerCase();
    // Round to `d` decimals and drop trailing zeros ("25.0"→"25", "6.60"→"6.6").
    const trim = (v: number, d: number) => String(Number(v.toFixed(d)));

    let out: string;
    if (u === "w" && abs >= 1000) out = `${trim(n / 1000, 1)} kW`;
    else if (u === "wh" && abs >= 1000) out = `${trim(n / 1000, 1)} kWh`;
    else if (u === "va" && abs >= 1000) out = `${trim(n / 1000, 1)} kVA`;
    else if (u === "%") out = `${Math.round(n)}%`;                        // percent hugs its sign
    else if (u === "°c" || u === "°f" || u === "°") out = `${trim(n, 1)}${unit}`; // degrees hug too
    // Units that read cleanest as whole numbers.
    else if (u === "w" || u === "wh" || u === "va" || u === "lx" || u === "ppm" || u === "ppb")
      out = unit ? `${Math.round(n)} ${unit}` : String(Math.round(n));
    // Generic: whole numbers as-is, otherwise up to 1 decimal.
    else {
      const val = Number.isInteger(n) ? String(n) : trim(n, 1);
      out = unit ? `${val} ${unit}` : val;
    }
    return this.clampPill(out);
  }

  /** Hard cap on pill text so an unexpectedly long value can never blow out the
   *  chip; keeps every pill to a tidy, uniform footprint. */
  private clampPill(text: string): string {
    return text.length > 16 ? `${text.slice(0, 15)}…` : text;
  }

  // ---------------------------------------------------------------------------
  // Mesh visuals
  // ---------------------------------------------------------------------------

  private emissiveOf(mesh: AbstractMesh): ((c: Color3) => void) | null {
    const mat = mesh.material as Material | null;
    if (!mat) return null;
    if (mat instanceof PBRMaterial) return (c) => (mat.emissiveColor = c);
    if (mat instanceof StandardMaterial) return (c) => (mat.emissiveColor = c);
    return null;
  }

  /** Red outline + translucent overlay while a climate device is running
   *  (state !== "off"), cleared otherwise — see CLIMATE_ON_COLOR. */
  private applyClimateOutline(mesh: AbstractMesh, on: boolean): void {
    if (!(mesh instanceof Mesh)) return;
    if (!on) {
      if (mesh.renderOutline || mesh.renderOverlay) {
        mesh.renderOutline = false;
        mesh.renderOverlay = false;
      }
      return;
    }
    const unit = axisWorldScale(mesh);
    const localScale = unit.x || unit.y || unit.z || 1;
    mesh.outlineColor = CLIMATE_ON_COLOR;
    mesh.outlineWidth = CLIMATE_OUTLINE_WORLD_WIDTH / localScale;
    mesh.renderOutline = true;
    mesh.overlayColor = CLIMATE_ON_COLOR;
    // 0.3 blended so faintly with the device's own (often light-coloured)
    // material that it read as pale pink rather than red — see colors.ts.
    mesh.overlayAlpha = 0.55;
    mesh.renderOverlay = true;
  }

  private diffuseOf(mesh: AbstractMesh): ((c: Color3) => void) | null {
    const mat = mesh.material as Material | null;
    if (!mat) return null;
    if (mat instanceof StandardMaterial) return (c) => (mat.diffuseColor = c);
    if (mat instanceof PBRMaterial) return (c) => (mat.albedoColor = c);
    return null;
  }

  /** Resolve a light's colour from its attributes (hs > kelvin > warm white). */
  private lightColour(state: HassEntity): Color3 {
    const a = state.attributes;
    if (a.hs_color) {
      const { r, g, b } = hsToRgb(a.hs_color[0], a.hs_color[1]);
      return new Color3(r, g, b);
    }
    if (a.color_temp_kelvin) {
      const { r, g, b } = kelvinToRgb(a.color_temp_kelvin);
      return new Color3(r, g, b);
    }
    return WARM_GLOW.clone();
  }

  /**
   * Make walls actually block a lamp's light. Always-on (no quality toggle): a
   * single cube shadow map per light ENTITY, attached to its representative
   * (first) fixture light, since the markers of a strip are clustered and one
   * occluder covers them — so a 12-marker strip costs one shadow map, not 12. The
   * un-shadowed sibling markers stay out of the next room via the tight LIGHT_RANGE.
   * Created lazily when the entity turns on and disposed when it turns off, so an
   * idle/off light costs nothing. Called once per entity from apply().
   */
  private syncEntityShadow(entityId: string, meshes: AbstractMesh[], on: boolean): void {
    // Baked mode DOES have entity lights now (they light the furniture — see the
    // light-creation block), but deliberately NO shadow maps: wall shadows are
    // already painted into the baked atlas, and per-fixture furniture shadows
    // aren't worth the cube-shadow-map cost the user asked us to keep low.
    if (this.bakedMode) return;
    const existing = this.lightShadows.get(entityId);

    if (!on) {
      if (existing) {
        existing.dispose();
        this.lightShadows.delete(entityId);
      }
      return;
    }
    if (existing) return; // already casting

    // Representative light = the first fixture mesh that owns a PointLight.
    let light: PointLight | undefined;
    for (const m of meshes) {
      light = this.meshLights.get(m.uniqueId);
      if (light) break;
    }
    if (!light) return;

    const gen = new ShadowGenerator(LIGHT_SHADOW_SIZE, light);
    gen.usePoissonSampling = true; // cheap soft edge; blur-ESM isn't supported for cube maps
    const shadowMap = gen.getShadowMap();
    if (shadowMap) {
      shadowMap.renderList = this.shadowCasters.slice();
      for (const caster of this.shadowCasters) caster.receiveShadows = true;
      // ── Render ONCE, not every frame (the app's biggest idle GPU cost) ────
      // Babylon's ObjectRenderer defaults refreshRate to 1 =
      // REFRESHRATE_RENDER_ONEVERYFRAME, and a PointLight needs a CUBE map, so
      // every lit fixture was re-rendering the entire shadowCasters list — the
      // whole villa shell plus furniture — SIX times per frame, on every frame
      // the scene drew. With the handful of lights a villa normally leaves on
      // that is tens of full-geometry depth passes per frame, forever, and it
      // dominated the main camera pass. Reported as the device heating slowly
      // for as long as the app stayed open, which fits exactly: lights-on is
      // the resting state of a house, so this ran essentially always.
      //
      // Rendering once is CORRECT here, not a quality trade: a shadow map is
      // rendered from the LIGHT's point of view, so it is independent of the
      // camera — panning, walking and zooming cannot change it. The lights are
      // fixed at their fixture positions and the casters are static villa
      // shell/furniture, so the map's content only changes when the set of
      // VISIBLE occluders does. invalidateShadowMaps() re-renders it for
      // exactly those events (floor switch, pose swap); nothing else needs to.
      shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }
    this.lightShadows.set(entityId, gen);
  }

  /** Re-render every live shadow map ONCE on the next frame.
   *
   *  Call whenever the set of VISIBLE shadow-casting geometry changes — a
   *  floor switch hiding/showing a storey, or a pose variant swapping a door
   *  or cover mesh. Deliberately NOT called for camera movement or for a
   *  light's own brightness/colour: neither can alter a depth map rendered
   *  from the light's position, so re-rendering for those would reintroduce
   *  the per-frame cost this exists to avoid.
   *
   *  resetRefreshCounter() puts the map back into its "never rendered" state,
   *  which makes the next frame draw it once and then stop again. */
  private invalidateShadowMaps(): void {
    if (this.lightShadows.size === 0) return;
    for (const gen of this.lightShadows.values()) gen.getShadowMap()?.resetRefreshCounter();
    this.requestRender();
  }

  private applyToMesh(mesh: AbstractMesh, map: EntityMapping, state: HassEntity, lightShare = 1): void {
    const setEmissive = this.emissiveOf(mesh);
    const setDiffuse = this.diffuseOf(mesh);

    switch (map.type) {
      case "light": {
        const on = state.state === "on";
        const colour = this.lightColour(state);
        const brightnessFrac = state.attributes.brightness ? state.attributes.brightness / 255 : 1;
        // Per-light override (Advanced Settings, -100%..+100%): a ratio applied
        // ON TOP of the entity's live brightness, so one fixture can be tuned
        // brighter/dimmer than its HA dimmer level alone would produce — e.g. a
        // light whose SweetHome placement reads darker than the others —
        // without touching the global "Light effect strength" slider that
        // affects every light. 0 = no change; -100% = off; +100% = double.
        const effectiveFrac = brightnessFrac * (1 + clampRatio(map.lightIntensityRatio));

        // 1) The fixture mesh glows.
        setEmissive?.(on ? colour.scale(effectiveFrac) : Color3.Black());

        // EVERY light fixture mesh — an inflated LED strip bar, a geometry-
        // less marker sphere, or a fully modelled bulb/fixture straight from
        // the SweetHome catalog — goes window-glass transparent while off
        // and fully opaque again once on (see STRIP_OFF_ALPHA for why
        // material alpha, not mesh.visibility). Applied unconditionally, by
        // TYPE alone (map.type === "light"), not by guessing which meshes
        // "look like" stand-in geometry from their size/name — any current
        // or future light asset gets this for free, no per-fixture setup.
        const fixtureMat = mesh.material;
        if (fixtureMat) {
          fixtureMat.alpha = on ? 1 : STRIP_OFF_ALPHA;
          fixtureMat.transparencyMode = on
            ? Material.MATERIAL_OPAQUE
            : Material.MATERIAL_ALPHABLEND;
        }

        // 2) This fixture mesh's own light source illuminates the room.
        //    A single HA light is frequently modelled in SweetHome 3D as MANY
        //    co-located virtual markers (e.g. a LED strip drawn as 8–12 point
        //    lights for a soft, diffuse spread). Each marker becomes its own
        //    PointLight, and point lights are ADDITIVE — 12 markers at full
        //    intensity would blow out to solid white. Normalise by the number of
        //    DISTINCT lights sharing this entity (lightShare, computed in apply())
        //    so the whole group reads as one fixture's worth of light, regardless
        //    of how many markers/meshes model it or whether they share one merged
        //    light (mergeStripEntityLights).
        const light = this.meshLights.get(mesh.uniqueId);
        if (light) {
          light.diffuse = colour;
          // lightPoolStrength (Settings' global "Light effect strength")
          // scales the DYNAMIC light too, not just baked-mode pools — before
          // this, the slider was a silent no-op on a non-baked GLB, where
          // room illumination comes from these real PointLights.
          light.intensity = on
            ? (MAX_LIGHT_INTENSITY * effectiveFrac * this.lightPoolStrength) / lightShare
            : 0;
          // Drop the light out of (or back into) shaders entirely with its state,
          // so only lights that are actually on add per-pixel cost.
          light.setEnabled(on);
        }
        // Baked mode's counterpart to the light above — see LightPools.ts.
        // `mesh.isEnabled()` folds in FloorManager's floor toggle: a fixture
        // on a currently-hidden floor must not light its pool even if the HA
        // entity itself is "on" (see resyncLightPoolsToFloor for the other
        // direction — a floor SWITCH with no entity-state change).
        const pools = this.meshLightPools.get(mesh.uniqueId);
        if (pools) {
          for (const pool of pools) {
            pool.setState(on && mesh.isEnabled(), colour, effectiveFrac * this.lightPoolStrength);
          }
        }
        // Wall occlusion is handled once per entity in apply(), not per mesh.
        break;
      }

      case "lock": {
        // A lock authored as POSE meshes (lock.foo__locked / __unlocked — a
        // door leaf that visibly swings open/closed) communicates its state
        // through which pose is shown (see applyMeshVariant), so the
        // red/green diffuse+emissive tint is both redundant AND ugly: it
        // paints the whole door leaf flat green/red. Skip ALL colour
        // treatment for a named pose mesh and let it keep its real door
        // material; the state is already legible from the open/closed pose.
        // A plain, single-mesh lock (lock.foo, no "__word" suffix) has no
        // pose to read, so it still relies on the tint below — that's the
        // one that stays coloured. Checked against THIS entity's own
        // registered poses (meshVariants), not a fixed word list: there is no
        // per-type vocabulary any more, so "is this mesh actually one of its
        // poses" is both the only question that still makes sense and a
        // strictly tighter test than the old list (an unrelated "__x" suffix
        // that never grouped as a pose can't match).
        const poseWord = extractVariantSuffix(mesh.name);
        if (poseWord && this.meshVariants.get(state.entity_id)?.has(poseWord)) break;

        // unavailable MUST win over the locked/unlocked colouring below —
        // colouring the mesh confirmed-red for a lock HA has actually lost
        // contact with asserts an "unlocked" reading that was never taken
        // (the bug this fixed: a lock reporting "unavailable" rendered, on
        // the map AND in its panel, exactly like a confirmed open door).
        if (isUnavailable(state)) {
          setDiffuse?.(UNAVAILABLE_AMBER);
          setEmissive?.(UNAVAILABLE_AMBER.scale(0.25));
          break;
        }
        const locked = state.state === "locked";
        setDiffuse?.(locked ? new Color3(0.2, 0.75, 0.3) : new Color3(0.9, 0.2, 0.2));
        setEmissive?.(locked ? new Color3(0.0, 0.15, 0.05) : new Color3(0.25, 0, 0));
        break;
      }

      case "binary_sensor": {
        // Same reasoning as lock's pose meshes: a binary_sensor authored
        // with alternate poses (e.g. "__on"/"__off", or a door/window
        // "__open"/"__closed") already shows its state by which pose is
        // visible, so pulsing/tinting that same mesh red on top would be
        // redundant (and, for a triggered-but-informational class, actively
        // misleading — it'd read as an alert the device_class says it
        // isn't). Checked against THIS entity's actually-registered pose
        // words (meshVariants), not a fixed list — binary_sensor has no
        // fixed vocabulary any more, so "is this mesh
        // really one of ITS poses" is the only question that still makes
        // sense. The plain, single-mesh case (the overwhelming majority of
        // binary_sensors — leak/motion/smoke/… — never authored with poses)
        // is completely unaffected and still pulses exactly as before.
        const poseWord = extractVariantSuffix(mesh.name);
        if (poseWord && this.meshVariants.get(state.entity_id)?.has(poseWord)) {
          this.pulsing.delete(mesh);
          break;
        }

        // Same reasoning as lock above: silently reading "unavailable" as
        // "not triggered" makes an offline leak/smoke sensor look exactly
        // like a safe, monitored one — flag it instead of going quiet.
        if (isUnavailable(state)) {
          this.pulsing.delete(mesh);
          setEmissive?.(UNAVAILABLE_AMBER.scale(0.4));
          break;
        }
        const alert = state.state === "on"; // "on" = triggered (e.g. leak)
        if (alert) this.pulsing.add(mesh);
        else {
          this.pulsing.delete(mesh);
          setEmissive?.(Color3.Black());
        }
        break;
      }

      // No emissive tint for on/off — a spinning ceiling fan (see updateFanSpin)
      // already reads as "on" by itself; a glow was redundant and, per product
      // decision, unwanted.
      case "fan":
        setEmissive?.(Color3.Black());
        break;

      case "switch":
      case "media_player": {
        const on = state.state === "on" || state.state === "playing";
        setEmissive?.(on ? new Color3(0.1, 0.35, 0.4) : Color3.Black());
        break;
      }

      // No per-mesh material/colour treatment for covers — a single curtain
      // mesh is never deformed/scaled to fake motion (fabric doesn't behave
      // like a rigid body, and there's no reliable way to infer a gather
      // pivot from arbitrary SweetHome3D geometry). Position IS reflected
      // now, but as a whole-mesh SWAP between up to 3 alternate, pre-posed
      // meshes (see applyMeshVariant) — that's an
      // entity-level decision (which mesh to show), not a per-mesh one, so
      // it happens once in apply(), not here. Kept as an explicit case (not
      // falling to default) so a cover doesn't get treated as something else.
      case "cover":
        break;

      // Purely informational domains — never meant to glow. Explicit (not
      // `default`) because a geometry-less sensor/climate device falls back
      // to a placeholder sphere sharing the SAME warm-emissive marker
      // material lights use (see blender_pipeline's _light_marker_material:
      // "the app overrides its emissive from live HA state ... the baked
      // baseline only makes an UNWIRED marker visible"). Every other domain
      // above does override it; sensor/climate never did, so a sensor that
      // fell back to a placeholder (e.g. its real geometry got matched to a
      // nearby entity instead — see compute_group_instance_map) stayed at
      // that baked-in glow forever, reading as "lit like a light fixture".
      case "sensor":
        setEmissive?.(Color3.Black());
        break;

      case "climate": {
        setEmissive?.(Color3.Black());
        const running = state.state !== "off" && state.state !== "unavailable" && state.state !== "unknown";
        this.applyClimateOutline(mesh, running);
        break;
      }

      default:
        break;
    }
  }

  private animatePulse(dtMs: number): void {
    if (this.pulsing.size === 0 && !this.beams.hasActive()) return;
    this.pulseT += (dtMs / 1000) * PULSE_RAD_PER_SEC;
    const intensity = (Math.sin(this.pulseT) + 1) / 2; // 0..1
    // Reused, not rebuilt: this runs every frame for as long as an alert stays
    // triggered, and re-arms the render loop itself (below), so a `new Color3`
    // here is a permanent allocation stream on a kiosk nobody is touching.
    const col = this.pulseColor;
    col.r = intensity;
    col.g = 0;
    col.b = 0;
    for (const mesh of this.pulsing) this.emissiveOf(mesh)?.(col);
    this.beams.applyPulse(intensity);
    this.requestAnimationRender();
  }

  /** Start/stop a fan's spin from its on/off (+ percentage) state. Only true
   *  CEILING fans spin — VMC/exhaust `fan.*` entities (bathroom vents) must not. */
  private updateFanSpin(entity: HassEntity, meshes: AbstractMesh[]): void {
    const id = entity.entity_id;
    if (!/ceiling[_-]?fan/i.test(id)) return; // e.g. fan.ceiling_fan_* only
    if (entity.state === "on") {
      const pct = entity.attributes.percentage as number | undefined;
      const frac = typeof pct === "number" ? Math.max(0.15, Math.min(1, pct / 100)) : 0.6;
      if (!this.fanRigs.has(id)) {
        const rig = this.setupFanRig(meshes);
        this.fanRigs.set(id, rig);
        this.detachFanLabelAnchor(id, rig);
      }
      this.spinningFans.set(id, FAN_MAX_RAD_PER_SEC * frac);
      this.requestRender(); // wake the loop so animateFans starts turning it
    } else {
      this.spinningFans.delete(id);
    }
  }

  /**
   * Rig each of the fan's meshes to spin in place around its TRUE axle.
   *
   * Two earlier approaches both broke on this exact mesh shape:
   *  - `rotateAround` re-derives its pivot offset from the mesh's CURRENT
   *    `.position` every call (`point - this.position`), so it only spins in
   *    place when the pivot is *exactly* that position. These fan meshes
   *    import with `.position` at the parent-local origin (0,0,0) — the real
   *    placement is baked entirely into vertex data — so any vertex-derived
   *    pivot orbited the whole mesh (and, since the label anchors to that
   *    same mesh, the label with it).
   *  - `mesh.setPivotPoint()` fixes the orbit mathematically (verified by
   *    hand), but the badge's position tracking (Babylon GUI's
   *    `linkWithMesh`) projects the mesh's *local* bounding-sphere centre
   *    through `getWorldMatrix()` each frame — an interaction with the pivot
   *    matrix I could not fully rule out without a browser, and empirically
   *    it made the fan (mesh AND label) disappear on "on" and never return.
   *
   * This version touches neither: an invisible `TransformNode` ("pivot") is
   * planted at the mesh's true axle and the mesh is REPARENTED under it
   * (`setParent` — a mechanism already used everywhere else in this app —
   * adjusts the mesh's local position/rotation to compensate, so nothing
   * visually moves at the moment of reparenting). Only `pivot.rotationQuaternion`
   * is ever touched afterwards; the mesh's OWN transform, pivot matrix and
   * bounding info stay exactly what they always were, so the badge (and
   * everything else that reads the mesh directly) can't be affected.
   *
   * The axle itself: average the vertices in the TOP slice of the fixture —
   * along whichever LOCAL axis currently reads as world-vertical, see
   * FAN_AXIS_TOP_SLICE — since the ceiling mount/canopy is reliably round and
   * centred exactly on the true axle, unlike the whole fixture's bounding box
   * (which assumes the blade assembly is perfectly symmetric; it usually
   * isn't quite).
   */
  private setupFanRig(
    meshes: AbstractMesh[],
  ): { mesh: AbstractMesh; pivot: TransformNode; axisLocal: Vector3 }[] {
    const rig: { mesh: AbstractMesh; pivot: TransformNode; axisLocal: Vector3 }[] = [];
    for (const m of meshes) {
      const positions = m.getVerticesData(VertexBuffer.PositionKind);
      if (!positions || positions.length < 3) continue;
      m.computeWorldMatrix(true);

      // The LOCAL (pre-rotation) direction that currently reads as
      // world-vertical — NOT necessarily local Y: these fixtures import with
      // a baked axis-conversion rotation (SweetHome's Z-up -> glTF's Y-up),
      // so the mesh's own un-rotated vertex data has "up" on a different
      // axis. Deriving it (rather than assuming Y or Z) keeps this correct
      // regardless of how any given model happens to be authored/exported.
      const invWorld = Matrix.Invert(m.getWorldMatrix());
      const axisInMeshSpace = Vector3.TransformNormal(Vector3.Up(), invWorld);
      axisInMeshSpace.normalize();

      // Project every vertex onto that axis to find the fixture's "height"
      // range, then average the positions in its top slice — in the mesh's
      // OWN local/object space, the same space getVerticesData returns, so
      // no world-matrix round-trip is needed for this part.
      const v = Vector3.Zero();
      let hMin = Infinity, hMax = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]);
        const h = Vector3.Dot(v, axisInMeshSpace);
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
      const topThreshold = hMax - (hMax - hMin) * FAN_AXIS_TOP_SLICE;
      const sum = Vector3.Zero();
      let sampled = 0;
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]);
        if (Vector3.Dot(v, axisInMeshSpace) >= topThreshold) { sum.addInPlace(v); sampled++; }
      }
      // Fall back to the plain local bbox midpoint if the top slice somehow
      // caught too little geometry to average reliably (e.g. a sparse mount).
      const bb = m.getBoundingInfo().boundingBox;
      const axleLocal = sampled >= 20 ? sum.scale(1 / sampled) : bb.minimum.add(bb.maximum).scale(0.5);
      if (!Number.isFinite(axleLocal.x) || !Number.isFinite(axleLocal.y) || !Number.isFinite(axleLocal.z)) continue;

      const axleWorld = Vector3.TransformCoordinates(axleLocal, m.getWorldMatrix());
      const parent = m.parent;
      const parentWorld = parent?.getWorldMatrix?.();
      const pivot = new TransformNode(`fanPivot_${m.uniqueId}`, this.scene);
      pivot.parent = parent;
      pivot.position = parentWorld
        ? Vector3.TransformCoordinates(axleWorld, Matrix.Invert(parentWorld))
        : axleWorld;

      // Reparent the mesh under the pivot — setParent adjusts the mesh's own
      // local position/rotation so its WORLD transform (and therefore its
      // on-screen appearance) is unchanged by this move.
      m.setParent(pivot);

      // The axis the PIVOT itself rotates around, in ITS parent's local space
      // (the shared original parent — pivot has no rotation of its own
      // besides the spin animateFans applies, so this is just world-up
      // projected through that parent's own orientation).
      const axisLocal = parentWorld
        ? Vector3.TransformNormal(Vector3.Up(), Matrix.Invert(parentWorld)).normalize()
        : Vector3.Up();

      rig.push({ mesh: m, pivot, axisLocal });
    }
    return rig;
  }

  /**
   * The label anchor is parented to the entity's first mesh (see
   * buildLabelAnchors — it inherits enabled/floor state that way), which is
   * exactly why the badge was STILL orbiting after 2.23.1's mesh-pivot fix:
   * `setupFanRig` reparents that same mesh under the spin `pivot`, so the
   * anchor — a grandchild of `pivot` via the mesh — got dragged into the
   * rotating subtree too, even though the mesh's own transform relative to
   * its new parent never changes. Move it back OUT, onto the pivot's own
   * (non-rotating) parent — `setParent` preserves its current world
   * position, so the badge stays exactly where it already was, just no
   * longer inside anything that spins.
   *
   * This intentionally breaks the anchor's OWN parent chain as a source of
   * floor enabled-state/floorIndex (the pivot's parent is a shared container
   * FloorManager never touches) — cullLabels() compensates by reading those
   * straight off the entity's bound mesh instead of the anchor's parent, so
   * the fan's badge still correctly disappears on the other floor.
   */
  private detachFanLabelAnchor(
    entityId: string,
    rig: { mesh: AbstractMesh; pivot: TransformNode; axisLocal: Vector3 }[],
  ): void {
    const anchor = this.labelAnchors.get(entityId);
    const primary = rig[0];
    if (!anchor || !primary || anchor.parent !== primary.mesh) return;
    anchor.setParent(primary.pivot.parent);
  }

  private animateFans(dtMs: number): void {
    if (this.spinningFans.size === 0) return;
    const dt = dtMs / 1000;
    let spun = false;
    for (const [id, speed] of this.spinningFans) {
      const rig = this.fanRigs.get(id);
      if (!rig || !rig.length) continue;
      // Only spin (and keep rendering) while the fan's storey is being viewed —
      // floors above the active one are hidden, so their fans needn't drive
      // continuous frames. (Cumulative floors: <= active are visible.)
      const floorIdx = (rig[0].mesh.metadata as { floorIndex?: number } | null)?.floorIndex;
      if (floorIdx !== undefined && floorIdx > this.activeFloor) continue;

      // The TOTAL angle, wrapped — every frame recomputes rotation fresh from
      // this absolute value (never accumulated), so there is nothing for
      // floating-point error to drift.
      const angle = ((this.fanAngles.get(id) ?? 0) + speed * dt) % (Math.PI * 2);
      this.fanAngles.set(id, angle);
      for (const { pivot, axisLocal } of rig) {
        // Write THROUGH the existing quaternion rather than replacing it: a
        // ceiling fan left on is the normal state in a villa, and this runs
        // every frame forever for each of its blade rigs (animateFans re-arms
        // the render loop below), so allocating one per rig per frame is a
        // permanent garbage stream. Created once on first use.
        if (!pivot.rotationQuaternion) {
          pivot.rotationQuaternion = Quaternion.RotationAxis(axisLocal, angle);
        } else {
          Quaternion.RotationAxisToRef(axisLocal, angle, pivot.rotationQuaternion);
        }
      }
      spun = true;
    }
    if (spun) this.requestAnimationRender();
  }
}
