// src/babylon/MarkerManager.ts
// Floating, app-created control markers (3Dash-style). Used when a device is NOT
// a separate mesh in the model, or its HA entity doesn't exist yet.
//
// Each marker is a small always-visible glowing orb dropped at a tapped 3D point
// and tagged with its entity_id (via mesh.metadata.entityId, so PickHandler can
// resolve a tap to the entity). Markers own their own state visuals and stay
// visible even when their device is off, so they remain easy to find and tap.

import {
  MeshBuilder, StandardMaterial, Color3, Vector3, PointLight, TransformNode,
  type AbstractMesh, type Mesh, type Scene,
} from "@babylonjs/core";
import type { HassEntity } from "@/types/ha.types";
import type { EntityType, SceneMarker } from "@/types/scene.types";

interface LiveMarker {
  def: SceneMarker;
  orb: Mesh;
  halo: Mesh;
  material: StandardMaterial;
  haloMaterial: StandardMaterial;
  light?: PointLight;
}

/** Base accent colour per type so a marker is identifiable at a glance. */
const TYPE_COLOR: Record<string, Color3> = {
  light: new Color3(1.0, 0.85, 0.5),
  climate: new Color3(0.36, 0.66, 0.63),
  cover: new Color3(0.8, 0.7, 0.4),
  fan: new Color3(0.4, 0.7, 0.8),
  lock: new Color3(0.5, 0.8, 0.55),
  switch: new Color3(0.79, 0.66, 0.3),
  media_player: new Color3(0.7, 0.5, 0.8),
  camera: new Color3(0.6, 0.6, 0.7),
  sensor: new Color3(0.36, 0.66, 0.63),
  binary_sensor: new Color3(0.75, 0.32, 0.3),
  assist_satellite: new Color3(0.7, 0.6, 0.4),
};

const BASE_EMISSIVE = 0.35; // always-visible floor so markers can be found/tapped

export class MarkerManager {
  private scene: Scene;
  private requestRender: () => void;
  private markers = new Map<string, LiveMarker>();
  private root: TransformNode;
  private pulseT = 0;
  private pulsing = new Set<string>();

  constructor(scene: Scene, requestRender: () => void) {
    this.scene = scene;
    this.requestRender = requestRender;
    this.root = new TransformNode("markers_root", scene);
    scene.registerBeforeRender(() => this.animate());
  }

  /** Replace all markers from config (cheap — there are only a handful). */
  sync(defs: SceneMarker[]): void {
    this.clear();
    for (const def of defs) this.create(def);
  }

  /** Anchor meshes for the state-label overlay (EntityVisuals), so a marker —
   *  a device with no mesh of its own — gets the same badge as a mesh-bound
   *  entity. Markers own their own orb/halo glow visuals; this only feeds the
   *  label pipeline. */
  getAnchors(): { entityId: string; type: EntityType; anchor: AbstractMesh }[] {
    return [...this.markers.values()].map((m) => ({
      entityId: m.def.entityId, type: m.def.type, anchor: m.orb,
    }));
  }

  private colorFor(type: EntityType): Color3 {
    return (TYPE_COLOR[type] ?? new Color3(0.8, 0.8, 0.8)).clone();
  }

  create(def: SceneMarker): void {
    const color = this.colorFor(def.type);

    const orb = MeshBuilder.CreateSphere(def.entityId, { diameter: 0.22, segments: 12 }, this.scene);
    orb.position = new Vector3(def.position.x, def.position.y, def.position.z);
    orb.parent = this.root;
    orb.isPickable = true;
    // Tag so PickHandler resolves a tap straight to the entity.
    orb.metadata = { entityId: def.entityId, markerId: def.id, isMarker: true };

    const material = new StandardMaterial(`mk_${def.id}`, this.scene);
    material.disableLighting = true;
    material.emissiveColor = color.scale(BASE_EMISSIVE);
    orb.material = material;

    // Soft halo ring so it reads as an interactive control, not scene geometry.
    const halo = MeshBuilder.CreateTorus(`halo_${def.id}`, { diameter: 0.42, thickness: 0.03, tessellation: 24 }, this.scene);
    halo.position = orb.position.clone();
    halo.parent = this.root;
    halo.isPickable = true;
    halo.metadata = orb.metadata;
    halo.billboardMode = 7; // face the camera
    const haloMaterial = new StandardMaterial(`hk_${def.id}`, this.scene);
    haloMaterial.disableLighting = true;
    haloMaterial.emissiveColor = color.scale(BASE_EMISSIVE);
    halo.material = haloMaterial;

    this.markers.set(def.id, { def, orb, halo, material, haloMaterial });
  }

  /** Update marker visuals from a state change (entity may match several markers). */
  apply(entity: HassEntity): void {
    let touched = false;
    for (const m of this.markers.values()) {
      if (m.def.entityId !== entity.entity_id) continue;
      this.applyOne(m, entity);
      touched = true;
    }
    if (touched) this.requestRender();
  }

  private applyOne(m: LiveMarker, state: HassEntity): void {
    const color = this.colorFor(m.def.type);
    this.pulsing.delete(m.def.id);
    m.light?.dispose();
    m.light = undefined;

    const setEmissive = (intensity: number, c = color) => {
      m.material.emissiveColor = c.scale(intensity);
      m.haloMaterial.emissiveColor = c.scale(Math.max(BASE_EMISSIVE, intensity * 0.8));
    };

    switch (m.def.type) {
      case "light": {
        const on = state.state === "on";
        const frac = state.attributes.brightness ? state.attributes.brightness / 255 : 1;
        setEmissive(on ? 1.0 * frac + 0.2 : BASE_EMISSIVE);
        if (on) {
          const light = new PointLight(`mklight_${m.def.id}`, m.orb.position.clone(), this.scene);
          light.diffuse = color;
          light.range = 8;
          light.intensity = 0.8 * frac;
          m.light = light;
        }
        break;
      }
      case "cover": {
        const pos = (state.attributes.current_position as number | undefined) ??
          (state.state === "open" ? 100 : state.state === "closed" ? 0 : 50);
        // Tint from closed (dim) -> open (bright).
        setEmissive(0.3 + (pos / 100) * 0.7);
        break;
      }
      case "lock": {
        const locked = state.state === "locked";
        setEmissive(0.9, locked ? new Color3(0.3, 0.8, 0.4) : new Color3(0.9, 0.25, 0.25));
        break;
      }
      case "binary_sensor": {
        if (state.state === "on") this.pulsing.add(m.def.id);
        else setEmissive(BASE_EMISSIVE);
        break;
      }
      case "fan":
      case "switch":
      case "media_player": {
        const on = state.state === "on" || state.state === "playing";
        setEmissive(on ? 1.0 : BASE_EMISSIVE);
        break;
      }
      default:
        setEmissive(0.7);
        break;
    }
  }

  private animate(): void {
    if (this.pulsing.size === 0) return;
    this.pulseT += 0.06;
    const intensity = 0.3 + ((Math.sin(this.pulseT) + 1) / 2) * 0.7;
    for (const id of this.pulsing) {
      const m = this.markers.get(id);
      if (!m) continue;
      const c = new Color3(intensity, 0, 0);
      m.material.emissiveColor = c;
      m.haloMaterial.emissiveColor = c;
    }
    this.requestRender();
  }

  removeById(id: string): void {
    const m = this.markers.get(id);
    if (!m) return;
    m.light?.dispose();
    m.material.dispose();
    m.haloMaterial.dispose();
    m.orb.dispose();
    m.halo.dispose();
    this.markers.delete(id);
    this.pulsing.delete(id);
    this.requestRender();
  }

  clear(): void {
    for (const id of [...this.markers.keys()]) this.removeById(id);
  }
}
