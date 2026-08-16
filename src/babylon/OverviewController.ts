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
//  WHEEL — no click required, arrives as WheelEvents from both mouse and
//  trackpad. Its VERTICAL axis is the Ctrl/⌘+drag zoom, through the very same
//  primitive (zoomByPixels), so the two cannot mean different things:
//    wheel / two-finger slide, vertically → ZOOM
//    pinch (ctrlKey)                      → ZOOM
//    horizontal component (deltaX)        → PAN sideways
//    (two-finger twist has no cross-browser event — rotate via Shift+drag)
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

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { clamp } from "@/utils/geometry";
import { Animation } from "@babylonjs/core/Animations/animation";
// Side-effect only: registers Scene.prototype.beginDirectAnimation, used by
// zoomStep. "Animations/animation" does NOT carry it — the extension lives in
// this sibling file, and missing it is invisible to tsc (see CLAUDE.md).
import "@babylonjs/core/Animations/animatable";
import { CubicEase, EasingFunction } from "@babylonjs/core/Animations/easing";
import { TapRecognizer } from "./TapRecognizer";
import { cameraFrame } from "./cameraFrame";

interface OverviewCallbacks {
  onActivity: () => void;
  onTap?: (clientX: number, clientY: number) => void;
  /** A press-and-hold at the given client coords (opens the full entity panel). */
  onLongPress?: (clientX: number, clientY: number) => void;
  /** A double press at the given client coords. Fires on the second press's
   *  DOWN, so the first tap's own action has already run — the handler has to
   *  decide whether the point is empty enough to zoom (see SceneManager). */
  onDoubleTap?: (clientX: number, clientY: number) => void;
  /** Keep drawing for `ms` — a camera animation needs frames, and this scene
   *  renders on demand. */
  onAnimating?: (ms: number) => void;
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
/** The ONE zoom rate, per vertical pixel × radius. Ctrl/⌘+drag and the wheel
 *  both go through zoomByPixels, so a wheel notch of N normalised pixels moves
 *  the camera exactly as far as dragging N pixels with ⌘ held. That identity is
 *  the point: two ways to ask for the same thing that answered at two different
 *  rates is what made the wheel feel like a separate, unfamiliar gesture. */
const ZOOM_SENS = 0.004;
// ── Double-tap zoom step (see zoomStep) ────────────────────────────────────
/** One "level" = halve the distance = double the scale, the step every map
 *  application uses for a double tap. */
export const ZOOM_STEP_FACTOR = 0.5;
/** How far the view slides toward the tapped point. 1 would centre it exactly,
 *  which over-travels and feels like being yanked; 0 leaves the thing you
 *  tapped drifting off the edge as the zoom closes in. Half is the
 *  conventional compromise and keeps the tapped spot roughly under the finger. */
const ZOOM_STEP_RECENTRE = 0.5;
const ZOOM_STEP_FRAMES = 18;   // at 60fps
const ZOOM_STEP_MS = 300;
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
    // A camera sees proportionally LESS WIDTH the narrower its viewport, so at
    // a fixed radius a portrait phone crops most of a villa that is wider than
    // it is deep. `span * 1.05` alone was tuned against a landscape aspect and
    // undershoots there. Widening the span by the ratio of the two half-angles
    // restores the visible width a square viewport would give, which is what
    // the flat multiplier assumed. Applied to upperRadiusLimit too, or the
    // camera's own per-frame clamp would clip the corrected radius straight
    // back down on narrow phones (aspect ~0.46 alone needs more headroom than
    // the old 2.2× cap).
    //
    // tan(vHalf)/tan(hHalf) is exactly 1/aspect while `fov` is the vertical
    // angle, so this is the identical number the hand-rolled version produced —
    // but WHICH angle `fov` is belongs to cameraFrame.ts, not to a fourth
    // separate assumption here. Capped at 1 so landscape stays untouched.
    const { vHalf, hHalf } = cameraFrame(this.scene, this.camera);
    const aspectCorrection = Math.max(1, Math.tan(vHalf) / Math.tan(hHalf));
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
  private pointers = new Map<number, { x: number; y: number; type: string; captured: boolean }>();

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

  /** A zoom step is gliding — see zoomStep. */
  private zooming = false;

  private onPointerDown = (e: PointerEvent): void => {
    this.dropLostPointers();
    let captured = true;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { captured = false; }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, captured });

    if (this.pointers.size === 1) {
      this.tap.begin(e.clientX, e.clientY);
      this.touchBase = null;
      // Double press → the caller decides (zoom, if the point is empty). Mouse
      // or FIRST touch only: a second finger is a pinch, and a pinch that also
      // fired a double tap would zoom twice from one gesture.
      if (this.tap.isDoublePress(e.clientX, e.clientY)) {
        this.cb.onDoubleTap?.(e.clientX, e.clientY);
      }
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
      this.zoomByPixels(dy, s);
    } else {
      // Plain single-pointer drag (1-finger touch or left mouse) → PAN.
      // Use exact ground tracking so the spot under the finger stays under the
      // finger (true 1:1 on BOTH axes regardless of tilt/zoom), instead of a
      // flat per-pixel constant that mistracks horizontally vs vertically.
      this.dragPan(oldX, oldY, e.clientX, e.clientY, s, dx, dy);
    }
    this.cb.onActivity();
  };

  /**
   * Forget pointers the browser has stopped telling us about.
   *
   * ── Why this has to exist (2.323.0) ──────────────────────────────────────
   * EVERY gesture decision here is a count: `size === 1` arms the tap and pans,
   * `size >= 2` rotates and tilts, and `size === 0` is what actually FIRES the
   * tap. So one entry that never gets its `pointerup` breaks two things at
   * once, and they were reported together — an aggregated room badge that does
   * nothing when tapped, and a one-finger drag that tilts the camera "as if
   * ctrl were held". Both are the same stale entry: the tap never arms and
   * never fires because the count is never 1 and never 0, and the drag reads as
   * the second finger of a two-finger gesture.
   *
   * A missed `pointerup` is not a hypothetical. `pointercancel` is handled, but
   * WebKit does not always send one — a drawing-buffer resize during an active
   * touch is one way to lose the sequence, which is why SceneManager no longer
   * changes resolution inside a pointer handler.
   *
   * `hasPointerCapture` is the exact question to ask, because this handler
   * captures every pointer it tracks: losing capture without an up or a cancel
   * means the browser ended that pointer and did not say so. Only entries we
   * KNOW we captured are eligible — if `setPointerCapture` threw, absent
   * capture proves nothing, and pruning on it would turn a live two-finger
   * gesture into a pan mid-stroke.
   */
  private dropLostPointers(): void {
    if (this.pointers.size === 0) return;
    for (const [id, p] of this.pointers) {
      if (!p.captured) continue;
      let live = true;
      try { live = this.canvas.hasPointerCapture(id); } catch { live = false; }
      if (!live) this.pointers.delete(id);
    }
    if (this.pointers.size === 0) this.touchBase = null;
  }

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
      //
      // NEGATED (reported as inverted): beta is measured DOWN FROM straight-up,
      // so a bigger beta lowers the camera toward the horizon. Dragging two
      // fingers UP (dCentY < 0) must therefore INCREASE beta — pushing the far
      // edge of the villa away from you tips the model over to reveal its
      // elevation, the direct-manipulation reading every map app uses for this
      // gesture. Feeding dCentY straight through did the opposite: fingers up
      // flattened the view to top-down. This sign is deliberately NOT shared
      // with the Shift+drag tilt above — a mouse drag with a modifier held is
      // an indirect control with no "grab the ground" metaphor to preserve,
      // and that one was never reported as wrong.
      const dCentY = (a.y + b.y) / 2 - (base.ay + base.by) / 2;
      this.applyTilt(-dCentY * TILT_SENS_TOUCH * s);
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

  // ── Wheel events (mouse wheel + trackpad gestures, no click needed) ───────
  //
  // ⚠️ THE VERTICAL AXIS IS ZOOM, FOR EVERY DEVICE, and it is the SAME call
  // Ctrl/⌘+drag makes. There used to be a heuristic here that tried to tell a
  // mouse from a trackpad — `deltaX === 0` plus a ≥100px notch — and sent the
  // mouse to zoom and the trackpad to pan. It cannot work: a mouse with smooth
  // scrolling, a Magic Mouse, and a trackpad doing a pure-vertical swipe all
  // report small pixel deltas with no horizontal component, so a real mouse
  // regularly fell through to the PAN branch and the wheel silently performed a
  // different gesture from the one the same user got by holding ⌘. Reported as
  // exactly that: "the wheel is doing a different gesture and it's not
  // intuitive."
  //
  // Vertical-is-zoom is also the map idiom the guess was reaching for — it is
  // what a two-finger slide does in Google Maps and Apple Maps — so nothing is
  // lost by stating it outright instead of inferring it from a delta magnitude.
  // Panning by trackpad is still a plain drag, exactly as it is by mouse.
  //
  // The horizontal component keeps panning, because it has no zoom meaning and
  // discarding it would make a diagonal trackpad swipe feel like it stuck.

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const s = this.naturalScrolling ? 1 : -1;

    // Normalise deltaMode: LINE (Firefox, mouse) and PAGE modes → pixels
    const mul = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
              : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 300 : 1;
    const dy = e.deltaY * mul;
    const dx = e.deltaX * mul;

    // Wheel notch, trackpad slide and trackpad pinch (which the browser marks
    // with ctrlKey) are one gesture as far as this camera is concerned.
    if (dy !== 0) this.zoomByPixels(dy, s);
    // Sideways only — the vertical component has already been spent on zoom.
    if (dx !== 0) this.applyPan(dx * s, 0, WHEEL_PAN_SENS);
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
   * THE zoom gesture, in vertical pixels. Positive `dyPixels` means "downward"
   * in both of its callers' vocabularies — a pointer moving down the screen and
   * a wheel scrolling down both report a positive vertical delta — so one
   * negation here serves both and up is zoom-in either way.
   *
   * Everything about how far a zoom goes lives in this one line, on purpose:
   * ⌘+drag and the wheel are two spellings of one instruction, and the moment
   * they had two sensitivity constants they became two gestures that merely
   * looked related.
   */
  private zoomByPixels(dyPixels: number, s: number): void {
    this.applyZoom(-dyPixels * ZOOM_SENS * this.camera.radius * s);
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

  /**
   * Zoom in (or out) by one STEP, gliding rather than jumping, optionally
   * pulling the view toward a ground point.
   *
   * `factor` multiplies the radius — 0.5 halves the distance, which is the
   * doubling of scale every map application means by "one level". `toward`, if
   * given, is a world point under the pointer: the target is eased HALFWAY to
   * it, which is the standard double-tap-to-zoom feel (the thing you tapped
   * stays roughly where you tapped it, instead of the view zooming into the
   * middle of the screen and leaving it behind).
   *
   * Uses the same CubicEase + beginDirectAnimation the first-person teleport
   * does, for the same reason: it is the app's one "the camera is moving on its
   * own" idiom, and matching it is what makes the two cameras feel like one
   * product. No-op while another step is still gliding, so a rapid double-
   * double-tap cannot stack two animations onto the same property.
   */
  zoomStep(factor: number, toward?: Vector3): void {
    if (this.zooming) return;
    const lo = this.camera.lowerRadiusLimit ?? 2;
    const hi = this.camera.upperRadiusLimit ?? 200;
    const to = clamp(this.camera.radius * factor, lo, hi);
    // Already against the stop: don't animate a move of nothing, which would
    // read as a dead control rather than as "there is no more zoom".
    if (Math.abs(to - this.camera.radius) < 1e-3) return;

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const anims: Animation[] = [];
    const radiusAnim = new Animation(
      "overviewZoomRadius", "radius", 60,
      Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    radiusAnim.setKeys([{ frame: 0, value: this.camera.radius }, { frame: ZOOM_STEP_FRAMES, value: to }]);
    radiusAnim.setEasingFunction(ease);
    anims.push(radiusAnim);

    if (toward) {
      const t = this.camera.target;
      // Clamped to the same pan bounds a drag obeys — a double tap must not be
      // able to put the camera somewhere dragging could never reach.
      const dest = new Vector3(
        clamp(t.x + (toward.x - t.x) * ZOOM_STEP_RECENTRE, this.bounds.minX, this.bounds.maxX),
        t.y,
        clamp(t.z + (toward.z - t.z) * ZOOM_STEP_RECENTRE, this.bounds.minZ, this.bounds.maxZ),
      );
      const targetAnim = new Animation(
        "overviewZoomTarget", "target", 60,
        Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      targetAnim.setKeys([{ frame: 0, value: t.clone() }, { frame: ZOOM_STEP_FRAMES, value: dest }]);
      targetAnim.setEasingFunction(ease);
      anims.push(targetAnim);
    }

    this.zooming = true;
    // This scene renders on demand, so an animation that does not ask for
    // frames plays to an audience of one still image and then snaps.
    this.cb.onAnimating?.(ZOOM_STEP_MS + 80);
    this.cb.onActivity();
    this.scene.beginDirectAnimation(this.camera, anims, 0, ZOOM_STEP_FRAMES, false, 1, () => {
      this.zooming = false;
      this.cb.onActivity();
    });
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
