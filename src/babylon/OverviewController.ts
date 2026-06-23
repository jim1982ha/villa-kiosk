// src/babylon/OverviewController.ts
// Bird's-eye overview camera with Google Earth-style gesture controls.
//
// ── Gesture map ──────────────────────────────────────────────────────────────
//
//  TRACKPAD (WheelEvent — the browser converts trackpad gestures):
//    2-finger slide          → pan   (deltaX/Y, no modifier key)
//    pinch / spread          → zoom  (deltaY, ctrlKey=true — browser does this)
//    Shift + 2-finger slide  → tilt (Y) + rotate heading (X)
//
//  TOUCHSCREEN / MOUSE (PointerEvent):
//    1 pointer drag          → pan
//    2 pointer pinch/spread  → zoom
//    2 pointer twist         → rotate heading (bearing)
//    2 pointer vertical slide (stable distance) → tilt (pitch)
//
//  TAP (touch or left-click, brief, no movement) → pick entity
//
// Natural scrolling flag: when true the map follows the finger/scroll direction;
// when false the view moves opposite (traditional). Applied uniformly to both
// pointer drag and wheel events so the in-app toggle matches user expectation
// regardless of the OS-level natural scrolling setting.

import { ArcRotateCamera, Vector3, type Scene } from "@babylonjs/core";

interface OverviewCallbacks {
  onActivity: () => void;
  onTap?: (clientX: number, clientY: number) => void;
}

interface Bounds {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
}

// Sensitivity constants
const DRAG_SENS       = 0.0016; // world-units per pixel × radius (pointer pan)
const WHEEL_PAN_SENS  = 0.0006; // lower: trackpad wheel deltas are larger in magnitude
const WHEEL_ZOOM_SENS = 0.006;  // per normalised wheel pixel
const TILT_SENS_TOUCH = 0.005;  // radians per pixel (two-finger centroid drag)
const TILT_SENS_WHEEL = 0.003;  // radians per normalised wheel pixel
const ROT_SENS_WHEEL  = 0.003;  // radians per normalised wheel pixel

export class OverviewController {
  readonly camera: ArcRotateCamera;
  private canvas: HTMLCanvasElement;
  private cb: OverviewCallbacks;
  private attached = false;
  private naturalScrolling = true;
  private bounds: Bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };

  private static readonly BETA_MIN = 0.05; // ~3° from straight down
  private static readonly BETA_MAX = 1.4;  // ~80° (near horizon)

  constructor(scene: Scene, canvas: HTMLCanvasElement, cb: OverviewCallbacks) {
    this.canvas = canvas;
    this.cb = cb;

    this.camera = new ArcRotateCamera(
      "overviewCamera", -Math.PI / 2, 0.5, 30, Vector3.Zero(), scene,
    );
    this.camera.minZ = 0.1;
    this.camera.fov = 0.8;
    this.camera.lowerBetaLimit = OverviewController.BETA_MIN;
    this.camera.upperBetaLimit = OverviewController.BETA_MAX;
    this.camera.lowerRadiusLimit = 3;
    this.camera.upperRadiusLimit = 200;
    // Input is fully manual — we never call attachControl.
  }

  setNaturalScrolling(v: boolean): void { this.naturalScrolling = v; }

  fitTo(ext: { min: Vector3; max: Vector3 }): void {
    const cx = (ext.min.x + ext.max.x) / 2;
    const cz = (ext.min.z + ext.max.z) / 2;
    const span = Math.max(ext.max.x - ext.min.x, ext.max.z - ext.min.z, 4);

    this.bounds = {
      minX: ext.min.x - span * 0.25, maxX: ext.max.x + span * 0.25,
      minZ: ext.min.z - span * 0.25, maxZ: ext.max.z + span * 0.25,
    };
    this.camera.lowerRadiusLimit = Math.max(2, span * 0.08);
    this.camera.upperRadiusLimit = span * 2.2;
    this.camera.setTarget(new Vector3(cx, ext.min.y + 1, cz));
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.5;
    this.camera.radius = span * 1.05;
    this.cb.onActivity();
  }

  panTo(x: number, z: number): void {
    const tgt = this.camera.target.clone();
    tgt.x = clamp(x, this.bounds.minX, this.bounds.maxX);
    tgt.z = clamp(z, this.bounds.minZ, this.bounds.maxZ);
    this.camera.setTarget(tgt);
    this.cb.onActivity();
  }

  enable(): void {
    if (this.attached) return;
    this.canvas.addEventListener("pointerdown",  this.onPointerDown);
    this.canvas.addEventListener("pointermove",  this.onPointerMove);
    this.canvas.addEventListener("pointerup",    this.onPointerUp);
    this.canvas.addEventListener("pointercancel",this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerUp);
    this.canvas.addEventListener("wheel",        this.onWheel, { passive: false });
    this.attached = true;
  }

  disable(): void {
    if (!this.attached) return;
    this.canvas.removeEventListener("pointerdown",  this.onPointerDown);
    this.canvas.removeEventListener("pointermove",  this.onPointerMove);
    this.canvas.removeEventListener("pointerup",    this.onPointerUp);
    this.canvas.removeEventListener("pointercancel",this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    this.canvas.removeEventListener("wheel",        this.onWheel);
    this.pointers.clear();
    this.touchBase = null;
    this.attached = false;
  }

  dispose(): void { this.disable(); }

  // ── Pointer state ──────────────────────────────────────────────────────────
  private pointers = new Map<number, { x: number; y: number; type: string }>();

  // Two-finger gesture snapshot (updated incrementally on every pointermove).
  private touchBase: { dist: number; angle: number; centX: number; centY: number } | null = null;

  // Tap detection (single brief press with minimal movement → entity pick).
  private tapCandidate = false;
  private tapStartX = 0;
  private tapStartY = 0;
  private tapStartT = 0;
  private static readonly TAP_MOVE_TOL = 14; // px
  private static readonly TAP_TIME     = 400; // ms

  private onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /**/ }

    if (this.pointers.size === 1) {
      this.tapCandidate = true;
      this.tapStartX = e.clientX;
      this.tapStartY = e.clientY;
      this.tapStartT = performance.now();
      this.touchBase = null;
    } else {
      // Second (or more) finger cancels tap and seeds the two-finger baseline.
      this.tapCandidate = false;
      this.seedTouchBase();
    }
    this.cb.onActivity();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    e.preventDefault();

    if (this.tapCandidate &&
        Math.hypot(e.clientX - this.tapStartX, e.clientY - this.tapStartY) > OverviewController.TAP_MOVE_TOL) {
      this.tapCandidate = false;
    }

    const s = this.naturalScrolling ? 1 : -1;

    if (this.pointers.size >= 2) {
      // Two (or more) touch/pen pointers: zoom + rotate + tilt simultaneously.
      this.handleTwoFingerTouch();
    } else {
      // Single pointer (1-finger touch or left mouse drag): pan the map.
      this.applyPan(dx * s, dy * s, DRAG_SENS);
    }
    this.cb.onActivity();
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /**/ }

    if (this.pointers.size < 2) {
      // Fewer than 2 fingers left — reset the two-finger baseline.
      this.touchBase = null;
    } else {
      this.seedTouchBase();
    }

    if (this.tapCandidate &&
        this.pointers.size === 0 &&
        performance.now() - this.tapStartT < OverviewController.TAP_TIME) {
      this.cb.onTap?.(e.clientX, e.clientY);
    }
    this.tapCandidate = false;
  };

  // ── Two-finger touch: pinch→zoom, twist→rotate, centroid-Y→tilt ───────────
  private seedTouchBase(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    this.touchBase = {
      dist:   Math.hypot(b.x - a.x, b.y - a.y),
      angle:  Math.atan2(b.y - a.y, b.x - a.x),
      centX:  (a.x + b.x) / 2,
      centY:  (a.y + b.y) / 2,
    };
  }

  private handleTwoFingerTouch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;

    const dist   = Math.hypot(b.x - a.x, b.y - a.y);
    const angle  = Math.atan2(b.y - a.y, b.x - a.x);
    const centX  = (a.x + b.x) / 2;
    const centY  = (a.y + b.y) / 2;

    if (!this.touchBase) {
      this.touchBase = { dist, angle, centX, centY };
      return;
    }

    const base = this.touchBase;
    const s = this.naturalScrolling ? 1 : -1;

    // ── Zoom: ratio of distances (spread fingers = zoom in = smaller radius) ──
    if (base.dist > 1 && dist > 1) {
      // base.dist / dist > 1 when pinching (fingers closer) = zoom out
      this.camera.radius = clamp(
        this.camera.radius * (base.dist / dist),
        this.camera.lowerRadiusLimit ?? 2,
        this.camera.upperRadiusLimit ?? 200,
      );
    }

    // ── Rotation: incremental twist angle ─────────────────────────────────────
    let dAngle = angle - base.angle;
    if (dAngle >  Math.PI) dAngle -= 2 * Math.PI;
    if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
    this.camera.alpha += dAngle;

    // ── Tilt: centroid Y movement ─────────────────────────────────────────────
    // Guard: only apply tilt when the pinch distance is relatively stable
    // (< 4% change) so a pure pinch doesn't spuriously tilt the camera.
    const distChangeFrac = Math.abs(dist - base.dist) / Math.max(base.dist, 1);
    if (distChangeFrac < 0.04) {
      const dCentY = centY - base.centY;
      this.applyTilt(dCentY * TILT_SENS_TOUCH * s);
    }

    // Update the baseline incrementally (correct result because both fingers
    // fire separate pointermove events — each step applies a partial delta,
    // together they sum to the full gesture change).
    base.dist  = dist;
    base.angle = angle;
    base.centX = centX;
    base.centY = centY;
  }

  // ── Wheel events (trackpad + mouse) ───────────────────────────────────────
  //
  // The browser maps trackpad gestures to WheelEvent as follows:
  //
  //   PINCH (spread/squeeze)          → ctrlKey=true,  deltaY = zoom amount
  //   2-FINGER SLIDE (pan)            → ctrlKey=false, deltaX/deltaY = pan amount
  //
  // A regular mouse wheel only produces deltaY (deltaX stays 0).
  //
  // Additionally we reserve Shift+scroll as a keyboard-accessible tilt+rotate
  // for users who can't do a two-finger touch tilt on a trackpad.

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const s = this.naturalScrolling ? 1 : -1;

    // Normalise deltaMode: LINE (Firefox, mouse) and PAGE modes → pixels
    const mul = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
              : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 300 : 1;
    const dy = e.deltaY * mul;
    const dx = e.deltaX * mul;

    if (e.ctrlKey) {
      // ── ZOOM: trackpad pinch or Ctrl+wheel ────────────────────────────────
      // ctrlKey is set by the browser for trackpad pinch gestures on all major
      // OSes (macOS, Windows, ChromeOS) — this is the reliable zoom signal.
      this.applyZoom(dy * WHEEL_ZOOM_SENS * this.camera.radius * s);
      this.cb.onActivity();
      return;
    }

    if (e.shiftKey) {
      // ── TILT + ROTATE: Shift + scroll ─────────────────────────────────────
      // Keyboard-accessible tilt for users on trackpad or mouse.
      // Vertical scroll (deltaY) → pitch. Horizontal (deltaX) → heading.
      this.applyTilt(dy * TILT_SENS_WHEEL * s);
      this.camera.alpha -= dx * ROT_SENS_WHEEL * s;
      this.cb.onActivity();
      return;
    }

    // ── PAN: plain trackpad 2-finger slide or mouse wheel ────────────────────
    // No modifier = drag gesture on trackpad (deltaX/Y) or mouse wheel (deltaY).
    // Mouse wheel only has deltaY → forward/back pan. Trackpad has both axes.
    this.applyPan(dx * s, dy * s, WHEEL_PAN_SENS);
    this.cb.onActivity();
  };

  // ── Movement primitives ────────────────────────────────────────────────────

  /**
   * Pan by projecting screen-space dx/dy onto the ground plane in world space.
   * Works for both pointer drag (DRAG_SENS) and wheel pan (WHEEL_PAN_SENS).
   */
  private applyPan(dx: number, dy: number, sens: number): void {
    const pos = this.camera.position;
    const tgt = this.camera.target.clone();

    // Ground-projected forward vector (camera → target, Y component removed).
    let fwd = new Vector3(tgt.x - pos.x, 0, tgt.z - pos.z);
    if (fwd.lengthSquared() < 1e-6) fwd = new Vector3(0, 0, 1);
    fwd.normalize();
    // Right vector (perpendicular to forward in the ground plane).
    const right = new Vector3(-fwd.z, 0, fwd.x);

    const k = this.camera.radius * sens;
    tgt.x = clamp(tgt.x + (-right.x * dx + fwd.x * dy) * k, this.bounds.minX, this.bounds.maxX);
    tgt.z = clamp(tgt.z + (-right.z * dx + fwd.z * dy) * k, this.bounds.minZ, this.bounds.maxZ);
    this.camera.setTarget(tgt);
  }

  private applyZoom(delta: number): void {
    this.camera.radius = clamp(
      this.camera.radius - delta,
      this.camera.lowerRadiusLimit ?? 2,
      this.camera.upperRadiusLimit ?? 200,
    );
  }

  private applyTilt(delta: number): void {
    this.camera.beta = clamp(
      this.camera.beta + delta,
      OverviewController.BETA_MIN,
      OverviewController.BETA_MAX,
    );
  }
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
