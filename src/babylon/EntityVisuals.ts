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
  type AbstractMesh, type Scene, type Material,
} from "@babylonjs/core";
import {
  AdvancedDynamicTexture, Rectangle, TextBlock, StackPanel,
} from "@babylonjs/gui";
import type { AppConfig } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import { resolveMeshToMapping } from "@/config/EntityMap";
import { hsToRgb, kelvinToRgb } from "@/utils/colorUtils";

const WARM_GLOW = new Color3(1.0, 0.89, 0.63);
const MAX_LIGHT_INTENSITY = 0.85;
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

interface LabelControls {
  rect: Rectangle;
  nameText: TextBlock;
  stateText: TextBlock;
}

export class EntityVisuals {
  private scene: Scene;
  private config: AppConfig;
  private requestRender: () => void;
  private onEntityPicked: ((entityId: string) => void) | null = null;

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

  constructor(
    scene: Scene,
    config: AppConfig,
    requestRender: () => void,
    onEntityPicked?: (entityId: string) => void,
  ) {
    this.scene = scene;
    this.config = config;
    this.requestRender = requestRender;
    this.onEntityPicked = onEntityPicked ?? null;
    scene.registerBeforeRender(() => {
      this.animatePulse();
    });
  }

  updateConfig(config: AppConfig): void {
    const prevLabels = this.config.showEntityLabels;
    this.config = config;
    // Entity-light wall occlusion is always-on (independent of the global Shadows
    // quality toggle, which drives the expensive sun shadows): walls block lamp
    // light out of the box, so there is nothing to tear down here when the toggle
    // changes.
    if (config.showEntityLabels !== prevLabels) {
      if (config.showEntityLabels) {
        this.rebuildLabels();
      } else if (this.labelLayer) {
        this.labelLayer.rootContainer.isVisible = false;
      }
    }
  }

  /** Build the reverse index entity_id -> meshes from the loaded GLB. */
  indexMeshes(meshes: AbstractMesh[]): void {
    // Dispose previously created light sources + shadow maps before re-indexing.
    this.disposeLights();
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

      // For lights, create a real (initially off) PointLight at EACH fixture mesh
      // — one per lamp, so two bedside lamps under one entity both illuminate.
      if (map.type === "light") {
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

    if (this.config.showEntityLabels) this.rebuildLabels();
  }

  /** Tear down all entity light sources and their shadow generators. */
  private disposeLights(): void {
    this.lightShadows.forEach((g) => g.dispose());
    this.lightShadows.clear();
    this.meshLights.forEach((l) => l.dispose());
    this.meshLights.clear();
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
    for (const mesh of meshes) this.applyToMesh(mesh, map, entity);
    if (map.type === "light") {
      this.syncEntityShadow(entity.entity_id, meshes, entity.state === "on");
    }
    this.updateLabel(entity.entity_id, map, entity);
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // State labels (BJS GUI fullscreen overlay)
  // ---------------------------------------------------------------------------

  private rebuildLabels(): void {
    // Ensure the GUI layer exists.
    if (!this.labelLayer) {
      this.labelLayer = AdvancedDynamicTexture.CreateFullscreenUI("entityLabels", true, this.scene);
    } else {
      this.labelLayer.rootContainer.clearControls();
    }
    this.labels.clear();
    this.labelLayer.rootContainer.isVisible = true;

    for (const [entityId, meshes] of this.byEntity) {
      if (!meshes.length) continue;
      const map = this.mapping.get(entityId);
      if (!map) continue;

      const anchor = meshes[0];

      const rect = new Rectangle(`lbl_rect_${entityId}`);
      rect.width = "170px";
      rect.height = "40px";
      rect.cornerRadius = 8;
      rect.background = "rgba(18,12,6,0.88)";
      rect.thickness = 1;
      rect.color = "rgba(201,168,76,0.45)";
      // Make the label tappable: clicking/touching it opens the control panel.
      if (this.onEntityPicked) {
        const cb = this.onEntityPicked;
        const eid = entityId;
        rect.isPointerBlocker = true;
        rect.hoverCursor = "pointer";
        rect.onPointerClickObservable.add(() => cb(eid));
        rect.onPointerEnterObservable.add(() => {
          rect.color = "rgba(201,168,76,0.85)";
          this.requestRender();
        });
        rect.onPointerOutObservable.add(() => {
          rect.color = "rgba(201,168,76,0.45)";
          this.requestRender();
        });
      }
      this.labelLayer.addControl(rect);
      rect.linkWithMesh(anchor);
      rect.linkOffsetYInPixels = -64;

      const stack = new StackPanel(`lbl_stack_${entityId}`);
      stack.isVertical = true;
      rect.addControl(stack);

      const nameText = new TextBlock(`lbl_name_${entityId}`);
      nameText.text = map.label;
      nameText.color = "#a89880";
      nameText.fontSize = 10;
      nameText.height = "18px";
      nameText.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
      stack.addControl(nameText);

      const stateText = new TextBlock(`lbl_state_${entityId}`);
      stateText.text = "—";
      stateText.color = "#f5edd8";
      stateText.fontSize = 13;
      stateText.fontStyle = "bold";
      stateText.height = "20px";
      stateText.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_CENTER;
      stack.addControl(stateText);

      this.labels.set(entityId, { rect, nameText, stateText });
    }
  }

  private updateLabel(entityId: string, map: EntityMapping, entity: HassEntity): void {
    const lbl = this.labels.get(entityId);
    if (!lbl) return;
    lbl.stateText.text = this.stateString(map, entity);
    // Colour-code the state text
    const colour = this.stateLabelColour(map, entity);
    if (colour) lbl.stateText.color = colour;
  }

  private stateString(map: EntityMapping, state: HassEntity): string {
    switch (map.type) {
      case "light":
        if (state.state !== "on") return "OFF";
        return state.attributes.brightness
          ? `ON · ${Math.round((state.attributes.brightness as number) / 255 * 100)}%`
          : "ON";
      case "lock":
        return state.state === "locked" ? "LOCKED" : "UNLOCKED";
      case "climate": {
        const cur = state.attributes.current_temperature as number | undefined;
        const tgt = state.attributes.temperature as number | undefined;
        if (cur != null) return `${cur}° → ${tgt ?? "—"}°`;
        return state.state;
      }
      case "cover": {
        const pos = state.attributes.current_position as number | undefined;
        if (pos != null) return `${Math.round(pos)}% open`;
        return state.state.toUpperCase();
      }
      case "fan":
        return state.state === "on" ? `ON${state.attributes.percentage ? ` · ${state.attributes.percentage}%` : ""}` : "OFF";
      case "switch":
        return state.state === "on" ? "ON" : "OFF";
      case "media_player":
        return state.state === "playing"
          ? (state.attributes.media_title as string | undefined) ?? "PLAYING"
          : state.state.toUpperCase();
      case "binary_sensor":
        return state.state === "on" ? "ALERT" : "OK";
      case "sensor": {
        const unit = (state.attributes.unit_of_measurement as string | undefined) ?? "";
        return `${state.state}${unit}`;
      }
      default:
        return state.state.toUpperCase();
    }
  }

  private stateLabelColour(map: EntityMapping, state: HassEntity): string | null {
    switch (map.type) {
      case "light":    return state.state === "on" ? "#c9a84c" : "#6b5a48";
      case "lock":     return state.state === "locked" ? "#6baa75" : "#c0504d";
      case "binary_sensor": return state.state === "on" ? "#c0504d" : "#6baa75";
      case "switch":   return state.state === "on" ? "#c9a84c" : "#6b5a48";
      default:         return null;
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

      case "cover": {
        this.applyCover(mesh, state);
        break;
      }

      default:
        break;
    }
  }

  /**
   * Curtain visual with three clear states:
   *   - position attribute present -> continuous (0 closed … 100 open),
   *   - otherwise the open/closed/opening/closing state maps to
   *     CLOSED (full) / HALF / OPEN (retracted).
   * The mesh scales down on its Y axis and fades as it opens.
   */
  private applyCover(mesh: AbstractMesh, state: HassEntity): void {
    const posAttr = state.attributes.current_position as number | undefined;
    let openFrac: number;
    if (typeof posAttr === "number") {
      openFrac = Math.max(0, Math.min(1, posAttr / 100));
    } else {
      switch (state.state) {
        case "open": openFrac = 1; break;
        case "closed": openFrac = 0; break;
        default: openFrac = 0.5; break;
      }
    }
    // Snapshot base values on first call.
    if (mesh.metadata?.baseScaleY === undefined) {
      mesh.computeWorldMatrix(true);
      mesh.metadata = {
        ...(mesh.metadata ?? {}),
        baseScaleY: mesh.scaling.y,
        // bb.maximum.y is the raw pre-scaling geometry max in local units.
        // Stored so we can offset the mesh to keep the top edge fixed as
        // scaling.y shrinks (otherwise the curtain collapses toward Y=0).
        geoTopY: mesh.getBoundingInfo().boundingBox.maximum.y,
      };
    }
    const base     = mesh.metadata.baseScaleY as number;
    const geoTopY  = mesh.metadata.geoTopY    as number;
    const newScale = base * (1 - openFrac * 0.9);

    // Keep the top edge at its original world position while retracting.
    // Without this offset the curtain collapses toward the floor (Y=0 pivot).
    mesh.scaling.y  = newScale;
    mesh.position.y = geoTopY * (base - newScale);
    mesh.visibility = 1 - openFrac * 0.85;
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
