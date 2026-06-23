// src/babylon/CameraController.ts
// First-person walk + teleport. Translation is driven manually (so it works the
// same from the React virtual joystick and from WASD), with gravity + collision
// handled via moveWithCollisions each frame. Look-around uses Babylon's built-in
// touch/mouse rotation.

import {
  UniversalCamera, Vector3, Animation, CubicEase, EasingFunction, Axis, Ray,
  type Scene, type AbstractMesh,
} from "@babylonjs/core";
import type { AppConfig } from "@/config/AppConfig";
import type { TeleportPoint } from "@/types/scene.types";
import { pointInPolygon, type Pt2 } from "@/utils/geometry";

interface CameraCallbacks {
  onRoomChange: (room: string | null) => void;
  onActivity: () => void;
  /** A clean single-finger / single-click tap at the given client coords.
   * The camera owns the only reliable pointer pipeline (it holds the pointer
   * capture), so tap-to-pick is detected here rather than via a second
   * scene.onPointerObservable listener that touch events race against. */
  onTap?: (clientX: number, clientY: number) => void;
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
  private roomPolygons: Array<{ name: string; pts: Pt2[] }> = [];
  private currentRoom: string | null = null;
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

    // Unified pointer input (works for mouse, pen and touch):
    //   • mouse drag / one finger drag  = look around
    //   • two fingers drag              = walk (up=forward, sideways=strafe)
    //   • double-tap / double-click     = walk to that spot
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerUp);
    // Two-finger trackpad swipe (and mouse wheel) = walk. A swipe emits a stream
    // of wheel events: up = forward, down = back, sideways = strafe.
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    // Arrow keys + WASD = walk.
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);

    scene.registerBeforeRender(() => this.step());
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
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private pinchDist = 0; // current separation between two touch pointers (px)
  private static readonly LOOK_SENS = 0.004; // rad per px

  // ── Single-tap detection (drives tap-to-pick) ──
  // A gesture is a tap if it stayed one pointer, barely moved, and was brief.
  private tapCandidate = false;
  private tapStartX = 0;
  private tapStartY = 0;
  private tapStartT = 0;
  private static readonly TAP_MOVE_TOL = 14; // px — generous for fat-finger touch
  private static readonly TAP_TIME = 400; // ms

  private onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

    // Begin a tap candidate on the first pointer; a second pointer (multi-touch
    // gesture) cancels it so a pinch/two-finger walk never fires a pick.
    if (this.pointers.size === 1) {
      this.tapCandidate = true;
      this.tapStartX = e.clientX;
      this.tapStartY = e.clientY;
      this.tapStartT = performance.now();
    } else {
      this.tapCandidate = false;
    }

    // Double-tap / double-click → walk to the tapped spot. Only on a fresh touch
    // (first finger) or a mouse press, so a two-finger walk doesn't trigger it.
    const touches = this.touchCount();
    if (e.pointerType !== "touch" || touches === 1) {
      const now = performance.now();
      const near = Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY) < 30;
      if (now - this.lastTapTime < 320 && near) {
        this.walkToScreen(e.clientX, e.clientY);
        this.lastTapTime = 0;
      } else {
        this.lastTapTime = now;
        this.lastTapX = e.clientX;
        this.lastTapY = e.clientY;
      }
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
    if (this.tapCandidate &&
        Math.hypot(e.clientX - this.tapStartX, e.clientY - this.tapStartY) > CameraController.TAP_MOVE_TOL) {
      this.tapCandidate = false;
    }

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

    // Fire a tap (→ entity pick) only if this was the last pointer up, the
    // gesture stayed a tap throughout, and it was brief. pointercancel/leave
    // also route here, so a candelled gesture won't mis-fire (tapCandidate
    // would have been reset or the move tolerance exceeded).
    if (this.tapCandidate &&
        this.pointers.size === 0 &&
        performance.now() - this.tapStartT < CameraController.TAP_TIME) {
      this.cb.onTap?.(e.clientX, e.clientY);
    }
    this.tapCandidate = false;
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
      (m) => m.isPickable && m.isVisible && !m.metadata?.isMarker && !/^(halo_|label_)/i.test(m.name),
    );
    if (pick?.hit && pick.pickedPoint) this.walkTo(pick.pickedPoint.x, pick.pickedPoint.z);
  }

  private keys = new Set<string>();

  private onKey = (e: KeyboardEvent): void => {
    this.shift = e.shiftKey;
    const map: Record<string, string> = {
      ArrowUp: "fwd", KeyW: "fwd", ArrowDown: "back", KeyS: "back",
      ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
      KeyQ: "turnLeft", KeyE: "turnRight",
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
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
  }

  /**
   * Drop the eye onto the real floor beneath it: raycast straight down and set
   * the camera Y to floorY + eyeHeight. Robust to any model origin/scale.
   */
  /**
   * Floor-following: while walking, smoothly keep the eye at floor+height by
   * raycasting just below the feet. This lets you walk UP/DOWN stairs and ramps
   * (your height follows the steps) instead of staying at one fixed level.
   */
  private followFloor(): void {
    const p = this.camera.position;
    const currentFloorY = p.y - this.eyeHeight;
    // Search 1.6 m above current feet (to catch a stair step ahead) and
    // 1.0 m below (a small drop-off). Total band = 2.6 m.
    const originY = currentFloorY + 1.6;
    const hit = this.scene.pickWithRay(
      new Ray(new Vector3(p.x, originY, p.z), new Vector3(0, -1, 0), 2.6),
      (m) => m.isPickable && m.isVisible && !m.metadata?.isMarker && !/^(halo_|label_)/i.test(m.name),
    );
    if (!hit?.hit || !hit.pickedPoint) return;

    const hitFloorY = hit.pickedPoint.y;
    const stepUp = hitFloorY - currentFloorY;
    const onStair = hit.pickedMesh?.metadata?.isStair === true;

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

  groundCamera(): void {
    const p = this.camera.position;
    const predicate = (m: AbstractMesh) =>
      m.isPickable && m.isVisible && !/^(halo_|label_)/i.test(m.name) && !m.metadata?.isMarker;

    // Try directly below, then a ring of nearby points, in case the exact spot is
    // over a gap (doorway, L-shaped notch). Cast from high above to catch any floor.
    const offsets: Array<[number, number]> = [
      [0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [1.2, 1.2], [-1.2, -1.2],
    ];
    let floorY: number | null = null;
    for (const [dx, dz] of offsets) {
      const origin = new Vector3(p.x + dx, p.y + 20, p.z + dz);
      const hit = this.scene.pickWithRay(new Ray(origin, new Vector3(0, -1, 0), 200), predicate);
      if (hit?.hit && hit.pickedPoint) {
        floorY = hit.pickedPoint.y;
        break;
      }
    }
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

    // --- Look via keys: Q/E always turn; Shift+arrows turn + tilt ---
    let yaw = (this.keys.has("turnRight") ? 1 : 0) - (this.keys.has("turnLeft") ? 1 : 0);
    let pitch = 0;
    if (this.shift) {
      yaw += (this.keys.has("right") ? 1 : 0) - (this.keys.has("left") ? 1 : 0);
      pitch += (this.keys.has("back") ? 1 : 0) - (this.keys.has("fwd") ? 1 : 0);
    }
    if (yaw !== 0 || pitch !== 0) {
      this.camera.rotation.y += yaw * 0.03;
      this.camera.rotation.x = clamp(this.camera.rotation.x + pitch * 0.03, -1.4, 1.4);
      this.cb.onActivity();
    }

    // --- Move: joystick + arrows/WASD (suppressed while Shift = look) ---
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
      const speed = WALK_SPEED * this.walkSpeed;
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
    const speed = WALK_SPEED * this.walkSpeed * 1.6;
    const inv = 1 / dist;
    this.camera.cameraDirection.addInPlace(new Vector3(dx * inv * speed, 0, dz * inv * speed));
    this.followFloor();
    this.cb.onActivity();
    this.updateRoom();
  }

  /** Set the (model-space) room polygons used for point-in-polygon labelling. */
  setRoomPolygons(polys: Array<{ name: string; pts: Pt2[] }>): void {
    this.roomPolygons = polys;
  }

  private updateRoom(): void {
    let room: string | null = null;

    // Preferred: which actual room polygon am I standing in?
    if (this.roomPolygons.length > 0) {
      const px = this.camera.position.x;
      const pz = this.camera.position.z;
      for (const r of this.roomPolygons) {
        if (pointInPolygon(px, pz, r.pts)) {
          room = r.name;
          break;
        }
      }
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

  updateConfig(config: AppConfig): void {
    this.config = config;
    if (config.eyeHeight && config.eyeHeight !== this.eyeHeight) {
      this.setEyeHeight(config.eyeHeight);
    }
    if (config.walkSpeed) this.walkSpeed = config.walkSpeed;
  }
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
