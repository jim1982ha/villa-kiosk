// src/babylon/FloorManager.ts
// Floor visibility and staircase trigger zones.
//
// Classification, in priority order — all of it via meshRoles.structureRole,
// which reads the pipeline's own glTF `extras` metadata and only falls back to
// the legacy name convention for a GLB built before that metadata existed:
//  0. The always-visible exterior group (`vk_exterior`): ground + garden +
//     palms. NEVER culled by a floor toggle, so the villa keeps its plot and
//     the palms stay whole on every floor.
//  1. Structure meshes (`vk_role: "structure"`), placed by their stamped
//     `vk_level` — 0-based from the pipeline (0 = ground), +1 here because
//     this app's floors are 1-based.
//  2. Everything else — entity meshes, and the single fused Structure of
//     older GLBs (which rule 1 pins to floor 1 so it can never vanish) — by
//     elevation: bounding-box centre Y below FLOOR_SPLIT_Y is floor 1.
//
// Switching floors is pure visibility and CUMULATIVE DOWNWARD (2.9.8): the
// active floor AND every floor below it are enabled; only floors ABOVE are
// setEnabled(false). Looking at 1F still cuts the upper storey away so you
// can see inside from above, but the 2F view keeps the ground floor's
// exterior walls, windows and terraces underneath — without them the upper
// storey read as a slab floating over the garden. (Pre-2.9.8 this was
// exclusive — active floor only.) The exterior group stays on throughout.
// setEnabled is deliberately NOT isVisible — applyStructure hides ceilings
// with isVisible, and the two must not stomp each other. Invisible
// `trigger_stair_up/down` meshes (if present) switch floors when the camera
// walks into them.

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { CameraController } from "./CameraController";
import { structureRole } from "./meshRoles";
import { tapDebug } from "@/utils/tapDebug";
import type { Material } from "@babylonjs/core/Materials/material";

const FLOOR_SPLIT_Y = 2.8; // metres; ground floor wall height is ~2.5 m

/**
 * Whether the storey-above slab may stand in for a missing ceiling — see
 * applyVisibility.
 *
 * ⚠️ **RUNTIME-OVERRIDABLE, AND THAT IS THE POINT (2.473.0).** The owner asked
 * the right question: how do you confirm the fallback is not quietly taking
 * over and hiding whether the REAL ceiling works? A compile-time constant
 * cannot answer that without a rebuild, so `?noslab` turns the lid off for one
 * reload. Whatever you can see overhead then is the peeled ceiling and nothing
 * else — the honest picture of what the bake actually produced.
 *
 * Two other signals already separate them and neither can be fooled by the lid:
 * `above=ceiling@…` vs `above=slab@…` on the `walk:` line names which surface
 * is over the walker's head at that moment, and `ceiling coverage:` rays only
 * against `ceilingMeshes`, so it measures the real ceiling whether or not the
 * fallback is on.
 *
 * `false` here is the intended end state: no lid at all once the pipeline's
 * peel stops leaving most of the ceiling behind.
 */
function ceilingSlabFallback(): boolean {
  if (!CEILING_SLAB_FALLBACK) return false;
  try {
    if (typeof location !== "undefined" && /[?&]noslab\b/.test(location.search)) return false;
  } catch { /* no location (tests) — keep the default */ }
  return true;
}

const CEILING_SLAB_FALLBACK = true;

export class FloorManager {
  private camera: CameraController | null = null;
  private onFloorChange: (floor: number) => void;

  private floorMeshes = new Map<number, AbstractMesh[]>();
  /** World Y of each floor's slab (its meshes' lowest point) — the elevation you
   *  stand on when on that storey. Used to pick the storey from the walker's
   *  feet height when the GLB ships no stair-trigger meshes. */
  private floorBaseY = new Map<number, number>();
  private alwaysOnMeshes: AbstractMesh[] = [];
  private triggerUp: AbstractMesh | null = null;
  private triggerDown: AbstractMesh | null = null;
  private currentFloor = 1;
  private floorsDetected: number[] = [1];
  private cooldownUntil = 0;
  // Elevation-based floor switching only runs while walking (first-person). In
  // overview the walker camera sits at a stale position and must not drive floors.
  private firstPerson = false;
  /** Dedupe for the lid report — see applyVisibility. */
  private lastLidCount = -1;

  constructor(scene: Scene, onFloorChange: (floor: number) => void) {
    this.onFloorChange = onFloorChange;
    scene.registerBeforeRender(() => this.checkTriggers());
  }

  setCamera(camera: CameraController): void {
    this.camera = camera;
  }

  /** Toggle elevation-driven floor switching (on only in first-person walk).
   *
   *  ⚠️ Visibility is deliberately NOT re-applied here any more (2.444.0). From
   *  2.435.0 to 2.443.0 this also enabled the storey-above's STRUCTURE while
   *  walking, to borrow its floor slab as a stand-in ceiling. That is gone: the
   *  pipeline (≥2.23.0) ships a real ceiling per storey, `applyStructure` shows
   *  it in first-person and hides it for the overview, and the slab was
   *  redundant where a real ceiling exists AND useless on the top storey, where
   *  there is no storey above to borrow from. Floor visibility is a pure
   *  function of the active floor again — see applyVisibility. */
  setFirstPerson(active: boolean): void {
    if (this.firstPerson === active) return;
    this.firstPerson = active;
    // The lid is a function of this flag, so the flag has to re-apply it.
    // Without this the slab would only appear at the next storey change, i.e.
    // never for anyone who walks a single floor — which is most sessions.
    this.applyVisibility();
  }

  indexFloors(meshes: AbstractMesh[]): void {
    this.floorMeshes.clear();
    this.floorBaseY.clear();
    this.alwaysOnMeshes = [];
    for (const m of meshes) {
      if (/^trigger_stair_up/i.test(m.name)) {
        this.triggerUp = m;
        m.isVisible = false;
        m.isPickable = false;
        continue;
      }
      if (/^trigger_stair_down/i.test(m.name)) {
        this.triggerDown = m;
        m.isVisible = false;
        m.isPickable = false;
        continue;
      }
      // Container/root nodes carry no geometry but parent everything else —
      // disabling one would take the whole model down with it. The night
      // carrier is managed by the day/night crossfade, not by floors.
      if (m.getTotalVertices() === 0) continue;
      if (m.name === "BAKED_NightCarrier") continue;
      // Ask the mesh what it IS (pipeline metadata), not what it is CALLED —
      // see meshRoles.ts. Falls back to the legacy name convention for a GLB
      // built before the pipeline stamped that metadata, and that fallback
      // still normalises the name first: Babylon's glTF loader splits a
      // multi-primitive mesh (one primitive per material slot — a baked
      // Structure keeps ~150 slots) into children renamed
      // `Structure_primitive<N>`, and without normalising, every structure
      // piece would fall through to the bounding-box rule below: the 2F floor
      // slab (centre ~2.5 m, under FLOOR_SPLIT_Y) would land on floor 1 —
      // visible on 1F, missing on 2F — and the garden would lose always-on.
      const role = structureRole(m);
      // The exterior group (ground + garden + palms) is always visible — it
      // belongs to no floor and must survive every toggle.
      if (role.isExterior) {
        this.alwaysOnMeshes.push(m);
        if (!m.isEnabled(false)) m.setEnabled(true);
        continue;
      }
      // Pipeline level is 0-based (0 = ground); this app's floors are 1-based.
      const floor = role.isStructure
        ? role.level + 1
        : m.getBoundingInfo().boundingBox.centerWorld.y > FLOOR_SPLIT_Y
          ? 2
          : 1;
      // Stamp the floor on the mesh so other systems (the entity-label culler)
      // can tell which storey a mesh belongs to without re-deriving the rules.
      m.metadata = { ...(m.metadata ?? {}), floorIndex: floor };
      const list = this.floorMeshes.get(floor) ?? [];
      list.push(m);
      this.floorMeshes.set(floor, list);
      // Track the storey's slab elevation = the lowest point of its meshes.
      const minY = m.getBoundingInfo().boundingBox.minimumWorld.y;
      const prev = this.floorBaseY.get(floor);
      if (prev === undefined || minY < prev) this.floorBaseY.set(floor, minY);
    }
    this.floorsDetected = [...this.floorMeshes.keys()].sort();
    if (this.floorsDetected.length === 0) this.floorsDetected = [1];
    this.applyVisibility();
  }

  getFloorsDetected(): number[] {
    return this.floorsDetected;
  }

  hasFloor(floor: number): boolean {
    return (this.floorMeshes.get(floor)?.length ?? 0) > 0;
  }

  /** Every mesh indexed under `floor`, regardless of its CURRENT visibility
   *  (setEnabled toggles with the active floor, this list doesn't). Lets a
   *  caller (RoomHighlight, via SceneManager) find a storey's real floor
   *  height without a scene raycast, which would miss a hidden floor. */
  getFloorMeshes(floor: number): AbstractMesh[] {
    return this.floorMeshes.get(floor) ?? [];
  }

  getCurrentFloor(): number {
    return this.currentFloor;
  }

  /**
   * Show the active floor and every floor BELOW it; only floors above are
   * disabled. The 1F view still cuts the upper storey away (top-down look
   * into the rooms), while the 2F view keeps the ground floor's shell —
   * exterior walls, windows, terraces — underneath so the upper storey
   * doesn't float in mid-air. The exterior group (ground + palms) stays
   * enabled regardless of floor.
   */
  private applyVisibility(): void {
    // ⚠️ THE STOREY-ABOVE SLAB IS BACK, AS A FALLBACK (2.465.0). It shipped from
    // 2.435.0 to 2.443.0 and was deleted in 2.444.0 on three arguments, one of
    // which was simply wrong: that it was "redundant the moment a real ceiling
    // existed". A real ceiling now exists and the measurement says it covers
    // **17% of the ground floor** — `ceiling coverage: 2/14 ground rooms`, with
    // the Kitchen, both bathrooms and the Laundry at zero, because
    // blender_pipeline's peel leaves 493 m2 of down-facing ceiling fused in the
    // structure against 124.8 m2 it takes. So deleting this removed the thing
    // that was covering the other 83%, and the owner said so plainly: "the slab
    // fallback you added a few versions ago was working very well".
    //
    // The other two arguments stand and are why this is scoped, not restored:
    // it wears the storey-above FLOOR's texture (a real complaint, and the
    // reason it is a fallback rather than the mechanism), and it can never help
    // the TOP storey, whose ceiling the pipeline deliberately drops. Both are
    // better than open sky over every interior room.
    //
    // FIRST-PERSON ONLY. The overview is a cut-away and a lid turns it into a
    // picture of the lid — the same rule `applyCeilingVisibility` follows, for
    // the same reason. `firstPerson` is already tracked here for the stair
    // auto-switch, so this needs no new state.
    const lidFloor = this.firstPerson && ceilingSlabFallback()
      ? this.currentFloor + 1 : -1;
    let lid = 0;
    for (const [floor, list] of this.floorMeshes) {
      for (const m of list) {
        // STRUCTURE ONLY on the lid storey. Its `floorMeshes` entry holds that
        // storey's furniture and fixtures too, and enabling those would render
        // a room's worth of objects standing on top of the slab — invisible
        // from underneath, except through the stairwell opening, and paid for
        // every frame regardless.
        const isLid = floor === lidFloor && m.metadata?.isStructure === true;
        if (isLid) lid += 1;
        const on = floor <= this.currentFloor || isLid;
        if (m.isEnabled(false) !== on) m.setEnabled(on);
        // ⚠️ A LID IS SCENERY, AND MUST NOT BE PICKABLE (2.466.0). Enabling the
        // storey above put its slab into every downward raycast in the app, and
        // `SceneManager.groundCamera` takes the FIRST hit from 20 m up — so the
        // walker was grounded ON TOP of the lid and arrived on the second floor.
        // Reported as "I land in another room than the one I specified", with
        // `spawn: groundRoom "Bedroom 1" ... standY=0.00` immediately followed
        // by `at=-6.5,4.3,1.0` — an eye at 4.3 m over a floor the spawn had
        // just measured at 0.00.
        //
        // The same set feeds `followFloor` (a capture shows floorMs=1192.90 for
        // 35 rays, 34 ms each, against ~13 ms before) and the tap picker, which
        // started returning `Structure_L1_primitive97` for a tap on the ceiling.
        // One flag fixes all three, because all three filter on isPickable.
        const meta = (m.metadata ??= {}) as {
          vkLidHid?: boolean; vkLidMat?: Material; vkBaseMat?: Material;
        };
        if (isLid && m.isPickable) { meta.vkLidHid = true; m.isPickable = false; }
        else if (!isLid && meta.vkLidHid) { meta.vkLidHid = false; m.isPickable = true; }
        // While it is a lid, a surface that carries a ceiling wears the ceiling
        // LOOK — lightmap withheld, albedo toned. See
        // SceneManager.prepareLidCeilingLook for why these meshes never got that
        // treatment at load, and why the alternative is a bake-side fix.
        // Restored the instant it stops being a lid, so walking that storey
        // shows its own materials exactly as before.
        if (meta.vkLidMat && meta.vkBaseMat) {
          const want = isLid ? meta.vkLidMat : meta.vkBaseMat;
          if (m.material !== want) m.material = want;
        }
      }
    }
    if (lid !== this.lastLidCount) {
      this.lastLidCount = lid;
      // Reported because its absence is exactly what went unnoticed for twenty
      // releases: with no line for it, "there is no ceiling" and "the fallback
      // that provided one was deleted" look identical from a capture.
      // ⚠️ SAY WHICH OF THE FOUR STATES THIS IS. The first cut printed
      // "0 structure mesh(es) from storey -1 — none available (top storey?)"
      // whenever the overview was showing, because `lidFloor` is -1 there by
      // design — a lid is first-person only. That reads as a fault, in a
      // subsystem where "no ceiling" has been the reported symptom for twenty
      // releases, and an instrument that cries wolf in the normal case is worse
      // than no instrument. Four states, four sentences.
      tapDebug("ceiling slab fallback: " + (
        !ceilingSlabFallback()
          ? "OFF (?noslab) — whatever is overhead is the real ceiling"
          : !this.firstPerson
            ? "idle — overview is a cut-away and takes no lid"
            : lid > 0
              ? `${lid} structure mesh(es) from storey ${lidFloor} used as a lid `
                + `over floor ${this.currentFloor}`
              : `no lid over floor ${this.currentFloor} — storey ${lidFloor} `
                + "ships no structure (top storey), so only a real ceiling can cover it"
      ));
    }
    for (const m of this.alwaysOnMeshes) {
      if (!m.isEnabled(false)) m.setEnabled(true);
    }
  }

  private checkTriggers(): void {
    if (!this.camera) return;
    if (performance.now() < this.cooldownUntil) return;
    const pos = this.camera.getPosition();

    // Explicit stair-trigger zones (if the GLB ships them) take priority.
    if (this.triggerUp && this.currentFloor === 1 && this.triggerUp.intersectsPoint(pos)) {
      this.switchToFloor(2);
      return;
    }
    if (this.triggerDown && this.currentFloor === 2 && this.triggerDown.intersectsPoint(pos)) {
      this.switchToFloor(1);
      return;
    }

    // Otherwise (the pipeline emits no trigger meshes) derive the storey from
    // the walker's feet height: climbing the stairs raises the eye, and once the
    // feet clear onto the upper slab we reveal that storey (and hide it again on
    // the way down). Only while actually walking — see setFirstPerson.
    if (this.firstPerson && !this.triggerUp && !this.triggerDown && this.floorsDetected.length > 1) {
      const desired = this.floorFromElevation(this.camera.getFeetY());
      if (desired !== this.currentFloor) this.switchToFloor(desired);
    }
  }

  /**
   * Highest storey whose slab the feet have reached. Hysteresis keeps the switch
   * from chattering at the boundary: you must climb to within 0.3 m of the upper
   * slab to go up, but drop a full 0.9 m below it to come back down.
   */
  private floorFromElevation(feetY: number): number {
    let desired = this.floorsDetected[0];
    for (const f of this.floorsDetected) {
      const base = this.floorBaseY.get(f);
      if (base === undefined) continue;
      const goingUp = f > this.currentFloor;
      const margin = goingUp ? 0.3 : 0.9; // climb close to switch up; drop well below to switch down
      if (feetY >= base - margin) desired = f;
    }
    return desired;
  }

  /**
   * Switch active floor: only that floor's meshes are shown (exclusive), the
   * others are hidden; the exterior group stays visible throughout.
   */
  switchToFloor(floor: number): void {
    if (floor === this.currentFloor) return;
    if (!this.hasFloor(floor)) {
      // Floor not modelled yet — report so the UI can show "coming soon".
      this.onFloorChange(floor);
      return;
    }
    this.currentFloor = floor;
    this.cooldownUntil = performance.now() + 1500;
    this.applyVisibility();
    this.onFloorChange(floor);
  }
}
