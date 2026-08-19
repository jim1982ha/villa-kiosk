// src/babylon/PickHandler.ts
// Turn a tap on the canvas into an entity selection. Tap *detection* lives in
// CameraController (the single owner of the canvas pointer pipeline + capture);
// it calls pickAtScreen() here, which raycasts and resolves the picked mesh (or
// its parents) to an entity. This avoids a second scene.onPointerObservable tap
// listener that touch POINTERUP events race against (Babylon and the camera
// both grab/release pointer capture). We keep a lightweight POINTERMOVE
// listener only to drive the mouse hover cursor.

import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import type { PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { resolveMeshToMapping } from "@/config/EntityMap";
import { effectiveCategory } from "@/config/EntityCategories";
import { tapDebug } from "@/utils/tapDebug";
import type { Category, EntityMapping, EntityType } from "@/types/scene.types";

export class PickHandler {
  private scene: Scene;
  private onPicked: (entityId: string, clientX: number, clientY: number) => void;
  private onLongPicked: (entityId: string, clientX: number, clientY: number) => void;
  private entityMap: Record<string, EntityMapping>;
  private bindings: Record<string, string> = {};
  /** RBAC type denials (AppConfig.deniedTypes) — a mesh resolving to one of
   *  these is NOT interactive, even when its name is a valid entity_id. */
  private deniedTypes: readonly EntityType[] = [];
  /** HUD category filter (AppConfig.hiddenCategories) — a mesh whose entity
   *  falls in a category the user switched off is NOT interactive either.
   *  Mirrors SceneManager.applyHighlight's own gate (hidden categories don't
   *  glow as clickable) — without this, the asset stayed tappable and still
   *  fired the HA action/panel even though nothing on screen suggested it
   *  could be tapped. */
  private hiddenCategories: readonly Category[] = [];

  /** Optional: is a state badge under these client coords? Wired from
   *  SceneManager to EntityVisuals.pickBadgeAt so the hover cursor also
   *  reacts to badges, not just 3D meshes (badges have no pointer handling
   *  of their own — see EntityVisuals.pickBadgeAt's docstring). */
  private badgeHitTest: ((clientX: number, clientY: number) => boolean) | null = null;

  constructor(
    scene: Scene,
    onPicked: (entityId: string, clientX: number, clientY: number) => void,
    entityMap: Record<string, EntityMapping> = {},
    bindings: Record<string, string> = {},
    onLongPicked?: (entityId: string, clientX: number, clientY: number) => void,
    badgeHitTest?: (clientX: number, clientY: number) => boolean,
  ) {
    this.scene = scene;
    this.onPicked = onPicked;
    // A long-press always opens the full panel; default to the same handler.
    this.onLongPicked = onLongPicked ?? onPicked;
    this.entityMap = entityMap;
    this.bindings = bindings;
    this.badgeHitTest = badgeHitTest ?? null;

    scene.onPointerObservable.add((info) => this.handlePointer(info));
  }

  setMaps(
    map: Record<string, EntityMapping>,
    bindings: Record<string, string>,
    deniedTypes: readonly EntityType[] = [],
    hiddenCategories: readonly Category[] = [],
  ): void {
    this.entityMap = map;
    this.bindings = bindings;
    this.deniedTypes = deniedTypes;
    this.hiddenCategories = hiddenCategories;
  }

  /** Flag interactive meshes pickable; everything else stays non-interactive. */
  indexInteractiveMeshes(meshes: AbstractMesh[]): void {
    for (const m of meshes) {
      const mapping = this.resolveMesh(m);
      m.isPickable = !!mapping || m.isPickable; // keep walls pickable for ray stop
    }
  }

  private resolveMesh(mesh: Node | null): EntityMapping | null {
    let node: Node | null = mesh;
    let depth = 0;
    while (node && depth < 4) {
      const mapping = resolveMeshToMapping(node.name, this.entityMap, this.bindings, this.deniedTypes);
      if (mapping) {
        // Same backstop as the deniedTypes check inside resolveMeshToMapping:
        // a category the HUD filter switched off is not interactive either,
        // matching SceneManager.applyHighlight's own gate (hidden categories
        // don't glow as clickable, so they shouldn't fire on tap either).
        const category = effectiveCategory(mapping.entityId, mapping.type, mapping.category);
        if (!this.hiddenCategories.includes(category)) return mapping;
      }
      node = node.parent;
      depth++;
    }
    return null;
  }

  /** Mouse-only hover cursor: show a pointer over interactive objects (3D
   *  meshes or state badges). Touch has no hover, so this is a no-op there
   *  and never interferes with tapping. */
  private handlePointer(info: PointerInfo): void {
    if (info.type !== PointerEventTypes.POINTERMOVE) return;
    const evt = info.event as PointerEvent;
    if (evt.pointerType === "touch") return;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return;
    const overBadge = !!this.badgeHitTest?.(evt.clientX, evt.clientY);
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    const interactive = overBadge || (!!pick?.hit && !!pick.pickedMesh && !!this.resolveMesh(pick.pickedMesh));
    canvas.style.cursor = interactive ? "pointer" : "";
  }

  /**
   * Which entity (if any) the 3D geometry at these client coordinates resolves
   * to — the same question `pickAtScreen` answers, ASKED instead of ACTED on.
   *
   * Exists because "is this point empty map?" is a real question with no
   * side effects (double-tap-to-zoom asks it), and the only way to ask it
   * before was to call pickAtScreen and watch what it did to the UI.
   */
  entityAtScreen(clientX: number, clientY: number): string | null {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    const rect = canvas?.getBoundingClientRect();
    const pick = this.scene.pick(clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0));
    if (!pick?.hit || !pick.pickedMesh) return null;
    return this.resolveMesh(pick.pickedMesh)?.entityId ?? null;
  }

  /**
   * Resolve a confirmed tap (or long-press) at client coordinates to the
   * entity mapped to the picked mesh. Called by the active camera controller
   * on a clean gesture (mouse or touch). A long-press always routes the
   * resolved entity to onLongPicked (the full panel).
   */
  pickAtScreen(clientX: number, clientY: number, longPress = false): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    const rect = canvas?.getBoundingClientRect();
    const pick = this.scene.pick(clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0));
    if (!pick?.hit || !pick.pickedMesh) {
      tapDebug("3D pick: no hit");
      return;
    }

    const mapping = this.resolveMesh(pick.pickedMesh);
    // ⚠️ COLLISION STATE ON THE LINE, because "can I walk through this?" was
    // asked of this exact log twice and it could not answer. The owner walked
    // through a glass balcony railing and fell a storey; the mesh's bounding
    // box was measured against applyStructure's rule and PASSED it, but that
    // is the rule ON PAPER — whether the flag was actually set on the mesh is
    // a different claim, and running the two together is how a round was lost.
    // One tap now separates "collision never enabled here" from "enabled and
    // the geometry lets you through", which need completely different fixes.
    const cm = pick.pickedMesh;
    const bb = cm.getBoundingInfo().boundingBox.extendSizeWorld;
    tapDebug(
      `3D pick: mesh="${cm.name}" mapping=${mapping?.entityId ?? "none"}`
      + ` collides=${cm.checkCollisions ? "y" : "n"}`
      + ` enabled=${cm.isEnabled() ? "y" : "n"} pickable=${cm.isPickable ? "y" : "n"}`
      + ` h=${(bb.y * 2).toFixed(2)} foot=${(bb.x * 2).toFixed(2)}x${(bb.z * 2).toFixed(2)}`,
    );
    if (mapping) (longPress ? this.onLongPicked : this.onPicked)(mapping.entityId, clientX, clientY);
  }
}
