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

import type { Observer } from "@babylonjs/core/Misc/observable";
import { FrameClock } from "./frameClock";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { sliceChanged } from "./entityMapDiff";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import type { Viewport } from "@babylonjs/core/Maths/math.viewport";
// Type-only: annotates the viewport cullLabels already computes and passes to
// Vector3.ProjectToRef. A `import type` adds no runtime import, so it cannot
// disturb the side-effect import discipline this file depends on elsewhere.
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { Scene } from "@babylonjs/core/scene";
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
  badgeMetricsFor, detectPointerClass, observePointerClass, type BadgeMetrics, type PointerClass,
  CHIP_MAX_VIEWPORT_FRACTION, CARD_MAX_VIEWPORT_FRACTION,
  PHONE_MAX_CSS_WIDTH,
  snapToZoomLattice,
  SUMMARY_TEXT_OF_HEIGHT, VALUE_CHAR_ADVANCE,
} from "./badgeMetrics";
import { badgeRank } from "./badgePriority";
import {
  viewBasis, projectToView, VIEW_BASIS_STEPS,
  type ViewBasis, type ProjectedPoint, type ProjectionMode,
} from "./badgeProjection";
import {
  solvePlacement, markContacts, createPlacementScratch,
  type PlacementItem, type PlacementScratch, type PlacementStats,
} from "./badgePlacement";
import { clampIconScale } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";
import { resolveMeshToMapping, extractVariantSuffix, hasVariantSuffix, inferTypeFromEntityId } from "@/config/EntityMap";
import { groupMemberIds, groupForPrimary } from "@/config/deviceGroups";
import { effectiveCategory, subjectOf, categorySurface, categorySurfaceRinged } from "@/config/EntityCategories";
import { badgeKindFor, badgeFaceAndRing, meshLookFor, type DeviceReading } from "@/utils/deviceActivity";
import { alertStateFor } from "@/config/BinarySensorClasses";
import type { BadgeKind } from "@/utils/deviceActivity";
import { hsToRgb, kelvinToRgb } from "@/utils/colorUtils";
import { compactValue, VALUE_CAPABLE_TYPES } from "@/utils/entityValue";
import { mergeOverlapping } from "./boxMerge";
import { phantomEntity } from "@/utils/phantomEntity";
import { channelEnabled, tapDebug } from "@/utils/tapDebug";
import { debugFlagEnabled } from "@/utils/devLog";
import { beginSpan } from "@/utils/perfSpans";
import { pointInPolygon } from "@/utils/geometry";
import { formatCountBadge } from "@/utils/countBadge";
import { RoomHighlight } from "./RoomHighlight";
import { CameraBeams, type BeamSource } from "./CameraBeams";
import { blocksCameraBeam, isResolvedCeiling, isHelperMesh } from "./meshRoles";
import { Storeys } from "./storeys";
import { FloorProbe } from "./floorProbe";
import { axisWorldScale } from "./meshUnits";
import type { LightReading } from "./lightPoolSet";
import { OcclusionSweep } from "./occlusionSweep";
import { bucketRoomChips, combineChips, chipSuffixOf, type RoomChip } from "./roomChips";
import { rungAt, referenceDepthAt, iconZoomAt, viewportPx } from "./badgeScale";
import { solveRoomZoom } from "./roomZoomSolver";
import { RoomFocus } from "./roomFocus";
import { PlacementCheck, type ScreenBox } from "./placementCheck";
import { FanRigs } from "./fanRigs";
import { PlacementPass, GROUP_OVERLAP_ALLOW_WIDTHS, type ShownLabel, type PendingEntityGroup } from "./placementPass";
import { onGlass, glyphDrawPx, glyphBakePx } from "./badgeLayout";
import type { FrameRequests } from "./frameScheduler";
import { badgeImageDataUrl, BADGE_INSET_CARD, BADGE_CORNER_FRACTION, RING_DASH } from "./badgeIcons";
import { DashableRectangle } from "./dashableRectangle";
import { badgeText } from "./badgeText";
import { badgeShadow } from "./badgeShadow";
import { cameraFrame } from "./cameraFrame";
import {
  arrange, cardStruts, gridCells, MAX_TOTAL_CHIPS, MAX_GRID_CHIPS, PHONE_MAX_GRID_CHIPS,
  type CardArrangement,
} from "./badgeCard";
import { iconKeyFor } from "./badgeIconKeys";
import { ALERT_RED, ALERT_RED_HEX, UNAVAILABLE_AMBER, AVAILABLE_GREEN_HEX, SECURE_GREEN, ACTIVE_GLOW } from "./colors";
import { COSMETIC_MAPPING_FIELDS, entityMapDelta } from "./entityMapDiff";
// Pose-word resolution (which "__<word>" mesh variant a live state asks for)
// — pure logic, extracted to keep this file to the things that actually touch
// the scene. See meshVariants.ts for the vocabulary rules themselves.
import {
  pickNearestVariant, desiredVariantWord, orderVariantWords,
} from "./meshVariants";
// Pure label/chip overlap geometry — see labelLayout.ts.
import { chipWidthPx, fitChipLabel, type ChipTextMetrics } from "./labelLayout";
// Babylon prototype patches this module depends on — see babylonSideEffects.
import { BulbSet, WARM_GLOW, STRIP_MIN_LENGTH, type BulbReading } from "./bulbSet";
import { lightingModeFor, type LightingMode } from "./lightingMode";
import "./babylonSideEffects";

// Baseline emissive for an UNWIRED light marker (no HA state yet). SweetHome
// ceiling spots / LED strips export as small placeholder spheres; at the old
// 0.18 they were almost invisible — especially the clustered ones (Bedroom 1
// ceiling, the living-room LED strips) where 12 faint 10 cm dots at the ceiling
// read as "missing". Lifted so every fixture reads as a real object before it's
// wired; applyToMesh still overrides this from live HA state (on = bright, off
// = black).
const LIGHT_BASELINE_GLOW = 0.5;
/** Clamp a per-light intensity override (Advanced Settings, -100%..+100%,
 *  stored as -1..1) to a safe range — a stale/hand-edited config value
 *  outside that range must not blow the fixture out or invert it. */
function clampRatio(ratio: number | undefined): number {
  return Math.max(-1, Math.min(1, ratio ?? 0));
}


// Strips — what counts as one, and why its light is lowered: bulbSet.ts.

/**
 * Every `PLACEMENT:` assertion, on the `place` channel — one call so sixteen
 * sites cannot drift apart, and so the whole family is muted or restored by one
 * word (`?debug=place`). It is muted by default since 2.436.0: the grouping tier
 * is settled, and these lines plus the solver's `pair` detail were ~95% of a
 * capture, drowning the question the capture was actually taken to answer.
 *
 * ⚠️ Muted, NOT deleted — see MUTED_BY_DEFAULT in tapDebug.ts. These are the
 * only guard against a badge silently disappearing, and the banner on every
 * capture names them so a silent tier cannot be misread as a clean one.
 */
function placeDebug(msg: string): void {
  tapDebug(msg, "place");
}

// ── First-person wall occlusion (see refreshWallOcclusion) ──────────────────
/**
 * How long a settled pass may spend casting, before it stops and leaves the
 * rest of the sweep to the next frame.
 *
 * ⚠️ A TIME budget, because a RAY-COUNT budget is a budget in the wrong unit —
 * and that mistake shipped. An owner capture measured the same eight rays at
 * 7 ms in one pose and 121 ms in another: a baked villa's structure is ~150
 * material primitives per storey whose bounding boxes each span the whole
 * building, so nothing is rejected cheaply and a ray that hits nothing is the
 * most expensive kind. A count that is affordable in a corridor is four dropped
 * frames looking down the hall. Milliseconds are the same everywhere.
 *
 * Only ever spent while the camera is STILL (see refreshWallOcclusion), so this
 * is not competing with a frame anyone is watching move.
 */
const OCCLUSION_MS_BUDGET = 8;
const OCCLUSION_MS_COARSE = 4;
/** How long the eye must hold still before the sweep resumes. Long enough that
 *  a walk of many small steps never triggers it, short enough that stopping to
 *  look at something settles before you have finished looking. */
const OCCLUSION_SETTLE_MS = 250;
/** Devices closer than this are in the room with you by definition — testing
 *  them buys nothing and a very short ray is the one most likely to clip the
 *  surface the device is mounted on. */
const OCCLUSION_NEAR_M = 1.2;
/** How far short of the anchor the ray stops. A device is normally mounted ON
 *  a wall or under a ceiling, so a ray that reaches its anchor ends inside that
 *  surface and reports the device as occluded by the thing it is attached to. */
const OCCLUSION_SLACK_M = 0.35;
/** One-word revert for the whole first-person wall cull, in the style of
 *  `BADGE_PLACEMENT` / `CHIP_COLLISION` — the fastest way to bisect a "it feels
 *  laggier since" report against the tier that was added with it. */
const WALL_OCCLUSION = true;
/** How often the `walk:` cost line is printed. Two seconds is long enough that
 *  a walk across the villa is a handful of lines rather than a wall of them,
 *  and short enough that a capture of a lag complaint contains several. */
const WALK_REPORT_MS = 2000;
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
// needs several on-screen pixels to read as one continuous line. OFF, it goes
// see-through like window glass — bulbSet's OFF_ALPHA, for every light fixture.
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

/** How far a room chip may move ON SCREEN between frames before watchChipJump
 *  calls it a teleport. GUI pixels, and well above anything the camera drifting
 *  produces per frame while comfortably under the ~1385px the report showed —
 *  a chip that genuinely follows its room never travels this far in one frame
 *  unless the camera is being flung, which is not what is being debugged. */
const CHIP_JUMP_SCREEN_PX = 120;

/** How many RENDERED frames traceWake reports after the tab wakes. Enough to
 *  cover the second or so the reported jump is visible for, and small enough
 *  that the trace cannot bury the rest of a capture. */
const WAKE_TRACE_FRAMES = 40;
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
//
// ⚠️ NOT a duplicate of `badgeMetrics.minCentrePitchPx`, which is also 44 on a
// coarse pointer. Two questions that happen to share a number:
//   this            — how far a HIT AREA is expanded around one badge, so a
//                     shrunken badge stays tappable. Flat, because the target
//                     must not shrink with the paint on any pointer.
//   minCentrePitchPx— how far two badge CENTRES must be before the solver
//                     stops grouping them. 44 coarse / 24 fine, because the
//                     fine profile paints 32 px and leans on WCAG 2.5.8's
//                     spacing exception.
// Converging them would drag the fine pointer's hit expansion down to 24 and
// undo exactly the decoupling this constant exists for. Cross-referenced in
// both directions so /dry-audit does not re-flag the pair every pass.
const TOUCH_MIN_CSS_PX = 44;
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


// Status/enum SENSOR states (a text sensor like an AP's connectivity state).
// NOMINAL = "all good, nothing to report" — its value is hidden (the badge is
// neutral by default, so "Connected" is just clutter). ALERT states (which
// drive the badge ring — resolved through `statusKeyFor`, the one status
// table the Map-colours legend documents) are the mirror image: their value stays
// SHOWN, so a real change is never silently swallowed. An unrecognised enum
// value (e.g. a weather "sunny") is neither: it's shown, un-ringed, as before.
// ⚠️ THE TABLE ITSELF NOW LIVES IN `utils/entityValue.ts` (exported as
// SENSOR_NOMINAL_STATES) so the badge and the panels cannot drift apart on
// which statuses count as "nothing to report".

// Pulse animation speed in radians per second (was 0.06 per frame at ~60 fps).
// Advanced by real elapsed time so the alert pulse breathes at the same rate on
// a 60 Hz tablet and a 120 Hz phone.
const PULSE_RAD_PER_SEC = 3.6;


/** Bucket name for badges whose entity has no room configured — they still
 *  cluster together rather than each becoming its own singleton chip. */

/** What the `walk:` line reports about the ceiling — see setCeilingState. */
export interface CeilingState {
  enabled: number;
  visible: number;
  /** Meshes the LAST FRAME actually submitted — Babylon's answer, not ours. */
  active: number;
  /** Height of the ceiling directly over the eye, or null for open sky. */
  above: number | null;
  /** Horizontal distance to the nearest ceiling panel. Metres means the model
   *  ships none here; centimetres would mean one is misplaced. */
  near: number | null;
  at: { x: number; y: number; z: number };
}

export interface LabelControls {
  container: StackPanel;
  /** Draws the card's border in EVERY state, dashed included — one mechanism. */
  badge: DashableRectangle;
  glyph: Image;
  valueWrap: Rectangle;
  /** The card style's icon-to-value gap, as a sized control rather than padding
   *  (see its construction). Null for the classic style, whose value is a pill
   *  BELOW the badge with no gap to hold. Toggled only through
   *  `setValueVisible`, because a gap to a hidden value is dead width. */
  valueSpacer: Rectangle | null;
  /** The card style's margin to the RIGHT of the value, the counterpart of
   *  `valueSpacer`. Null for the classic style. Toggled only through
   *  `setValueVisible` — see there. */
  valueTail: Rectangle | null;
  /** The card style's two left margins: `padl` beside a value, `barePad` (the
   *  same number as the right margin) on a bare icon — see
   *  badgeCard.cardStruts. Toggled only through `setValueVisible`. Null for
   *  the classic style. */
  padL: Rectangle | null;
  barePad: Rectangle | null;
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
  /** Cells drawn this pass — never 0 for a live group (see badgeCard's
   *  `cells`). Also how many zones are live for hit-testing. */
  gridN: number;
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
  private readonly animClock = new FrameClock();
  /** Held so `dispose()` can detach them — see the registrations. */
  private onBeforeRender: (() => void) | null = null;
  private afterRenderObserver: Observer<Scene> | null = null;

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
  private projPlane: ProjectedPoint = { px: 0, py: 0, pz: 0, pd: 0 };

  /** Something that can change WHERE or WHETHER a badge draws has happened —
   *  recompute the layout on the next frame. Cheap and deliberately generous:
   *  a false positive costs one recomputed frame, a false negative leaves a
   *  badge visibly stale, so every caller that touches label content, the
   *  label set, scale, floor or category filtering calls this. */
  private markLayoutDirty(): void {
    this.layoutDirty = true;
  }
  private pulseT = 0;
  /** Scratch for animatePulse — see its comment. */
  private pulseColor = new Color3(0, 0, 0);

  /** Every bulb and every light it gives — its own glow and off-state
   *  transparency, PointLights, floor pools, the furniture light, the shadow
   *  maps, the slider and the storey rule: bulbSet.ts. */
  private bulbs!: BulbSet;
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

  /** Rooms chipped THIS pass purely because another room holds the focus —
   *  the third way a chip can appear, and the only one the solver never sees.
   *  Reported in the `place` line beside the solver's own two. */


  private iconUserScale = 1;
  private iconZoomScale = 1;
  /** Every badge dimension, in CSS px, for the pointer currently driving this
   *  device. Read by BOTH labelBoxes and rebuildLabels — see badgeMetrics. */
  private metrics: BadgeMetrics = badgeMetricsFor(detectPointerClass());
  /** The pointer class `metrics` was chosen for, kept in its own field because
   *  the wall-occlusion ray budget needs the CLASS and not the table (two
   *  classes can share a table value while deserving different budgets). */
  private pointer: PointerClass = detectPointerClass();
  private offPointerClass: (() => void) | null = null;
  /** The layout pass's own solver workspace. solveRoomZoomRadius keeps a
   *  SEPARATE one — see PlacementResult's warning about pooled returns. */
  private placeScratch: PlacementScratch = createPlacementScratch();
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
  /** The `?debug=place` self-check over what a pass painted — placementCheck.ts. */
  private readonly placementCheck = new PlacementCheck();
  /** Ceiling fans that spin — the rig, the turn, the teardown: fanRigs.ts. */
  private readonly fans: FanRigs;
  /** Room-cluster chips, keyed by roomKey(). Built lazily the first time a
   *  room clusters; disposed with everything else in rebuildLabels. */
  private clusters = new Map<string, ClusterControls>();
  /** The rooms the user asked to SEE (tapped a chip, picked from the radial
   *  menu) — exempt from grouping — and how long that lasts: roomFocus.ts. */
  private readonly focus = new RoomFocus();
  /** One placement pass's cards and chips, and why — placementPass.ts. Its
   *  state (roomClustered, entityGrouped, the chip reasons, the seat log) is
   *  read here by the renderer and the logs. */
  private readonly pass = new PlacementPass({
    roomOf: (id) => this.roomOf(id),
    layoutOf: (g, n) => this.layoutOf(g, n),
    planeOf: (c, x, y, z) => this.planeOf(c, x, y, z),
    drawnDistance: (ax, ay, az, bx, by, bz) => this.drawnDistance(ax, ay, az, bx, by, bz),
    summaryMetrics: () => this.summaryMetrics(),
    sortCardMembers: (shown, m) => this.sortCardMembers(shown, m),
    cardOf: (cells, max, maxWidth) => this.cardOf(cells, max, maxWidth),
    cardBudget: () => this.cardBudget(),
    cardCellCap: (max) => this.cardCellCap(max),
    effectiveScale: () => this.effectiveScale(),
    deriveChips: (shown, merge) => this.deriveChips(shown, merge),
    metrics: () => this.metrics,
    focus: () => this.focus,
  });

  /** Entity groups drawn this frame, keyed by PendingEntityGroup.key. Same
   *  lazy-build / dispose-with-rebuildLabels lifecycle as `clusters`. */
  private entityGroups = new Map<string, EntityGroupControls>();
  /** THE VILLA PLAN (storeys.ts) — the calibrated room outlines with their
   *  floors and storeys, the one object SceneManager built and every reader
   *  shares. Room auto-fill (roomForEntity) and the floor probe's room
   *  resolver ask it which room a point is in, ON ITS STOREY: the outlines
   *  are a flat floor plan, and upstairs lies over downstairs in XZ, so a bare
   *  containment test answers with `.rooms.json`'s load order. */
  private plan = new Storeys<{ name: string; pts: { x: number; z: number }[]; floorY: number; storey?: number }>([]);
  /** True while the walking camera is the active one — see setFirstPerson. */
  private firstPerson = false;
  /** Which badges are behind a wall from the walker's eye — see
   *  occlusionSweep.ts, which owns the answers, when they go stale and what a
   *  pass may spend. This file only supplies the ray cast. Empty in overview. */
  private readonly occlusion = new OcclusionSweep({
    settleMs: OCCLUSION_SETTLE_MS, nearM: OCCLUSION_NEAR_M, slackM: OCCLUSION_SLACK_M,
    cast: (ox, oy, oz, dx, dy, dz, len) => this.castOcclusionRay(ox, oy, oz, dx, dy, dz, len),
  });
  /** Dedupe for the badge-geometry diagnostic — see logBadgeGeometry. */
  private lastBadgeGeom = "";
  /** Frames logBadgeGeometry refused to print because the row's children were
   *  not inside their own badge yet — see there. Printed on the next good line
   *  rather than dropped, so "it stopped complaining" and "it never measured"
   *  stay distinguishable. */
  private badgeGeomUnsettled = 0;
  /** performance.now() of the last `walk:` line — see reportWalkCost. */
  private lastWalkReportAt = 0;
  /**
   * Reads `CameraController.floorProbeCost` for the `walk:` line — injected by
   * SceneManager rather than imported, because this file owns no camera and the
   * scene layer's one rule is that these subsystems talk through SceneManager.
   * Null until wired, and the field simply reads `-` then.
   */
  private walkFloorCost:
    (() => { rays: number; ms: number; still: number; flat: boolean; cand: number })
    | null = null;
  /**
   * The meshes a wall-occlusion ray may hit — resolved ONCE per indexMeshes,
   * because it cannot change while you walk.
   *
   * The classification is the expensive part, not the ray: `blocksCameraBeam`
   * reads pipeline metadata and falls through to a name regex for anything
   * unstamped. Running that per mesh per ray (Babylon's pick predicate is
   * called for EVERY mesh in the scene) was ~7,200 classifications a frame.
   * Resolving the set once and testing only its members leaves the geometry
   * identical and deletes the classification entirely — the same "a SET, not a
   * scan" correction floorProbe.storeyFloorY already made for its predicate.
   */
  private occluders: AbstractMesh[] = [];
  /** Reused ray + direction: the sweep runs while walking, and allocating a
   *  Ray and a Vector3 per badge per frame is exactly the kind of steady-state
   *  garbage this file pools everything else to avoid. */
  private occlRay = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, 1), 1);
  /** Active storey from FloorManager (1-based). Floors below it stay rendered
   *  (cumulative visibility), so enabled-state alone can't cull their badges —
   *  cullLabels compares each label's stamped floorIndex against this. */
  private activeFloor = 1;

  /** Which lights this model gets (lightingMode.ts), from ModelLoader. The
   *  fixture's own emissive glow is kept in every mode: it is the on/off
   *  signal the user reads, not light transport. */
  private lighting: LightingMode = lightingModeFor("unbaked");

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
    /** What this module may ask of the render loop: a repaint after a change,
     *  or a rate-capped frame for a CONTINUOUS animation (fan spin, alert
     *  pulse) — see frameScheduler.ts. One object, so the capped half can no
     *  longer be dropped: it was an optional second callback that fell back
     *  to the uncapped one. */
    frames: FrameRequests,
  ) {
    this.scene = scene;
    this.config = config;
    this.requestRender = () => frames.repaint();
    this.requestAnimationRender = () => frames.animate();
    this.probe = new FloorProbe(scene);
    // The probe can only key by ROOM once calibration has produced the world
    // polygons; until then the plan is empty, answers null, and it falls back to the
    // grid, exactly as every load did before 2.300.0 (see floorProbe.ts).
    this.probe.setRoomResolver((x, y, z) => this.plan.roomAt(x, y, z)?.name ?? null);
    this.roomHighlight = new RoomHighlight(scene, frames, this.probe);
    // Every baked-mode floor pool — see lightPoolSet.ts. The probe is its floor
    // port; the readings callback lets it repaint a pool it creates late.
    this.fans = new FanRigs(scene, (id) => this.labelAnchors.get(id), () => this.requestRender());
    this.bulbs = new BulbSet(scene, this.probe, () => this.bulbReadings(), tapDebug, () => this.shadowCasters);
    this.beams = new CameraBeams(scene);
    // ⚠️ KEPT SO `dispose()` CAN DETACH THEM. Both observers below used to be
    // registered and never removed, while this class's own dispose() docstring
    // promised it was "safe to run before scene.dispose()" — which is exactly
    // the order under which they keep firing against maps this teardown has
    // just cleared. `registerBeforeRender` has no handle of its own, so the
    // callback is held here for `unregisterBeforeRender`.
    this.onBeforeRender = () => {
      // Real time between the frames these animations are actually stepped
      // on, whatever the render cadence — see babylon/frameClock for why
      // engine.getDeltaTime() cannot answer this.
      const dtMs = this.animClock.step(performance.now());
      this.animatePulse(dtMs);
      if (this.fans.animate(dtMs, this.activeFloor)) this.requestAnimationRender();
      this.cullLabels();
      this.bulbs.syncGlow();
    };
    scene.registerBeforeRender(this.onBeforeRender);
    // AFTER render, not before: Babylon reprojects every linkWithMesh control
    // during the frame, so the drawn `leftInPixels` this reads is only the
    // real one once the frame is done. Reading it in beforeRender would report
    // the PREVIOUS frame's projection and could never see the jump at all —
    // the same class of mistake as watching the world centre.
    this.afterRenderObserver = scene.onAfterRenderObservable.add(() => {
      this.watchChipJump();
      this.logBadgeGeometry();
      if (this.wakeTrace > 0) { this.wakeTrace--; this.traceWake(); }
    });
    document.addEventListener("visibilitychange", this.onWake);
    // A mouse plugged into a tablet, or a 2-in-1 folded over, changes which
    // badge geometry is correct. Unlike a hardware-scaling change (which only
    // needs applyIconScale) this one needs a full REBUILD: the painted sizes
    // are baked into each control's height/cornerRadius/fontSize, and leaving
    // them while the layout used the new metrics is exactly the mismatch this
    // subsystem has been bitten by before. Rare enough to afford it.
    this.offPointerClass = observePointerClass((p) => {
      // Set BEFORE the early return below: the ray budget reads this even on a
      // change that leaves the metrics table identical.
      this.pointer = p;
      const next = badgeMetricsFor(p);
      if (next === this.metrics) return;
      this.metrics = next;
      this.rebuildLabels();
    });
  }

  /** MUST be called before indexMeshes() — that's where the bulbs are built
   *  for the mode. */
  setLightingMode(mode: LightingMode): void {
    this.lighting = mode;
    this.bulbs.setCastShadows(mode.lightShadows);
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
    // ⚠️ SAME-CONTENT, NOT SAME-REFERENCE, and this file was the last place it
    // was still missing. DeviceConfigSync pulls the shared store on every
    // window focus and visibilitychange, and hands back freshly JSON-parsed
    // objects — never `===` the ones already held, even when nothing changed.
    // SceneManager learned this twice (entityMapDelta, then the meshBindings
    // stringify guard); here the bare `!==` meant a no-op focus pull set
    // needsRepaint and ran rebuildLabels(), which DISPOSES AND RECREATES every
    // GUI control. That is what produced the reported flicker: a recreated
    // room chip has `adaptWidthToChildren`, whose setter parks `width` at
    // "100%" until the LAYOUT pass resolves it, while Babylon's
    // `_moveToProjectedPosition` runs BEFORE that pass and computes
    // `left = projectedX − _currentMeasure.width / 2`. For one frame that
    // width is the fullscreen root's, so every chip drew ~1439px to the left
    // and snapped back on the next frame. Measured: the five chips' implied
    // widths reconstructed from the jump distances came back as their real
    // label widths, and `top` never moved because `height` is set in explicit
    // pixels and needs no children.
    // Reuses the shared classifier rather than a third stringify idiom.
    const mapDelta = config.entityMap === prevEntityMap
      ? "identical" : entityMapDelta(prevEntityMap, config.entityMap);
    if (mapDelta !== "identical") {
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
      // ⚠️ AND RE-BAKE, WHICH THIS DID NOT DO. `applyIconScale` sets
      // `container.scaleX/Y` and never touches `glyph.source`, so stepping the
      // size from 1.0 to 2.5 upscaled the OLD bitmap 2.5x — precisely the blur
      // the bake ladder exists to remove. Badges then re-sharpened one at a
      // time, as each device happened to change state.
      //
      // ⚠️ THE DOCSTRING SAID THIS WAS ALREADY HANDLED. `glyphBakePx` claims
      // "the user moves the size stepper … both of those already repaint".
      // Traced through HUD -> SceneManager.updateConfig (which classifies this
      // as cosmetic and skips `repaintBadges`) -> here: nothing repainted.
      this.repaintGlyphs();
    }
    // Labels are always shown; rebuild when a device group is created/edited
    // (a member's badge must appear/disappear without needing a full
    // re-index — see rebuildLabels' hiddenMembers), OR when entityMap itself
    // changed (see needsRepaint above). One call covers both rather than two
    // separate rebuildLabels() passes when both happen to change together.
    // deviceGroups gets the SAME same-content guard, for the same reason and
    // from the same pull — it is a SHARED_CONFIG_KEY too, so it also arrives
    // freshly parsed on every focus. badgeStyle is a per-device string and
    // compares by value already.
    const groupsChanged = sliceChanged(config.deviceGroups, prevGroups);
    if (needsRepaint || groupsChanged || config.badgeStyle !== prevBadgeStyle) {
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
    if (this.bulbs.setStrength(value)) this.requestRender();
  }

  /** One light's state as its fixture shows it: on/off, colour, and the
   *  brightness fraction with the per-light override (Advanced Settings,
   *  -100%..+100%) applied ON TOP of HA's own dimmer level. The ONE copy of
   *  that formula — it was written three times, for the state pass, the
   *  dynamic-light resync and the pool resync, and they had to agree exactly
   *  for a slider drag and the next state_changed to land on the same value. */
  private lightReading(state: HassEntity, map: EntityMapping): LightReading {
    const brightnessFrac = state.attributes.brightness ? state.attributes.brightness / 255 : 1;
    return {
      on: state.state === "on",
      colour: this.lightColour(state),
      frac: brightnessFrac * (1 + clampRatio(map.lightIntensityRatio)),
    };
  }

  /** Every light entity's bulbs and current reading, for BulbSet's bulk
   *  repaint (slider, floor switch, a pool created late). */
  private *bulbReadings(): Iterable<BulbReading> {
    for (const [entityId, map] of this.mapping) {
      if (map.type !== "light") continue;
      const state = this.lastState.get(entityId);
      const meshes = this.byEntity.get(entityId);
      if (!state || !meshes) continue;
      yield { meshes, reading: this.lightReading(state, map) };
    }
  }

  /** Every light entity's fixture meshes. */
  private *lightEntityMeshes(): Iterable<readonly AbstractMesh[]> {
    for (const [entityId, meshes] of this.byEntity) {
      if (this.mapping.get(entityId)?.type === "light") yield meshes;
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

  /** The size a badge's glyph is DRAWN at, base CSS px — badgeLayout.glyphDrawPx,
   *  which carries why the control and the bake must read one expression. */
  private glyphPxFor(card: boolean): number {
    return glyphDrawPx(this.metrics, card);
  }

  /** The size a glyph must be BAKED at, render px — badgeLayout.glyphBakePx,
   *  which carries why it is not the drawn size. The two inputs besides the
   *  metrics change only when the resolution valve fires or the size stepper
   *  moves, and both re-bake through `repaintGlyphs` (which the stepper did
   *  NOT until 2.496.29). */
  private glyphBakePx(card: boolean): number {
    return glyphBakePx(this.metrics, card, this.iconUserScale, this.bestCssToGui());
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
    // Fan meshes back out of their pivots, pivots disposed — fanRigs.ts.
    this.fans.clear();
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
        if (m.getTotalVertices() > 0 && !isHelperMesh(m)) {
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
        // same off-state alpha treatment in BulbSet.show (see its OFF_ALPHA):
        // a smart light should read as "off" (translucent) the instant HA
        // says so, not stay a permanently opaque, statically-coloured prop.
        // That toggle needs depth writing while alpha-blended (see the
        // window-glass/strip depth-sort note by OFF_ALPHA), so set it
        // here, once, for every light mesh — not only the ones inflateThinStrip
        // happens to touch.
        if (mat) mat.forceDepthWrite = true;
        // Its PointLight and, on a baked villa, its floor pools: bulbSet.ts.
        this.bulbs.addFixture(m, this.lighting.pools);
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

    // The wall-occlusion occluder set, resolved once here rather than per ray —
    // see `occluders`. Derived from shadowCasters (already "every non-entity
    // mesh with geometry") through the SAME predicate the camera beams use, so
    // "what blocks a line of sight" has one definition in this file, not two.
    //
    // ⚠️ MINUS THE CEILING, and only here — a camera cone must still be clipped
    // by it, which is why `blocksCameraBeam` itself is untouched (the beam path
    // builds its own set from the bare predicate).
    //
    // A ceiling is the LID OF THE ROOM YOU ARE STANDING IN. Everything it could
    // legitimately hide is on the storey above, and FloorManager has that storey
    // disabled while you walk this one — so it can never hide a badge that was
    // drawable anyway. What it DID do, measured rather than reasoned:
    // `occludedBy=Structure_Ceiling_L0x16(fan.ceiling_fan_livingroom,
    // fan.ceiling_fan_kitchen)` — sixteen badges, including the two the owner
    // reported as missing while looking straight at the fans.
    //
    // Why OCCLUSION_SLACK_M did not already cover it, since it was written for
    // exactly this case: the slack is measured ALONG THE RAY. For a device
    // mounted just under the ceiling and seen from across the room the ray is
    // nearly horizontal, so 0.35 m along it buys almost no VERTICAL clearance,
    // and the ray grazes up through the ceiling plane before the slack bites.
    // Raising the constant would trade this bug for a worse one (wall-mounted
    // devices near a corner going unoccluded); removing the surface that cannot
    // legitimately occlude anything is the predicate fix, not a tuned number.
    //
    // ⚠️ Accepted trade, stated so it is not rediscovered as a bug: a device
    // genuinely tucked behind a low soffit may now keep its badge. It is only
    // revealed if NO wall also blocks it — the wall test is unchanged and the
    // loop simply reports the first blocker it finds — and a badge shown a
    // little too eagerly costs far less than one missing for a device the
    // operator is looking straight at.
    this.occluders = this.shadowCasters.filter(
      (m) => blocksCameraBeam(m) && !isResolvedCeiling(m));
    this.extendStripJoints();
    this.bulbs.mergeStrips(this.lightEntityMeshes());
    if (this.lighting.furnitureLight) this.bulbs.glowEverythingLit();
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
    // hasVariantSuffix, not a local regex: the authority strips export
    // artifacts first, so a Blender-duplicated "…__open.001" counts here too.
    const orphanIds = Array.from(this.byEntity.keys()).filter(hasVariantSuffix);
    if (variantSummary.length || orphanIds.length) {
      tapDebug(
        `mesh variant groups:\n  ${variantSummary.join("\n  ") || "(none)"}`
        + (orphanIds.length ? `\n  ORPHAN un-collapsed entities: ${orphanIds.join(", ")}` : ""),
        "variant",
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
    this.bulbs.clear();
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
    // ⚠️ THE TWO SCENE OBSERVERS COME OFF FIRST, AND THEY USED NOT TO COME OFF
    // AT ALL. This method's own docstring says it is safe to run before
    // `scene.dispose()`; under that order a beforeRender still stepping
    // animations over cleared maps is precisely what "safe" has to exclude.
    if (this.onBeforeRender) {
      this.scene.unregisterBeforeRender(this.onBeforeRender);
      this.onBeforeRender = null;
    }
    this.scene.onAfterRenderObservable.remove(this.afterRenderObserver);
    this.afterRenderObserver = null;
    document.removeEventListener("visibilitychange", this.onWake);
    this.offPointerClass?.();
    this.offPointerClass = null;
    this.disposeLights();
    this.disposeLabelAnchors();
    this.beams.dispose();
    this.roomHighlight.dispose();
    this.fans.clear();
    this.pulsing.clear();
    this.labels.clear();
    this.labelsNewestFirst.length = 0;
    this.lastState.clear();
    this.labelLayer?.dispose();
    this.labelLayer = null;
  }

  /** The calibrated villa plan (world space, storeys.ts) — the one object
   *  SceneManager builds per plan→world re-fit (load + mirror-flip toggles),
   *  handed on as-is to the room highlight and the bulbs' pools. */
  setPlan(plan: Storeys<{ name: string; pts: { x: number; z: number }[]; floorY: number; storey?: number; conform?: { positions: number[]; indices: number[] } }>): void {
    this.roomHighlight.setRooms(plan);
    // Each room's ground WIDTH used to be cached here too, as the "is there
    // space here?" denominator for laying a pile of badges out across a room.
    // Nothing lays badges out any more (2.159.0 — badges sit on their anchors
    // or their room summarises), so the room's own size no longer takes part
    // in any grouping decision and the cache is gone with the fan.
    this.plan = plan;
    // The earliest moment the pools can take their rooms' shapes and floors.
    this.bulbs.setRooms(plan);
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
    // The anchor's OWN height decides the storey — a 2F device is not in the
    // 1F room its outline happens to sit over (Storeys.roomAt: containment,
    // on the storey a point at an unknown height above its floor is on).
    const onMyStorey = this.plan.roomAt(p.x, p.y, p.z);
    if (onMyStorey) return onMyStorey.name;
    // ⚠️ THE STOREY FILTER MAY REFINE AN ANSWER, NEVER DELETE ONE (2.440.0).
    //
    // A device inside a drawn room got a room name before 2.434.0 and must
    // still get one: an entity with no room falls into the NO_ROOM_LABEL
    // bucket, and that bucket is what puts an "Other" pile on the map. The
    // storey rule is a preference between polygons that BOTH contain the
    // point, and this villa reports three distinct floor heights — enough for
    // the clearance test to name a storey none of whose rooms contain a given
    // anchor, which used to turn a perfectly good room into "Other".
    //
    // Deliberately NOT pushed down into Storeys.roomAt: the light pool wants the
    // opposite when its storey has no room here — it falls through to bounding
    // the pool by the nearest boundary, which is a better answer than a room
    // one floor up. Same lookup, two right answers, so the fallback belongs to
    // the caller that wants it.
    for (const room of this.plan.rooms) {
      if (pointInPolygon(p.x, p.z, room.pts)) return room.name;
    }
    return null;
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
    if (!this.focus.grant((rooms ?? []).map(roomKey).filter(Boolean))) return;
    this.markLayoutDirty();
    this.requestRender();
  }

  /** The rooms currently exempt from grouping (roomKey form). */
  focusedRoomKeys(): string[] {
    return [...this.focus.rooms];
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
      /** Vertical field of view in radians. Comes from `cameraFrame()`, which
       *  is the one place that knows whether `camera.fov` is the vertical or
       *  the horizontal angle — do not read `cam.fov` here instead. */
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
    for (const m of members) this.setValueVisible(m.lbl, false);
    // Destination scale: the zoom cap is 1 where this shot lands, so only
    // the user size and the CSS→GUI conversion apply.
    const mScale = this.iconUserScale * this.cssToGui();
    const boxes = this.labelBoxes(members, [], [], mScale);
    for (let i = 0; i < members.length; i++) this.setValueVisible(members[i].lbl, wasVisible[i]);

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
    return solveRoomZoom(
      members.map((m, i) => ({ wx: m.wx, wy: m.wy, wz: m.wz, mine: m.mine, halfW: boxes[i].halfW, halfH: boxes[i].halfH, cy: boxes[i].cy })),
      {
        vpH: view.vpH, vpW: view.vpW, vFov: view.vFov, frame: view.frame,
        // The DESTINATION's grouping basis: computeRoomOverviewPose keeps the
        // current alpha but forces a top-down beta, so the ladder is walked
        // through the direction the camera will ARRIVE at (roomZoomSolver.ts).
        grouping: this.currentViewBasis(view.dir),
        cx: view.cx, cy: view.cy, cz: view.cz, minRadius: view.minRadius, maxRadius: view.maxRadius,
      },
      { gapPx, minSepPx, allow },
      this.zoomScratch,
    );
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
        + (skipped.length ? ` | skipped: ${skipped.join("; ")}` : ""), "beam");
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
      // Channel "beam": the `camera beams: N built | skipped: …` summary below
      // already names every camera without a beam, so this per-camera line is
      // the same fact once per camera per state change. Opt in with ?debug=beam.
      tapDebug(`beam ${entityId}: motion ${on ? "ON" : "off"} but NO BEAM MESH exists for this camera`, "beam");
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
        tapDebug(`apply(${entity.entity_id}): NO MESH/MAPPING — meshes=${!!meshes} map=${!!map}. This entity's live state changed but nothing in the model resolves to it, so no variant could ever be shown for it.`, "mesh");
      }
      return;
    }
    if (
      (entity.entity_id.startsWith("cover.") && map.type !== "cover") ||
      (entity.entity_id.startsWith("lock.") && map.type !== "lock")
    ) {
      tapDebug(`apply(${entity.entity_id}): resolved mesh(es) but map.type="${map.type}" — a variant pose will NEVER be applied while the type mismatch stands (check Advanced Settings' Type field for this entity).`, "mesh");
    }
    for (const mesh of meshes) this.applyToMesh(mesh, map, entity);
    if (map.type === "light") this.bulbs.show(meshes, this.lightReading(entity, map));
    if (map.type === "fan") this.fans.show(entity, meshes);
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
      tapDebug(`applyMeshVariant(${entityId}): SKIPPED — only ${byWord?.size ?? 0} variant group(s) registered (need 2+); requested="${active}"`, "variant");
      return false;
    }
    const chosen = pickNearestVariant(order, active, byWord.keys());
    tapDebug(`applyMeshVariant(${entityId}): requested="${active}" -> chosen="${chosen}" from {${Array.from(byWord.keys()).join(",")}}`, "variant");
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
    if (poseChanged) { this.bulbs.invalidateShadows(); this.requestRender(); }
    // Read the flags straight back off the mesh objects (not just "what we
    // just set") so this answers "is __open ACTUALLY hidden right now" with
    // zero ambiguity — a mesh only renders if BOTH isVisible AND isEnabled()
    // are true, so this also catches a floor-visibility (setEnabled) conflict
    // that isVisible alone wouldn't reveal.
    const postState = Array.from(byWord, ([word, meshes]) =>
      `${word}:[${meshes.map((m) => `${m.isVisible ? "V" : "-"}${m.isEnabled() ? "E" : "-"}`).join(",")}]`
    ).join(" ");
    tapDebug(`applyMeshVariant(${entityId}): after toggle (V=visible E=enabled, need BOTH to render) -> ${postState}`, "variant");
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
    return effectiveCategory(subjectOf(
      entityId, this.config.entityMap[entityId], dc ? { attributes: { device_class: dc } } : undefined, type));
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
    // The slabs that occlude changed with the storey: re-test every badge, even
    // if the walker has not moved a millimetre (the sweep used to keep its old
    // answers until the next step).
    this.occlusion.invalidate();
    // A bulb on a now-hidden storey must go dark — its pools are decals
    // FloorManager never toggles, and its PointLight kept lighting through the
    // slab until 2.496.82. Repaint every bulb from its floor-correct state;
    // resync also redraws the shadow maps, since which storey's geometry
    // occludes a lamp just changed (they render once and then hold).
    this.bulbs.resync();
    // Mesh variants (curtain/lock poses) need NO floor resync: their
    // exclusivity rides `isVisible`, which FloorManager's per-floor
    // `setEnabled` never touches — see applyMeshVariant's docstring.
    this.requestRender();
  }

  /**
   * The whole-villa fit RADIUS, or 0 for "no zoom shrink" (the walk camera).
   *
   * A threshold, not a scale. Pushed by SceneManager whenever the overview
   * camera moves; the scale itself is derived from the rung in
   * `syncIconZoomToRung`, which is what makes it a function of the rung rather
   * than a second quantity racing it.
   */
  setIconZoomFit(fitRadius: number): void {
    this.iconZoomFitRadius = fitRadius > 0 ? fitRadius : 0;
  }

  /** Applies an already-derived zoom scale, snapped onto the zoom lattice. */
  private applyIconZoom(z: number): void {
    // ── QUANTISED ONTO THE ZOOM LATTICE, AND NOT DEADBANDED ────────────────
    // This is the SECOND quantity that scales badge layout with zoom — the
    // rung scales the positions, this scales the sizes — and until 2.414.0 it
    // was continuous while the rung was quantised. So two frames at the SAME
    // rung produced different layouts, which the field capture caught outright:
    //
    //   place rung=53.817 zoom=0.98 … drawn=1 chips=9
    //   place rung=53.817 zoom=0.95 … drawn=6 chips=3
    //
    // Same rung, different answer — the purity violation `rung` exists to make
    // visible.
    //
    // ⚠️ THE LATTICE ALONE DID NOT FIX IT (2.417.0). The caller now DERIVES `z`
    // from the rung, and that is what makes the pair hold still; snapping here
    // is only tidiness on top of a value that is already a function of the
    // rung. Restoring a caller that computes `z` from the raw camera radius
    // re-opens the whole bug however fine this lattice is — see
    // syncIconZoomToRung.
    //
    // The 0.02 deadband both replaced was worse than merely imprecise: whether
    // it updated depended on the PREVIOUS value, so the drawn size — and
    // therefore the layout — became a function of the path taken rather than
    // the zoom arrived at. That is hysteresis, the first of the five things
    // this subsystem's rules forbid outright, hiding in a size setter.
    const snapped = snapToZoomLattice(z);
    if (snapped === this.iconZoomScale) return;
    this.iconZoomScale = snapped;
    // `false`: this runs INSIDE the layout pass, before anything is measured,
    // so the new size is used by this very frame. Asking for another render
    // here would schedule a frame per lattice step for no visible change.
    this.applyIconScale(false);
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
    // Its OWN fraction of the badge height — not the badge's VALUE font, which
    // is a small secondary readout and was dragging the room name and the count
    // digit down with it every time it was tuned. See SUMMARY_TEXT_OF_HEIGHT.
    const font = Math.round(size * SUMMARY_TEXT_OF_HEIGHT);
    return {
      size,
      font,
      countSize: Math.round(size * m.countPillFraction),
      countFont: Math.round(font * m.countFontFraction),
    };
  }

  /**
   * The room chip's text model — the ONE answer to "how wide will that chip be
   * drawn", handed to both `fitChipLabel` and the merge (2.422.0).
   *
   * Every term comes from what `ensureCluster` actually writes on the control:
   * the advance is badgeMetrics' own for this style's value font, which the
   * chip prints at the same size and the same weight 600; the pad is the left
   * inset plus the right-hand reserve the count overlay sits in. Nothing here
   * is a private constant, which is the whole point — labelLayout carried its
   * own pair until /dry-audit found them, and they were wrong in opposite
   * directions by enough to cancel at one name length and nowhere else.
   */
  private chipTextMetrics(): ChipTextMetrics {
    const m = this.metrics;
    const sm = this.summaryMetrics();
    return {
      // The advance follows the font THE CHIP ACTUALLY PRINTS, which since
      // 2.447.0 is the summary's own — not the badge value's. Deriving it from
      // the wrong font is the 2.422.0 defect in a new place: a width model that
      // measures a string at a size nobody draws it at.
      charPx: sm.font * VALUE_CHAR_ADVANCE,
      padPx: m.chipTextPadPx * 2 + sm.countSize,
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
    this.pass.begin();
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
      // ⚠️ `iconPadX` AND `inkInset` ARE GONE FROM HERE. Both now live inside
      // `cardStruts`, which is the whole point: the two expressions that
      // computed a card's width shared one term out of six, and `tsc` reporting
      // these as unused is the proof the second copy has no reader left.
      // ⚠️ ONE OWNER FOR THE CARD'S WIDTH TERMS — see badgeCard.cardStruts.
      // These four strut widths and the layout's estimate were two disjoint
      // expressions until 2.496.28; they are the same six numbers now, so the
      // solver cannot reserve a size the renderer does not draw.
      const st = card ? cardStruts(m.cardHeightPx, glyphPx, 1) : null;

      const container = new StackPanel(`lbl_${entityId}`);
      container.isVertical = true;
      container.width = `${m.labelMaxWidthPx}px`;
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
      const badge = new DashableRectangle(`lbl_badge_${entityId}`);
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
      // Symmetric halo, in device pixels — the two facts behind that, and why
      // they are a function rather than four copies of two numbers, are in
      // badgeShadow.ts. This block is where the reasoning was written; it moved
      // there when /dry-audit found the other two controls ignoring it.
      badgeShadow(badge);
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
        // ⚠️ ZERO. THE CARD'S OUTER MARGINS ARE SPACER CONTROLS TOO (2.452.0),
        // and this is measurement, not another theory. The `badge` line printed
        // `glyph.left === badge.left` EXACTLY while the badge's width still
        // included both paddings (1 + 16 + 3 + 17 + 2.25 = 39.25, drawn 39) — so
        // under `descendantsOnlyPadding` + `adaptWidthToChildren` the padding
        // sizes the box and does NOT offset the children. Every pixel of it
        // therefore piled up as dead space on the RIGHT: visL=1.60, which is only
        // the baked ink, against visR=3.00, which was all the padding. Five
        // attempts at this bug were five different padding values feeding a
        // mechanism that never positioned anything.
        //
        // The gap spacer, by contrast, measured EXACTLY the 3 px it was set to —
        // a StackPanel lays children out by their widths and gets it right. So
        // the outer margins become spacers as well, and the whole card is now
        // positioned by one mechanism that is proven to work.
        badge.paddingLeft = "0px";
        badge.paddingRight = "0px";
      } else {
        badge.width = `${m.badgeDiameterPx}px`;
      }
      container.addControl(badge);

      // Card mode lays the icon + value in a horizontal row INSIDE the card;
      // classic keeps the glyph as the badge's full fill and the value in a
      // separate pill below.
      const row = card ? new StackPanel(`lbl_row_${entityId}`) : null;
      let barePad: Rectangle | null = null;
      let padL: Rectangle | null = null;
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
          // ⚠️ `glyphBakePx`, NOT `glyphPx`. This argument is the bake size in
          // RENDER pixels; every other number here is unscaled CSS px. Passing
          // the CSS one baked the first version of every badge at the wrong
          // rung — the exact mistake `glyphBakePx`'s own docstring was written
          // to describe ("true of the two NUMBERS, and false of the pixels").
          // It self-healed on the badge's first state change, so the one badge
          // it stayed wrong for was a device that had never reported.
          undefined, card, this.glyphBakePx(card), card));

      glyph.width = `${glyphPx}px`;
      glyph.height = `${glyphPx}px`;
      glyph.stretch = Image.STRETCH_UNIFORM;
      /** A transparent, sized gap — the ONE mechanism in this row that measures
       *  what it is set to (see the badge's zeroed padding above). */
      const strut = (name: string, w: number): Rectangle => {
        const r = new Rectangle(`lbl_${name}_${entityId}`);
        r.thickness = 0;
        r.background = "";
        r.width = `${Math.max(0, w)}px`;
        r.height = `${glyphPx}px`;
        r.isPointerBlocker = false;
        return r;
      };
      if (row) {
        // The LEFT margin is short by the baked ink the chip already contributes,
        // so the two VISIBLE margins match: visL = padL + ink, visR = padR.
        // Unrounded, like the two on the value's side (2.454.0): these are
        // PRE-scale CSS px and rounding 0.65 to 1 is a 35% error on the very
        // quantity the `visL/gap/visR` readout exists to make checkable.
        // Two left margins, one shown at a time (setValueVisible): a bare
        // icon's is the SAME number as its right margin, so the chip is
        // centred whatever Babylon's whole-pixel flooring does; beside a value
        // it is short by the ink — see cardStruts.
        barePad = strut("barepad", st!.barepad);
        row.addControl(barePad);
        padL = strut("padl", st!.padl);
        padL.isVisible = false;
        row.addControl(padL);
      }
      (row ?? badge).addControl(glyph);

      // Value: classic → a dark rounded pill BELOW the badge; card → inline
      // text to the RIGHT of the icon chip, on the coloured card itself.
      // Declared out here so the label record can carry it: the classic style
      // has no gap to hold (its value is a pill BELOW the badge), so null.
      let valueSpacer: Rectangle | null = null;
      /** The value's right-hand margin, shown and hidden with it — see where it
       *  is added for why it is the value's and not the card's. */
      let valueTail: Rectangle | null = null;
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
        // ── THE GAP IS A SPACER CONTROL, NOT PADDING (2.446.0) ───────────────
        // Third attempt at "the number sits too far right", and the first two
        // failed the same way: the gap was expressed as PADDING on this wrap,
        // and a padding here interacts with `descendantsOnlyPadding` and
        // `adaptWidthToChildren` in a way I mis-modelled twice — predicting the
        // text left of centre while the owner's screenshot measured it 20 px
        // from the icon and 10 px from the pill's edge, i.e. the opposite.
        //
        // A StackPanel lays its children out by their WIDTHS. A transparent
        // Rectangle of width G therefore puts exactly G between the icon and the
        // text, with no padding semantics involved at all — the gap becomes a
        // thing with a size instead of an inset whose sign I have to reason
        // about. The wrap now carries NO horizontal padding, so the pill hugs
        // the number and the only space to its right is the card's own
        // `iconPadX`, matching the icon's inset on the left.
        valueWrap.paddingLeft = "0px";
        // ⚠️ ZERO, and see the spacer note above for why this is not the dial.
        valueWrap.paddingRight = "0px";
        valueWrap.isVisible = false;
        // Added BEFORE the wrap so the row reads glyph | spacer | value. It
        // shares the wrap's visibility: a badge with no value must not carry a
        // gap to nothing, or every valueless card would be that much wider.
        valueSpacer = strut("valgap", 0);
        // ⚠️ THE CHIP'S INK IS SMALLER THAN ITS BOX, and missing that is why two
        // attempts at this looked right on paper and wrong on screen (2.447.0).
        // `badgeImageDataUrl` bakes the squircle at BADGE_INSET_CARD (10%) inside
        // the image, so the VISIBLE chip stops 0.1·glyphPx short of the control's
        // edge on every side. Every gap I computed was therefore measured from a
        // boundary nobody can see, and the drawn gap was that plus the inset —
        // which is exactly the "still too far right" the owner kept reporting
        // while the arithmetic said otherwise.
        //
        // So the target is stated where it can be checked: the value's visible
        // clear space on the LEFT (this spacer plus the baked inset) equals its
        // visible clear space on the RIGHT (the card's own iconPadX). Solve for
        // the spacer and it is a subtraction, not a fraction — and on this
        // villa's metrics it comes out at ~1 CSS px, which is why every
        // fraction-of-the-gap value I tried was too wide.
        // ⚠️ THE OWNER STATED THE TARGET AND IT REVERSES THE 2x RULE (2.454.0):
        // "I want the 100% to appear centered between the end of the entity
        // icon and the end of the badge graph". That is VISIBLE gap == VISIBLE
        // right margin, and both are printed on the `badge` line as `gap=` and
        // `visR=` — so this stopped being a number to argue and became an
        // equation to satisfy. See CARD_VALUE_MARGIN_OF_ICON_PAD for why the
        // multiple is 1.5 (it preserves the card's width) and for the six
        // attempts that were argued from the DOM twin instead of measured.
        //
        // No Math.round, deliberately: these are PRE-scale CSS px multiplied by
        // effectiveScale (3.2 on this capture), so rounding 3.375 to 3 is a
        // 1.2 render-px error on a 2 px quantity — and it lands on exactly the
        // equality the pin checks. The struts take fractional widths fine.
        valueSpacer.width = `${st!.valgap}px`;
        valueSpacer.isVisible = false;
        row!.addControl(valueSpacer);
        row!.addControl(valueWrap);
        // The value's TAIL, and it rides the value's own visibility for the
        // same reason the gap spacer does — a bare-icon card must keep its
        // visible margins equal (with `bareink`, 2.496.130: this comment used to
        // claim visL == visR here while the drawn margins were 3.0 and 5.2), so the extra
        // margin the owner's centring asks for belongs to the VALUE, not to the
        // card. With a value: visR = this + padr = 1.5·iconPadX, which is the
        // visible gap on the other side of the text. Without one: it collapses
        // and the card is symmetric exactly as before.
        valueTail = strut("valtail", st!.valtail);
        valueTail.isVisible = false;
        row!.addControl(valueTail);
        // The right margin proper, LAST in the row. It is the counterpart of
        // `padl` above and the reason the card no longer collects its padding
        // on one side. Always present.
        row!.addControl(strut("padr", st!.padr));
      } else {
        valueWrap.height = `${m.valueChipHeightPx}px`;
        valueWrap.cornerRadius = m.valueChipHeightPx / 2;
        valueWrap.background = "rgba(15,23,42,0.85)";
        // Padding must clear the stadium's corner radius (VALUE_CHIP_HEIGHT/2) or
        // the text crowds the rounded ends and reads as touching the edges.
        //
        // ⚠️ FLAGGED BY /dry-audit, DELIBERATELY NOT CHANGED (2026-08-18). This is
        // the SAME wrap object that carries `adaptWidthToChildren` and
        // `descendantsOnlyPadding`, and the card branch above measured what that
        // combination actually does: padding SIZES the box and does not offset the
        // children, so it collects on one side. The prediction here is therefore
        // that this pill's text sits LEFT with both pads piled to its right.
        //
        // Left alone on purpose: this install runs the CARD style, so nothing can
        // verify it on hardware, and the failure would look different anyway (a
        // value off-centre inside its own dark pill, with no icon beside it to
        // measure against). Fix it the day someone reports the classic style's
        // value looking off-centre — and fix it with struts, the way the card
        // was, not with another padding value.
        valueWrap.paddingLeft = `${m.pillPadXPx}px`;
        valueWrap.paddingRight = `${m.pillPadXPx}px`;
        badgeShadow(valueWrap, "pill");
        valueWrap.isVisible = false;
        container.addControl(valueWrap);
      }

      // Card: the surface's glyph colour, so it stays legible on a neutral
      // badge and shifts with state exactly as the icon does. Classic: white,
      // on its own dark pill. updateLabel re-applies the card case per state.
      const valueText = badgeText(`lbl_value_${entityId}`, {
        // LEFT so the number starts at a known x beside the icon (resizeToFit
        // measures the advance width, which carries the last glyph's side
        // bearing, so a centred string drifts by half of it).
        align: "left",
        // ⚠️ THE OPTICAL NUDGE STAYS ON. I turned it off in 2.448.0 arguing that
        // `resizeToFit` removes the situation it corrects, and the drawn geometry
        // says the argument was right and the conclusion was wrong: badge y447+20,
        // glyph y449+16, text y452+10 — every box centred on 457.0, and the owner
        // still reads the digits as sitting high. That is EXACTLY what this file's
        // header already recorded: "the arithmetic says no correction is needed.
        // It does not match the screen, and the value that does — half a
        // descender — was arrived at by a person looking at real hardware after
        // the arithmetic had twice been trusted over them." I trusted it a third
        // time. Whatever in Babylon's chain the model misses, it is still there
        // with resizeToFit on.
        fontPx: card ? m.cardValueFontPx : m.pillValueFontPx,
        color: card
          ? categorySurface(category, "off", this.config.entityMap[entityId]?.badgeColor).ink
          : PILL_TEXT,
        weight: "600",
        metrics: m,
      });
      valueWrap.addControl(valueText);

      this.labels.set(entityId, {
        container, badge, glyph, valueWrap, valueSpacer, valueTail, padL, barePad, valueText, anchor, type, category,
      });

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
        for (const mesh of meshesForEntity) this.applyToMesh(mesh, mapForEntity, cached);
        if (mapForEntity.type === "light") this.bulbs.show(meshesForEntity, this.lightReading(cached, mapForEntity));
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
  /** Re-bake every badge's glyph at the current size.
   *
   *  ⚠️ IT GOES THROUGH `updateLabel` RATHER THAN CALLING THE BAKE ITSELF, so
   *  there is still exactly one place that decides a glyph's source. A second
   *  call site would be a second answer to "what size is this icon", which is
   *  the defect this method exists to fix. */
  private repaintGlyphs(): void {
    for (const id of this.labels.keys()) {
      const st = this.lastState.get(id);
      const map = this.mapping.get(id);
      if (st && map) this.updateLabel(id, map.type, st);
    }
  }

  private updateLabel(entityId: string, type: EntityType, entity: HassEntity): boolean {
    const lbl = this.labels.get(entityId);
    if (!lbl) return false;
    const prevCategory = lbl.category;
    const prevLen = lbl.valueText.text.length;
    const prevVisible = lbl.valueWrap.isVisible;
    // Re-resolve the filter category now that this state may carry the
    // device_class (e.g. an enum sensor → Network) — cullLabels reads it live.
    lbl.category = effectiveCategory(
      subjectOf(entityId, this.config.entityMap[entityId], entity, type));
    // FACE from this device's own state, RING from its linked entity — two
    // independent facts, two independent sets of pixels. See badgeFaceAndRing.
    // (badgeKind still folds the linked signal into ONE value for everything
    // else that reads it — the alert pulse, a room chip's ring, an entity
    // group's — because those all mean "is anything here demanding attention",
    // which a linked entity being on genuinely is.)
    const { face: state, ring: ringState } =
      badgeFaceAndRing(this.reading(type, entity, this.linkActiveIds.has(entityId)));
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
      // ONE mechanism for every state's border, the dashed one included: the
      // card's own Rectangle, which can dash (dashableRectangle). The dash was
      // a separate baked image over the card (2.496.130) and it did not agree
      // with the Rectangle on where the edge is — "why is there a difference
      // in the icon shape?" (owner). Same corner, same weight, same place.
      const dashed = !!surface.ringDashed;
      const ringW = !surface.ring ? 0 : surface.ringHairline ? 1 : this.metrics.ringThicknessPx;
      lbl.badge.thickness = ringW;
      lbl.badge.dash = dashed && ringW > 0 ? [ringW * RING_DASH[0], ringW * RING_DASH[1]] : null;
      lbl.badge.color = surface.ring ?? "transparent";
      // Every state's chip is baked the same way: inset, with no ring of its own.
      lbl.glyph.source = badgeImageDataUrl(
        lbl.category, iconKey, state, override,
        BADGE_INSET_CARD, ringState, true, this.glyphBakePx(true),
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
      lbl.badge.dash = null;
      lbl.badge.color = "transparent";
      lbl.glyph.source = badgeImageDataUrl(
        lbl.category, iconKey, state, override, 0, ringState, false, this.glyphBakePx(false));
    }
    lbl.badge.alpha = 1;
    // The value pill is never shown for an unavailable entity anyway
    // (compactValue short-circuits to "" for every type when state is
    // unavailable/unknown — see below), so it needs no alpha of its own.

    const value = this.groupedValue(entityId, compactValue(type, entity));
    lbl.valueText.text = value;
    this.setValueVisible(lbl, value.length > 0);
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
    // ⚠️ CLEARED HERE, at the top of the PASS — not inside placeEntityGroups,
    // which is where it started and which silently broke the instrument: the
    // solver's `pair` lines are pushed BEFORE that method runs, so clearing
    // there wiped every one of them and a capture came back with a `place`
    // line and no pairs at all. Anything buffered for this pass has to be
    // reset where the pass begins, or the buffer eats the earliest writers.
    this.pass.seatLog.length = 0;
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
        s = {
          id, lbl, x: 0, y: 0, wx: 0, wy: 0, wz: 0, sx: 0, sy: 0, sz: 0,
          inFront: false, occluded: false,
        };
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
      s.occluded = this.occlusion.occluded.has(id);
      shown[shownCount] = s;
      shownCount++;
    }
    // Truncate to this frame's count. The objects themselves stay alive in
    // shownPool, so refilling next frame reuses them.
    shown.length = shownCount;
    // Answers are for the pose this pass is drawing, so this runs AFTER the
    // world positions are collected and BEFORE anything reads `occluded`.
    this.refreshWallOcclusion(shown, cam);

    // ── The focus, and how long each half of it lasts: roomFocus.ts ────────
    // Resolved BEFORE any grouping runs, so a single pass cannot group with a
    // focus it is about to drop. The zoom is in CSS px (see
    // quantisedPixelsPerWorldUnit) — the one comparison made BETWEEN frames.
    const suppressOthers = this.focus.size > 0
      && this.focus.step(this.quantisedPixelsPerWorldUnit(shown, true));

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
      this.setValueVisible(s.lbl, s.lbl.valueText.text.length > 0);
    }
    // Before ANY measurement this pass: the icon scale is derived from the rung
    // (see syncIconZoomToRung) and resizing controls after `labelBoxes` has read
    // them would break the file's oldest rule — layout geometry equals render
    // geometry.
    this.syncIconZoomToRung(shown);
    const clearance = this.screenClearance(shown);
    if (clearance) {
      const withText = this.placementItems(shown, this.labelBoxes(shown), clearance);
      const touching = markContacts(withText, clearance.gap, clearance.minSep, this.placeScratch);
      for (let i = 0; i < shown.length; i++) {
        if (touching[i]) this.setValueVisible(shown[i].lbl, false);
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
    // A new pass: the last one's chips, cards, reasons and counters go.
    this.pass.begin();
    for (const s2 of shown) {
      const raw = this.roomOf(s2.id);
      const k = roomKey(raw);
      // Smallest spelling wins, so a chip's label cannot depend on which badge
      // of the room happened to be projected first.
      const seen = this.pass.roomDisplay.get(k);
      if (seen === undefined || raw < seen) this.pass.roomDisplay.set(k, raw);
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
    if (suppressOthers) {
      for (const k of this.pass.roomDisplay.keys()) {
        if (!this.focus.rooms.has(k)) {
          this.pass.chipRoom(k, "focus");
        }
      }
    }

    const pending: PendingEntityGroup[] = this.pendingGroups;
    pending.length = 0;
    let solved: PlacementStats | null = null;
    if (clearance) {
      const items = this.placementItems(shown, boxes, clearance);
      const result = solvePlacement(
        items, clearance.gap, clearance.minSep, BADGE_PLACEMENT, this.placeScratch,
        this.drawableMax(),
      );
      solved = result.stats;
      // The solver states its own two reasons (undrawable/degenerate) in
      // `stats`; they are re-counted here so every chip has ONE accounting.
      // ── Every PAIR the solver formed, with the numbers behind it ─────────
      // A group of TWO is the case a person can check by eye ("those two are
      // not touching"), so it is the case the log has to be able to answer.
      // Prints the ids, the actual separation on each axis, the requirement,
      // and the half-extents each requirement came from — which is where a
      // requirement can be larger than the ink. Same buffer as the seat lines,
      // so it rides the `place` line's outcome dedupe.
      // Gated on the channel that PRINTS it, not on the debug flag: `seat` is
      // muted by default since 2.436.0, and this loop would otherwise walk
      // every bucket and build a string per pair for a line nobody sees.
      if (channelEnabled("seat")) {
        for (let b = 0; b < result.bucketCount; b++) {
          const bk = result.buckets[b];
          if (bk.members.length !== 2) continue;
          const [ia, ib] = bk.members;
          const A = items[ia], B = items[ib];
          const dx = Math.hypot(B.sx - A.sx, B.sz - A.sz), dy = Math.abs(B.sy - A.sy);
          const needX = Math.max(A.reach + B.reach + clearance.gap, clearance.minSep);
          const needY = Math.max(A.reachY + B.reachY + clearance.gap, clearance.minSep);
          this.pass.seatLog.push(
            `pair ${shown[ia].id} + ${shown[ib].id}`
            + ` dx=${dx.toFixed(0)}/${needX.toFixed(0)} dy=${dy.toFixed(0)}/${needY.toFixed(0)}`
            + ` halfW=${A.reach.toFixed(0)},${B.reach.toFixed(0)}`
            + ` halfH=${A.reachY.toFixed(0)},${B.reachY.toFixed(0)}`
            + ` pill=${shown[ia].lbl.valueWrap.isVisible ? "y" : "n"}`
            + `${shown[ib].lbl.valueWrap.isVisible ? "y" : "n"}`);
        }
      }
      for (const room of result.chipRooms) this.pass.chipRoom(room, "solver");
      for (let b = 0; b < result.bucketCount; b++) {
        const bucket = result.buckets[b];
        let wx = 0, wy = 0, wz = 0;
        for (const i of bucket.members) {
          wx += shown[i].wx; wy += shown[i].wy; wz += shown[i].wz;
          this.pass.entityGrouped.add(shown[i].id);
        }
        const n = bucket.members.length;
        // Keyed by the PILE alone. It was `room|pileKey`, which was stable only
        // while a bucket's room was — and a bucket's room can now change (a
        // cross-room pile loses a member and becomes single-room), which would
        // have rebuilt the group's GUI controls mid-zoom and flickered.
        // pileKey is the pile's lowest entity_id, so it is already unique.
        const primary = this.pass.roomDisplay.get(bucket.room) ?? bucket.room;
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
      this.pass.pairFocusedRoom(shown, items, clearance, pending);
    }

    // Placed only after every bucket is known: a group's clearance is measured
    // against the badges that were ACCEPTED, and which those are is not
    // settled until the solve above has finished.
    if (clearance) this.pass.placeEntityGroups(shown, boxes, pending, clearance);

    // Chips are derived and drawn LAST, but which rooms have one is settled
    // here — a chip can push a neighbour's badge or card to its own room's
    // chip, and every visibility flag below has to be this pass's final answer.
    const chips = this.pass.settleChips(shown, boxes, pending, clearance);

    for (const s of shown) {
      // ZERO X offset and a FIXED Y lift that centres every badge over its
      // own anchor — the same value for all of them, so nothing here can move
      // one badge relative to another. This is the "a badge never moves"
      // invariant expressed literally rather than as a budget that happens to
      // be small: there is no per-badge displacement to set.
      s.lbl.container.linkOffsetXInPixels = 0;
      s.lbl.container.linkOffsetYInPixels = baseY;
      s.lbl.container.isVisible = s.inFront
        // A wall between the eye and the device, while walking. Sits beside
        // `inFront` deliberately: both are gates on DRAWING a badge whose
        // grouping has already been decided, so neither can move a badge or
        // change which pile it belongs to.
        && !s.occluded
        && !this.pass.roomClustered.get(roomKey(this.roomOf(s.id)))
        && !this.pass.entityGrouped.has(s.id);
    }
    this.renderChips(chips);
    this.updateEntityGroups(shown, pending);
    // Either channel, because this method emits BOTH the `place` line and the
    // flush of the `seat` buffer — asking for one of them must not silence the
    // other. Cheap enough to keep on the flag alone were it not for that.
    if (channelEnabled("place") || channelEnabled("seat")) {
      this.logPlacement(shown, clearance, solved, pending);
    }
    // Last, so every visibility flag it reads is this pass's, not the previous
    // frame's.
    // ⚠️ Gated on the CHANNEL, not the debug flag. Every line this emits is a
    // `placeDebug`, and the method re-solves the whole layout from a reversed
    // input to check purity — a second full solve per pass. With `place` muted
    // (2.436.0) that is pure cost for output nobody sees, and `?debug=place`
    // brings both the work and the lines back together.
    if (channelEnabled("place") && clearance) {
      this.assertPlacementInvariants(shown, boxes, clearance, pending, chips, tm, vp);
    }
  }

  /**
   * Hide the badges of devices standing behind a wall, while walking.
   *
   * In the bird's-eye view the villa is deliberately seen through its own
   * walls — that is what a cut-away plan IS — so this does nothing there and
   * the unfocused overview path stays byte-identical. Standing inside a room,
   * the opposite holds: a badge for a device three rooms away, painted over the
   * wall in front of you, is not a label for anything you can see.
   *
   * ── Why this cannot be a per-frame raycast ────────────────────────────────
   * ── IT CASTS NOTHING WHILE YOU ARE MOVING, AND THAT IS THE DESIGN (2.438.0) ─
   * MEASURED, from an owner capture, after I shipped this costing a ray budget
   * per frame: `occlMs=54.4 … 121.3` for eight rays — 7 to 15 ms EACH, against
   * a frame budget of 16. `occluders=307`, because a baked villa's structure is
   * split into ~150 material primitives per storey and each one's bounding box
   * spans the whole building, so the cheap bounding rejection rejects nothing
   * and every ray does real triangle work across ~1.4M triangles. floorProbe's
   * header had already recorded this exact fact ("~950 ms measured, 27% of
   * visible load" for a few hundred probes) and its whole design — memoise per
   * room, persist to localStorage — exists because of it. I had the number and
   * shipped eight per frame anyway.
   *
   * So the rule is: **a moving camera casts no rays at all.** It keeps the
   * answers from the last time it stood still, which are wrong by at most the
   * distance walked since — and a badge that lags a step behind while the whole
   * view is sliding is invisible, where a 100 ms hitch is not. The sweep runs
   * only once the eye has been still for `OCCLUSION_SETTLE_MS`, which is also
   * exactly when the frames are cheap enough to afford it.
   *
   * The budget is then TIME, not a ray count, because a ray count is a budget
   * in the wrong unit: the same eight rays cost 7 ms in a corridor and 121 ms
   * looking down the length of the villa. At least one ray always runs (so the
   * sweep cannot stall) and the pass stops as soon as it has spent
   * `OCCLUSION_MS_BUDGET`. On this villa that is one ray per pass and a full
   * sweep of 73 badges takes about a second of standing still — unnoticeable,
   * because nothing is moving.
   *
   * While a sweep is incomplete the pass marks the layout dirty and asks for
   * another frame, because `cullLabels` early-returns on an unchanged
   * view-projection matrix — without that, stopping mid-sweep would freeze half
   * the badges on a stale answer until the camera moved again.
   *
   * The occluder set is `blocksCameraBeam` — structure only, the same predicate
   * a camera's detection cone is clipped against, for the same reason: walls,
   * slabs and the shell are what you genuinely cannot see through, while
   * furniture, curtains and door trim are not (and a beam clipped on those
   * collapsed to a stub). Visibility is tested EXPLICITLY because a custom pick
   * predicate REPLACES Babylon's enabled/visible filter rather than adding to
   * it (see floorProbe's header) — so a hidden storey's slab, or a ceiling
   * hidden in overview, cannot occlude anything.
   */
  private refreshWallOcclusion(shown: ShownLabel[], cam: Camera): void {
    if (!WALL_OCCLUSION || !this.firstPerson || shown.length === 0) {
      // Leaving first-person must not strand a hidden badge — the overview has
      // no notion of occlusion at all.
      if (this.occlusion.occluded.size) {
        this.occlusion.reset(true);
        for (const s of shown) s.occluded = false;
      }
      return;
    }
    // A TIME budget, halved on a phone — see occlusionSweep.ts.
    const budget = this.pointer === "coarse" ? OCCLUSION_MS_COARSE : OCCLUSION_MS_BUDGET;
    const pass = this.occlusion.step(shown, cam.globalPosition, budget);
    if (pass === "idle") return;
    // Settling: no rays while moving, but a frame must come to start the sweep
    // the moment the camera stops.
    if (pass === "settling") { this.requestRender(); return; }
    this.reportWalkCost(shown.length);
    if (pass === "sweeping") {
      // The sweep owes answers and the camera may now stop moving — see the
      // early-return in cullLabels, which would otherwise freeze half the
      // badges on a stale answer.
      this.layoutDirty = true;
      this.requestRender();
    }
  }

  /** The occlusion sweep's adapter: is this segment blocked by a VISIBLE
   *  structure mesh? Tests only `occluders` (resolved once per load, not a
   *  scene walk — 2.437.0), and asks visibility per ray because a hidden
   *  storey's slab, or the ceiling hidden in overview, must not occlude. */
  private castOcclusionRay(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number,
  ): string | null {
    this.occlRay.origin.set(ox, oy, oz);
    this.occlRay.direction.set(dx, dy, dz);
    this.occlRay.length = len;
    for (const m of this.occluders) {
      if (!m.isEnabled() || !m.isVisible) continue;
      if (this.occlRay.intersectsMesh(m, true).hit) return m.name.replace(/_primitive\d+$/, "");
    }
    return null;
  }

  /**
   * What walking actually costs, once every WALK_REPORT_MS, UNTAGGED so it
   * survives the default channel set.
   *
   * This exists because "it feels a bit more laggy now" arrived against a
   * release that added two things to the walk path (a per-frame ray sweep and
   * the storey-above ceiling), and the only honest answer to a *feeling* is a
   * number. `occlMs` is the sweep's own cost, `active` is how many meshes the
   * last frame actually drew — which is where the ceiling would show up — and
   * `fps` is the headline the report was about. If `occlMs` is a rounding error
   * and `fps` is low, the rays are not the cause and `WALL_OCCLUSION` will
   * prove it in one line.
   *
   * Throttled rather than deduped: this is a rate, and a rate printed once per
   * change is a rate nobody can read.
   */
  /** See `walkFloorCost`. Called once by SceneManager after the camera exists. */
  setWalkFloorCost(
    fn: () => { rays: number; ms: number; still: number; flat: boolean; cand: number },
  ): void {
    this.walkFloorCost = fn;
  }

  /**
   * The ceiling's state DURING A WALKING FRAME, which is the one time nobody
   * has measured it (2.455.0).
   *
   * Everything known about the ceiling so far was reported at LOAD, in the
   * overview, where `isVisible` is deliberately false — so `11 enabled` was
   * measured in the one view that is supposed to hide them. Five fixes have
   * been argued from that line. `active` is the field that cannot be argued
   * with: it counts how many of them Babylon actually submitted for the last
   * frame, so `enabled=11 visible=11 active=0` and `active=11` are completely
   * different faults and every previous report collapsed them.
   */
  private ceilingState:
    (() => CeilingState) | null = null;

  setCeilingState(fn: () => CeilingState): void {
    this.ceilingState = fn;
  }

  private reportWalkCost(eligible: number): void {
    // The FLAG, not a channel, and deliberately so: this line is untagged
    // precisely because it measures a tier whose own channel is muted. Do not
    // "converge" it onto channelEnabled — an instrument that goes quiet with
    // the thing it measures is not an instrument.
    if (!debugFlagEnabled()) return;
    const now = performance.now();
    if (now - this.lastWalkReportAt < WALK_REPORT_MS) return;
    // ⚠️ THE WINDOW IS NOT WALK_REPORT_MS AND THIS LINE USED TO IMPLY IT WAS.
    // reportWalkCost is called from the occlusion sweep, which early-returns
    // once the sweep is complete and the eye is still — so the throttle is a
    // FLOOR on the gap, never the gap itself. An owner capture ran 2.0, 2.4,
    // 4.5 and 9.6 s between consecutive lines, and `floorMs=2466` over 9.6 s is
    // 26% of wall-clock where the same figure over 2 s would be impossible.
    // Every "per 2 s window" reading taken off this line before 2.493.0 was
    // therefore arithmetic on an assumed denominator, mine included. Printed so
    // the rate can be computed instead of assumed.
    const winMs = this.lastWalkReportAt === 0 ? 0 : now - this.lastWalkReportAt;
    this.lastWalkReportAt = now;
    const eng = this.scene.getEngine();
    tapDebug(
      `walk: fps=${eng.getFps().toFixed(0)}`
      + ` occl=${this.occlusion.occluded.size}/${eligible} swept=${this.occlusion.swept}/${eligible}`
      // `moving` is the field that says whether the sweep was even ALLOWED to
      // run this pass — without it, `rays=0` reads as "cheap" when it means
      // "not asked", which is the misread this project keeps paying for.
      + ` moving=${this.occlusion.isMoving() ? "y" : "n"}`
      + ` rays=${this.occlusion.lastRays}/pass occlMs=${this.occlusion.lastMs.toFixed(2)}`
      + ` occluders=${this.occluders.length} active=${this.scene.getActiveMeshes().length}`
      + ` win=${(winMs / 1000).toFixed(1)}s`
      // ⚠️ The field that turns `occl=N/M` from a count into a diagnosis. Top
      // blockers by share, each with up to two of the entities it hid, so
      // "the ceiling is eating badges" and "you are simply indoors and most of
      // the villa is behind walls" — which produce the SAME count — are one
      // glance apart. Empty string when nothing is occluded, so it costs a
      // stationary overview capture nothing.
      + (() => {
        if (!this.occlusion.blockedBy.size) return "";
        const counts = new Map<string, number>();
        const eg = new Map<string, string[]>();
        for (const [id, mesh] of this.occlusion.blockedBy) {
          counts.set(mesh, (counts.get(mesh) ?? 0) + 1);
          const list = eg.get(mesh) ?? [];
          if (list.length < 2) { list.push(id); eg.set(mesh, list); }
        }
        return " occludedBy=" + [...counts]
          .sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([m, c]) => `${m}x${c}(${(eg.get(m) ?? []).join(",")})`).join(" ");
      })()
      // The OTHER raycast that runs while the camera moves — CameraController's
      // floor follower, which mine is not a substitute for and which no capture
      // has ever measured. Reported as a RATE (what it spent since the last
      // line, i.e. per WALK_REPORT_MS) because that is the shape of the
      // question: how much of a second is it eating? Zeroed on read, so two
      // lines cannot double-count the same milliseconds.
      + (() => {
        const c = this.walkFloorCost?.();
        if (!c) return " floor=-";
        // `floorStill` is this line's `moving=`: probe slots the stationary gate
        // declined. Without it `floorRays=0` reads as "cheap" when what it means
        // is "the eye did not move", and those are different findings.
        // `floorFlat` is why the other two moved. Without it a drop in
        // floorRays reads as "the probe got cheaper" when what happened is
        // "the gate widened because the ground was level" — and on a stair or
        // a terrace edge it must read n, or the widening is hiding a fault.
        const line = ` floorRays=${c.rays} floorStill=${c.still}`
          + ` floorFlat=${c.flat ? "y" : "n"} floorMs=${c.ms.toFixed(2)}`
          + (c.rays > 0 ? `/${(c.ms / c.rays).toFixed(1)}ms-per-ray` : "")
          + ` floorCand=${c.cand}`;
        c.rays = 0;
        c.ms = 0;
        c.still = 0;
        return line;
      })()
      + (() => {
        const s = this.ceilingState?.();
        // `above=` is the field that decides between "rendering is broken" and
        // "there is no ceiling over this spot" — see SceneManager.setCeilingState.
        return s
          ? ` ceil=${s.enabled}e/${s.visible}v/${s.active}a`
            + ` above=${s.above !== null ? `ceiling@${s.above.toFixed(2)}m` : "none"}`
            + ` near=${s.near === null ? "-" : `${s.near.toFixed(1)}m`}`
            + ` at=${s.at.x.toFixed(1)},${s.at.y.toFixed(1)},${s.at.z.toFixed(1)}`
          : "";
      })(),
    );
  }

  /** Which camera the badges are being drawn from. Set by SceneManager on every
   *  view switch AND after a model load, because a load can land in either
   *  view. Only wall-occlusion reads it — everything else that differs between
   *  the two cameras already rides `VIEW_METRIC`/`setIconZoomFit`. */
  setFirstPerson(on: boolean): void {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    this.occlusion.reset(!on);
    this.markLayoutDirty();
  }

  /**
   * Show or hide a badge's value — and, with it, the gap that separates the
   * value from the icon.
   *
   * ONE owner, because there are six places that decide a value's visibility
   * (the readout drop in cullLabels, the contact drop, updateLabel's empty
   * check, the room-zoom measurement's save and restore, and construction) and
   * a seventh will exist eventually. A gap left visible beside a hidden value is
   * dead width on every valueless card; a gap hidden beside a visible one puts
   * the number back against the icon. Neither is discoverable from the site that
   * forgot it, which is the whole reason this is a method and not two lines.
   */
  private setValueVisible(lbl: LabelControls, on: boolean): void {
    lbl.valueWrap.isVisible = on;
    if (lbl.valueSpacer) lbl.valueSpacer.isVisible = on;
    // BOTH margins around the value ride its visibility, or a valueless card
    // pays for space around text it is not drawing — the same dead-width bug
    // the gap spacer above was written to avoid, on the other side.
    if (lbl.valueTail) lbl.valueTail.isVisible = on;
    // …and the left margin: `padl` beside a value, `barePad` without one.
    if (lbl.padL) lbl.padL.isVisible = on;
    if (lbl.barePad) lbl.barePad.isVisible = !on;
  }

  /**
   * What a badge's value is ACTUALLY DRAWN AT — read off Babylon after the frame
   * is laid out, on the `badge` channel.
   *
   * ⚠️ THIS EXISTS BECAUSE I GOT THE SAME REPORT WRONG FOUR TIMES. "The value
   * sits too far right" was answered with a padding change, an equalised-margin
   * change, a spacer control and an alignment change, each derived from my model
   * of the layout, and the owner's screenshots kept disagreeing with the
   * arithmetic. A model that loses four times to a screenshot is not the thing to
   * reason from. `_currentMeasure` is Babylon's own PRE-transform measure, in CSS
   * pixels (see the chip's `estErr`, which lied for a release by dividing it by
   * the render scale twice), so these numbers are directly comparable with the
   * metrics that produced them — and the FIRST thing they settle is which style
   * is on screen, which I had been assuming rather than checking.
   *
   * Deduped on its own text, so a static view prints one line. Delete this once
   * it has answered: it is a diagnostic, not a permanent boundary.
   */
  private logBadgeGeometry(): void {
    if (!channelEnabled("badge")) return;
    // ⚠️ RELATIVE to the badge, and vertical included. The first cut printed
    // ABSOLUTE left positions and deduped on the whole string, so it re-fired on
    // every frame the camera moved — the owner's capture came back as eighty
    // identical-but-for-L lines. What is being investigated is the layout INSIDE
    // the badge, which does not move with the camera at all.
    const meas = (c: unknown) => (c as {
      _currentMeasure?: { left: number; top: number; width: number; height: number };
    } | undefined)?._currentMeasure;

    // ⚠️ Relative to THIS badge, not to some other label's — the first cut read
    // the origin off `labels.values().next()`, so every value still moved with
    // the camera, the dedupe never matched, and the owner's capture came back as
    // two hundred lines. The layout under investigation is INSIDE one badge and
    // does not move at all; with the right origin this prints once and stops.
    let origin: { left: number; top: number } | undefined;
    const box = (c: unknown): string => {
      const m = meas(c);
      if (!m || !origin) return "?";
      return `x${(m.left - origin.left).toFixed(1)}+${m.width.toFixed(1)}`
        + `/y${(m.top - origin.top).toFixed(1)}+${m.height.toFixed(1)}`;
    };
    for (const [id, lbl] of this.labels) {
      if (!lbl.container.isVisible || !lbl.valueWrap.isVisible) continue;
      if (!lbl.valueText.text) continue;
      const m = this.metrics;
      const card = this.isCardStyle();
      const glyphPx = this.glyphPxFor(card);
      const badgeM = meas(lbl.badge);
      origin = badgeM;
      const glyphM = meas(lbl.glyph);
      const textM = meas(lbl.valueText);
      const ink = card ? glyphPx * BADGE_INSET_CARD : 0;
      // ⚠️ REFUSE TO PRINT A ROW THAT IS NOT LAID OUT YET, because this
      // instrument's whole job is to be believed over a model of the layout.
      // A 2026-08-19 capture printed `badge x0.0+18.0 … gap x-54.0+1.0 …
      // gap=-68.40 visR=55.00` for one badge while every other badge on the
      // same glass read `gap=2.60 visR=3.00`. 18 px is this badge WITHOUT its
      // value, and the value's controls sat 54 px to its LEFT — the signature
      // `adaptWidthToChildren` leaves for one frame (it parks the parent's
      // width until the layout pass, the same mechanism that drew a room chip
      // 1439 px off in 2.404.0). The arithmetic was faithful; its inputs came
      // from two different layout states.
      //
      // That mattered more than a stray line: the value here is a constant
      // ("100%"), so the dedupe below would have kept that ONE wrong reading
      // as the badge's only entry for the rest of the session. Four rounds of
      // this bug were already lost to reasoning from numbers that disagreed
      // with the screen.
      //
      // Bounded on BOTH sides deliberately — a right-edge test alone passes
      // this case, since the offending children are to the LEFT.
      const inside = badgeM && glyphM && textM
        && Math.min(glyphM.left, textM.left) >= badgeM.left - 0.5
        && Math.max(glyphM.left + glyphM.width, textM.left + textM.width)
          <= badgeM.left + badgeM.width + 0.5;
      if (!inside) {
        // Counted, never silently skipped: the next frame re-measures, so if
        // this were only the first-frame transient it costs one tick and the
        // real line follows. A count that keeps CLIMBING says the opposite —
        // the row never settles — which is the finding, not the noise.
        this.badgeGeomUnsettled += 1;
        return;
      }
      // The three numbers the fix is ABOUT, spelled out so nobody has to
      // subtract four boxes by hand again: the visible margins either side and
      // the visible gap between the chip's ink and the number.
      const visible = badgeM && glyphM && textM
        ? `visL=${(glyphM.left + ink - badgeM.left).toFixed(2)}`
          + ` gap=${(textM.left - (glyphM.left + glyphM.width - ink)).toFixed(2)}`
          + ` visR=${(badgeM.left + badgeM.width - (textM.left + textM.width)).toFixed(2)}`
        : "visL=? gap=? visR=?";
      const line =
        `badge "${id}" val="${lbl.valueText.text}"`
        + ` style=${card ? "CARD" : "classic"} scale=${this.effectiveScale().toFixed(2)}`
        + ` font=${card ? m.cardValueFontPx : m.pillValueFontPx}`
        + ` glyphPx=${glyphPx} iconPad=${card ? ((m.cardHeightPx - glyphPx) / 2).toFixed(2) : 0}`
        + ` ink=${card ? (glyphPx * BADGE_INSET_CARD).toFixed(2) : 0}`
        + ` | badge ${box(lbl.badge)} glyph ${box(lbl.glyph)}`
        + ` gap ${lbl.valueSpacer ? box(lbl.valueSpacer) : "-"}`
        + ` wrap ${box(lbl.valueWrap)} text ${box(lbl.valueText)}`
        + ` | ${visible}`
        + (this.badgeGeomUnsettled
          ? ` (skipped ${this.badgeGeomUnsettled} unsettled frame(s))` : "");
      if (line !== this.lastBadgeGeom) {
        this.lastBadgeGeom = line;
        tapDebug(line, "badge");
      }
      // Reset only once a good line has been PRINTED OR deduped — either way
      // this badge has now been measured settled, which is what the count is
      // there to distinguish.
      this.badgeGeomUnsettled = 0;
      return;
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
  ): { pxPerWorld: number; gap: number; minSep: number; allow: number; basis: ViewBasis;
       refDepth: number } | null {
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
      refDepth: this.rungReferenceDepth(pxPerWorld),
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
    clearance: { pxPerWorld: number; allow: number; basis: ViewBasis; refDepth: number },
  ): PlacementItem[] {
    const pool = this.placeItems;
    const focus = this.focus.rooms;
    const p = this.projPlane;
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      let it = pool[i];
      if (!it) {
        it = { sx: 0, sy: 0, sz: 0, reach: 0, reachY: 0, rank: 0, sortKey: "", category: "", room: "", exempt: false };
        pool[i] = it;
      }
      // Position on the glass (centred where the box is DRAWN) and the room it
      // claims there (inflated by its OWN depth) — badgeLayout.onGlass, which
      // carries both rules and their history. Written back onto the
      // ShownLabel too: placeEntityGroups needs the same plane coordinates,
      // and projecting twice is how two spaces drift apart.
      onGlass(clearance, s.wx, s.wy, s.wz, boxes[i], p, it);
      s.sx = it.sx; s.sy = it.sy; s.sz = it.sz;
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
    for (const [k, on] of this.pass.roomClustered) if (on) chips.push(k);
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
      // The build, on the line itself — a `place` line is almost always pasted
      // as an EXCERPT, so the panel's one-time banner does not travel with it.
      // v2.417.0's claim was falsifiable from two of these lines; deciding
      // whether it had failed or simply not shipped was not.
      `place v${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "?"}`
      + ` rung=${clearance.pxPerWorld.toFixed(3)} icon=${this.iconUserScale.toFixed(2)}x`
      // ⚠️ `css` is what makes `rung` READABLE, and without it a capture can
      // fake a purity violation. The rung is RENDER pixels (deliberately — it
      // cancels against the badge boxes within a frame), so the resolution
      // valve moves it: on a dpr-3 phone the same pose measures 1.5x more
      // while idle than while being dragged, and a v2.420.1 capture duly
      // showed `rung=45.255 zoom=0.84` beside `rung=45.255 zoom=0.71`. Those
      // are two DIFFERENT camera radii wearing one label, not one rung with
      // two layouts. "Same rung => same layout" is only checkable between
      // lines that agree on this field.
      + ` css=${this.cssToGui().toFixed(2)}`
      + ` zoom=${this.iconZoomScale.toFixed(2)} gapPx=${clearance.gap.toFixed(1)}`
      + ` sepPx=${clearance.minSep.toFixed(1)}`
      + ` sinTilt=${clearance.basis.sinPhi.toFixed(3)} az=${clearance.basis.ax.toFixed(3)}`
      + ` metric=${clearance.basis.mode}`
      + ` | badges=${this.labels.size} eligible=${shown.length} behind=${behind} drawn=${drawn}`
      // BUCKETED, NOT DROPPED, and `off` is not the same word as `0`. Wall
      // occlusion exists only under the walking camera, so in overview this
      // field must say "not applicable" rather than print a zero that reads as
      // "measured, nothing hidden" — the exact misread that made four counters
      // in this subsystem lie about the case they existed to measure.
      // `swept/eligible` is how much of the round-robin has answered at the
      // current eye position: anything below `eligible` means some badges are
      // still carrying the previous pose's answer.
      + (this.firstPerson
        ? ` occl=${this.occlusion.occluded.size} swept=${this.occlusion.swept}/${shown.length}`
        + ` rays=${this.occlusion.lastRays}`
        : " occl=off")
      + ` | piles=${stats.piles} exempt=${stats.exempt} accepted=${stats.accepted}`
      + ` deferred=${stats.deferred} pulledBack=${stats.pulledBack}`
      + ` | groups=${placed.length}/${stats.buckets} cross=${stats.crossRoom}`
      + ` cards=${cardSizes} counts=${counts}${split ? `/${split}split` : ""}`
      + (this.pass.absorbed ? ` absorbed=${this.pass.absorbed}` : "")
      + (this.pass.focusPairs ? ` focusGroups=${this.pass.focusPairs}` : "")
      // WHY the chips exist, not just how many. A "the whole villa chipped at
      // one zoom" report is unanswerable from a count: several different rules
      // produce a chip and they fail in opposite directions under zoom.
      //
      // ⚠️ This used to name only the solver's two reasons plus focus, while
      // TEN sites could chip a room — so a capture read `undrawable=0
      // degenerate=0 focus=0` next to `chips=8` and sent the reader to the
      // solver, which had chipped nothing. Every reason is now listed, from
      // the one writer (chipRoom), and `solver=` is split by the stats it
      // already carried. The totals reconcile with `chips=` before merging.
      // Always printed, including the zeroes — a diagnostic that omits its own
      // null result reads as a missing measurement.
      + ` | chipWhy: solver=${stats.chipUndrawable}u/${stats.chipDegenerate}d`
      + [...this.pass.chipWhyCount.entries()]
        .filter(([k]) => k !== "solver")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ` ${k}=${v}`).join("")
      + ` total=${[...this.pass.chipWhyCount.values()].reduce((a, b) => a + b, 0)}`
      // OUTSIDE total, on purpose: a chip that was refused is not a chip.
      + (this.pass.chipRefusedNoRoom ? ` noroomRefused=${this.pass.chipRefusedNoRoom}` : "")
      + ` [${groups}] chips=${chips.length} [${chips.join(", ")}]`;
    // ⚠️ Dedupe on the OUTCOME, not the whole line. rung/sinTilt/az change on
    // every frame of a drag, so the old whole-line compare emitted a `place`
    // per pointer move — a capture of one orbit was 30 near-identical lines and
    // the one that mattered scrolled away. These fields are what a placement
    // report is actually about; when none of them moved, the layout did not.
    // The chip REASONS are part of the outcome, not just their total: the same
    // eight rooms chipping for a different rule is a different answer, and
    // deduping it away would hide exactly the transition a zoom report is about.
    const outcome = `${drawn}|${stats.accepted}|${placed.length}/${stats.buckets}`
      + `|${chips.length}|${stats.chipUndrawable}|${stats.chipDegenerate}`
      + `|${[...this.pass.chipWhyCount.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`).join(",")}`;
    if (outcome === this.lastPlaceLog) return;
    this.lastPlaceLog = outcome;
    tapDebug(line, "place");
    // Flushed HERE and nowhere else, so the `seat` detail rides the `place`
    // line's outcome dedupe: it prints once per genuine layout CHANGE instead
    // of once per frame. A field capture of the unbuffered version was dozens
    // of identical lines per frame with the informative ones scrolled away —
    // an instrument nobody can read is not an instrument.
    for (const l of this.pass.seatLog) tapDebug(l, "seat");
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
      refDepth: number;
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
    // The RULES are placementCheck.ts's; this only says what was painted, in
    // the TRUE perspective the GUI layer draws through (Vector3.ProjectToRef),
    // sharing no arithmetic with the solver — the only reason it can disagree.
    const scale = this.effectiveScale();
    const focus = this.focus.rooms;
    const covered = new Set<string>();
    for (const g of groups) for (const i of g.members) covered.add(shown[i].id);
    // `container.isVisible` rather than a reconstruction of the same decision
    // from entityGrouped/roomClustered: the renderer's own answer to "is this
    // drawn", read after the visibility loop has run.
    const badges = shown.map((s2, i) => {
      const room = roomKey(this.roomOf(s2.id));
      return {
        id: s2.id,
        box: { cx: s2.x, cy: s2.y + boxes[i].cy, hw: boxes[i].halfW, hh: boxes[i].halfH },
        visible: s2.lbl.container.isVisible, inFront: s2.inFront, occluded: s2.occluded,
        exempt: focus.has(room), roomChipped: !!this.pass.roomClustered.get(room),
        covered: covered.has(s2.id), offsetX: s2.lbl.container.linkOffsetXInPixels,
      };
    });
    // A card is drawn ENTIRELY ABOVE its anchor — updateEntityGroups sets
    // linkOffsetYInPixels = -(lay.height / 2) * scale so the card's bottom
    // edge lands on the anchor, exactly as a badge's does. The LAYOUT models
    // the same card as a disc centred ON the anchor (cardHalfOf), a documented
    // asymmetry; using the layout's model here would report overlaps nobody
    // can see and miss the ones they can, which is the whole failure mode this
    // method just stopped repeating.
    const cards: { box: ScreenBox; ink: ScreenBox; focused: boolean }[] = [];
    const p = new Vector3();
    for (const g of groups) {
      const lay = this.layoutOf(g, g.members.length);
      p.set(g.wx, g.wy, g.wz);
      Vector3.ProjectToRef(p, Matrix.IdentityReadOnly, tm, vp, p);
      if (!(p.z >= 0 && p.z <= 1)) continue;
      const hw = (lay.width / 2) * scale;
      const hh = (lay.height / 2) * scale;
      // The square INSCRIBED in the card — "is this badge under my ink", the
      // question absorb exists to answer, and a different question from "do we
      // clear each other". Same distinction cardInscribedHalf draws.
      const inner = Math.min(hw, hh);
      const box = { cx: p.x, cy: p.y - hh, hw, hh };
      cards.push({ box, ink: { cx: box.cx, cy: box.cy, hw: inner, hh: inner }, focused: g.focused });
    }
    const found = this.placementCheck.check({
      viewport: vp, badges, cards, chips,
      chipDrawnWidth: (key) => (this.clusters.get(key)?.container as unknown as
        { _currentMeasure?: { width: number } } | undefined)?._currentMeasure?.width,
      chipScale: scale,
      minSepPx: clearance.minSep,
      minGapPx: this.metrics.minGapPx,
      overlapAllow: GROUP_OVERLAP_ALLOW_WIDTHS,
      solve: {
        items: this.placementItems(shown, boxes, clearance), gap: clearance.gap, minSep: clearance.minSep,
        mode: BADGE_PLACEMENT, drawableMax: this.drawableMax(),
      },
    });
    for (const line of found.lines) placeDebug(line);
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

  /**
   * The depth at which a rung's single scene-wide scale is EXACT.
   *
   * ⚠️ THIS IS ALGEBRA ON THE RUNG, NOT A CAMERA QUERY, AND THAT DISTINCTION IS
   * THE WHOLE POINT. `pxPerWorldAt` is `vpH / (2 · dist · tan(fov/2))`, so the
   * distance it was taken at is recoverable from the scale itself. Inverting
   * the SNAPPED value rather than reusing the raw camera distance is what keeps
   * one rung meaning one thing: the depth and the scale then agree exactly, and
   * both move only when the lattice steps.
   *
   * ⚠️ THE FILE SAID THIS COULD NOT BE KNOWN. The residual note above reads
   * "nothing inside a position-invariant metric can know that ratio — knowing
   * it is precisely what 'invariant to where the camera stands' forbids." That
   * is too strong, and it cost the villa a documented class of overlapping
   * badges. What invariance forbids is reading the LIVE camera every frame;
   * this reads a number the rung already fixed. Measured: a pair the solver
   * judged exactly touching overlaps by 9% of a badge width 8 m beyond this
   * depth, 14% at 12 m and 22% at 20 m — which is the far side of a villa, and
   * is exactly where the overlapping badges were reported.
   */

  /** This pass's reference depth, from the same viewport and field of view the
   *  rung was measured with. 0 when either is unavailable, which reads as "no
   *  correction" everywhere downstream. */
  private rungReferenceDepth(pxPerWorld: number): number {
    const cam = this.scene.activeCamera;
    if (!cam) return 0;
    return referenceDepthAt(this.scene.getEngine().getRenderHeight(),
      Math.tan(cameraFrame(this.scene, cam).vHalf), pxPerWorld);
  }

  /**
   * ── THE ICON SCALE IS A FUNCTION OF THE RUNG. NOT OF THE RADIUS. ─────────
   * Two quantities scale badge layout with zoom: the RUNG scales the positions
   * the solver measures, and this scales the boxes it measures them against.
   * The layout is the ratio, so "same rung ⇒ same layout" holds only if the
   * second is determined by the first.
   *
   * 2.414.0 put both on the same 12-per-doubling lattice and that was not
   * enough. Both are proportional to 1/radius but with different constants, so
   * the ceil boundaries sat at different radii: inside ONE rung bucket the icon
   * scale still stepped, and a phone capture showed every rung paired with two
   * adjacent scales — `rung=71.838 zoom=0.84 → chips=3` beside
   * `rung=71.838 zoom=0.89 → chips=8`. Zooming smoothly through a rung made the
   * villa flicker between three chips and eight.
   *
   * So the ratio is taken against the rung itself. `atFit` is the same
   * expression at the fit radius, so `rung / atFit` is exactly `fitRadius / r`
   * before quantisation — the number getIconZoomCap used to return — and after
   * it, a function of the rung alone. One rung, one size, one layout.
   *
   * ⚠️ The exponent may NEVER exceed 1: badge/separation ∝ r^(1−e), so
   * "zooming out may never un-group" IS e ≤ 1. See ICON_ZOOM_EXPONENT, and the
   * pin in the suite that rejects the 1.8 this shipped with.
   */
  private syncIconZoomToRung(shown: ShownLabel[]): void {
    const fit = this.iconZoomFitRadius;
    if (!(fit > 0)) { this.applyIconZoom(1); return; }
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const vpH = this.scene.getEngine().getRenderHeight();
    // ⚠️ RENDER pixels on BOTH sides, and deliberately not the `cssPixels`
    // variant. It cancels in the ratio, so this is hw-independent anyway — and
    // asking for CSS px here would quantise against a DIFFERENT rung from the
    // one scaling the positions, which is the offset-lattice bug this method
    // exists to remove, reintroduced through the other door.
    // A function of the RUNG — badgeScale.iconZoomAt, which carries why.
    const z = iconZoomAt(this.quantisedPixelsPerWorldUnit(shown), vpH,
      Math.tan(cameraFrame(this.scene, cam).vHalf), fit);
    if (z !== null) this.applyIconZoom(z);
  }

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
    const vpH = viewportPx(engine.getRenderHeight(), engine.getHardwareScalingLevel(), cssPixels);
    // Not `cam.fov` directly: whether that is the vertical or the horizontal
    // angle is cameraFrame.ts's question, and this reader was one of four that
    // each answered it separately. Its `|| 0.8` fallback lived on there too.
    const fov = 2 * cameraFrame(this.scene, cam).vHalf;
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
    // Ceiled onto the zoom lattice — see badgeScale.rungAt and the note below.
    // ⚠️ CEIL, NOT ROUND — the rung must never sit BELOW the drawn zoom.
    // `k` scales every separation the solver measures (`s.sx = p.px * k`)
    // while the badge boxes it compares them against are real drawn pixels
    // that no rung can shrink. So a rung under the true zoom hands the solver
    // shortened distances and full-size boxes, and it groups while space is
    // still visible on the glass — exactly the report. Rounding UP makes the
    // error one-sided: measured separations are always ≥ drawn, so grouping
    // can only ever be late, never early. See GROUP_ZOOM_STEPS_PER_DOUBLING
    // for why the step is small enough that "late" is imperceptible.
    return rungAt(vpH, Math.tan(fov / 2), dist);
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
        // ⚠️ THE RENDERER'S OWN STRUTS — see badgeCard.cardStruts. This read
        // `cardPadLeftPx + cardHeightPx + valW`, which shares exactly one term
        // with what `rebuildLabels` actually builds, and over-reserved about
        // 10 CSS px per card: three to five times `minGapPx`, on the very
        // estimate the gap constants are tuned against.
        const valW = hasVal ? s.lbl.valueText.text.length * m.cardValueCharPx : 0;
        const cardW = cardStruts(m.cardHeightPx, this.glyphPxFor(true), valW).width;
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
      const pillCapable = VALUE_CAPABLE_TYPES.has(s.lbl.type);
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
   * Is this a PHONE, in CSS pixels — the one reading of that question.
   *
   * It now governs exactly one thing: cells per CARD (`perCardCap`). It used
   * to ALSO cap the arrangement's total cell count, which on a phone pinned
   * `drawableMax` at 2 and sent every pile of three to its room chip — see
   * badgeMetrics' block where PHONE_MAX_TOTAL_CHIPS used to be.
   *
   * Read in CSS px, never render px: the resolution valve moves the render
   * width whenever the camera starts and stops, and a device that stopped
   * being a phone mid-gesture would regroup its badges for no reason. That is
   * the same trap the focus-retention rule fell into in 2.354.0.
   */
  private isPhoneWidth(): boolean {
    const engine = this.scene.getEngine();
    const cssWidth = engine.getRenderWidth() * engine.getHardwareScalingLevel();
    return cssWidth > 0 && cssWidth <= PHONE_MAX_CSS_WIDTH;
  }

  private cardCellCap(max = MAX_TOTAL_CHIPS): number {
    const width = this.scene.getEngine().getRenderWidth();
    const scale = this.effectiveScale();
    if (width === this.capWidth && scale === this.capScale && max === this.capMax) return this.capCells;
    this.capWidth = width; this.capScale = scale; this.capMax = max;
    // ⚠️ ONE answer to "how many cells fit on this screen", and it is MEASURED,
    // not guessed: the loop below asks `cardOf` — the function that lays the
    // card out — whether the arrangement is inside CARD_MAX_VIEWPORT_FRACTION.
    // `perCardCap` already makes a phone's cards pairs, so the shapes this
    // walks are the shapes the phone will actually draw. A second, screen-blind
    // ceiling used to sit in front of it and that is what this cache-line's
    // earlier comment defended; it outlived the count badge that made it safe.
    let cells = max;
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
    return this.isPhoneWidth() ? PHONE_MAX_GRID_CHIPS : MAX_GRID_CHIPS;
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

  /**
   * ⚠️ HISTORICAL NOTE, not a live constant. There is NO cell ceiling for a
   * FOCUSED group's card — the one a room chip's tap produces — and this records
   * why, because "add a cap" is the obvious-looking change that keeps being
   * proposed. (`FOCUS_MAX_CHIPS` was deleted here; `badgeCard.cellMax` still
   * points at this paragraph.)
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
        // A summary whose every member is behind a wall is behind it too — the
        // same rule the room chip applies below, at the same tier (the render
        // set, after every placement decision is final), so a card and a chip
        // standing for the same hidden devices cannot disagree. `every`, not
        // `some`: one visible member and the card still has something to show,
        // and its other cells are the honest statement that those devices are
        // co-located with it.
        if (this.firstPerson && g.members.length > 0
          && g.members.every((i) => shown[i].occluded)) {
          const stale = this.entityGroups.get(g.key);
          if (stale) stale.container.isVisible = false;
          continue;
        }
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
          // WAS `shadowOffsetY = 2` — a directional skirt on a control drawn
          // beside badges that have none. See badgeShadow.ts.
          badgeShadow(sub, "surface");
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
              this.reading(s2.lbl.type, st, this.linkActiveIds.has(s2.id)));
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
              this.reading(shown[i].lbl.type, st, this.linkActiveIds.has(shown[i].id)));
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
    // Which badges each chip stands for — roomChips.bucketRoomChips.
    const members = shown.map((sh) => {
      const st = this.lastState.get(sh.id);
      const p = sh.lbl.anchor.getAbsolutePosition();
      return { id: sh.id, room: roomKey(this.roomOf(sh.id)), pos: { x: p.x, y: p.y, z: p.z },
               kind: st ? this.badgeKind(sh.lbl.type, st) : undefined };
    });
    const seeds = bucketRoomChips(members, (k) => !!this.pass.roomClustered.get(k), (k) => this.pass.roomDisplay.get(k) ?? k);

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
    // Merging is by worst overlap first and repeats until nothing overlaps.
    // ⚠️ THAT ALONE DOES NOT MAKE IT ORDER-INDEPENDENT — this comment claimed
    // it did for several releases while three tie-breaks still read array
    // order. See the merge call below; `boxMerge.ts` owns the rule. The
    // survivor keeps
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
    // ONE object, both readers — fitChipLabel truncates against exactly the
    // model the merge then measures the result with.
    const chipText = this.chipTextMetrics();
    const measure = (c: RoomChip) => {
      c.label = fitChipLabel(c.room, chipSuffixOf(c), chipText, chipBudget);
      if (vp) {
        const p = Vector3.Project(c.centre, Matrix.IdentityReadOnly, tm, vp);
        c.x = p.x; c.y = p.y;
      }
      // Same width ESTIMATE the old path used (chipWidthPx) — it only has to be
      // close enough to decide overlap, not match the drawn glyphs exactly.
      // ⚠️ THE LABEL ALONE. The count is a fixed-size corner overlay living in
      // padding chipWidthPx already reserves; concatenating it here charged
      // every chip ~33 CSS px of phantom width and merged pills that were
      // visibly clear — sixteen times the gap 2.419.0 removed for the same
      // symptom, added back through the width. See chipWidthPx.
      c.halfW = (chipWidthPx(c.label, chipText) / 2) * scale;
      c.halfH = (this.summaryMetrics().size / 2) * scale;
    };

    const chips: RoomChip[] = seeds;
    for (const c of chips) measure(c);

    if (merge && vp && chips.length > 1) {
      // ── THE SAME GAP AS EVERY OTHER TIER (2.419.0) ────────────────────
      // This read `chipGapPx`, a second dial that stayed at 6 when 2.412.0 cut
      // the shared one to 2 — so room chips merged at THREE TIMES the clear
      // space two badges need, and were reported as "aggregating together too
      // soon". The rest of the glass had already converged: `settleChips`'
      // own chip-vs-badge and chip-vs-card tests read `minGapPx` a few lines
      // up, and only this merge did not.
      //
      // It is the last of the three tiers to arrive at THE collision rule —
      // two things collide when their drawn boxes, inflated by ONE gap,
      // intersect — and there is now exactly one number to move if contact
      // ever wants to be tighter or looser. `chipGapPx` is deleted, not
      // aliased, so nothing can drift back apart.
      const gap = this.metrics.minGapPx * scale;
      // ⚠️ THE FIXPOINT IS `boxMerge.ts` NOW, AND THE COMMENT ABOVE WAS WRONG.
      // It claimed "the outcome does not depend on room iteration order", and
      // this loop settled ties with `severity > worst` — so on an exact tie the
      // first pair in ARRAY order won, and array order is room iteration order.
      // Ties are not exotic: two equal-width chips at equal spacing produce
      // them, and villas are frequently laid out on a grid.
      //
      // THREE things had to be made total, not one: which PAIR merges, which of
      // the pair SURVIVES (`a.ids.length >= b.ids.length` handed it to whoever
      // arrived first whenever the counts matched — two rooms with one device
      // each, the common case), and the ORDER the survivors come back in.
      // Measured over all 24 orderings of four tied chips: EIGHT distinct
      // outcomes before, one after.
      //
      // Same defect class as the badge placement order-dependence fixed in
      // 2.366.0 — in the very subsystem that fix was written for.
      mergeOverlapping(
        chips,
        gap,
        (c) => c.ids.length,
        // What the merged chip becomes — roomChips.combineChips.
        (keep, drop) => { combineChips(keep, drop); measure(keep); },
      );
    }

    return chips;
  }

  /**
   * Draw the chips `deriveChips` settled on. Split off it in 2.290.0 so the
   * derivation can run repeatedly inside one pass (see CHIP_COLLISION) without
   * repainting the GUI on every round.
   */
  /**
   * Catch a chip TELEPORTING, and say which half of the pipeline did it.
   *
   * The report: on returning focus to the tab, every room chip jumps sideways
   * for ONE frame and snaps back. Measured off the recording rather than
   * guessed — `flick.mov`, the frame at ~1.23s, 0.7s after the tab regains
   * focus. What that measurement establishes, and therefore what NOT to go
   * looking at again:
   *
   *   • the 3D never moves (badge-free crops are identical to within codec
   *     noise), so it is not the camera and not a resize;
   *   • chip SIZES are unchanged, so it is not the resolution valve and not
   *     effectiveScale();
   *   • a summary CARD sitting at screen centre does not move at all while the
   *     chips shift ~1385px, so it is not a global transform, not the GUI
   *     viewport and not the plan→world calibration — those would move every
   *     linked control together;
   *   • the labels and counts are identical either side of the jump ("Kitchen
   *     2", "Swimming Pool 9"), so the member SETS did not change and neither
   *     did the merge outcome.
   *
   * Same room, same members, same count — so `chip.centre` is a pure function
   * of the member anchors' world positions, and it MUST have come out the same.
   * It did not. That leaves exactly one suspect: an anchor's absolute position
   * was momentarily wrong. This says so out loud, with both centres, so the
   * next capture names it instead of costing another measurement round.
   *
   * Passive and self-triggering: the event lasts one frame and cannot be
   * reproduced on demand, so a counter that has to be read at the right moment
   * is no use — this only speaks when the anomaly actually happens.
   *
   * ⚠️ v2.401.0's version WATCHED THE WRONG THING AND SAID NOTHING. It compared
   * `chip.centre` between calls and gated on the member count being unchanged,
   * so it could only ever report a chip whose world centre moved — and the
   * field capture proved the world centre does NOT move: the user cleared the
   * panel, reproduced the jump, and got no line at all, not even a `place`
   * (which dedupes on outcome, so an unchanged solve is silent). Two lessons,
   * both already paid for once today: a field that covers one half of a
   * two-sided question reads as a complete answer, and a guard written from
   * what a video seemed to show can suppress exactly the case that fires.
   *
   * So it now watches what the user actually sees — the DRAWN position — and
   * reports the world position beside it, which turns the two remaining
   * possibilities into one glance:
   *
   *   screen moved, world ~0  → the PROJECTION moved: the GUI texture size,
   *                             the camera viewport or the hardware scaling.
   *                             `adt`/`render`/`hw` on the line say which.
   *   screen moved, world too → the DATA moved: member anchors or membership,
   *                             and `n=a->b` says whether membership changed.
   *
   * It also no longer gates on the member count, because a count change is a
   * finding rather than a reason to stay quiet.
   */
  private watchChipJump(): void {
    if (!channelEnabled("chip")) return; // per-frame loop — pay nothing when the channel is off
    for (const [key, c] of this.clusters) {
      if (!c.container.isVisible) continue;
      const w = c.node.position;
      const left = c.container.leftInPixels, top = c.container.topInPixels;
      const n = c.entityIds.length;
      const prev = this.lastChipDraw.get(key);
      this.lastChipDraw.set(key, { wx: w.x, wz: w.z, left, top, n });
      if (!prev) continue;
      const screen = Math.hypot(left - prev.left, top - prev.top);
      if (screen < CHIP_JUMP_SCREEN_PX) continue;
      const world = Math.hypot(w.x - prev.wx, w.z - prev.wz);
      const eng = this.scene.getEngine();
      const adt = this.labelLayer?.getSize();
      tapDebug(
        `chipjump ${key} n=${prev.n}->${n}`
        + ` screen=${screen.toFixed(0)}px (${prev.left.toFixed(0)},${prev.top.toFixed(0)}`
        + `->${left.toFixed(0)},${top.toFixed(0)})`
        + ` world=${world.toFixed(2)}m`
        + ` adt=${adt ? `${adt.width}x${adt.height}` : "?"}`
        + ` render=${eng.getRenderWidth()}x${eng.getRenderHeight()}`
        + ` hw=${eng.getHardwareScalingLevel().toFixed(3)}`,
        "chip",
      );
    }
  }

  /** Whole-villa fit radius, or 0 for no zoom shrink. See setIconZoomFit. */
  private iconZoomFitRadius = 0;

  /** Previous frame's DRAWN chip position per room key, for watchChipJump. */
  private lastChipDraw = new Map<
    string, { wx: number; wz: number; left: number; top: number; n: number }>();

  /** Rendered frames still to trace after the tab woke — see traceWake. */
  private wakeTrace = 0;
  private wakeAt = 0;

  private onWake = (): void => {
    // The CHANNEL, not the flag — every line `traceWake` emits is on `chip`,
    // which is muted by default since 2.436.0. Arming the trace on the flag
    // alone left it walking the cluster map and building a string on every
    // rendered frame after a wake, for output that was then dropped.
    // (`watchChipJump` was converted at the time and this one was missed — the
    // applicable set of that rule is "every gate gating output on a muted
    // channel", not "the sites I happened to be editing".)
    if (document.visibilityState !== "visible" || !channelEnabled("chip")) return;
    this.wakeTrace = WAKE_TRACE_FRAMES;
    this.wakeAt = performance.now();
    tapDebug(`wake: visible — tracing the next ${WAKE_TRACE_FRAMES} RENDERED frames`, "chip");
  };

  /**
   * An UNCONDITIONAL trace of the frames after the tab wakes.
   *
   * Two thresholded instruments (v2.401.0, v2.401.1) both stayed silent through
   * a live reproduction of the chip jump, and the second one watched the drawn
   * position on `onAfterRenderObservable` — so it would have caught any chip
   * that moved more than 120px between two RENDERED frames. It did not fire.
   * That is not "nothing happened"; it is one of two things, and a threshold
   * cannot tell them apart:
   *
   *   • no frame was rendered while the jump was on screen — in which case the
   *     jump is what the COMPOSITOR showed, not what Babylon drew, and no
   *     amount of watching draw calls will ever see it;
   *   • or frames rendered and the chips were where they belonged, meaning the
   *     thing that moves is not a chip control at all.
   *
   * So this stops thresholding. It logs one line per rendered frame for a short
   * window after `visibilitychange`, and the FRAME COUNT is as much the answer
   * as the contents: a handful of lines spread over the seconds the jump is
   * visible settles the first case on its own. Everything that could plausibly
   * shift a linked control is on the line — render size, GUI texture size,
   * hardware scaling, the camera pose — beside where the chips actually landed.
   *
   * Costs nothing when `?debug` is off (onWake returns before arming) and stops
   * by itself after WAKE_TRACE_FRAMES.
   */
  private traceWake(): void {
    const eng = this.scene.getEngine();
    const adt = this.labelLayer?.getSize();
    const cam = this.scene.activeCamera as unknown as
      { alpha?: number; beta?: number; radius?: number } | null;
    const chips = [...this.clusters.entries()]
      .filter(([, c]) => c.container.isVisible)
      .slice(0, 3)
      .map(([k, c]) =>
        `${k}@${c.container.leftInPixels.toFixed(0)},${c.container.topInPixels.toFixed(0)}`)
      .join(" ");
    tapDebug(
      `wake+${Math.round(performance.now() - this.wakeAt)}ms`
      + ` render=${eng.getRenderWidth()}x${eng.getRenderHeight()}`
      + ` adt=${adt ? `${adt.width}x${adt.height}` : "?"}`
      + ` hw=${eng.getHardwareScalingLevel().toFixed(3)}`
      + (cam?.alpha != null
        ? ` cam=${cam.alpha.toFixed(3)}/${cam.beta?.toFixed(3)}/${cam.radius?.toFixed(1)}` : "")
      + ` chips[${chips}]`,
      "chip",
    );
  }

  private renderChips(chips: RoomChip[]): void {
    const layer = this.labelLayer;
    if (!layer) return; // no GUI layer yet — nothing to attach chips to
    const scale = this.effectiveScale();
    const chipRest = categorySurface("others", "off");
    const chipAlert = categorySurface("others", "alert");
    for (const chip of chips) {
      // A chip whose every device is behind a wall is behind that wall too.
      //
      // RENDER SET ONLY, exactly like the merge and the focused-room yield
      // above it: this runs after the escalation fixpoint, so it cannot change
      // which badges are drawn and cannot feed back into any collision test.
      // It is also `every`, not `some` — a chip stands for its whole room, and
      // one visible device in that room is reason enough to keep the room's
      // label on the glass. the occluded set is empty in overview, so this is a
      // set lookup that can never fire there.
      if (this.firstPerson && chip.ids.length > 0
        && chip.ids.every((id) => this.occlusion.occluded.has(id))) {
        const stale = this.clusters.get(chip.key);
        if (stale) stale.container.isVisible = false;
        continue;
      }
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
    // WAS `shadowOffsetY = 2` — see badgeShadow.ts and the summary card above.
    badgeShadow(container, "surface");
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
    // ⚠️ THE SAME NUMBER chipTextMetrics() models this chip's width with. A
    // literal here and an estimate there is how labelLayout came to carry a
    // pad of 24 against a real inset of 40-50 (/dry-audit, 2.422.0).
    text.paddingLeft = `${this.metrics.chipTextPadPx}px`;
    text.paddingRight = `${sm.countSize + this.metrics.chipTextPadPx}px`;
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

    // ── A ROOM CHIP PAINTS BEHIND BADGES AND CARDS (2.430.0) ───────────────
    // Reported: focus a room and its devices draw "behind" other rooms' chips.
    // They did. Every control here shares one layer at the default zIndex, so
    // paint order WAS insertion order, and clusters are built last — after
    // badges (rebuildLabels) and after summary cards. A chip therefore painted
    // over the very devices the focus exists to show.
    //
    // A chip labels a room you are NOT looking at; a badge is a device you are.
    // When they overlap the specific thing wins — the same rule the tap path
    // already states for cards ("a tap that lands on something visible belongs
    // to that thing").
    //
    // ⚠️ PAINT ORDER AND HIT ORDER MUST AGREE. SceneManager's handleTap and
    // handleLongPress now ask pickClusterAt LAST among the GUI tiers; flipping
    // one without the other leaves a chip nobody can see stealing taps from the
    // badge drawn on top of it. Both were `chip first` and both moved together.
    container.zIndex = -1;
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
    const slopCssPx = Math.max(this.metrics.tapSlopMinPx, (TOUCH_MIN_CSS_PX - paintedCssPx) / 2);
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
  /** The ONE place this module assembles a `DeviceReading`, so the villa's
   *  per-entity alert override reaches the map by the same route it reaches
   *  the panel. Every badge drawn here goes through it. */
  private reading(type: EntityType, s: HassEntity, linkedOn: boolean): DeviceReading {
    return {
      type, entity: s, linkedOn,
      alertState: alertStateFor(
        s.attributes.device_class as string | undefined,
        this.config.alertThresholds[s.entity_id]?.alertState),
    };
  }

  private badgeKind(type: EntityType, s: HassEntity): BadgeKind {
    // The rule itself lives in utils/deviceActivity (badgeKindFor), shared with
    // every DOM list that draws the same squircle — this method only supplies
    // the one input the map holds differently: a live set of "your linked
    // entity is on", fed by state events. A camera's MOTION sensor is
    // deliberately NOT part of it: that drives the beam/room glow
    // (applyMotionRouting), never the ring, so the two read independently.
    return badgeKindFor(this.reading(type, s, this.linkActiveIds.has(s.entity_id)));
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
      const v = compactValue(t, st);
      if (v) parts.push(v);
    }
    // ⚠️ THE JOIN IS CLAMPED, NOT JUST EACH PART. clampPill bounds a single
    // value at 16 characters for tidiness; nothing bounded the JOIN, which
    // grows at 21N-5 characters for an N-member group. labelBoxes then reserved
    // that full width while the container could never draw past
    // labelMaxWidthPx — ~384 CSS px reserved against 180 drawn at three
    // members (/dry-audit 2.423.0). Two different questions, so both clamps
    // stay: one keeps a value tidy, this one keeps the model honest.
    return this.clampToLabelWidth(parts.join("  ·  "));
  }

  /**
   * Truncate value text to what the label container can actually DRAW.
   *
   * Derived, not guessed: the ceiling is `labelMaxWidthPx` and the per-character
   * advance is the one `labelBoxes` measures the very same string with, so the
   * width the solver reserves and the width the renderer draws agree by
   * construction rather than by a constant that happens to be big enough.
   */
  private clampToLabelWidth(text: string): string {
    const m = this.metrics;
    const card = this.isCardStyle();
    const fixed = card
      ? m.cardPadLeftPx + m.cardHeightPx + m.cardValuePadPx
      : m.pillValuePadPx;
    const charPx = card ? m.cardValueCharPx : m.pillValueCharPx;
    if (!(charPx > 0)) return text;
    const max = Math.max(1, Math.floor((m.labelMaxWidthPx - fixed) / charPx));
    return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
  }

  /* ⚠️ `compactValue`, `formatSensorValue` AND `clampPill` ALL LIVE IN
   * `utils/entityValue.ts` — this class owns none of them.
   *
   * `compactValue` was the one that got away: it was COPIED there rather than
   * moved, and the private original kept serving every badge for the whole
   * time an oracle pinned the export. Two bodies, one pinned, and the pinned
   * one had no production caller at all — so the oracle could have gone green
   * through any change to the text the screen actually draws.
   *
   * They were private methods on this class, so the DOM panels could not reach
   * them and each wrote a reading its own way: the same 6570.989 W sensor read
   * "6.6 kW" on this badge and "6570.989 W" in the panel a tap opens. The rule
   * is unchanged — only its address is — and the badge passes the two flags
   * that were previously implicit here: hide a nominal status, clamp to 16
   * characters. A panel passes neither, because it has room and no ring. */


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

  private applyToMesh(mesh: AbstractMesh, map: EntityMapping, state: HassEntity): void {
    const setEmissive = this.emissiveOf(mesh);
    const setDiffuse = this.diffuseOf(mesh);

    // What the mesh shows is utils/deviceActivity's meshLookFor — the SAME
    // classification the badge is painted from (device_class, the villa's
    // alert override, in-between states). Only the painting is here.
    const look = meshLookFor(this.reading(map.type, state, false));
    // A device authored as POSE meshes (lock.foo__locked / __unlocked, a
    // door "__open"/"__closed") shows its state by which pose is visible
    // (applyMeshVariant); tinting or pulsing that same mesh on top is
    // redundant, and paints a real door leaf flat green/red. Checked against
    // THIS entity's registered poses, not a word list.
    const poseWord = extractVariantSuffix(mesh.name);
    const isPose = !!poseWord && !!this.meshVariants.get(state.entity_id)?.has(poseWord);

    switch (look.kind) {
      case "none":
        // Lights: BulbSet.show owns their whole look. Covers: never deformed
        // to fake motion — position is a whole-mesh SWAP between pre-posed
        // meshes (applyMeshVariant), an entity-level decision made in apply().
        break;

      case "tint": {
        if (isPose) break;
        // Unavailable is amber, never red: a lock HA has lost contact with
        // asserts no "unlocked" reading (see colors.ts).
        const c = look.tone === "unavailable" ? UNAVAILABLE_AMBER : look.tone === "alert" ? ALERT_RED : SECURE_GREEN;
        setDiffuse?.(c);
        setEmissive?.(c.scale(look.tone === "unavailable" ? 0.25 : 0.2));
        break;
      }

      case "pulse":
        if (isPose) { this.pulsing.delete(mesh); break; }
        if (look.unavailable) {
          // An offline leak/smoke sensor must not look like a safe, monitored
          // one — flag it instead of going quiet.
          this.pulsing.delete(mesh);
          setEmissive?.(UNAVAILABLE_AMBER.scale(0.4));
        } else if (look.on) {
          this.pulsing.add(mesh);
        } else {
          this.pulsing.delete(mesh);
          setEmissive?.(Color3.Black());
        }
        break;

      case "glow":
        setEmissive?.(look.on ? ACTIVE_GLOW : Color3.Black());
        break;

      case "dark":
        // Fans read as on by spinning (updateFanSpin) — a glow was unwanted.
        // Sensors and climate are informational, and a geometry-less one falls
        // back to a placeholder sharing the lights' warm marker material,
        // whose baked glow must be overridden or it reads "lit like a light".
        setEmissive?.(Color3.Black());
        if (map.type === "climate") {
          this.applyClimateOutline(mesh, badgeKindFor(this.reading("climate", state, false)) === "on");
        }
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




}
