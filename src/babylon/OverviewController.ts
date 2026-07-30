// src/babylon/OverviewController.ts
// Bird's-eye overview camera with explicit, modifier-gated gesture controls.
//
// ── Gesture map ──────────────────────────────────────────────────────────────
//
//  DESKTOP — single-pointer drag with the primary button held (PointerEvent):
//    plain drag          → PAN   (slide the view on the X/Y plane)
//    Shift + drag        → ROTATE (dx → heading/bearing) + TILT (dy → pitch)
//    Ctrl/⌘ + drag       → ZOOM  (dy → in/out)
//
//  TRACKPAD — no click required, gestures arrive as WheelEvents:
//    two-finger slide    → PAN
//    pinch (ctrlKey)     → ZOOM
//    (two-finger twist has no cross-browser event — rotate via Shift+drag)
//
//  MOUSE WHEEL → ZOOM (the universal map idiom)
//
//  TOUCHSCREEN (PointerEvent):
//    1 finger drag       → PAN
//    2 finger pinch      → ZOOM
//    2 finger twist      → ROTATE (heading/bearing)
//    2 finger vertical   → TILT (pitch)   [applied when pinch distance is stable]
//
//  TAP (touch or left-click, brief, no movement, no modifier) → pick entity
//
// The modifier (Shift/Ctrl) is read per pointermove, so it can be pressed or
// released mid-drag and the gesture switches live.
//
// Natural scrolling flag: when true the map follows the finger/scroll direction;
// when false the view moves opposite (traditional). Applied to pan, tilt and zoom
// so the in-app toggle matches user expectation regardless of the OS setting.

import { ArcRotateCamera, Matrix, Vector3, type Scene } from "@babylonjs/core";
import { TapRecognizer } from "./TapRecognizer";

interface OverviewCallbacks {
  onActivity: () => void;
  onTap?: (clientX: number, clientY: number) => void;
  /** A press-and-hold at the given client coords (opens the full entity panel). */
  onLongPress?: (clientX: number, clientY: number) => void;
}

interface Bounds {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
}

// Sensitivity constants
const DRAG_SENS       = 0.0016; // world-units per pixel × radius (pointer pan)
const WHEEL_PAN_SENS  = 0.0009; // per normalised wheel pixel (two-finger slide pan)
const ROT_SENS_DRAG   = 0.005;  // radians per pixel (Shift+drag horizontal → heading)
const TILT_SENS_DRAG  = 0.005;  // radians per pixel (Shift+drag vertical → pitch)
const ZOOM_SENS_DRAG  = 0.004;  // per pixel × radius (Ctrl+drag vertical → zoom)
const WHEEL_ZOOM_SENS = 0.006;  // per normalised wheel pixel (wheel / pinch → zoom)
const TILT_SENS_TOUCH = 0.007;  // radians per px of the two fingers' SHARED vertical drag
// Fraction of the whole-villa fit radius used as the icon-scaling "1×"
// reference (see fitTo). <1 so the default overview starts with shrunk
// badges instead of full-size ones.
const ICON_REF_FRACTION = 0.55;
/**
 * How far the zoom-out shrink may take badges below their configured size.
 *
 * This used to be 0.22, which let badges keep shrinking indefinitely — and
 * that quietly DEFEATED the badge clustering in EntityVisuals. The two are
 * tools for the same job (keeping a zoomed-out view readable) and they were
 * fighting: clustering engages when badges can no longer be laid out without
 * overlapping, but a badge that shrinks as fast as the villa does never
 * starts overlapping, so the trigger never fired. The result was reported
 * from the field as an unreadable, jittering blob of tiny icons that never
 * grouped no matter how far out you zoomed.
 *
 * Floored at a still-legible fraction instead, the two hand off cleanly:
 * badges recede while that remains useful, and once the view really is too
 * dense they genuinely overlap, so clustering takes over and replaces them
 * with room chips. A fraction of the user's own chosen size, so it carries
 * no assumption about villa size, device count or screen.
 */
const ICON_ZOOM_MIN_SCALE = 0.7;

export class OverviewController {
  readonly camera: ArcRotateCamera;
  private scene: Scene;
  private canvas: HTMLCanvasElement;
  private cb: OverviewCallbacks;
  private attached = false;
  private naturalScrolling = true;
  private bounds: Bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
  /** Radius of the default whole-villa fit — the "1×" reference for icon zoom
   *  scaling (icons grow when the user zooms past it, shrink when zoomed out). */
  private refRadius = 30;
  /** The exact whole-villa fit radius (see fitTo). Distinct from refRadius: this
   *  is the threshold at/below which badges render at their configured size, and
   *  above which (zoomed OUT past the fit) getIconZoomCap shrinks them so a far
   *  zoom-out can't pile every badge into one blob over a tiny villa. */
  private fitRadius = 30;

  private static readonly BETA_MIN = 0.05; // ~3° from straight down
  private static readonly BETA_MAX = 1.4;  // ~80° (near horizon)

  constructor(scene: Scene, canvas: HTMLCanvasElement, cb: OverviewCallbacks) {
    this.scene = scene;
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

  /** Zoom factor for the state-icon badges: 1× at the default whole-villa fit,
   *  >1 when zoomed in (closer), <1 when zoomed out. Clamped so icons never
   *  vanish or swamp the view. */
  getIconZoomScale(): number {
    return clamp(this.refRadius / (this.camera.radius || this.refRadius), 0.5, 3);
  }

  /** Downward-only badge size factor vs the whole-villa fit. At the fit or
   *  zoomed IN (radius ≤ fitRadius) it returns 1 — badges keep their configured
   *  screen size, so standard framing is untouched (no side effects). Zoomed OUT
   *  past the fit it shrinks proportionally so badges scale down with the
   *  shrinking villa instead of swamping it in a fixed-size blob. */
  getIconZoomCap(): number {
    const r = this.camera.radius || this.fitRadius;
    if (r <= this.fitRadius) return 1;
    // Shrink FASTER than the villa does (exponent > 1) once zoomed out past the
    // fit, so badges visibly recede instead of just tracking the villa's size —
    // a plain fitRadius/r left them looking huge over a tiny far-zoom villa.
    return clamp(Math.pow(this.fitRadius / r, 1.8), ICON_ZOOM_MIN_SCALE, 1);
  }

  fitTo(ext: { min: Vector3; max: Vector3 }): void {
    const cx = (ext.min.x + ext.max.x) / 2;
    const cz = (ext.min.z + ext.max.z) / 2;
    const span = Math.max(ext.max.x - ext.min.x, ext.max.z - ext.min.z, 4);

    this.bounds = {
      minX: ext.min.x - span * 0.25, maxX: ext.max.x + span * 0.25,
      minZ: ext.min.z - span * 0.25, maxZ: ext.max.z + span * 0.25,
    };
    // Babylon's default FOVMODE_VERTICAL_FIXED keeps `camera.fov` as the
    // VERTICAL angle and derives the horizontal one from the aspect ratio
    // (tan(hFov/2) = tan(vFov/2) * aspect) — so at a fixed radius, a portrait
    // phone (aspect < 1) sees proportionally LESS width than a landscape
    // desktop window does, cropping most of a villa that's wider than it is
    // deep. `span * 1.05` alone was tuned against a landscape aspect, so it
    // undershoots on portrait. Scaling by 1/aspect (only below aspect 1, so
    // desktop — always ≥1 — is untouched) restores the same visible width a
    // square viewport would give, which is what the flat multiplier assumed.
    // Applied to upperRadiusLimit too, or the camera's own per-frame clamp
    // would just clip the corrected radius straight back down on narrow
    // phones (aspect ~0.46 alone needs more headroom than the old 2.2× cap).
    const aspect = this.scene.getEngine().getAspectRatio(this.camera);
    const aspectCorrection = aspect < 1 ? 1 / aspect : 1;
    const correctedSpan = span * aspectCorrection;

    this.camera.lowerRadiusLimit = Math.max(2, span * 0.08);
    this.camera.upperRadiusLimit = correctedSpan * 2.2;
    this.camera.setTarget(new Vector3(cx, ext.min.y + 1, cz));
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.5;
    this.camera.radius = correctedSpan * 1.05;
    this.fitRadius = this.camera.radius;   // threshold for getIconZoomCap
    // The icon "1x" reference is deliberately CLOSER than the whole-villa fit
    // radius, not equal to it: the default overview is the single most crowded
    // view (every device in the villa on screen at once), so anchoring "1x" to
    // it renders every badge at full size exactly where there's least room —
    // guaranteeing overlap and forcing the declutter pass to hide most of
    // them. Referencing a nearer, room-scale radius means badges start already
    // shrunk on the default overview and grow toward 1x as the user zooms into
    // a room, where there's actually space for them.
    this.refRadius = this.camera.radius * ICON_REF_FRACTION;
    this.cb.onActivity();
  }

  /** Snapshot of the current camera pose (see applyPose). */
  getPose(): { alpha: number; beta: number; radius: number; target: { x: number; y: number; z: number } } {
    return {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: { x: this.camera.target.x, y: this.camera.target.y, z: this.camera.target.z },
    };
  }

  /** Restore a previously captured pose, e.g. a device's saved default
   *  overview framing. Applied AFTER fitTo() (whose bounds/radius-limits this
   *  clamps against), so it overrides the auto-fit angles without losing the
   *  pan bounds / icon-zoom reference fitTo just computed for this model. */
  applyPose(pose: { alpha: number; beta: number; radius: number; target: { x: number; y: number; z: number } }): void {
    this.camera.alpha = pose.alpha;
    this.camera.beta = clamp(pose.beta, OverviewController.BETA_MIN, OverviewController.BETA_MAX);
    this.camera.radius = clamp(pose.radius, this.camera.lowerRadiusLimit ?? 2, this.camera.upperRadiusLimit ?? 200);
    const t = this.camera.target;
    t.x = clamp(pose.target.x, this.bounds.minX, this.bounds.maxX);
    t.y = pose.target.y;
    t.z = clamp(pose.target.z, this.bounds.minZ, this.bounds.maxZ);
    this.cb.onActivity();
  }

  panTo(x: number, z: number): void {
    // Mutate the orbit target IN PLACE — calling setTarget() would recompute
    // alpha/beta/radius from the current position and spin the view.
    const t = this.camera.target;
    t.x = clamp(x, this.bounds.minX, this.bounds.maxX);
    t.z = clamp(z, this.bounds.minZ, this.bounds.maxZ);
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

  // Two-finger gesture snapshot. `a*/b*` are the two fingers' positions from the
  // PREVIOUS pointermove (for incremental zoom/rotate/tilt deltas); `start*` are
  // their positions when the two-finger gesture began — used to classify the
  // gesture (both fingers drifting the same way vertically = TILT; otherwise
  // ZOOM). pointermove only ever carries ONE finger's new position, so we can't
  // compare the two fingers' movement within a single event; the from-start
  // displacements are what make the classification possible.
  private touchBase: {
    ax: number; ay: number; bx: number; by: number;
    startAy: number; startBy: number;
  } | null = null;

  // Tap detection (single brief press with minimal movement → entity pick).
  // Long-press is delivered by the recognizer's own hold timer, mid-gesture —
  // see TapRecognizer's constructor docs for why it no longer waits for release.
  private readonly tap = new TapRecognizer((x, y) => this.cb.onLongPress?.(x, y));

  private onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /**/ }

    if (this.pointers.size === 1) {
      this.tap.begin(e.clientX, e.clientY);
      this.touchBase = null;
    } else {
      // Second (or more) finger cancels tap and seeds the two-finger baseline.
      this.tap.cancel();
      this.seedTouchBase();
    }
    this.cb.onActivity();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const oldX = prev.x;
    const oldY = prev.y;
    const dx = e.clientX - oldX;
    const dy = e.clientY - oldY;
    prev.x = e.clientX;
    prev.y = e.clientY;
    e.preventDefault();

    // A modifier-drag (rotate/zoom) is never a tap; otherwise drift cancels it.
    if (e.shiftKey || e.ctrlKey) this.tap.cancel();
    this.tap.moved(e.clientX, e.clientY);

    const s = this.naturalScrolling ? 1 : -1;

    if (this.pointers.size >= 2) {
      // Two (or more) touch/pen pointers: zoom + rotate + tilt simultaneously.
      this.handleTwoFingerTouch();
    } else if (e.shiftKey) {
      // Shift + drag → ROTATE (horizontal) + TILT (vertical).
      this.camera.alpha -= dx * ROT_SENS_DRAG;
      this.applyTilt(dy * TILT_SENS_DRAG * s);
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl (or ⌘ on macOS) + drag → ZOOM (vertical). Drag up = zoom in.
      this.applyZoom(-dy * ZOOM_SENS_DRAG * this.camera.radius * s);
    } else {
      // Plain single-pointer drag (1-finger touch or left mouse) → PAN.
      // Use exact ground tracking so the spot under the finger stays under the
      // finger (true 1:1 on BOTH axes regardless of tilt/zoom), instead of a
      // flat per-pixel constant that mistracks horizontally vs vertically.
      this.dragPan(oldX, oldY, e.clientX, e.clientY, s, dx, dy);
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

    // Last finger up and still a brief, stationary tap → entity pick.
    // TapRecognizer swallows the trailing touch/pen ghost click so it can't
    // dismiss the panel the tap opens (see TapRecognizer for the why).
    if (this.pointers.size === 0) {
      // Only "tap" can come back now — a long-press already fired from the
      // recognizer's hold timer while the finger was still down.
      if (this.tap.complete(e) === "tap") this.cb.onTap?.(e.clientX, e.clientY);
    }
  };

  // ── Two-finger touch: pinch→zoom, twist→rotate, centroid-Y→tilt ───────────
  private seedTouchBase(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    this.touchBase = { ax: a.x, ay: a.y, bx: b.x, by: b.y, startAy: a.y, startBy: b.y };
  }

  private handleTwoFingerTouch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;

    if (!this.touchBase) {
      this.touchBase = { ax: a.x, ay: a.y, bx: b.x, by: b.y, startAy: a.y, startBy: b.y };
      return;
    }

    const base = this.touchBase;
    const s = this.naturalScrolling ? 1 : -1;

    const dist     = Math.hypot(b.x - a.x, b.y - a.y);
    const baseDist = Math.hypot(base.bx - base.ax, base.by - base.ay);
    const angle     = Math.atan2(b.y - a.y, b.x - a.x);
    const baseAngle = Math.atan2(base.by - base.ay, base.bx - base.ax);

    // ── Rotation: incremental twist angle (always) ────────────────────────────
    let dAngle = angle - baseAngle;
    if (dAngle >  Math.PI) dAngle -= 2 * Math.PI;
    if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
    this.camera.alpha += dAngle;

    // ── Classify the gesture: TILT vs ZOOM ────────────────────────────────────
    // Since one pointermove only carries one finger's motion, we classify from
    // how far each finger has drifted VERTICALLY since the gesture began:
    //  • both fingers drifted the SAME way (up or down) and that shared drift
    //    outweighs how much their vertical separation changed → a two-finger
    //    vertical DRAG → TILT (and zoom is suppressed so it doesn't creep in);
    //  • otherwise (a pinch, a mostly-horizontal move, one finger still) → ZOOM.
    const totalDyA = a.y - base.startAy;
    const totalDyB = b.y - base.startBy;
    const shared = (totalDyA > 0 && totalDyB > 0) ? Math.min(totalDyA, totalDyB)
                 : (totalDyA < 0 && totalDyB < 0) ? Math.max(totalDyA, totalDyB)
                 : 0;
    const separationDrift = Math.abs(totalDyA - totalDyB);
    const tiltMode = Math.abs(shared) > 6 && Math.abs(shared) >= separationDrift;

    if (tiltMode) {
      // Tilt from the centroid's incremental vertical move (its net travel over
      // the whole drag equals the shared finger movement). Zoom is intentionally
      // skipped this frame so a clean vertical drag reads as pure tilt.
      const dCentY = (a.y + b.y) / 2 - (base.ay + base.by) / 2;
      this.applyTilt(dCentY * TILT_SENS_TOUCH * s);
    } else if (baseDist > 1 && dist > 1) {
      // Zoom: ratio of finger distances (spread = zoom in = smaller radius).
      this.camera.radius = clamp(
        this.camera.radius * (baseDist / dist),
        this.camera.lowerRadiusLimit ?? 2,
        this.camera.upperRadiusLimit ?? 200,
      );
    }

    // Advance the incremental baseline (start* stays fixed for classification).
    base.ax = a.x; base.ay = a.y; base.bx = b.x; base.by = b.y;
  }

  // ── Wheel events (trackpad gestures + mouse wheel, no click needed) ────────
  //
  //   pinch (ctrlKey=true, set by the browser)  → ZOOM
  //   classic mouse wheel (discrete, vertical)  → ZOOM
  //   trackpad two-finger slide                 → PAN
  //
  // Distinguishing a mouse wheel from a trackpad slide: a real wheel reports
  // line-mode deltas (Firefox) or large pixel notches (~100, Chrome) with no
  // horizontal component, whereas a trackpad slide streams small pixel deltas
  // and often a non-zero deltaX.

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const s = this.naturalScrolling ? 1 : -1;

    // Normalise deltaMode: LINE (Firefox, mouse) and PAGE modes → pixels
    const mul = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
              : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 300 : 1;
    const dy = e.deltaY * mul;
    const dx = e.deltaX * mul;

    const isMouseWheel =
      e.deltaX === 0 &&
      (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(e.deltaY) >= 100);

    if (e.ctrlKey) {
      // Trackpad pinch (browser sets ctrlKey) → zoom.
      this.applyZoom(-dy * WHEEL_ZOOM_SENS * this.camera.radius * s);
    } else if (isMouseWheel) {
      // Classic mouse wheel notch → zoom.
      this.applyZoom(-dy * WHEEL_ZOOM_SENS * this.camera.radius * s);
    } else {
      // Trackpad two-finger slide → pan (no click required).
      // A wheel reports SCROLL deltas, whose VERTICAL sign is opposite to a
      // pointer DRAG's: scrolling down is deltaY>0, but dragging content down is
      // pointer dy>0. Feeding deltaY straight in (like the drag path does with
      // dy) therefore inverts up/down vs. click-drag. Negate dy so a two-finger
      // slide pans the map the SAME direction a click-drag does. It's negated
      // INSIDE the `s` factor, so this stays consistent whether the app's
      // Natural Scrolling toggle is on or off (both states flip together).
      // deltaX already matches the drag convention on the trackpads tested, so
      // it's left as-is (reported correct; only up/down was inverted).
      this.applyPan(dx * s, -dy * s, WHEEL_PAN_SENS);
    }
    this.cb.onActivity();
  };

  // ── Movement primitives ────────────────────────────────────────────────────

  /**
   * Unproject a screen (client) point onto the horizontal ground plane at the
   * orbit target's height. Returns null when the ray is parallel to / above the
   * plane (finger over the sky near the horizon).
   */
  private groundAt(clientX: number, clientY: number): Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ray = this.scene.createPickingRay(
      clientX - rect.left, clientY - rect.top, Matrix.Identity(), this.camera,
    );
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const dist = (this.camera.target.y - ray.origin.y) / ray.direction.y;
    if (dist <= 0) return null;
    return ray.origin.add(ray.direction.scale(dist));
  }

  /**
   * Drag-to-pan with exact finger tracking: keep the ground point first grabbed
   * under the moving finger by translating the orbit target by the world-space
   * difference between where the finger was and where it now is on the ground.
   * This is correct on both axes at any tilt/zoom (no per-axis foreshortening
   * mismatch). Falls back to the analytic pan if either point misses the ground.
   */
  private dragPan(
    oldX: number, oldY: number, newX: number, newY: number,
    s: number, dx: number, dy: number,
  ): void {
    const g0 = this.groundAt(oldX, oldY);
    const g1 = this.groundAt(newX, newY);
    if (!g0 || !g1) { this.applyPan(dx * s, dy * s, DRAG_SENS); return; }
    const t = this.camera.target;
    // Exact ground tracking is inherently symmetric: pinning the grabbed ground
    // point to the finger makes BOTH axes follow it — that IS "natural"
    // scrolling. So the naturalScrolling toggle (`s`) inverts BOTH axes the
    // same way; the two must never carry different signs. (v2.9.11 tried an
    // asymmetric `-s` on z to fix a reported up/down inversion — wrong lever:
    // that broke the axis symmetry and re-inverted up/down in the other toggle
    // state. natural ON = content follows the finger on both axes; OFF =
    // opposes on both.)
    t.x = clamp(t.x + (g0.x - g1.x) * s, this.bounds.minX, this.bounds.maxX);
    t.z = clamp(t.z + (g0.z - g1.z) * s, this.bounds.minZ, this.bounds.maxZ);
  }

  /**
   * Pan by projecting screen-space dx/dy onto the ground plane in world space.
   * Works for both pointer drag (DRAG_SENS) and wheel pan (WHEEL_PAN_SENS).
   */
  private applyPan(dx: number, dy: number, sens: number): void {
    const pos = this.camera.position;
    const t = this.camera.target; // live reference to the orbit centre

    // Ground-projected forward vector (camera → target, Y component removed).
    let fwd = new Vector3(t.x - pos.x, 0, t.z - pos.z);
    if (fwd.lengthSquared() < 1e-6) fwd = new Vector3(0, 0, 1);
    fwd.normalize();
    // Right vector (perpendicular to forward in the ground plane).
    const right = new Vector3(-fwd.z, 0, fwd.x);

    const k = this.camera.radius * sens;
    // Mutate the target IN PLACE. setTarget() would recompute alpha/beta/radius
    // from the stale position and rotate the view — moving only the target
    // translates the whole rig (position is re-derived from target + angles),
    // which is a pure pan with no rotation.
    t.x = clamp(t.x + (-right.x * dx + fwd.x * dy) * k, this.bounds.minX, this.bounds.maxX);
    t.z = clamp(t.z + (-right.z * dx + fwd.z * dy) * k, this.bounds.minZ, this.bounds.maxZ);
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
