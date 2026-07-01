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
  Vector3, Matrix, TransformNode,
  type AbstractMesh, type Scene, type Material,
} from "@babylonjs/core";
import {
  AdvancedDynamicTexture, Rectangle, TextBlock, StackPanel, Image,
} from "@babylonjs/gui";
import type { AppConfig } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping, EntityType } from "@/types/scene.types";
import { DEFAULT_ENTITY_ICONS } from "@/config/AppConfig";
import { resolveMeshToMapping } from "@/config/EntityMap";
import { hsToRgb, kelvinToRgb } from "@/utils/colorUtils";

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

interface LabelControls {
  container: StackPanel;
  badge: Rectangle;
  glyph: Image;
  valueWrap: Rectangle;
  valueText: TextBlock;
  anchor: TransformNode;
  type: EntityType;
}

/** A live state distilled to one of four visual kinds the badge colour-codes. */
type BadgeKind = "on" | "off" | "alert" | "unavailable";

// Modern badge palette — a dark "glass" disc with a state-coloured ring. A neutral
// slate base plus a single bright accent per state reads cleanly on both the light
// daytime scene and the dark overview backdrop (no more brown/gold).
const BADGE_BASE_FILL = "rgba(17,24,39,0.74)";
const BADGE_STYLE: Record<BadgeKind, { ring: string; alpha: number; glow: string }> = {
  on:          { ring: "#38bdf8",                 alpha: 1,   glow: "rgba(56,189,248,0.55)" },
  off:         { ring: "rgba(148,163,184,0.55)",  alpha: 0.9, glow: "rgba(0,0,0,0.5)" },
  alert:       { ring: "#fb7185",                 alpha: 1,   glow: "rgba(251,113,133,0.6)" },
  unavailable: { ring: "rgba(148,163,184,0.4)",   alpha: 0.5, glow: "rgba(0,0,0,0.4)" },
};

/** Render an emoji/glyph to a square canvas, centred on the em box (textBaseline
 *  "middle"), and cache the data URL. Drawing a pre-centred bitmap and showing it
 *  through a GUI Image sidesteps Babylon TextBlock's alphabetic-baseline math,
 *  which renders colour emoji high and inconsistently across platforms — a bitmap
 *  is pixel-centred everywhere and needs no per-glyph nudging. */
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
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(px * 0.72)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(glyph, px / 2, px / 2);
    url = canvas.toDataURL();
  }
  glyphCache.set(glyph, url);
  return url;
}

export class EntityVisuals {
  private scene: Scene;
  private config: AppConfig;
  private requestRender: () => void;
  private onEntityPicked: ((entityId: string) => void) | null = null;
  private onEntityLongPicked: ((entityId: string) => void) | null = null;

  /** entity_id -> meshes (one entity can drive several meshes, e.g. curtains). */
  private byEntity = new Map<string, AbstractMesh[]>();
  private mapping = new Map<string, EntityMapping>();
  private pulsing = new Set<AbstractMesh>();
  private pulseT = 0;

  // Real light sources for `light` entities. Keyed by MESH uniqueId (not entity
  // id) so an entity whose fixture is several distinct meshes — e.g. the two
  // bedside lamps that share one HA entity, or multiple curtain-rail downlights —
  // gets a real light at EACH lamp instead of one merged light at their midpoint.
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
  /** Floating control-marker anchors (MarkerManager) — devices with no mesh of
   *  their own. Label-only: the marker's orb/halo glow stays owned there, this
   *  just feeds the same badge pipeline mesh-bound entities use. */
  private markerAnchors = new Map<string, { type: EntityType; anchor: AbstractMesh }>();
  /** Last seen HA state per entity, so a label rebuild (toggle on / icon edit)
   *  can repaint badges immediately instead of waiting for the next push. */
  private lastState = new Map<string, HassEntity>();
  /** User size multiplier (Settings slider) and live bird's-eye zoom factor;
   *  the badge container is scaled by their product. */
  private iconUserScale = 1;
  private iconZoomScale = 1;

  constructor(
    scene: Scene,
    config: AppConfig,
    requestRender: () => void,
    onEntityPicked?: (entityId: string) => void,
    onEntityLongPicked?: (entityId: string) => void,
  ) {
    this.scene = scene;
    this.config = config;
    this.requestRender = requestRender;
    this.onEntityPicked = onEntityPicked ?? null;
    // A long-press opens the full detail panel; fall back to the tap handler.
    this.onEntityLongPicked = onEntityLongPicked ?? onEntityPicked ?? null;
    scene.registerBeforeRender(() => {
      this.animatePulse();
      this.cullLabels();
    });
  }

  updateConfig(config: AppConfig): void {
    const prevLabels = this.config.showEntityLabels;
    const prevIcons = this.config.entityIcons;
    this.config = config;
    // Entity-light wall occlusion is always-on (independent of the global Shadows
    // quality toggle, which drives the expensive sun shadows): walls block lamp
    // light out of the box, so there is nothing to tear down here when the toggle
    // changes.
    const iconsChanged = config.entityIcons !== prevIcons;
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
      const map = resolveMeshToMapping(m.name, this.config.entityMap, this.config.meshBindings);
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
        // Use bounding-box centre: when the model came from an OBJ (Blender
        // pipeline), the node position is (0,0,0) for every entity mesh and the
        // actual 3D location is encoded only in vertex data.
        m.computeWorldMatrix(true);
        const pos = m.getBoundingInfo().boundingBox.centerWorld.clone();
        const light = new PointLight(`elight_${m.name}_${m.uniqueId}`, pos, this.scene);
        light.intensity = 0;
        light.range = LIGHT_RANGE;
        light.diffuse = WARM_GLOW.clone();
        // Start DISABLED, not just intensity 0. A disabled light is dropped from
        // every material's shader light-loop entirely, so an off fixture costs
        // nothing to compile or shade; it's re-enabled in applyToMesh when the
        // entity turns on. With most lights off at load, this slashes the active
        // light count the first frame has to compile shaders for.
        light.setEnabled(false);
        this.meshLights.set(m.uniqueId, light);
      }
    }

    scene.blockMaterialDirtyMechanism = false;

    this.buildLabelAnchors();
    if (this.config.showEntityLabels) this.rebuildLabels();
  }

  /** Tear down all entity light sources and their shadow generators. */
  private disposeLights(): void {
    this.lightShadows.forEach((g) => g.dispose());
    this.lightShadows.clear();
    this.meshLights.forEach((l) => l.dispose());
    this.meshLights.clear();
  }

  /** One invisible anchor per mesh-bound entity, positioned at the top-centre
   *  of that entity's WHOLE bounding box (all its meshes merged — e.g. a
   *  curtain rail + fabric, or several bedside lamps under one entity — not
   *  just whichever mesh happened to be first), plus a small clearance
   *  margin. This is real geometry, computed once from the loaded model, so
   *  the label naturally sits close to each asset regardless of how tall it
   *  is or how high up it's mounted — no per-object hand-tuning. */
  private buildLabelAnchors(): void {
    for (const [entityId, meshes] of this.byEntity) {
      if (!meshes.length) continue;
      let min: Vector3 | null = null;
      let max: Vector3 | null = null;
      for (const m of meshes) {
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        min = min ? Vector3.Minimize(min, bb.minimumWorld) : bb.minimumWorld.clone();
        max = max ? Vector3.Maximize(max, bb.maximumWorld) : bb.maximumWorld.clone();
      }
      if (!min || !max) continue;
      const node = new TransformNode(`lblAnchor_${entityId}`, this.scene);
      node.position.set((min.x + max.x) / 2, max.y + LABEL_ANCHOR_MARGIN, (min.z + max.z) / 2);
      this.labelAnchors.set(entityId, node);
    }
  }

  private disposeLabelAnchors(): void {
    this.labelAnchors.forEach((n) => n.dispose());
    this.labelAnchors.clear();
  }

  hasEntity(entityId: string): boolean {
    return this.byEntity.has(entityId);
  }

  /** All entity mappings resolved during the last indexMeshes call. */
  getDetectedMappings(): EntityMapping[] {
    return Array.from(this.mapping.values());
  }

  /** Called for every state change. No-op if the entity has no mesh. */
  apply(entity: HassEntity): void {
    const meshes = this.byEntity.get(entity.entity_id);
    const map = this.mapping.get(entity.entity_id);
    if (!meshes || !map) return;
    this.lastState.set(entity.entity_id, entity);
    for (const mesh of meshes) this.applyToMesh(mesh, map, entity);
    if (map.type === "light") {
      this.syncEntityShadow(entity.entity_id, meshes, entity.state === "on");
    }
    this.updateLabel(entity.entity_id, map.type, entity);
    this.requestRender();
  }

  /** Replace the set of floating marker anchors (called whenever MarkerManager
   *  re-syncs). A mesh binding for the same entity_id always wins — a marker
   *  is only a fallback for devices without real geometry. */
  syncMarkerAnchors(defs: { entityId: string; type: EntityType; anchor: AbstractMesh }[]): void {
    this.markerAnchors.clear();
    for (const d of defs) {
      if (this.byEntity.has(d.entityId)) continue;
      this.markerAnchors.set(d.entityId, { type: d.type, anchor: d.anchor });
    }
    if (this.config.showEntityLabels) this.rebuildLabels();
  }

  /** State push for a marker-bound entity. Mesh-bound entities go through
   *  apply(); this is the marker-only equivalent — label only, since the
   *  marker's own orb/halo visuals are updated separately by MarkerManager. */
  applyMarker(entity: HassEntity): void {
    const m = this.markerAnchors.get(entity.entity_id);
    if (!m) return;
    this.lastState.set(entity.entity_id, entity);
    this.updateLabel(entity.entity_id, m.type, entity);
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // State labels (BJS GUI fullscreen overlay)
  // ---------------------------------------------------------------------------

  /** Resolve the per-category glyph (Settings override > built-in default). */
  private iconFor(type: EntityType): string {
    return this.config.entityIcons?.[type] ?? DEFAULT_ENTITY_ICONS[type] ?? "●";
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

    // Two anchor sources feed the same badge pipeline: real mesh-bound entities
    // (from the GLB, anchored at their own bounding-box top — see
    // buildLabelAnchors) and floating control markers (devices with no mesh of
    // their own — see MarkerManager, anchored at the marker orb itself). A mesh
    // binding always takes priority for a given entity_id (enforced in
    // syncMarkerAnchors).
    const sources: { entityId: string; anchor: TransformNode; type: EntityType }[] = [];
    for (const [entityId, meshes] of this.byEntity) {
      if (!meshes.length) continue;
      const map = this.mapping.get(entityId);
      if (!map) continue;
      const anchor = this.labelAnchors.get(entityId) ?? meshes[0];
      sources.push({ entityId, anchor, type: map.type });
    }
    for (const [entityId, m] of this.markerAnchors) {
      sources.push({ entityId, anchor: m.anchor, type: m.type });
    }

    for (const { entityId, anchor, type } of sources) {
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
      // see buildLabelAnchors / the marker orb position — so the only pixel
      // offset needed is to lift the WHOLE container clear of that point
      // (rather than centering it on the point), not the large hand-tuned
      // constant this used to be.
      container.linkOffsetYInPixels = -LABEL_HEIGHT_PX / 2;

      const badge = new Rectangle(`lbl_badge_${entityId}`);
      badge.width = "40px";
      badge.height = "40px";
      badge.cornerRadius = 20; // = half of width/height -> a circle
      badge.thickness = 2.5;
      badge.background = BADGE_BASE_FILL;
      badge.color = BADGE_STYLE.off.ring;
      badge.shadowColor = "rgba(0,0,0,0.55)";
      badge.shadowBlur = 6;
      badge.shadowOffsetY = 2;
      // Tap = quick action (toggle / open); long-press = full detail panel.
      if (this.onEntityPicked || this.onEntityLongPicked) {
        badge.isPointerBlocker = true;
        badge.hoverCursor = "pointer";
        this.wireBadgeGestures(badge, entityId);
      }
      container.addControl(badge);

      const glyph = new Image(`lbl_glyph_${entityId}`, glyphDataUrl(this.iconFor(type)));
      glyph.width = "26px";
      glyph.height = "26px";
      glyph.stretch = Image.STRETCH_UNIFORM;
      badge.addControl(glyph);

      // Value pill: a snug rounded chip that hugs its text (adaptWidthToChildren).
      const valueWrap = new Rectangle(`lbl_valwrap_${entityId}`);
      valueWrap.adaptWidthToChildren = true;
      valueWrap.height = "19px";
      valueWrap.cornerRadius = 9;
      valueWrap.thickness = 0;
      valueWrap.background = "rgba(15,23,42,0.85)";
      valueWrap.paddingLeft = "7px";
      valueWrap.paddingRight = "7px";
      valueWrap.shadowColor = "rgba(0,0,0,0.5)";
      valueWrap.shadowBlur = 4;
      valueWrap.isVisible = false;

      const valueText = new TextBlock(`lbl_value_${entityId}`);
      valueText.text = "";
      valueText.color = "#f8fafc";
      valueText.fontSize = 12;
      valueText.fontStyle = "bold";
      valueText.resizeToFit = true;
      valueText.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
      valueWrap.addControl(valueText);
      container.addControl(valueWrap);

      this.labels.set(entityId, { container, badge, glyph, valueWrap, valueText, anchor, type });

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
    lbl.badge.color = style.ring;
    lbl.badge.alpha = style.alpha;
    lbl.badge.shadowColor = style.glow;
    lbl.badge.shadowBlur = kind === "on" || kind === "alert" ? 10 : 6;
    lbl.glyph.source = glyphDataUrl(this.iconFor(type)); // honour live icon edits
    lbl.glyph.alpha = kind === "unavailable" ? 0.6 : 1;

    const value = this.compactValue(type, entity);
    lbl.valueText.text = value;
    lbl.valueWrap.isVisible = value.length > 0;
  }

  /** Tap vs long-press on a badge. Tap → quick action (toggle/open); a press held
   *  past the threshold → the full detail panel, matching the 3D-mesh gesture. */
  private wireBadgeGestures(badge: Rectangle, entityId: string): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let longFired = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    badge.onPointerDownObservable.add(() => {
      longFired = false;
      badge.scaleX = badge.scaleY = 1.12;
      this.requestRender();
      clear();
      timer = setTimeout(() => {
        longFired = true;
        this.onEntityLongPicked?.(entityId);
      }, 480);
    });
    badge.onPointerUpObservable.add(() => {
      clear();
      badge.scaleX = badge.scaleY = 1;
      this.requestRender();
      if (!longFired) this.onEntityPicked?.(entityId);
    });
    badge.onPointerOutObservable.add(() => {
      clear();
      badge.scaleX = badge.scaleY = 1;
      this.requestRender();
    });
  }

  /** Deliberately NOT a "declutter": every registered device's tag stays
   *  visible all the time — that's the point of the "Show device state
   *  labels" toggle. An earlier version greedily hid same-screen-cluster
   *  badges to avoid overlap, but in a villa where several devices sit
   *  within a couple of screen-pixels of each other at any reasonable
   *  zoom, that reliably hid most non-priority tags no matter how the
   *  camera moved — worse than the overlap it was trying to prevent. The
   *  only thing this still culls is an anchor that projects BEHIND the
   *  camera (z outside [0,1]): that's not clutter avoidance, it's a
   *  genuinely invalid screen position that would otherwise place a badge
   *  at a nonsensical spot on screen. */
  private cullLabels(): void {
    if (!this.config.showEntityLabels || this.labels.size === 0) return;
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const eng = this.scene.getEngine();
    const w = eng.getRenderWidth();
    const h = eng.getRenderHeight();
    const vp = cam.viewport.toGlobal(w, h);
    const tm = this.scene.getTransformMatrix();

    for (const lbl of this.labels.values()) {
      const p = Vector3.Project(lbl.anchor.getAbsolutePosition(), Matrix.IdentityReadOnly, tm, vp);
      lbl.container.isVisible = p.z >= 0 && p.z <= 1;
    }
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
      case "sensor":        return "on"; // sensors are informational; value carries meaning
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
        return s.state === "on" && p != null ? `${p}%` : "";
      }
      case "cover": {
        const pos = s.attributes.current_position as number | undefined;
        return pos != null ? `${Math.round(pos)}%` : "";
      }
      case "climate": {
        const cur = s.attributes.current_temperature as number | undefined;
        return cur != null ? `${Math.round(cur)}°` : "";
      }
      case "sensor": {
        const unit = (s.attributes.unit_of_measurement as string | undefined) ?? "";
        return `${s.state}${unit}`;
      }
      default:
        return "";
    }
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

  private applyToMesh(mesh: AbstractMesh, map: EntityMapping, state: HassEntity): void {
    const setEmissive = this.emissiveOf(mesh);
    const setDiffuse = this.diffuseOf(mesh);

    switch (map.type) {
      case "light": {
        const on = state.state === "on";
        const colour = this.lightColour(state);
        const brightnessFrac = state.attributes.brightness ? state.attributes.brightness / 255 : 1;

        // 1) The fixture mesh glows.
        setEmissive?.(on ? colour.scale(brightnessFrac) : Color3.Black());

        // 2) This fixture mesh's own light source illuminates the room.
        //    A single HA light is frequently modelled in SweetHome 3D as MANY
        //    co-located virtual markers (e.g. a LED strip drawn as 8–12 point
        //    lights for a soft, diffuse spread). Each marker becomes its own
        //    PointLight, and point lights are ADDITIVE — 12 markers at full
        //    intensity would blow out to solid white. Normalise by the number of
        //    fixture meshes sharing this entity so the whole group reads as one
        //    fixture's worth of light, regardless of how many markers model it.
        const light = this.meshLights.get(mesh.uniqueId);
        if (light) {
          const fixtureCount = this.byEntity.get(map.entityId)?.length ?? 1;
          light.diffuse = colour;
          light.intensity = on ? (MAX_LIGHT_INTENSITY * brightnessFrac) / fixtureCount : 0;
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

      default:
        break;
    }
  }

  private animatePulse(): void {
    if (this.pulsing.size === 0) return;
    this.pulseT += 0.06;
    const intensity = (Math.sin(this.pulseT) + 1) / 2; // 0..1
    const col = new Color3(intensity, 0, 0);
    for (const mesh of this.pulsing) this.emissiveOf(mesh)?.(col);
    this.requestRender();
  }
}
