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
//   fan           -> blades spin while on.
//   lock          -> green (locked) / red (unlocked).
//   switch/media  -> emissive "active" tint when on/playing.
//   binary_sensor -> pulsing red when triggered (e.g. leak).

import {
  Color3, StandardMaterial, PBRMaterial, PointLight,
  type AbstractMesh, type Scene, type Material,
} from "@babylonjs/core";
import type { AppConfig } from "@/config/AppConfig";
import type { HassEntity } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";
import { resolveMeshToMapping } from "@/config/EntityMap";
import { hsToRgb, kelvinToRgb } from "@/utils/colorUtils";

const WARM_GLOW = new Color3(1.0, 0.89, 0.63);
const MAX_LIGHT_INTENSITY = 0.85;

export class EntityVisuals {
  private scene: Scene;
  private config: AppConfig;
  private requestRender: () => void;

  /** entity_id -> meshes (one entity can drive several meshes, e.g. curtains). */
  private byEntity = new Map<string, AbstractMesh[]>();
  private mapping = new Map<string, EntityMapping>();
  private pulsing = new Set<AbstractMesh>();
  private pulseT = 0;

  /** Real light sources we create for `light` entities (entity_id -> light). */
  private lights = new Map<string, PointLight>();
  /** Meshes currently spinning because their fan is on. */
  private spinning = new Set<AbstractMesh>();

  constructor(scene: Scene, config: AppConfig, requestRender: () => void) {
    this.scene = scene;
    this.config = config;
    this.requestRender = requestRender;
    scene.registerBeforeRender(() => {
      this.animatePulse();
      this.animateSpin();
    });
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  /** Build the reverse index entity_id -> meshes from the loaded GLB. */
  indexMeshes(meshes: AbstractMesh[]): void {
    // Dispose previously created light sources before re-indexing.
    this.lights.forEach((l) => l.dispose());
    this.lights.clear();
    this.pulsing.clear();
    this.spinning.clear();
    this.byEntity.clear();
    this.mapping.clear();

    for (const m of meshes) {
      const map = resolveMeshToMapping(m.name, this.config.entityMap, this.config.meshBindings);
      if (!map) continue;
      const list = this.byEntity.get(map.entityId) ?? [];
      list.push(m);
      this.byEntity.set(map.entityId, list);
      this.mapping.set(map.entityId, map);

      // For lights, create a real (initially off) PointLight at the fixture.
      if (map.type === "light" && !this.lights.has(map.entityId)) {
        const pos = m.getAbsolutePosition().clone();
        const light = new PointLight(`elight_${map.entityId}`, pos, this.scene);
        light.intensity = 0;
        light.range = 8;
        light.diffuse = WARM_GLOW.clone();
        this.lights.set(map.entityId, light);
      }
    }
  }

  hasEntity(entityId: string): boolean {
    return this.byEntity.has(entityId);
  }

  /** Called for every state change. No-op if the entity has no mesh. */
  apply(entity: HassEntity): void {
    const meshes = this.byEntity.get(entity.entity_id);
    const map = this.mapping.get(entity.entity_id);
    if (!meshes || !map) return;
    for (const mesh of meshes) this.applyToMesh(mesh, map, entity);
    this.requestRender();
  }

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

        // 2) The real light source illuminates the room.
        const light = this.lights.get(map.entityId);
        if (light) {
          light.diffuse = colour;
          light.intensity = on ? MAX_LIGHT_INTENSITY * brightnessFrac : 0;
        }
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
        if (on) this.spinning.add(mesh);
        else this.spinning.delete(mesh);
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
        default: openFrac = 0.5; break; // opening / closing / partial
      }
    }
    if (mesh.metadata?.baseScaleY === undefined) {
      mesh.metadata = { ...(mesh.metadata ?? {}), baseScaleY: mesh.scaling.y };
    }
    const base = mesh.metadata.baseScaleY as number;
    // Closed = full height; open = retracted to 10%.
    mesh.scaling.y = base * (1 - openFrac * 0.9);
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

  private animateSpin(): void {
    if (this.spinning.size === 0) return;
    for (const mesh of this.spinning) mesh.rotation.y += 0.25;
    this.requestRender();
  }
}
