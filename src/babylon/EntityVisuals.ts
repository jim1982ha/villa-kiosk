// src/babylon/EntityVisuals.ts
// Reflect HA entity states onto their 3D meshes. Driven imperatively by
// HAStateStore.subscribeAll (NOT React), then requests a render frame.
//
// Visual feedback per entity type (all driven by the binding's resolved type,
// which is editable in the Config Editor):
//   light         -> the bound object glows AND a real PointLight illuminates
//                    the room; colour follows hs/kelvin, intensity follows
//                    brightness, off = dark.
//   cover         -> curtain mesh shows OPEN / HALF / CLOSED (by position % or
//                    open/closed state).
//   fan           -> emissive teal tint while on.
//   lock          -> green (locked) / red (unlocked).
//   switch/media  -> emissive "active" tint when on/playing.
//   binary_sensor -> pulsing red when triggered (e.g. leak).

import {
  Color3, StandardMaterial, PBRMaterial, PointLight, ShadowGenerator,
  Vector3, Matrix, TransformNode, Ray, VertexBuffer, Material,
  type AbstractMesh, type Scene,
} from "@babylonjs/core";
import {
  AdvancedDynamicTexture, Rectangle, TextBlock, StackPanel, Image,
} from "@babylonjs/gui";
import type { AppConfig } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";
import { DEFAULT_ENTITY_ICONS, DEFAULT_BINARY_SENSOR_ICONS, DEFAULT_SENSOR_ICONS } from "@/config/AppConfig";
import { resolveMeshToMapping } from "@/config/EntityMap";
import { categoryForEntity } from "@/config/EntityCategories";
import { hsToRgb, kelvinToRgb } from "@/utils/colorUtils";
import { tapDebug } from "@/utils/tapDebug";
import { RoomHighlight } from "./RoomHighlight";
import { CameraBeams, type BeamSource } from "./CameraBeams";
import { axisWorldScale } from "./meshUnits";

const WARM_GLOW = new Color3(1.0, 0.89, 0.63);
const MAX_LIGHT_INTENSITY = 0.85;
// Baseline emissive for an UNWIRED light marker (no HA state yet). SweetHome
// ceiling spots / LED strips export as small placeholder spheres; at the old
// 0.18 they were almost invisible — especially the clustered ones (Bedroom 1
// ceiling, the living-room LED strips) where 12 faint 10 cm dots at the ceiling
// read as "missing". Lifted so every fixture reads as a real object before it's
// wired; applyToMesh still overrides this from live HA state (on = bright, off
// = black).
const LIGHT_BASELINE_GLOW = 0.5;
// Room-scale reach for a fixture's PointLight. The old value (8 m) lit straight
// through walls into the next room because point lights have no occlusion on
// their own; the un-shadowed markers of a multi-marker strip rely on this tight
// range to stay out of the adjacent room, while the entity's representative light
// is wall-blocked by the per-entity shadow below.
const LIGHT_RANGE = 2.8;
// A SweetHome "line light" (the Sweet Home Light plugin's linear LED strip) is
// mounted flush against a ceiling/wall. A PointLight placed ON the strip sits
// centimetres from that surface, so it prints a hard bright pool right there —
// and sampling several lights along the strip (tried in v2.4.72) just prints a
// CHAIN of pools, reading as separate bulbs instead of a line. The continuous
// "LED line" look must come from the strip mesh's own emissive + GlowLayer
// bloom (view-independent), NOT from dynamic lights. The dynamic light's only
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
// The inflated ~6cm bar is sized for the ON state, where the emissive core +
// GlowLayer halo need several on-screen pixels to read as one continuous
// line. When the light is OFF that same bar is just dead geometry, and no
// base colour can make a 6cm slab at ceiling height look like the ~1cm
// recessed channel it really is. So the OFF state turns the strip
// see-through — the SAME technique as window glass (ModelLoader): material
// alpha + MATERIAL_ALPHABLEND + forceDepthWrite. Material-level alpha rather
// than mesh.visibility on purpose: forceDepthWrite is a material flag, and
// without depth writing Babylon sorts transparent meshes back-to-front per
// frame, which can flip against the (also transparent) glass walls as the
// camera moves — the exact appear/disappear glitch ModelLoader documents for
// glass vs. strips. Transparency does not affect pickability, so an off
// strip stays clickable exactly where its faint trace shows. Only meshes
// tagged __inflatedStrip get this treatment — real lamp geometry keeps full
// visibility when off (a physical lamp doesn't vanish when switched off).
// When the light is ON, applyToMesh restores alpha 1 + MATERIAL_OPAQUE, so
// the on-state render path is byte-identical to before this existed.
const STRIP_OFF_ALPHA = 0.25; // slightly clearer than window glass (0.38)
// A rectangular LED cove (dining-table/sofa perimeter) is built from 4
// separate straight strip pieces (top/bottom/left/right), one per side. Their
// authored endpoints don't always reach far enough to overlap at the
// corners — confirmed straight from the .sh3d source coordinates (not a
// camera-angle or occlusion effect): the sofa rectangle's top-right corner
// has the top piece ending at y≈654.05 while the right piece only starts at
// y≈654.84, a real ~0.8cm gap baked into the model. GlowLayer has nothing
// emissive to bloom from in that gap, so it reads as a hard, camera-angle-
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
// World-space clearance added above a mesh-bound entity's bounding-box top when
// placing its state-label anchor, so the badge floats just clear of the
// geometry instead of sitting flush on it.
const LABEL_ANCHOR_MARGIN = 0.12;
// Total rendered height of a label's container (badge + spacing + value chip;
// must match the StackPanel height set in rebuildLabels). Used to derive the
// link offset so the whole badge sits just above its anchor point instead of
// straddling it, without a separately hand-tuned pixel constant.
const LABEL_HEIGHT_PX = 76;
// Height of the value pill (e.g. "42%", "21°") shown under the badge.
const VALUE_CHIP_HEIGHT_PX = 18;
// The badge circle's rendered diameter (unscaled) — also its tap radius
// basis for pickBadgeAt()'s nearest-centre hit-testing.
const BADGE_DIAMETER_PX = 40;

// Pulse animation speed in radians per second (was 0.06 per frame at ~60 fps).
// Advanced by real elapsed time so the alert pulse breathes at the same rate on
// a 60 Hz tablet and a 120 Hz phone.
const PULSE_RAD_PER_SEC = 3.6;

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

/** A live state distilled to one of the visual kinds the badge colour-codes. */
type BadgeKind = "on" | "off" | "alert" | "info" | "unavailable";

// Badge palette. An ACTIVE device (on / alert) fills the whole disc with its
// state colour so it reads as clearly "live" at a glance — a coloured ring on a
// dark disc wasn't punchy enough. Passive states (off / unavailable) and purely
// informational sensors (info) keep the dark "glass" disc so they recede and let
// the active devices pop. Whites/greys read on both the daytime scene and the
// dark overview backdrop.
const BADGE_BASE_FILL = "rgba(17,24,39,0.74)";
const BADGE_STYLE: Record<
  BadgeKind,
  { fill: string; ring: string; alpha: number; glow: string; glowBlur: number; glyphAlpha: number }
> = {
  // One shared, FULLY OPAQUE blue for every live device — on-devices and
  // sensors alike. Opaque so the badge reads the same colour over any background
  // (a translucent fill let the floor/wood/grass behind it tint the blue, which
  // looked inconsistent); shared so there's no "why is this one darker" — the
  // glyph already tells a thermometer from a light.
  on:          { fill: "rgb(14,165,233)",        ring: "#e0f2fe",               alpha: 1,   glow: "rgba(56,189,248,0.85)", glowBlur: 16, glyphAlpha: 1 },
  alert:       { fill: "rgb(244,63,94)",         ring: "#ffe4e6",               alpha: 1,   glow: "rgba(244,63,94,0.85)",  glowBlur: 16, glyphAlpha: 1 },
  info:        { fill: "rgb(14,165,233)",        ring: "#e0f2fe",               alpha: 1,   glow: "rgba(56,189,248,0.85)", glowBlur: 16, glyphAlpha: 1 },
  // OFF = a SOLID, fully-opaque dark disc with a clear glyph and a defined ring:
  // reads as "here and reachable, just switched off". OFFLINE = a heavily GHOSTED
  // disc (translucent fill, faint ring, faded glyph) so an unreachable device
  // visibly recedes — the strong opacity gap is what tells the two apart.
  off:         { fill: "rgba(30,41,59,0.95)",    ring: "rgba(148,163,184,0.75)", alpha: 1,    glow: "rgba(0,0,0,0.5)",  glowBlur: 6, glyphAlpha: 0.9 },
  unavailable: { fill: "rgba(20,24,31,0.34)",    ring: "rgba(100,116,139,0.32)", alpha: 0.5,  glow: "rgba(0,0,0,0.2)",  glowBlur: 2, glyphAlpha: 0.7 },
};

/** Render an emoji/glyph to a square canvas and cache the data URL. Drawing a
 *  pre-centred bitmap and showing it through a GUI Image sidesteps Babylon
 *  TextBlock's alphabetic-baseline math entirely, but canvas's own
 *  `textBaseline: "middle"` isn't a fix by itself — it centres on the FONT's
 *  ascent/descent metrics, not the glyph's actual visible ink, and colour
 *  emoji glyphs routinely sit well off that metric centre (varies by glyph
 *  and platform). So: draw once, measure the real non-transparent pixel
 *  bounding box via getImageData, then redraw shifted so THAT box is
 *  centred — this is what actually guarantees a vertically/horizontally
 *  centred icon everywhere, no per-glyph hand-tuning. */
const glyphCache = new Map<string, string>();
function glyphDataUrl(glyph: string): string {
  const cached = glyphCache.get(glyph);
  if (cached !== undefined) return cached;
  const px = 72;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  let url = "";
  if (ctx) {
    const font = `${Math.round(px * 0.72)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
    const draw = (dx: number, dy: number) => {
      ctx.clearRect(0, 0, px, px);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = font;
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(glyph, px / 2 + dx, px / 2 + dy);
    };
    draw(0, 0);
    const { data } = ctx.getImageData(0, 0, px, px);
    let minX = px, minY = px, maxX = -1, maxY = -1;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        if (data[(y * px + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX && maxY >= minY) {
      const offX = px / 2 - (minX + maxX) / 2;
      const offY = px / 2 - (minY + maxY) / 2;
      draw(offX, offY);
    }
    url = canvas.toDataURL();
  }
  glyphCache.set(glyph, url);
  return url;
}

export class EntityVisuals {
  private scene: Scene;
  private config: AppConfig;
  private requestRender: () => void;

  /** entity_id -> meshes (one entity can drive several meshes, e.g. curtains). */
  private byEntity = new Map<string, AbstractMesh[]>();
  private mapping = new Map<string, EntityMapping>();
  private pulsing = new Set<AbstractMesh>();
  private pulseT = 0;

  // Real light sources for `light` entities. Keyed by MESH uniqueId (not entity
  // id) so an entity whose fixture is several distinct meshes — e.g. the two
  // bedside lamps that share one HA entity, or the four Led Line meshes of a
  // perimeter strip — gets a real light at EACH piece. ONE light per mesh, no
  // more: materials cap simultaneous lights (ModelLoader), and every light past
  // the cap is silently dropped, which reads as patchy/arbitrary illumination.
  private meshLights = new Map<number, PointLight>();
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
  private iconUserScale = 1;
  private iconZoomScale = 1;
  /** Active storey from FloorManager (1-based). Floors below it stay rendered
   *  (cumulative visibility), so enabled-state alone can't cull their badges —
   *  cullLabels compares each label's stamped floorIndex against this. */
  private activeFloor = 1;

  /** Baked-lighting GLB loaded (see ModelLoader). All lighting — including
   *  every fixture's contribution to the room — is already painted into the
   *  structure's texture, and the structure is unlit, so a runtime PointLight
   *  can't brighten it anyway; per-entity lights and their cube shadow maps
   *  would be pure cost with no visible effect. Skipped entirely in baked
   *  mode. Emissive glow + GlowLayer feedback is KEPT — that's surface glow
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
  /** motion binary_sensor entity_id -> camera entity_ids it drives (see
   *  EntityMapping.motionEntityId). Rebuilt from config.entityMap on every
   *  indexMeshes() (structural entityMap edits re-trigger that already). */
  private motionToCameraIds = new Map<string, string[]>();
  /** Floor-glow overlay for physical (non-camera) motion/presence sensors —
   *  a room, not a direction, is the natural signal for those. */
  private roomHighlight: RoomHighlight;

  constructor(
    scene: Scene,
    config: AppConfig,
    requestRender: () => void,
  ) {
    this.scene = scene;
    this.config = config;
    this.requestRender = requestRender;
    this.roomHighlight = new RoomHighlight(scene, requestRender);
    this.beams = new CameraBeams(scene);
    scene.registerBeforeRender(() => {
      this.animatePulse();
      this.cullLabels();
    });
  }

  /** MUST be called before indexMeshes() — that's where lights are created. */
  setBakedMode(baked: boolean): void {
    this.bakedMode = baked;
  }

  updateConfig(config: AppConfig): void {
    const prevLabels = this.config.showEntityLabels;
    const prevIcons = this.config.entityIcons;
    const prevBsIcons = this.config.binarySensorIcons;
    const prevSensorIcons = this.config.sensorIcons;
    this.config = config;
    // Entity-light wall occlusion is always-on (independent of the global Shadows
    // quality toggle, which drives the expensive sun shadows): walls block lamp
    // light out of the box, so there is nothing to tear down here when the toggle
    // changes.
    const iconsChanged = config.entityIcons !== prevIcons
      || config.binarySensorIcons !== prevBsIcons
      || config.sensorIcons !== prevSensorIcons;
    // Apply the user's size multiplier (combined with the live zoom factor).
    if (typeof config.entityIconScale === "number" && config.entityIconScale !== this.iconUserScale) {
      this.iconUserScale = config.entityIconScale;
      this.applyIconScale();
    }
    if (config.showEntityLabels !== prevLabels) {
      if (config.showEntityLabels) {
        this.rebuildLabels();
      } else if (this.labelLayer) {
        this.labelLayer.rootContainer.isVisible = false;
      }
    } else if (config.showEntityLabels && iconsChanged) {
      // Per-category glyph edited in Settings while labels are shown — rebuild so
      // the new icons take effect, then repaint from the last known states.
      this.rebuildLabels();
    }
  }

  /** Build the reverse index entity_id -> meshes from the loaded GLB. */
  indexMeshes(meshes: AbstractMesh[]): void {
    // Dispose previously created light sources + shadow maps before re-indexing.
    this.disposeLights();
    this.disposeLabelAnchors();
    this.beams.dispose();
    this.pulsing.clear();
    this.byEntity.clear();
    this.mapping.clear();
    this.shadowCasters = [];

    // Creating dozens of PointLights one-by-one makes Babylon re-flag every
    // material's shader as dirty on each add — an O(lights × materials) storm of
    // shader recompiles that dominates load time on a fixture-dense villa. Batch
    // it: suspend the dirty mechanism while we build, then flush once at the end.
    const scene = this.scene;
    scene.blockMaterialDirtyMechanism = true;

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
        // Baked mode: no runtime light — the room's illumination from this
        // fixture is already painted into the structure's texture, and the
        // unlit structure wouldn't respond to a PointLight anyway (see
        // bakedMode). Everything above (material, baseline glow, strip
        // inflation) still runs: the fixture's own on/off glow is kept.
        if (!this.bakedMode) {
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
            const ray = new Ray(pos, Vector3.Down(), 8);
            const hit = this.scene.pickWithRay(ray, (candidate) =>
              candidate !== m && candidate.getTotalVertices() > 0 &&
              !/^(halo_|label_|marker)/i.test(candidate.name));
            if (hit?.hit && hit.distance > 0.3) {
              pos.y -= Math.min(STRIP_DROP_MAX, hit.distance * STRIP_DROP_FRACTION);
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
        }
      }
    }

    this.extendStripJoints();
    this.mergeStripEntityLights();
    scene.blockMaterialDirtyMechanism = false;

    this.buildLabelAnchors();
    this.buildMotionToCameraIndex();
    if (this.config.showEntityLabels) this.rebuildLabels();
  }

  /** A rectangular LED cove (e.g. the dining-table or sofa-area perimeter) is
   *  modelled as SEVERAL separate elongated strip meshes — one per side — so
   *  the per-mesh loop above gives it one PointLight per side: 4 hotspots
   *  instead of one even wash. GlowLayer's bloom blends those into something
   *  that reads fine from a distance, but up close (or with the blur
   *  relatively small vs. the strip's on-screen size) they separate into the
   *  distinct light "pools" the user does not want ("I want to keep seeing a
   *  light line, not separate light bulbs"). When EVERY mesh of a light
   *  entity is an elongated strip, merge their individual PointLights into
   *  ONE shared light at the merged bounding box's centre — one soft,
   *  even room-fill instead of N hotspots. Genuinely separate fixtures under
   *  one entity (e.g. two bedside lamps) don't pass the "every mesh is a
   *  strip" test, so each keeps its own light exactly as before. */
  private mergeStripEntityLights(): void {
    if (this.bakedMode) return; // no per-mesh lights exist to merge — and this must not CREATE one
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
      const ray = new Ray(pos, Vector3.Down(), 8);
      const hit = this.scene.pickWithRay(ray, (candidate) =>
        !meshes.includes(candidate) && candidate.getTotalVertices() > 0 &&
        !/^(halo_|label_|marker)/i.test(candidate.name));
      if (hit?.hit && hit.distance > 0.3) {
        pos.y -= Math.min(STRIP_DROP_MAX, hit.distance * STRIP_DROP_FRACTION);
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

  /** motion binary_sensor -> camera(s) it drives, from the FULL entityMap (not
   *  just meshes indexed in THIS glb) so the link works regardless of which
   *  side has a 3D mesh. Cheap lookup rebuild — safe to redo on every index. */
  private buildMotionToCameraIndex(): void {
    this.motionToCameraIds.clear();
    for (const map of Object.values(this.config.entityMap)) {
      if (map.type !== "camera" || !map.motionEntityId) continue;
      const list = this.motionToCameraIds.get(map.motionEntityId) ?? [];
      list.push(map.entityId);
      this.motionToCameraIds.set(map.motionEntityId, list);
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
    mesh.metadata = { ...(mesh.metadata ?? {}), __inflatedStrip: true };

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

  /** Replace the calibrated room polygons (world space) — forwarded straight
   *  to RoomHighlight. Called by SceneManager after every plan→world re-fit
   *  (load + mirror-flip toggles), same trigger as the teleport grid. */
  setRoomPolygons(polys: { name: string; pts: { x: number; z: number }[]; floorY?: number }[]): void {
    this.roomHighlight.setRooms(polys);
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
    this.beams.rebuild(sources, new Set(this.shadowCasters));
  }

  /** Turn a camera's beam on/off (driven by its linked motion sensor state). */
  private setBeamActive(entityId: string, on: boolean): void {
    if (!this.beams.has(entityId)) {
      tapDebug(`beam ${entityId}: motion ${on ? "ON" : "off"} but NO BEAM MESH exists for this camera`);
      return;
    }
    this.beams.setActive(entityId, on);
    this.requestRender();
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

    const meshes = this.byEntity.get(entity.entity_id);
    const map = this.mapping.get(entity.entity_id);
    if (!meshes || !map) return;
    this.lastState.set(entity.entity_id, entity);
    // Normalise by the number of DISTINCT light objects, not meshes — a merged
    // strip entity (mergeStripEntityLights) shares ONE light across several
    // meshes, so it must get the full intensity, not 1/N of it.
    const lightShare = map.type === "light"
      ? new Set(meshes.map((m) => this.meshLights.get(m.uniqueId)).filter(Boolean)).size || 1
      : 1;
    for (const mesh of meshes) this.applyToMesh(mesh, map, entity, lightShare);
    if (map.type === "light") {
      this.syncEntityShadow(entity.entity_id, meshes, entity.state === "on");
    }
    this.updateLabel(entity.entity_id, map.type, entity);
    this.requestRender();
  }

  /** Route a state change to whichever motion-driven visual it feeds:
   *  - linked to a camera's motionEntityId  -> that camera's detection beam
   *  - otherwise, a binary_sensor with a Room set -> that room's floor glow
   *  A sensor already driving a camera beam does NOT also glow its room —
   *  the two are separate treatments for separate device kinds (see the
   *  camera-vs-physical-sensor design discussion), not a doubled-up alert. */
  private applyMotionRouting(entity: HassEntity): void {
    const on = entity.state === "on";
    const cameraIds = this.motionToCameraIds.get(entity.entity_id);
    if (cameraIds) {
      for (const camId of cameraIds) this.setBeamActive(camId, on);
      return;
    }
    const map = this.config.entityMap[entity.entity_id];
    if (map?.type === "binary_sensor" && map.room) {
      this.roomHighlight.setActive(map.room, on);
    }
  }

  // ---------------------------------------------------------------------------
  // State labels (BJS GUI fullscreen overlay)
  // ---------------------------------------------------------------------------

  /** Resolve the per-category glyph (Settings override > built-in default).
   *  binary_sensor is the one generic domain: when the entity's live state is
   *  known, its `device_class` attribute (moisture, motion, door …) picks a
   *  class-specific glyph so a leak sensor and a PIR stop sharing one icon.
   *  Before the first state arrives — or with no device_class at all — the
   *  per-type glyph applies; updateLabel refreshes the badge on every state
   *  change, so the class glyph appears as soon as HA reports it. */
  private iconFor(type: EntityType, entity?: HassEntity): string {
    if (type === "binary_sensor") {
      const dc = entity?.attributes?.device_class as string | undefined;
      const icon = dc
        ? this.config.binarySensorIcons?.[dc] ?? DEFAULT_BINARY_SENSOR_ICONS[dc]
        : undefined;
      if (icon) return icon;
    }
    if (type === "sensor") {
      const dc = entity?.attributes?.device_class as string | undefined;
      const icon = dc
        ? this.config.sensorIcons?.[dc] ?? DEFAULT_SENSOR_ICONS[dc]
        : undefined;
      if (icon) return icon;
    }
    return this.config.entityIcons?.[type] ?? DEFAULT_ENTITY_ICONS[type] ?? "●";
  }

  /** An entity's map-filter category: whatever the user set in the Config
   *  Editor (persisted on its EntityMapping), falling back to the type-based
   *  default (config/EntityCategories.ts) for entities that don't have one
   *  yet (see bindingUtils). */
  private categoryOf(entityId: string, type: EntityType): Category {
    return this.config.entityMap[entityId]?.category ?? categoryForEntity(entityId, type);
  }

  /** Follow FloorManager's floor toggle — only the active floor's badges are
   *  drawn (see cullLabels). Called by SceneManager on every floor change. */
  setActiveFloor(floor: number): void {
    if (floor === this.activeFloor) return;
    this.activeFloor = floor;
    this.requestRender();
  }

  /** Live bird's-eye zoom factor (1 = default fit). Driven per-frame by
   *  SceneManager from the overview camera; ignored (reset to 1) elsewhere. */
  setIconZoomScale(z: number): void {
    if (Math.abs(z - this.iconZoomScale) < 0.02) return; // skip imperceptible jitter
    this.iconZoomScale = z;
    this.applyIconScale();
  }

  /** Scale every badge container by user-size × zoom, around its anchor point. */
  private applyIconScale(): void {
    const s = this.iconUserScale * this.iconZoomScale;
    for (const lbl of this.labels.values()) {
      lbl.container.scaleX = s;
      lbl.container.scaleY = s;
    }
    if (this.labels.size) this.requestRender();
  }

  private rebuildLabels(): void {
    // Ensure the GUI layer exists.
    if (!this.labelLayer) {
      this.labelLayer = AdvancedDynamicTexture.CreateFullscreenUI("entityLabels", true, this.scene);
    } else {
      this.labelLayer.rootContainer.clearControls();
    }
    this.labels.clear();
    this.labelLayer.rootContainer.isVisible = true;

    // Every mesh-bound entity feeds the same badge pipeline, anchored at its
    // own bounding-box top (see buildLabelAnchors).
    const sources: { entityId: string; anchor: TransformNode; type: EntityType }[] = [];
    for (const [entityId, meshes] of this.byEntity) {
      if (!meshes.length) continue;
      const map = this.mapping.get(entityId);
      if (!map) continue;
      const anchor = this.labelAnchors.get(entityId) ?? meshes[0];
      sources.push({ entityId, anchor, type: map.type });
    }

    for (const { entityId, anchor, type } of sources) {
      const category = this.categoryOf(entityId, type);
      // A compact column: a round "glass" icon badge over an optional value pill.
      // The device TYPE reads from the (pixel-centred) glyph image, the STATE from
      // the ring colour, and the value pill only appears for entities with a
      // meaningful reading (%, °, sensor value). Children are top-aligned in a
      // fixed-height panel so the badge never shifts when the pill shows/hides.
      const container = new StackPanel(`lbl_${entityId}`);
      container.isVertical = true;
      container.width = "128px";
      container.height = `${LABEL_HEIGHT_PX}px`;
      container.spacing = 3;
      this.labelLayer.addControl(container);
      container.linkWithMesh(anchor);
      // The anchor already sits at (or just above) the asset's own top edge —
      // see buildLabelAnchors — so the only pixel offset needed is to lift
      // the WHOLE container clear of that point
      // (rather than centering it on the point), not the large hand-tuned
      // constant this used to be.
      container.linkOffsetYInPixels = -LABEL_HEIGHT_PX / 2;

      const badge = new Rectangle(`lbl_badge_${entityId}`);
      badge.width = `${BADGE_DIAMETER_PX}px`;
      badge.height = `${BADGE_DIAMETER_PX}px`;
      badge.cornerRadius = BADGE_DIAMETER_PX / 2; // = half of width/height -> a circle
      badge.thickness = 2.5;
      badge.background = BADGE_BASE_FILL;
      badge.color = BADGE_STYLE.off.ring;
      badge.shadowColor = "rgba(0,0,0,0.55)";
      badge.shadowBlur = 6;
      badge.shadowOffsetY = 2;
      // Tap/long-press handling is NOT wired here — see pickBadgeAt()'s
      // docstring for why. The badge is a purely visual control now.
      container.addControl(badge);

      const glyph = new Image(`lbl_glyph_${entityId}`,
        glyphDataUrl(this.iconFor(type, this.lastState.get(entityId))));
      glyph.width = "26px";
      glyph.height = "26px";
      glyph.stretch = Image.STRETCH_UNIFORM;
      badge.addControl(glyph);

      // Value pill: a snug rounded chip that hugs its text (adaptWidthToChildren).
      const valueWrap = new Rectangle(`lbl_valwrap_${entityId}`);
      valueWrap.adaptWidthToChildren = true;
      valueWrap.height = `${VALUE_CHIP_HEIGHT_PX}px`;
      valueWrap.cornerRadius = VALUE_CHIP_HEIGHT_PX / 2;
      valueWrap.thickness = 0;
      valueWrap.background = "rgba(15,23,42,0.85)";
      // Padding must clear the stadium's corner radius (VALUE_CHIP_HEIGHT/2) or
      // the text crowds the rounded ends and reads as touching the edges.
      valueWrap.paddingLeft = "10px";
      valueWrap.paddingRight = "10px";
      valueWrap.shadowColor = "rgba(0,0,0,0.5)";
      valueWrap.shadowBlur = 4;
      valueWrap.isVisible = false;

      const valueText = new TextBlock(`lbl_value_${entityId}`);
      valueText.text = "";
      valueText.color = "#f8fafc";
      // Match the app's own UI typeface (--font-ui: Inter) instead of the GUI
      // layer's Babylon default (Arial) — that mismatch, plus font-style:"bold"
      // faking a weight Inter doesn't ship (only 200/400/500/600 are loaded, see
      // index.html), was rendering the pill in a heavier, uneven fallback font
      // that visually clashed with every other label in the app.
      valueText.fontFamily = "Inter, system-ui, sans-serif";
      valueText.fontWeight = "600";
      valueText.fontSize = 11;
      valueText.resizeToFit = true;
      valueText.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
      valueText.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_CENTER;
      valueWrap.addControl(valueText);
      container.addControl(valueWrap);

      this.labels.set(entityId, { container, badge, glyph, valueWrap, valueText, anchor, type, category });

      // Repaint from the last known state so a rebuild (toggle on / icon edit)
      // shows live status immediately instead of an idle default.
      const cached = this.lastState.get(entityId);
      if (cached) this.updateLabel(entityId, type, cached);
    }
    this.applyIconScale(); // honour current size + zoom on freshly built badges
  }

  private updateLabel(entityId: string, type: EntityType, entity: HassEntity): void {
    const lbl = this.labels.get(entityId);
    if (!lbl) return;
    const kind = this.badgeKind(type, entity);
    const style = BADGE_STYLE[kind];
    lbl.badge.background = style.fill; // fill the whole disc for active devices
    lbl.badge.color = style.ring;
    lbl.badge.alpha = style.alpha;
    lbl.badge.shadowColor = style.glow;
    lbl.badge.shadowBlur = style.glowBlur;
    lbl.glyph.source = glyphDataUrl(this.iconFor(type, entity)); // honour live icon + device_class
    lbl.glyph.alpha = style.glyphAlpha;

    const value = this.compactValue(type, entity);
    lbl.valueText.text = value;
    lbl.valueWrap.isVisible = value.length > 0;
  }

  /** Decide which badges are visible, then DECLUTTER the visible ones so no two
   *  stack on the exact same virtual position. Every registered device's tag
   *  stays visible (that's the point of the "Show device state labels" toggle —
   *  an earlier version that HID crowded badges hid most of them and was worse
   *  than the overlap). Instead, overlapping badges are nudged apart in screen
   *  space (a light force-relaxation) and spring back when the crowding clears.
   *  Hidden regardless: anchors projecting behind the camera (z outside [0,1]),
   *  categories filtered off in the HUD, and entities on a hidden floor. */
  private cullLabels(): void {
    if (!this.config.showEntityLabels || this.labels.size === 0) return;
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const eng = this.scene.getEngine();
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const tm = this.scene.getTransformMatrix();
    const hidden = this.config.hiddenCategories;

    // Visible badges + their projected anchor position, for the declutter pass.
    const shown: { id: string; lbl: LabelControls; x: number; y: number; off: { x: number; y: number } }[] = [];

    for (const [id, lbl] of this.labels) {
      if (hidden.includes(lbl.category)) {
        lbl.container.isVisible = false;
        continue;
      }
      // Anchor disabled = its mesh is on a hidden floor (FloorManager's
      // 1F/2F toggle) — the badge must vanish with the device.
      if (!lbl.anchor.isEnabled()) {
        lbl.container.isVisible = false;
        continue;
      }
      // Floors below the active one stay RENDERED (2.9.8 cumulative floors:
      // the 2F view keeps the 1F shell underneath), but their badges are GUI
      // overlay and would draw straight through the 2F slab — show only the
      // active floor's badges. The floorIndex is stamped by FloorManager on
      // the entity mesh; the anchor is either that mesh or a TransformNode
      // parented to it.
      const floorIdx = (lbl.anchor.metadata as { floorIndex?: number } | null)?.floorIndex
        ?? (lbl.anchor.parent?.metadata as { floorIndex?: number } | null)?.floorIndex;
      if (floorIdx !== undefined && floorIdx !== this.activeFloor) {
        lbl.container.isVisible = false;
        continue;
      }
      // Only cull anchors projecting BEHIND the camera (z outside [0,1] — a
      // genuinely invalid screen position). Tap hit-testing does NOT read
      // this projection: it asks each badge control directly via the GUI's
      // own contains() (see pickBadgeAt), so there is no stored screen
      // position to drift out of sync with what's actually drawn.
      const p = Vector3.Project(lbl.anchor.getAbsolutePosition(), Matrix.IdentityReadOnly, tm, vp);
      const visible = p.z >= 0 && p.z <= 1;
      lbl.container.isVisible = visible;
      if (visible) shown.push({ id, lbl, x: p.x, y: p.y, off: { x: 0, y: 0 } });
    }

    this.declutterLabels(shown);
  }

  /**
   * Nudge overlapping labels apart so none share a virtual position — and,
   * crucially, so no BADGE lands on a neighbour's value pill. Each label is
   * modelled as its true screen BOX (the badge, plus the value pill hanging below
   * it when shown), not a circle, and overlaps are resolved with the minimum
   * axis-aligned translation. The layout is a DETERMINISTIC function of the
   * current screen positions — relaxed from zero each frame — and applied
   * DIRECTLY, not eased: a static camera projects the same positions every frame,
   * so the same offsets come out and the labels sit perfectly still. (An earlier
   * version eased toward a target and called requestRender while "moving"; that
   * kept the render loop — and the overview camera's inertia — alive, nudging the
   * projections and sustaining the motion: a feedback loop that made labels
   * shake. Direct application removes both the easing and the self-render.)
   * Offsets are the GUI link offset, so tap hit-testing (which reads each badge's
   * real drawn box) keeps working.
   */
  private declutterLabels(
    shown: { id: string; lbl: LabelControls; x: number; y: number; off: { x: number; y: number } }[],
  ): void {
    const scale = this.iconUserScale * this.iconZoomScale;
    const maxOff = 150 * scale; // never fling a label miles from its device
    const baseY = -LABEL_HEIGHT_PX / 2;
    const GAP = 5 * scale; // breathing room between two labels' boxes

    // Each label's collision box, in screen px, relative to its anchor point.
    // Layout (unscaled, anchor at 0, y grows downward, container hangs ABOVE):
    //   badge  → centre −56, half 20         (BADGE_DIAMETER 40, container 76 tall)
    //   pill   → centre −24, half 9          (VALUE_CHIP_HEIGHT 18, under the badge)
    // With a pill the box spans the badge top down to the pill bottom.
    const boxes = shown.map((s) => {
      const hasPill = s.lbl.valueWrap.isVisible;
      // ≈ text width (px/char at 11px Inter) + the pill's L/R padding (10+10).
      const pillHalfW = hasPill ? (s.lbl.valueText.text.length * 6.2 + 24) / 2 : 0;
      const halfW = Math.max(BADGE_DIAMETER_PX / 2, pillHalfW) * scale;
      const halfH = (hasPill ? 30.5 : 20) * scale;
      const cy = (hasPill ? -45.5 : -56) * scale; // box centre Y relative to anchor
      return { halfW, halfH, cy };
    });

    for (const s of shown) { s.off.x = 0; s.off.y = 0; }
    for (let iter = 0; iter < 12; iter++) {
      let moved = false;
      for (let i = 0; i < shown.length; i++) {
        for (let j = i + 1; j < shown.length; j++) {
          const a = shown[i], b = shown[j], ba = boxes[i], bb = boxes[j];
          const dx = (b.x + b.off.x) - (a.x + a.off.x);
          const dy = (b.y + b.off.y + bb.cy) - (a.y + a.off.y + ba.cy);
          const ox = ba.halfW + bb.halfW + GAP - Math.abs(dx); // x-overlap (>0 = overlapping)
          const oy = ba.halfH + bb.halfH + GAP - Math.abs(dy); // y-overlap
          if (ox <= 0 || oy <= 0) continue; // boxes clear on at least one axis
          // Resolve along the axis of LEAST penetration (minimum translation).
          if (ox < oy) {
            const s2 = dx === 0 ? ((i * 31 + j) % 2 ? 1 : -1) : Math.sign(dx);
            a.off.x -= (ox / 2) * s2; b.off.x += (ox / 2) * s2;
          } else {
            const s2 = dy === 0 ? ((i * 31 + j) % 2 ? 1 : -1) : Math.sign(dy);
            a.off.y -= (oy / 2) * s2; b.off.y += (oy / 2) * s2;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }

    for (const s of shown) {
      const len = Math.hypot(s.off.x, s.off.y);
      if (len > maxOff) { s.off.x *= maxOff / len; s.off.y *= maxOff / len; }
      s.lbl.container.linkOffsetXInPixels = s.off.x;
      s.lbl.container.linkOffsetYInPixels = baseY + s.off.y;
    }
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
  pickBadgeAt(clientX: number, clientY: number): string | null {
    if (!this.config.showEntityLabels || this.labels.size === 0) {
      tapDebug(`pickBadgeAt: no badges (labels=${this.labels.size} showLabels=${this.config.showEntityLabels})`);
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
    // point (~10 CSS px of slop, converted to render px) so a slightly-off
    // finger still lands — every sample uses the same contains() truth, so
    // the slop can never claim screen space the badge doesn't visually own
    // beyond that ring.
    const slop = 10 * scaleX;
    const samples: Array<[number, number]> = [[0, 0]];
    for (const r of [slop * 0.5, slop]) {
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI / 4) * k;
        samples.push([r * Math.cos(a), r * Math.sin(a)]);
      }
    }
    for (const [dx, dy] of samples) {
      const hit = this.badgeContaining(px + dx, py + dy);
      if (hit) {
        tapDebug(`pickBadgeAt(${px.toFixed(0)},${py.toFixed(0)}) hit=${hit} offset=${Math.hypot(dx, dy).toFixed(0)}px`);
        return hit;
      }
    }
    let visible = 0;
    for (const lbl of this.labels.values()) if (lbl.container.isVisible) visible++;
    tapDebug(`pickBadgeAt(${px.toFixed(0)},${py.toFixed(0)}) hit=none (visible=${visible}/${this.labels.size})`);
    return null;
  }

  /** The visible badge (or its value pill) containing this render-space
   *  point, via the GUI's own transform-accurate Control.contains().
   *  Iterated newest-first: the GUI draws later-added controls on top, so
   *  when badges overlap the tap goes to the one the user actually sees. */
  private badgeContaining(x: number, y: number): string | null {
    for (const [entityId, lbl] of [...this.labels].reverse()) {
      if (!lbl.container.isVisible) continue;
      if (lbl.badge.contains(x, y)) return entityId;
      if (lbl.valueWrap.isVisible && lbl.valueWrap.contains(x, y)) return entityId;
    }
    return null;
  }

  /** Distil any entity's live state into one of four colour-coded badge kinds. */
  private badgeKind(type: EntityType, s: HassEntity): BadgeKind {
    if (s.state === "unavailable" || s.state === "unknown") return "unavailable";
    switch (type) {
      case "lock":          return s.state === "locked" ? "on" : "alert";
      case "binary_sensor": return s.state === "on" ? "alert" : "off";
      case "climate":       return s.state === "off" ? "off" : "on";
      case "cover": {
        const pos = s.attributes.current_position as number | undefined;
        if (pos != null) return pos > 0 ? "on" : "off";
        return s.state === "closed" ? "off" : "on";
      }
      case "media_player":  return s.state === "playing" ? "on" : "off";
      case "sensor":        return "info"; // informational: neutral disc, value pill carries meaning
      default:              return s.state === "on" ? "on" : "off"; // light/fan/switch/input_boolean
    }
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
    if (this.bakedMode) return; // no entity lights in baked mode → nothing to occlude
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
    }
    this.lightShadows.set(entityId, gen);
  }

  private applyToMesh(mesh: AbstractMesh, map: EntityMapping, state: HassEntity, lightShare = 1): void {
    const setEmissive = this.emissiveOf(mesh);
    const setDiffuse = this.diffuseOf(mesh);

    switch (map.type) {
      case "light": {
        const on = state.state === "on";
        const colour = this.lightColour(state);
        const brightnessFrac = state.attributes.brightness ? state.attributes.brightness / 255 : 1;

        // 1) The fixture mesh glows.
        setEmissive?.(on ? colour.scale(brightnessFrac) : Color3.Black());

        // An artificially-inflated LED strip bar is only meant to be seen
        // while it IS the light — off, it goes window-glass transparent
        // instead of sitting at the ceiling as a solid 6cm slab; on, it's
        // fully opaque again so the glow renders exactly as always (see
        // STRIP_OFF_ALPHA for why material alpha, not mesh.visibility).
        if (mesh.metadata?.__inflatedStrip) {
          const stripMat = mesh.material;
          if (stripMat) {
            stripMat.alpha = on ? 1 : STRIP_OFF_ALPHA;
            stripMat.transparencyMode = on
              ? Material.MATERIAL_OPAQUE
              : Material.MATERIAL_ALPHABLEND;
          }
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
          light.intensity = on ? (MAX_LIGHT_INTENSITY * brightnessFrac) / lightShare : 0;
          // Drop the light out of (or back into) shaders entirely with its state,
          // so only lights that are actually on add per-pixel cost.
          light.setEnabled(on);
        }
        // Wall occlusion is handled once per entity in apply(), not per mesh.
        break;
      }

      case "lock": {
        const locked = state.state === "locked";
        setDiffuse?.(locked ? new Color3(0.2, 0.75, 0.3) : new Color3(0.9, 0.2, 0.2));
        setEmissive?.(locked ? new Color3(0.0, 0.15, 0.05) : new Color3(0.25, 0, 0));
        break;
      }

      case "binary_sensor": {
        const alert = state.state === "on"; // "on" = triggered (e.g. leak)
        if (alert) this.pulsing.add(mesh);
        else {
          this.pulsing.delete(mesh);
          setEmissive?.(Color3.Black());
        }
        break;
      }

      case "fan": {
        const on = state.state === "on";
        setEmissive?.(on ? new Color3(0.1, 0.35, 0.4) : Color3.Black());
        break;
      }

      case "switch":
      case "media_player": {
        const on = state.state === "on" || state.state === "playing";
        setEmissive?.(on ? new Color3(0.1, 0.35, 0.4) : Color3.Black());
        break;
      }

      // Covers (curtains) are intentionally inert: per product decision the
      // curtain geometry must NEVER move or scale with position/state. We keep
      // the case so cover entities don't fall through to the default and get
      // treated as something else, but apply no visual transform.
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
      case "climate":
        setEmissive?.(Color3.Black());
        break;

      default:
        break;
    }
  }

  private animatePulse(): void {
    if (this.pulsing.size === 0 && !this.beams.hasActive()) return;
    // Advance by real elapsed time, clamped: the on-demand render loop can idle
    // for seconds, and a raw delta after such a gap would make the pulse jump.
    const dtMs = Math.min(this.scene.getEngine().getDeltaTime(), 100);
    this.pulseT += (dtMs / 1000) * PULSE_RAD_PER_SEC;
    const intensity = (Math.sin(this.pulseT) + 1) / 2; // 0..1
    const col = new Color3(intensity, 0, 0);
    for (const mesh of this.pulsing) this.emissiveOf(mesh)?.(col);
    this.beams.applyPulse(intensity);
    this.requestRender();
  }
}
