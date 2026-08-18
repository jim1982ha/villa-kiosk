// src/babylon/CameraController.ts
// First-person walk + teleport. Translation is driven manually (so it works the
// same from the React virtual joystick and from WASD), with gravity + collision
// handled via moveWithCollisions each frame. Look-around uses Babylon's built-in
// touch/mouse rotation.

import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Animation } from "@babylonjs/core/Animations/animation";
// Side-effect only: registers Scene.prototype.beginDirectAnimation (used below).
// @babylonjs/core's barrel used to pull this in for free; a deep import to just
// "Animations/animation" does NOT — the extension lives in this sibling file.
import "@babylonjs/core/Animations/animatable";
// Side-effect only: registers Scene.CollisionCoordinatorFactory, which
// moveWithCollisions (triggered below by any non-zero camera.cameraDirection —
// i.e. every frame this controller is actually walking, never while only
// rotating) needs to exist at all. Without it Babylon throws "DefaultCollision-
// Coordinator needs to be imported before..." on every such frame — this is
// the actual cause of first-person movement freezing the UI while look-around
// stayed smooth; see SceneManager.ts's own copy of this import for the fuller
// trace (confirmed via production WINDOW_ERROR telemetry).
import "@babylonjs/core/Collisions/collisionCoordinator";
import { CubicEase, EasingFunction } from "@babylonjs/core/Animations/easing";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AppConfig } from "@/config/AppConfig";
import { roomKey } from "@/config/roomKey";
import type { TeleportPoint } from "@/types/scene.types";
import { clamp, pointInPolygon, type Pt2 } from "@/utils/geometry";
import { nearestFloorRoom } from "./roomStorey";
import { TapRecognizer } from "./TapRecognizer";

interface CameraCallbacks {
  onRoomChange: (room: string | null) => void;
  onActivity: () => void;
  /** A clean single-finger / single-click tap at the given client coords.
   * The camera owns the only reliable pointer pipeline (it holds the pointer
   * capture), so tap-to-pick is detected here rather than via a second
   * scene.onPointerObservable listener that touch events race against. */
  onTap?: (clientX: number, clientY: number) => void;
  /** A press-and-hold at the given client coords (opens the full entity panel). */
  onLongPress?: (clientX: number, clientY: number) => void;
}

const WALK_SPEED = 0.018; // world-space impulse per frame at full joystick deflection

interface RoomAnchor {
  name: string;
  position: Vector3;
}

export class CameraController {
  readonly camera: UniversalCamera;
  private scene: Scene;
  private config: AppConfig;
  private cb: CameraCallbacks;

  private moveX = 0; // strafe, -1..1
  private moveY = 0; // forward, -1..1
  private roomAnchors: RoomAnchor[] = [];
  /** Normalised by setRoomPolygons — `floorY` is always present here, because
   *  the per-frame storey test must not have to default it. */
  private roomPolygons: Array<{ name: string; pts: Pt2[]; floorY: number }> = [];
  private currentRoom: string | null = null;
  /**
   * What `followFloor`'s raycasts cost, since the last read — the instrument for
   * the one raycast in this app that runs while the camera is MOVING.
   *
   * /dry-audit, 2026-08-17: "what is the floor height below this point" is
   * supposed to have exactly one answer (`floorProbe.ts`, three callers named in
   * CLAUDE.md). This is a fourth, and its divergence is only half documented:
   * the CACHE must differ (a walking camera cannot memoise an answer that
   * changes every step — see SceneManager.applyStructure's octree note), but its
   * PREDICATE also differs, silently, accepting every pickable mesh (~900) where
   * floorProbe accepts structure only (~307). An owner capture measured a ray
   * against this geometry at 7-15 ms, and this fires one or two of them ~11
   * times a second while you walk.
   *
   * That made it a CANDIDATE for the residual walk lag, not a finding — six
   * perf hypotheses in this app have been argued from exactly that reasoning and
   * disproved. So it got measured before it got changed, and the measurement
   * came back (owner capture, 2026-08-17): `floorMs=176..447` per 2 s window,
   * i.e. 12-19 ms per ray and 9-22% of wall-clock — **while STANDING STILL**,
   * because the throttle below is the only thing that ever gated it and a
   * throttle asks "how long since last time", never "did anything change".
   * `still` is the count of probe slots the stationary gate declined, and it is
   * here for the reason `moving=` is on the occlusion line: without it
   * `floorRays=0` reads as "cheap" when it means "not asked".
   */
  readonly floorProbeCost = { rays: 0, ms: 0, still: 0 };
  /** Scratch for `roomHitTest` — see updateRoom. */
  private hitX = 0;
  private hitZ = 0;
  /** Allocated ONCE. `nearestFloorRoom` takes a predicate so a caller need not
   *  build a filtered array per frame; handing it a fresh arrow each frame
   *  would have given back the allocation it was designed to save. */
  private roomHitTest = (r: { pts: Pt2[] }): boolean =>
    pointInPolygon(this.hitX, this.hitZ, r.pts);
  private animating = false;
  private eyeHeight: number;
  private walkSpeed: number;
  private canvas: HTMLCanvasElement;

  // Click-to-walk target (collision-aware), and stuck detection.
  private autoTarget: { x: number; z: number } | null = null;
  private lastAutoPos: { x: number; z: number } | null = null;
  private autoStuck = 0;
  private shift = false;

  constructor(scene: Scene, canvas: HTMLCanvasElement, config: AppConfig, cb: CameraCallbacks) {
    this.scene = scene;
    this.config = config;
    this.cb = cb;
    this.canvas = canvas;
    this.eyeHeight = config.eyeHeight ?? 1.7;
    this.walkSpeed = config.walkSpeed ?? 1;

    this.camera = new UniversalCamera("villaCamera", new Vector3(0, this.eyeHeight, 0), scene);
    this.camera.setTarget(new Vector3(0, this.eyeHeight, 1));
    this.camera.minZ = 0.1;
    this.camera.fov = 0.9;
    this.camera.speed = 0; // we move manually
    this.camera.angularSensibility = 2500; // higher = slower look (tablet-friendly)
    this.camera.inertia = 0.6;

    this.camera.checkCollisions = true;
    // No gravity: the villa floor is flat, so we keep the eye at a fixed height
    // (found by raycasting to the real floor) and only move horizontally.
    this.camera.applyGravity = false;
    // Collision body: a capsule that FLOATS above the floor so short steps don't
    // block it (you climb stairs via floor-following). updateEllipsoid() sizes it
    // from the current eye height so its BOTTOM clears `STEP_CLEAR` (any riser
    // below that is steppable) and its TOP stays under ~2 m door lintels.
    this.updateEllipsoid();

    // We drive ALL look/move ourselves via pointer events (below) so touch and
    // mouse behave identically and predictably. Remove Babylon's built-in mouse
    // AND touch camera inputs so they can't double-rotate or drag-to-walk.
    this.camera.attachControl(canvas, true);
    this.camera.inputs.removeByType("FreeCameraMouseInput");
    this.camera.inputs.removeByType("FreeCameraTouchInput");
    // Strip keyboard translation so it can't fight our manual move.
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];

    // Unified pointer input (works for mouse, pen and touch). Attached here and
    // toggleable via detachInput()/attachInput() so the overview camera can take
    // sole ownership of the pointer pipeline when that mode is active.
    //   • mouse drag / one finger drag  = look around
    //   • two fingers drag              = walk (up=forward, sideways=strafe)
    //   • double-tap / double-click     = walk to that spot
    this.attachInput();

    scene.registerBeforeRender(() => this.step());
  }

  // ── Input ownership ────────────────────────────────────────────────────────
  // Only one controller (first-person OR overview) listens to canvas pointers at
  // a time, so there's never a setPointerCapture race between them.
  private inputAttached = false;

  attachInput(): void {
    if (this.inputAttached) return;
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerUp);
    // Two-finger trackpad swipe (and mouse wheel) = walk. A swipe emits a stream
    // of wheel events: up = forward, down = back, sideways = strafe.
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    // Arrow keys + WASD = walk.
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    this.inputAttached = true;
  }

  detachInput(): void {
    if (!this.inputAttached) return;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    // Drop any in-flight gesture/movement so we don't resume mid-walk on return.
    this.pointers.clear();
    this.keys.clear();
    this.moveX = 0;
    this.moveY = 0;
    this.inputAttached = false;
  }

  // ── Collision capsule sizing ──────────────────────────────────────────────
  // Steps/stairs shorter than this don't collide, so you can walk up them; the
  // floor-follower then raises the eye. Keep this in sync with followFloor()'s
  // furniture threshold.
  private static readonly STEP_CLEAR = 0.55;
  // Keep the capsule short (knee-to-chest): a tall body jams its head on the
  // ceiling / upper-floor slab partway up a staircase and locks you in place.
  // Walls span full height so they still block; overhead stays clear for stairs.
  private static readonly BODY_RADIUS_Y = 0.5;

  private updateEllipsoid(): void {
    const ry = CameraController.BODY_RADIUS_Y;
    this.camera.ellipsoid = new Vector3(0.3, ry, 0.3);
    // Place the capsule so its bottom sits STEP_CLEAR above the floor:
    //   bottom = eyeHeight + offsetY - ry  →  offsetY = STEP_CLEAR + ry - eyeHeight
    const offsetY = CameraController.STEP_CLEAR + ry - this.eyeHeight;
    this.camera.ellipsoidOffset = new Vector3(0, offsetY, 0);
  }

  // ── Unified pointer look / two-finger walk + pinch-zoom / double-tap ────────
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private pinchDist = 0; // current separation between two touch pointers (px)
  private static readonly LOOK_SENS = 0.004; // rad per px

  // ── Single-tap detection (drives tap-to-pick) ──
  // A gesture is a tap if it stayed one pointer, barely moved, and was brief.
  // Long-press is delivered by the recognizer's own hold timer, mid-gesture —
  // see TapRecognizer's constructor docs for why it no longer waits for release.
  private readonly tap = new TapRecognizer((x, y) => this.cb.onLongPress?.(x, y));

  private onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

    // Begin a tap candidate on the first pointer; a second pointer (multi-touch
    // gesture) cancels it so a pinch/two-finger walk never fires a pick.
    if (this.pointers.size === 1) this.tap.begin(e.clientX, e.clientY);
    else this.tap.cancel();

    // Double-tap / double-click → walk to the tapped spot. Only on a fresh touch
    // (first finger) or a mouse press, so a two-finger walk doesn't trigger it.
    const touches = this.touchCount();
    if ((e.pointerType !== "touch" || touches === 1)
      && this.tap.isDoublePress(e.clientX, e.clientY)) {
      this.walkToScreen(e.clientX, e.clientY);
    }
    this.cb.onActivity();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return; // mouse moving with no button held → ignore (look only on drag)
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    e.preventDefault();

    // Moving past the tolerance turns the gesture into a look/drag, not a tap.
    this.tap.moved(e.clientX, e.clientY);

    if (this.touchCount() >= 2) {
      // ── Pinch-to-zoom: change in finger separation = forward / back movement.
      // Detect AFTER updating prev (so pointers map holds current positions).
      const touches = [...this.pointers.values()].filter((p) => p.type === "touch");
      if (touches.length === 2) {
        const dist = Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y);
        if (this.pinchDist > 0) {
          const pinchDelta = dist - this.pinchDist; // +ve = spread = walk forward
          // Each finger fires its own event so the observed delta per event is ≈ half
          // the total gesture change — similar to the 0.5 factor in the walk code.
          const PINCH_FACTOR = 0.005;
          this.nudge(pinchDelta * PINCH_FACTOR * this.walkSpeed, 0);
        }
        this.pinchDist = dist;
      }

      // ── Two-finger swipe: both fingers moving together = walk / strafe.
      // Up = forward, sideways = strafe. Both fingers emit moves, so halve gain.
      const factor = 0.0016 * WALK_SPEED * this.walkSpeed * 60 * 0.5;
      this.nudge(-dy * factor, dx * factor);
    } else {
      // Mouse drag or one finger = look around.
      this.pinchDist = 0; // reset if one finger lifts mid-gesture
      this.camera.rotation.y += dx * CameraController.LOOK_SENS;
      this.camera.rotation.x = clamp(this.camera.rotation.x + dy * CameraController.LOOK_SENS, -1.4, 1.4);
      this.cb.onActivity();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // Reset pinch baseline when we're back to 0 or 1 touch fingers.
    if (this.touchCount() < 2) this.pinchDist = 0;

    // Fire a tap (→ entity pick) only if this was the last pointer up and the
    // gesture stayed a brief, stationary tap. pointercancel/leave also route
    // here, so a cancelled gesture won't mis-fire. TapRecognizer swallows the
    // synthesized touch/pen ghost click that would otherwise dismiss whatever
    // the tap opens the instant React mounts it.
    if (this.pointers.size === 0) {
      // Only "tap" can come back now — a long-press already fired from the
      // recognizer's hold timer while the finger was still down.
      if (this.tap.complete(e) === "tap") this.cb.onTap?.(e.clientX, e.clientY);
    }
  };

  private touchCount(): number {
    let n = 0;
    for (const p of this.pointers.values()) if (p.type === "touch") n++;
    return n;
  }

  /** Pick the floor under a screen (client) point and walk there. */
  private walkToScreen(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const pick = this.scene.pick(
      clientX - rect.left,
      clientY - rect.top,
      (m) => m.isPickable && m.isVisible && m.isEnabled() && !m.metadata?.isMarker && !/^(halo_|label_)/i.test(m.name),
    );
    if (pick?.hit && pick.pickedPoint) this.walkTo(pick.pickedPoint.x, pick.pickedPoint.z);
  }

  private keys = new Set<string>();

  private onKey = (e: KeyboardEvent): void => {
    this.shift = e.shiftKey;
    const map: Record<string, string> = {
      ArrowUp: "fwd", KeyW: "fwd", ArrowDown: "back", KeyS: "back",
      // Left/right TURN rather than strafe. Sidestepping is what a game pad
      // does; walking a villa, "left" means "look left", and strafing read as
      // the view drifting sideways with no way to change heading. Q/E keep the
      // sidestep for anyone who wants it, which is the swap of what they were.
      ArrowLeft: "turnLeft", KeyA: "turnLeft", ArrowRight: "turnRight", KeyD: "turnRight",
      KeyQ: "left", KeyE: "right",
    };
    const action = map[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.type === "keydown") this.keys.add(action);
    else this.keys.delete(action);
    this.cb.onActivity();
  };

  /**
   * "Click to move": walk to a floor spot, respecting wall collisions (so you
   * can't pass through walls/windows). Only starts if the target is inside the
   * house footprint when room polygons are known — clicking the garden/outside
   * is ignored so you don't end up stuck outside.
   */
  walkTo(x: number, z: number): void {
    if (this.roomPolygons.length > 0) {
      // EVERY storey's outline, deliberately — unlike updateRoom below. The
      // question here is "is this spot inside the house at all", and a point
      // under an upper-storey room is inside the house by any reading.
      const inside = this.roomPolygons.some((r) => pointInPolygon(x, z, r.pts));
      if (!inside) return; // clicked outside the rooms — ignore
    }
    this.autoTarget = { x, z };
    this.lastAutoPos = null;
    this.autoStuck = 0;
    this.cb.onActivity();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Hold Shift while swiping/scrolling = look around (turn + tilt) instead of walk.
    if (e.shiftKey) {
      this.camera.rotation.y += e.deltaX * 0.0022;
      this.camera.rotation.x = clamp(this.camera.rotation.x + e.deltaY * 0.0022, -1.4, 1.4);
      this.cb.onActivity();
      return;
    }
    const WHEEL_FACTOR = 0.0009;
    const forward = -e.deltaY * WHEEL_FACTOR * WALK_SPEED * this.walkSpeed * 60;
    const strafe = e.deltaX * WHEEL_FACTOR * WALK_SPEED * this.walkSpeed * 60;
    this.nudge(forward, strafe);
  };

  /**
   * Per-frame movement scale that keeps walking speed CONSTANT regardless of
   * frame rate. WALK_SPEED is tuned for 60 fps; on a slower tablet a raw
   * per-frame impulse crawls (fewer frames = less distance), which is why the
   * joystick "barely moved forward". Scaling by (Δt / 16.67 ms) restores the
   * configured pace on any device. Capped so a long stall (tab switch) can't
   * fling the camera on the next frame.
   */
  private frameFactor(): number {
    const dt = this.scene.getEngine().getDeltaTime(); // ms since last frame
    if (!Number.isFinite(dt) || dt <= 0) return 1;
    return Math.min(3, dt / 16.667);
  }

  /** Apply a one-off world-space horizontal movement impulse (used by wheel). */
  private nudge(forward: number, strafe: number): void {
    this.requestedMove = true;
    this.autoTarget = null; // manual swipe cancels click-to-walk
    const f = this.camera.getDirection(Axis.Z);
    const r = this.camera.getDirection(Axis.X);
    f.y = 0; r.y = 0;
    f.normalize(); r.normalize();
    const move = f.scale(forward).add(r.scale(strafe));
    move.y = 0;
    this.camera.cameraDirection.addInPlace(move);
    this.followFloor(); // keep two-finger-swipe walking on the floor / stairs
    this.cb.onActivity();
    this.updateRoom();
  }

  dispose(): void {
    this.detachInput();
  }

  /**
   * Drop the eye onto the real floor beneath it: raycast straight down and set
   * the camera Y to floorY + eyeHeight. Robust to any model origin/scale.
   */
  /**
   * How often followFloor() is actually allowed to raycast, in wall-clock ms
   * (~11 Hz) rather than once per rendered frame. This exists because the
   * raycast itself, not the smoothing math below that consumes its answer, is
   * the expensive part: it tests against the same structural geometry
   * EntityVisuals.surfaceBelowCache's own docstring measured as "a linear
   * scan over a 1.4-million-triangle structure mesh with no picking octree"
   * (SceneManager.applyStructure now builds a submesh octree for exactly this
   * reason, but a mesh whose geometry doesn't happen to split into enough
   * submeshes to prune gets little or no benefit from that alone — this is
   * the second, unconditional half of the same fix). Time-based rather than
   * frame-count-based for the same reason frameFactor() is: it caps the COST
   * regardless of how the frame rate itself is responding, instead of both
   * degrading together in a feedback loop. The smoothing below still runs
   * every frame against whatever answer is cached, so motion stays exactly
   * as continuous as before — only how often the expensive question gets
   * re-asked changes, and a person's feet don't move far enough in ~90ms for
   * a slightly-stale floor answer to be visible.
   */
  private static readonly FLOOR_PROBE_INTERVAL_MS = 90;
  private lastFloorProbeAt = 0;
  private lastFloorHit: { y: number; onStair: boolean } | null = null;
  /**
   * Where the eye stood when the last probe was actually cast, and the distance
   * it must leave before the next one is allowed. The interval above caps the
   * RATE; this caps the WORK, and they are not the same gate — a throttle asks
   * "how long since last time" and answers "cast" forever to a camera that has
   * not moved a millimetre, which is what an owner capture measured this doing
   * for 9-22% of wall-clock.
   *
   * Skipping is sound because a downward ray from a fixed XZ against fixed
   * geometry has a fixed answer: nothing about the villa moves. The two things
   * that CAN change that answer without the eye moving are a storey switch
   * (FloorManager toggles `setEnabled`, and the predicate below honours it) and
   * entering first-person, and both call `invalidateFloorProbe()` — a gate that
   * can be invalidated is the difference between caching an answer and
   * assuming one.
   *
   * 1 cm: walking at ~1.4 m/s covers ~13 cm between probes, so this can only
   * ever swallow numerical drift, never a step.
   */
  private static readonly FLOOR_PROBE_MIN_MOVE = 0.01;
  private floorProbeAnchor: { x: number; z: number } | null = null;
  /**
   * The meshes a downward floor ray is allowed to hit, resolved ONCE per load
   * rather than re-decided per ray — the same correction `refreshWallOcclusion`
   * made in 2.437.0, applied to the other raycast that runs while walking.
   *
   * ⚠️ This is a MECHANICAL change and deliberately not a narrowing. The set is
   * exactly what the old inline predicate accepted (every pickable mesh, ~900,
   * NOT floorProbe's structure-only ~307), because stairs are not reliably
   * stamped `isStructure` and climbing them is what this raycast exists for.
   * What is removed is the scene walk and the per-mesh name regex, not any
   * geometry.
   *
   * Justified by measurement rather than by the plausibility argument that has
   * been wrong six times here — an owner capture (v2.452.0, one 2 s window,
   * walking down the stairs) timed BOTH mechanisms against this villa at once:
   *
   *   occlusion  rays=9/pass  occlMs=8.20    → 0.91 ms/ray  (resolved set + intersectsMesh)
   *   floor      floorRays=24 floorMs=307.60 → 12.8 ms/ray  (pickWithRay + predicate)
   *
   * Not a controlled experiment — the occlusion ray is short and `fastCheck`,
   * this one needs the NEAREST hit over 2.6 m (200 m on the fallback) — so the
   * gap will not be the full 14x. But the term 2.437.0 named, `scene.pickWithRay`
   * walking every mesh and running a regex on each, is identical in both and is
   * what this removes. `floorMs=` on the `walk:` line is how the result gets
   * checked instead of claimed.
   *
   * Only the STATIC half of the old predicate is applied here (name, marker
   * flag); `isPickable`/`isVisible`/`isEnabled` are asked per ray below,
   * because FloorManager moves them and a hidden storey's slab must never be
   * the floor you are standing on.
   */
  private floorCandidates: AbstractMesh[] = [];

  /** Called by SceneManager after every model load — see `floorCandidates`. */
  setFloorCandidates(meshes: AbstractMesh[]): void {
    this.floorCandidates = meshes.filter(
      (m) => !m.metadata?.isMarker && !/^(halo_|label_)/i.test(m.name));
    this.invalidateFloorProbe();
  }

  /**
   * Floor-following: while walking, smoothly keep the eye at floor+height by
   * raycasting just below the feet. This lets you walk UP/DOWN stairs and ramps
   * (your height follows the steps) instead of staying at one fixed level.
   */
  private followFloor(): void {
    const p = this.camera.position;
    const currentFloorY = p.y - this.eyeHeight;
    const now = performance.now();

    if (now - this.lastFloorProbeAt >= CameraController.FLOOR_PROBE_INTERVAL_MS) {
      this.lastFloorProbeAt = now;
      // The stationary gate, INSIDE the throttle rather than in front of it, so
      // that `still` counts probe SLOTS declined and is therefore on the same
      // scale as `rays` — a per-frame count here would read as ~5x the work
      // that was actually avoided and make the instrument's two numbers
      // incomparable. The cost is that resuming from a standstill waits up to
      // one interval for its first probe, which is the same 90 ms staleness
      // walking already carries.
      const anchor = this.floorProbeAnchor;
      const eps = CameraController.FLOOR_PROBE_MIN_MOVE;
      const still = anchor !== null && this.lastFloorHit !== null
        && Math.abs(p.x - anchor.x) < eps && Math.abs(p.z - anchor.z) < eps;
      if (still) {
        // No probe. The GLIDE below still runs every frame against the cached
        // answer, exactly as it did before — only the expensive question is
        // skipped, so a walker mid-descent keeps descending while standing on
        // the spot, which is what makes this invisible rather than a behaviour
        // change.
        this.floorProbeCost.still += 1;
      } else {
        this.floorProbeAnchor = { x: p.x, z: p.z };
        // Search 1.6 m above current feet (to catch a stair step ahead) and
        // 1.0 m below (a small drop-off). Total band = 2.6 m.
        const originY = currentFloorY + 1.6;
        const probeT0 = performance.now();
        let hit = this.castFloorRay(p.x, originY, p.z, 2.6);
        if (!hit) {
          // The band missed: we walked over a drop taller than 1 m (terrace edge
          // down to the garden, a stair void) or re-entered first-person above
          // the floor. Without this fallback the early return kept the old
          // height for good — the "person floats above the ground" bug. Catch
          // the real floor however far below and glide down (MAX_STEP paces it).
          hit = this.castFloorRay(p.x, originY, p.z, 200);
        }
        // Both rays, including the fallback — which is the expensive one: 200 m
        // that hits nothing has to be tested against everything.
        this.floorProbeCost.ms += performance.now() - probeT0;
        // A miss keeps the previous lastFloorHit rather than clearing it, so one
        // unlucky probe (e.g. a momentary gap) doesn't stall the follower for a
        // whole throttle interval — it just tries again next time.
        if (hit) this.lastFloorHit = hit;
      }
    }
    if (!this.lastFloorHit) return;

    const hitFloorY = this.lastFloorHit.y;
    const stepUp = hitFloorY - currentFloorY;
    const onStair = this.lastFloorHit.onStair;

    // On stairs we always follow the surface (that's how you climb). Off stairs,
    // ignore surfaces that read like furniture tops: a hit higher than the
    // capsule's step clearance (STEP_CLEAR) but below head height is a
    // chair/table/bed — skip it so you don't involuntarily climb onto furniture.
    // (Anything at/under STEP_CLEAR doesn't collide either, so steps stay walkable.)
    if (!onStair && stepUp > CameraController.STEP_CLEAR && stepUp < 1.6) return;

    // Clamp the per-frame vertical change so a sudden tall hit can't snap the
    // eye (which feels like teleporting/juddering); stairs rise gradually but we
    // keep the follow brisk so climbing doesn't lag behind your feet.
    const targetY = hitFloorY + this.eyeHeight;
    const delta = (targetY - this.camera.position.y) * 0.5; // smooth follow
    const MAX_STEP = 0.25; // metres per frame
    this.camera.position.y += clamp(delta, -MAX_STEP, MAX_STEP);
  }

  /**
   * One downward ray against the resolved candidate set — see `floorCandidates`
   * for why this is not `scene.pickWithRay`, and for the capture that measured
   * the difference.
   *
   * `fastCheck: false` because the question here IS "what is nearest": the
   * follower's furniture rejection compares the hit height against the step
   * clearance, so a first-found tabletop instead of the floor under it would
   * read as a step-up and stall the walker. The occlusion sweep can use
   * fastCheck precisely because its question is only "is anything in the way".
   *
   * The `length` clamp is explicit rather than left to `ray.length`. Babylon
   * applies that to the bounding-box rejection, and the 2.6 m band vs the 200 m
   * fallback is the whole reason two rays exist — a hit past the band leaking
   * into the first cast would silently delete the fallback's meaning.
   */
  private readonly floorRay = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 2.6);

  private castFloorRay(
    x: number, y: number, z: number, length: number,
  ): { y: number; onStair: boolean } | null {
    this.floorProbeCost.rays += 1;
    this.floorRay.origin.set(x, y, z);
    this.floorRay.direction.set(0, -1, 0);
    this.floorRay.length = length;
    let bestDist = Infinity;
    let best: { y: number; onStair: boolean } | null = null;
    for (const m of this.floorCandidates) {
      // The DYNAMIC half of the old predicate, asked per ray because
      // FloorManager moves it: isEnabled() matters because upper storeys are
      // hidden with setEnabled(false), not isVisible, and without it the
      // follower snaps onto a hidden floor's slab above you.
      if (!m.isPickable || !m.isVisible || !m.isEnabled()) continue;
      const info = this.floorRay.intersectsMesh(m, false);
      if (!info.hit || !info.pickedPoint || info.distance > length) continue;
      if (info.distance < bestDist) {
        bestDist = info.distance;
        best = { y: info.pickedPoint.y, onStair: m.metadata?.isStair === true };
      }
    }
    return best;
  }

  /**
   * "The floor under this exact spot may have changed." The stationary gate in
   * `followFloor` caches an answer, and every cache in this app that went wrong
   * went wrong by having no way to be told it was stale. Two callers, both in
   * SceneManager: a storey switch (FloorManager `setEnabled`s a different slab
   * under a walker who has not moved) and entering first-person (the eye was
   * last placed by the overview camera, so any anchor is from another pose).
   */
  invalidateFloorProbe(): void {
    this.floorProbeAnchor = null;
    this.lastFloorProbeAt = 0;
  }

  groundCamera(): void {
    const p = this.camera.position;
    // isEnabled() so we never ground on a HIDDEN upper floor (FloorManager
    // disables storeys above the active one) — that slab sits right over the
    // staircase and would otherwise teleport the spawn up onto the 2nd floor.
    const base = (m: AbstractMesh) =>
      m.isPickable && m.isVisible && m.isEnabled() && !/^(halo_|label_)/i.test(m.name) && !m.metadata?.isMarker;
    // Prefer the STRUCTURAL shell (floor slabs) so we land on the actual floor,
    // never on a table/bed/sofa top the generic ray would hit first ("landing
    // above an asset"). Fall back to any surface for GLBs without tagged structure.
    const structural = (m: AbstractMesh) => base(m) && m.metadata?.isStructure === true;

    // Try directly below, then a ring of nearby points, in case the exact spot is
    // over a gap (doorway, L-shaped notch). Cast from high above to catch any floor.
    const offsets: Array<[number, number]> = [
      [0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [1.2, 1.2], [-1.2, -1.2],
    ];
    const probe = (pred: (m: AbstractMesh) => boolean): number | null => {
      for (const [dx, dz] of offsets) {
        const origin = new Vector3(p.x + dx, p.y + 20, p.z + dz);
        const hit = this.scene.pickWithRay(new Ray(origin, new Vector3(0, -1, 0), 200), pred);
        if (hit?.hit && hit.pickedPoint) return hit.pickedPoint.y;
      }
      return null;
    };
    let floorY = probe(structural);
    if (floorY === null) floorY = probe(base);
    if (floorY === null) {
      console.warn("[Villa] no floor found under camera; defaulting floor=0");
      floorY = 0;
    }
    this.camera.position.y = floorY + this.eyeHeight;
    this.cb.onActivity();
  }

  /** Change standing height live (from Settings). */
  setEyeHeight(h: number): void {
    this.eyeHeight = h;
    this.updateEllipsoid(); // keep the collision capsule clearing steps at the new height
    this.groundCamera();
  }

  /** Change walk-speed multiplier live (from Settings). */
  setWalkSpeed(v: number): void {
    this.walkSpeed = v;
  }

  /** Called by the React VirtualJoystick. x/y in -1..1. */
  setMovement(x: number, y: number): void {
    this.moveX = Math.max(-1, Math.min(1, x));
    this.moveY = Math.max(-1, Math.min(1, y));
    // Wake the on-demand render loop so movement is actually drawn. Once awake,
    // step() keeps requesting frames while there's input.
    this.cb.onActivity();
  }

  // ── Anti-stuck escape ─────────────────────────────────────────────────────
  // If movement is requested but the camera makes no progress for a while, it's
  // wedged (classically: mid-staircase against a riser/railing/ceiling). Briefly
  // drop collisions so a push frees you, then snap them back. Never traps you.
  private requestedMove = false;
  private stuckFrames = 0;
  private unstickCooldown = 0;
  private prevStepPos = new Vector3();

  private antiStuck(): void {
    if (this.unstickCooldown > 0) {
      if (--this.unstickCooldown === 0) this.camera.checkCollisions = true;
      this.prevStepPos.copyFrom(this.camera.position);
      return;
    }
    const pos = this.camera.position;
    const moved = Math.hypot(pos.x - this.prevStepPos.x, pos.z - this.prevStepPos.z);
    this.prevStepPos.copyFrom(pos);
    if (this.requestedMove && moved < 0.004) {
      if (++this.stuckFrames > 18) {
        this.camera.checkCollisions = false; // slip out of the wedge for a few frames
        this.unstickCooldown = 10;
        this.stuckFrames = 0;
      }
    } else {
      this.stuckFrames = 0;
    }
  }

  private step(): void {
    // Evaluate last frame's progress, then reset the flag for this frame.
    this.antiStuck();
    this.requestedMove = false;

    // Keep frames coming during a teleport animation too.
    if (this.animating) this.cb.onActivity();

    // --- Look via keys: A/D and left/right turn; Shift+up/down also tilts ---
    let yaw = (this.keys.has("turnRight") ? 1 : 0) - (this.keys.has("turnLeft") ? 1 : 0);
    let pitch = 0;
    if (this.shift) {
      pitch += (this.keys.has("back") ? 1 : 0) - (this.keys.has("fwd") ? 1 : 0);
    }
    if (yaw !== 0 || pitch !== 0) {
      this.camera.rotation.y += yaw * 0.03;
      this.camera.rotation.x = clamp(this.camera.rotation.x + pitch * 0.03, -1.4, 1.4);
      this.cb.onActivity();
    }

    // --- Move: joystick + W/S (forward/back) and Q/E (sidestep) ---
    const kbX = this.shift ? 0 : (this.keys.has("right") ? 1 : 0) - (this.keys.has("left") ? 1 : 0);
    const kbY = this.shift ? 0 : (this.keys.has("fwd") ? 1 : 0) - (this.keys.has("back") ? 1 : 0);
    const mx = Math.max(-1, Math.min(1, this.moveX + kbX));
    const my = Math.max(-1, Math.min(1, this.moveY + kbY));

    if (mx !== 0 || my !== 0) {
      this.requestedMove = true;
      this.autoTarget = null; // manual input cancels click-to-walk
      const forward = this.camera.getDirection(Axis.Z);
      const right = this.camera.getDirection(Axis.X);
      forward.y = 0; right.y = 0;
      forward.normalize(); right.normalize();
      const speed = WALK_SPEED * this.walkSpeed * this.frameFactor();
      const move = forward.scale(my * speed).add(right.scale(mx * speed));
      move.y = 0;
      this.camera.cameraDirection.addInPlace(move);
      this.followFloor();
      this.cb.onActivity();
      this.updateRoom();
      return;
    }

    // --- Click-to-walk: drive toward the target through collisions ---
    if (this.autoTarget) this.driveAuto();
  }

  /** Move toward autoTarget using collision-resolved motion; stop when close or stuck. */
  private driveAuto(): void {
    const pos = this.camera.position;
    const dx = this.autoTarget!.x - pos.x;
    const dz = this.autoTarget!.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) {
      this.autoTarget = null;
      this.groundCamera();
      this.updateRoom();
      return;
    }
    // Stuck against a wall? Stop after a few frames of no progress.
    if (this.lastAutoPos) {
      const moved = Math.hypot(pos.x - this.lastAutoPos.x, pos.z - this.lastAutoPos.z);
      if (moved < 0.004) {
        if (++this.autoStuck > 12) {
          this.autoTarget = null;
          this.autoStuck = 0;
          return;
        }
      } else {
        this.autoStuck = 0;
      }
    }
    this.lastAutoPos = { x: pos.x, z: pos.z };

    this.requestedMove = true;
    const speed = WALK_SPEED * this.walkSpeed * 1.6 * this.frameFactor();
    const inv = 1 / dist;
    this.camera.cameraDirection.addInPlace(new Vector3(dx * inv * speed, 0, dz * inv * speed));
    this.followFloor();
    this.cb.onActivity();
    this.updateRoom();
  }

  /** Set the (model-space) room polygons used for point-in-polygon labelling.
   *  `floorY` is defaulted HERE rather than at each read: `updateRoom` runs on
   *  every frame of a walk and must not allocate a normalised copy per frame. */
  setRoomPolygons(polys: Array<{ name: string; pts: Pt2[]; floorY?: number }>): void {
    this.roomPolygons = polys.map((p) => ({ ...p, floorY: p.floorY ?? 0 }));
  }

  /** World-space XZ bounding box (plus the room's floor height) of a real
   *  drawn room polygon by name, or null if this room has none (e.g. a
   *  point-only teleport spot like a staircase landing — see RoomHighlight's
   *  two-source split). Used to dynamically frame a room's own true
   *  dimensions rather than whatever radius happened to be saved with its
   *  teleport point. Matched case/whitespace-insensitively: polygon names
   *  come from the floor plan and teleport-point names from config, and a
   *  silent mismatch here would look exactly like "zoom-to-room is broken". */
  getRoomBounds(
    name: string,
  ): { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number } | null {
    const key = roomKey(name);
    // ⚠️ BY NAME ALONE, ACROSS STOREYS — deliberately not converged onto the
    // storey rule `updateRoom` uses, and recorded here so the next audit does
    // not flag it as an oversight. A name is all a caller gives us: this is
    // reached from "frame the room the user picked", which arrives as a string.
    // The storey test needs a HEIGHT, and there is none to pass.
    //
    // The consequence is real but latent: a villa with a "Bathroom" upstairs
    // AND down has two polygons under one key, and this takes the first. That
    // is the by-NAME twin of the by-POSITION defect fixed in 2.434.0-2.437.0,
    // and it is not a one-line fix — room identity is the name in `roomKey`,
    // in RoomHighlight's two maps, in `roomClustered`, in `resolvedRooms` and
    // in the teleport points. Changing it is a design change to what a room IS.
    // Fix it the day a plan with duplicate room names is reported, not before.
    const poly = this.roomPolygons.find((r) => roomKey(r.name) === key);
    if (!poly || poly.pts.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    return { minX, maxX, minZ, maxZ, floorY: poly.floorY ?? 0 };
  }

  private updateRoom(): void {
    let room: string | null = null;

    // Preferred: which actual room polygon am I standing in?
    //
    // ⚠️ ON MY OWN STOREY (2.437.0). A room polygon is a flat outline with no
    // height, so on a two-storey villa the upper storey's outlines lie directly
    // over the lower one's and a bare containment test answers with whichever
    // was listed first — the load order of `.rooms.json`. Standing in the
    // ground-floor kitchen, the walk-in banner read "Tearrace 2F". Same defect,
    // same fix as the light pools (see roomStorey.ts); this reader was missed
    // when that rule was rolled out, which is what the dry-audit skill exists
    // to catch.
    //
    // ⚠️ AND VIA THE FEET, not the eye-and-clearance rule a FIXTURE needs —
    // see `nearestFloorRoom`. Reusing the fixture rule here cost a release: a
    // walker knows exactly which floor it is on (its feet are on it), while
    // that rule has to guess from a mounting height and so works from "the
    // highest floor a clearance BELOW the point". This villa reports three
    // distinct room floor heights; a group partway up beat the ground floor on
    // that test, every ground-floor room was filtered out, and the banner
    // showed NOTHING AT ALL. Nearest-floor always returns one of the rooms
    // that contain the point, so this reader can never lose a name it had.
    if (this.roomPolygons.length > 0) {
      const px = this.camera.position.x;
      const pz = this.camera.position.z;
      // The predicate is a FIELD, not an arrow written here: this runs on every
      // frame of a walk, and a closure per frame is the kind of steady-state
      // garbage the rest of this app pools specifically to avoid.
      this.hitX = px;
      this.hitZ = pz;
      room = nearestFloorRoom(this.roomPolygons, this.getFeetY(), this.roomHitTest)?.name ?? null;
    } else if (this.roomAnchors.length > 0) {
      // Fallback: nearest anchor within ~3.5 m.
      let best = Infinity;
      let nearest: RoomAnchor | null = null;
      for (const a of this.roomAnchors) {
        const d = Vector3.DistanceSquared(this.camera.position, a.position);
        if (d < best) {
          best = d;
          nearest = a;
        }
      }
      room = nearest && best < 3.5 * 3.5 ? nearest.name : null;
    }

    if (room !== this.currentRoom) {
      this.currentRoom = room;
      this.cb.onRoomChange(room);
    }
  }

  /**
   * Build room anchors for proximity labelling. Prefer invisible
   * `teleport_*` meshes baked into the GLB; otherwise fall back to the
   * configured TeleportPoints.
   */
  indexTeleportAnchors(meshes: AbstractMesh[]): void {
    const fromMesh: RoomAnchor[] = [];
    for (const m of meshes) {
      if (/^teleport_/i.test(m.name)) {
        const pretty = m.name
          .replace(/^teleport_/i, "")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        fromMesh.push({ name: pretty, position: m.getAbsolutePosition().clone() });
        m.isVisible = false;
        m.isPickable = false;
      }
    }
    this.roomAnchors =
      fromMesh.length > 0
        ? fromMesh
        : this.config.teleportPoints
            .filter((p) => p.floor === this.config.currentFloor)
            .map((p) => ({ name: p.name, position: new Vector3(p.position.x, p.position.y, p.position.z) }));
  }

  /** Replace room anchors from a set of (already model-space) teleport points. */
  setTeleportPoints(points: TeleportPoint[]): void {
    this.roomAnchors = points
      .filter((p) => p.floor === this.config.currentFloor)
      .map((p) => ({ name: p.name, position: new Vector3(p.position.x, p.position.y, p.position.z) }));
  }

  /** Smoothly move (or instantly jump) to a teleport point. */
  teleport(point: TeleportPoint, instant = false): void {
    const dest = new Vector3(point.position.x, point.position.y, point.position.z);
    const lookAt = new Vector3(point.target.x, point.target.y, point.target.z);

    if (instant) {
      this.camera.position.copyFrom(dest);
      this.camera.setTarget(lookAt);
      this.groundCamera(); // stand on the real floor at eye height
      this.currentRoom = point.name;
      this.cb.onRoomChange(point.name);
      return;
    }

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const posAnim = new Animation(
      "teleportPos", "position", 60,
      Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    posAnim.setKeys([
      { frame: 0, value: this.camera.position.clone() },
      { frame: 30, value: dest },
    ]);
    posAnim.setEasingFunction(ease);

    this.animating = true;
    this.cb.onActivity();
    // Re-aim while we glide so arrival faces the room.
    this.camera.setTarget(lookAt);
    this.scene.beginDirectAnimation(this.camera, [posAnim], 0, 30, false, 1, () => {
      this.animating = false;
      this.groundCamera(); // settle to floor + eye height on arrival
      this.currentRoom = point.name;
      this.cb.onRoomChange(point.name);
    });
  }

  /** Nudge the camera up/down a floor (used by FloorManager). */
  setElevation(y: number): void {
    this.camera.position.y = y;
    this.cb.onActivity();
  }

  isAnimating(): boolean {
    return this.animating;
  }

  getPosition(): Vector3 {
    return this.camera.position;
  }

  /** Current standing (eye) height above the floor. */
  getEyeHeight(): number {
    return this.eyeHeight;
  }

  /** World Y of the camera's FEET (floor it's standing on) — eye minus height.
   *  Lets the FloorManager derive which storey the walker is on from elevation
   *  when the GLB has no explicit stair-trigger meshes. */
  getFeetY(): number {
    return this.camera.position.y - this.eyeHeight;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    if (config.eyeHeight && config.eyeHeight !== this.eyeHeight) {
      this.setEyeHeight(config.eyeHeight);
    }
    if (config.walkSpeed) this.walkSpeed = config.walkSpeed;
  }
}
