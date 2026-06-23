// src/babylon/OverviewController.ts
// Bird's-eye "overview" camera: float above the plan and look down at the whole
// house. A second way to use the UI alongside first-person walking — pan across
// the plan, zoom, tilt the inclination, and tap entities to control them.
//
// Like CameraController, ALL input is driven manually from our own canvas
// pointer listeners (no Babylon attachControl), and the listeners are attached
// only while this mode is active. That keeps a single owner of the pointer
// pipeline at any time, so there's no setPointerCapture race and tap-to-pick
// stays reliable on touch.
//
//   • one finger drag / left-mouse drag  = pan across the plan
//   • two-finger pinch                   = zoom in / out
//   • two-finger vertical drag           = change inclination (tilt)
//   • two-finger twist                   = rotate heading
//   • mouse wheel                        = zoom; Shift+wheel = rotate/tilt
//   • clean tap / click                  = pick the entity under it

import {
  ArcRotateCamera, Vector3, type Scene,
} from "@babylonjs/core";

interface OverviewCallbacks {
  onActivity: () => void;
  /** A clean single-finger / single-click tap at the given client coords. */
  onTap?: (clientX: number, clientY: number) => void;
}

interface Bounds {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  floorY: number;
}

export class OverviewController {
  readonly camera: ArcRotateCamera;
  private canvas: HTMLCanvasElement;
  private cb: OverviewCallbacks;
  private attached = false;

  /** Pan limits (house footprint + margin), set by fitTo(). */
  private bounds: Bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20, floorY: 0 };

  // Tilt range: ~3° off straight-down up to ~80° (near the horizon).
  private static readonly BETA_MIN = 0.05;
  private static readonly BETA_MAX = 1.4;

  constructor(scene: Scene, canvas: HTMLCanvasElement, cb: OverviewCallbacks) {
    this.canvas = canvas;
    this.cb = cb;

    this.camera = new ArcRotateCamera(
      "overviewCamera",
      -Math.PI / 2,   // alpha (heading)
      0.5,            // beta (inclination from straight-down)
      30,             // radius (zoom)
      Vector3.Zero(),
      scene,
    );
    this.camera.minZ = 0.1;
    this.camera.fov = 0.8;
    this.camera.lowerBetaLimit = OverviewController.BETA_MIN;
    this.camera.upperBetaLimit = OverviewController.BETA_MAX;
    this.camera.lowerRadiusLimit = 3;
    this.camera.upperRadiusLimit = 200;
    // We never call attachControl — input is fully manual (see handlers below).
  }

  /** Frame the whole house: centre the target, pick a radius that fits it. */
  fitTo(ext: { min: Vector3; max: Vector3 }): void {
    const cx = (ext.min.x + ext.max.x) / 2;
    const cz = (ext.min.z + ext.max.z) / 2;
    const width = ext.max.x - ext.min.x;
    const depth = ext.max.z - ext.min.z;
    const span = Math.max(width, depth, 4);

    this.bounds = {
      minX: ext.min.x - span * 0.25, maxX: ext.max.x + span * 0.25,
      minZ: ext.min.z - span * 0.25, maxZ: ext.max.z + span * 0.25,
      floorY: ext.min.y,
    };

    this.camera.lowerRadiusLimit = Math.max(2, span * 0.08);
    this.camera.upperRadiusLimit = span * 2.2;
    this.camera.setTarget(new Vector3(cx, ext.min.y + 1, cz));
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.5;
    this.camera.radius = span * 1.05;
    this.cb.onActivity();
  }

  enable(): void {
    if (this.attached) return;
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.attached = true;
  }

  disable(): void {
    if (!this.attached) return;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.pointers.clear();
    this.attached = false;
  }

  dispose(): void {
    this.disable();
  }

  // ── Manual pointer input ──────────────────────────────────────────────────
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private pinchDist = 0;
  private twoFingerCentroidY = 0;
  private twoFingerAngle = 0;

  // Single-tap detection (drives tap-to-pick).
  private tapCandidate = false;
  private tapStartX = 0;
  private tapStartY = 0;
  private tapStartT = 0;
  private static readonly TAP_MOVE_TOL = 14;
  private static readonly TAP_TIME = 400;

  private onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

    if (this.pointers.size === 1) {
      this.tapCandidate = true;
      this.tapStartX = e.clientX;
      this.tapStartY = e.clientY;
      this.tapStartT = performance.now();
    } else {
      this.tapCandidate = false;
      // (Re)seed the two-finger gesture baselines.
      this.seedTwoFinger();
    }
    this.cb.onActivity();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return; // mouse moving with no button held → ignore
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    e.preventDefault();

    if (this.tapCandidate &&
        Math.hypot(e.clientX - this.tapStartX, e.clientY - this.tapStartY) > OverviewController.TAP_MOVE_TOL) {
      this.tapCandidate = false;
    }

    const touchCount = this.touchCount();
    if (touchCount >= 2 || this.pointers.size >= 2) {
      this.handleTwoFinger();
    } else {
      // One finger / left-mouse drag = pan across the plan.
      this.pan(dx, dy);
    }
    this.cb.onActivity();
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.pointers.size < 2) {
      this.pinchDist = 0;
    } else {
      this.seedTwoFinger();
    }

    if (this.tapCandidate &&
        this.pointers.size === 0 &&
        performance.now() - this.tapStartT < OverviewController.TAP_TIME) {
      this.cb.onTap?.(e.clientX, e.clientY);
    }
    this.tapCandidate = false;
  };

  private touchCount(): number {
    let n = 0;
    for (const p of this.pointers.values()) if (p.type === "touch") n++;
    return n;
  }

  /** Snapshot the current two-pointer separation / centroid / angle. */
  private seedTwoFinger(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    this.twoFingerCentroidY = (a.y + b.y) / 2;
    this.twoFingerAngle = Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** Two fingers: pinch → zoom, vertical centroid → tilt, twist → heading. */
  private handleTwoFinger(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;

    // Pinch → zoom (spread fingers = zoom in = smaller radius).
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (this.pinchDist > 0) {
      const delta = dist - this.pinchDist;
      this.zoom(delta * 0.01 * this.camera.radius * 0.12);
    }
    this.pinchDist = dist;

    // Vertical centroid movement → inclination (tilt).
    const centroidY = (a.y + b.y) / 2;
    const dCentroidY = centroidY - this.twoFingerCentroidY;
    this.twoFingerCentroidY = centroidY;
    this.tilt(dCentroidY * 0.004); // drag down → toward horizon

    // Twist → heading (rotate around the target).
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    let dAngle = angle - this.twoFingerAngle;
    if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
    if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
    this.twoFingerAngle = angle;
    this.camera.alpha += dAngle;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift+wheel = rotate heading + tilt.
      this.camera.alpha += e.deltaX * 0.0025;
      this.tilt(e.deltaY * 0.0015);
      this.cb.onActivity();
      return;
    }
    this.zoom(-e.deltaY * 0.0015 * this.camera.radius);
    this.cb.onActivity();
  };

  /** Pan the look-at target across the ground plane, clamped to the footprint. */
  private pan(dx: number, dy: number): void {
    const pos = this.camera.position;
    const tgt = this.camera.target;
    // Ground-projected forward (camera → target) and right vectors.
    let fwd = new Vector3(tgt.x - pos.x, 0, tgt.z - pos.z);
    if (fwd.lengthSquared() < 1e-6) fwd = new Vector3(0, 0, 1);
    fwd.normalize();
    const right = new Vector3(-fwd.z, 0, fwd.x);

    // Pan speed scales with zoom so it feels consistent at any radius.
    const k = this.camera.radius * 0.0016;
    const nx = tgt.x + (-right.x * dx + fwd.x * dy) * k;
    const nz = tgt.z + (-right.z * dx + fwd.z * dy) * k;
    tgt.x = clamp(nx, this.bounds.minX, this.bounds.maxX);
    tgt.z = clamp(nz, this.bounds.minZ, this.bounds.maxZ);
    this.camera.setTarget(tgt);
  }

  private zoom(delta: number): void {
    this.camera.radius = clamp(
      this.camera.radius - delta,
      this.camera.lowerRadiusLimit ?? 2,
      this.camera.upperRadiusLimit ?? 200,
    );
  }

  private tilt(delta: number): void {
    this.camera.beta = clamp(
      this.camera.beta + delta,
      OverviewController.BETA_MIN,
      OverviewController.BETA_MAX,
    );
  }
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
