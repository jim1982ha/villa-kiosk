// src/components/panels/CameraPanel.tsx
// Full-screen camera takeover (not a bottom sheet).
//
// The feed itself — which of four ways reaches the camera, the watchdogs and
// the fallback between them — is cameraPlayer.ts driving cameraTiers.ts.
// This file is everything around the picture: gestures, chrome, zoom, the
// camera picker and the status bar.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X, VideoOff, Maximize2, Minimize2, ZoomOut, ChevronLeft, ChevronRight, Power, Check, Video } from "lucide-react";
import type { PanelProps } from "@/types/panel.types";
import { useRailLayout } from "@/utils/railLayout";
import { usePanelActions } from "./PanelActionsContext";
import { useHA } from "@/ha/HAStateStore";
import { createCameraPlayer, type CameraPlayer, type CameraPlayerState } from "./cameraPlayer";
import { cameraTiers } from "./cameraTiers";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useLongPress, HOLD_MS_HUD } from "@/hooks/useLongPress";
import { useMediaZoom } from "@/hooks/useMediaZoom";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useBackToClose } from "@/hooks/useBackToClose";
import { tapDebug } from "@/utils/tapDebug";
import { WHEEL_IDLE_MS, swipeStep, wheelOwner, wheelStep } from "./cameraGestures";
import { STATUS_COLOR, UNKNOWN_STATES } from "@/utils/stateColors";
import { TAP_MOVE_TOL_PX, LONG_PRESS_MS } from "@/utils/tapThresholds";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { useHistory } from "@/hooks/useHistory";
import { mergeStateHistories } from "./chartUtils";
import StateTimeline from "./StateTimeline";
import type { StateHistoryPoint } from "@/types/ha.types";

interface Props extends PanelProps {
  /** Lets the camera pin continuous rendering while the stream is open. */
  pinContinuous?: () => () => void;
  /** Swap this panel to another entity — drives the prev/next camera buttons. */
  onOpenEntity?: (entityId: string) => void;
}

// How long the title + status/controls chrome stays up after the last bit of
// pointer/touch/key activity before fading back out. Long enough to read the
// status bar and reach a control without racing it; short enough that the
// feed is unobstructed whenever nobody is actually interacting.
const CHROME_IDLE_MS = 2000;
// A touch counts as a TAP (and so toggles the chrome) only if the finger
// neither travelled nor lingered — otherwise a pan/pinch of a zoomed feed
// would flip the chrome on every gesture. Slop is generous because a finger
// on glass always drifts a little.
// ⚠️ THE SHARED ANSWER, NOT A SECOND ONE. These were 12px/400ms against
// TapRecognizer's 14px/500ms, so the same finger on the same glass was a tap
// in the 3D villa and a drag here. `utils/tapThresholds.ts` is the one place.
const TAP_SLOP_PX = TAP_MOVE_TOL_PX;
const TAP_MAX_MS = LONG_PRESS_MS;
/** The feed before its player exists: the first tier, nothing painted. */
const FEED_STARTING: CameraPlayerState = { mode: "webrtc", frameReady: false };

export default function CameraPanel({ mapping, onClose, pinContinuous, onOpenEntity }: Props) {
  const { connected, ws, entities } = useHA();
  const entityLabel = useEntityLabel();
  // Same linked-entity switch every OTHER panel gets from the shared BasePanel
  // chrome — this panel is the one that doesn't use BasePanel (it's a
  // fullscreen feed, not a modal card), so it reads the identical context and
  // renders the control in its own bottom bar instead of re-deriving anything.
  const { linked } = usePanelActions();
  // ── The feed ─────────────────────────────────────────────────────────────
  // One player per camera, made in an EFFECT rather than a memo: StrictMode
  // runs effect cleanups once on mount, and a memoised player would be
  // disposed by that and then reused. Until it exists the feed reads as the
  // first tier, not yet painted — i.e. the spinner.
  //
  // ⚠️ AND ONLY FOR ITS OWN CAMERA. On a camera change the first render still
  // holds the previous player; handing it the new element would restart the
  // OLD camera's current tier for a moment — the stale request this module
  // exists to remove. So a player is used only while its camera is on screen.
  const [owned, setOwned] = useState<{ entityId: string; player: CameraPlayer } | null>(null);
  useEffect(() => {
    const p = createCameraPlayer(cameraTiers(ws, mapping.entityId), { log: tapDebug });
    setOwned({ entityId: mapping.entityId, player: p });
    return () => p.dispose();
  }, [ws, mapping.entityId]);
  const player = owned?.entityId === mapping.entityId ? owned.player : null;
  const subscribeFeed = useCallback(
    (l: () => void) => (player ? player.subscribe(l) : () => {}), [player]);
  const feedState = useCallback(() => (player ? player.getState() : FEED_STARTING), [player]);
  const { mode, frameReady } = useSyncExternalStore(subscribeFeed, feedState);
  // The element for the current mode, handed to the player as React mounts
  // it — keyed on camera AND mode below, so every attempt gets a fresh one.
  const attachFeed = useCallback((el: HTMLVideoElement | HTMLImageElement | null) => {
    if (!player) return;
    if (el) player.attach(el); else player.detach();
  }, [player]);
  // ── Escape, and the focus contract that comes with it ────────────────────
  // This surface is a dialog like any other and now says so through the shared
  // hook rather than a keydown listener of its own — Escape closes it, focus
  // enters it and cannot Tab out into the live villa controls underneath.
  // Until 2.324.0 it had NEITHER: Escape did nothing (the only Escape handler
  // here closed the camera picker) so the one key that dismisses every other
  // surface in the app left the full-screen feed sitting there.
  //
  // Escape and Back unwind INNERMOST FIRST — picker, then feed, then villa —
  // and they agree because they ask the SAME question. Each surface registers
  // itself with `useBackToClose`; `dismissTop` is what both gestures call, so
  // the order lives in the stack and not in a condition either handler has to
  // keep true. Escape used to branch on the picker here while Back stacked,
  // which was one rule written twice.
  const closePicker = useCallback(() => setPickerOpen(false), []);
  // The hook's ref IS this panel's root — one element, one ref, so the focus
  // trap and the chrome/fullscreen logic below cannot drift onto two nodes.
  // useModalA11y registers the Back entry too (see its docstring), so the feed
  // is on the dismissal stack from this one call — no second registration.
  const rootRef = useModalA11y(onClose);
  const zoom = useMediaZoom<HTMLDivElement>();
  const [isFs, setIsFs] = useState(false);
  // The status/controls row now OVERLAYS the feed and auto-hides (see
  // chromeVisible below), so the feed gets the entire screen and is centred
  // on it by construction. This removed a measured `margin-top: <row height>`
  // (and the ResizeObserver + ref that fed it) which mirrored the row's
  // reserved height back above the video to re-centre it — the correct fix
  // while the row genuinely occupied flow space, and dead weight once it
  // stopped reserving any.
  // Phone-landscape rail: the status bar runs vertically down the left edge.
  // Detected here rather than in CSS alone because the timeline has to lay its
  // segments out on the matching axis (StateTimeline's `vertical`) — a CSS
  // rotation was tried first and abandoned; see that prop's docstring.
  // Live "is something moving right now" — the same sensor the status bar
  // summarises after the fact, read straight from the entity table so the feed
  // can signal a detection while it is happening.
  const motionActive = mapping.motionEntityId
    ? entities[mapping.motionEntityId]?.state === "on"
    : false;
  // ⚠️ ASKED, NOT RESTATED. This was a second copy of the stylesheet's media
  // query and it drifted: v2.81.1 changed the CSS to `(pointer: coarse)` and
  // left `(max-height: 560px)` here, so an iPad in landscape got rail layout
  // from the stylesheet and `vertical={false}` from this file — a history bar
  // drawing its segments along X inside a ten-pixel-wide vertical strip.
  const railVertical = useRailLayout();
  // Reorders .camera-controls' vertical (phone-landscape) column ONLY — the
  // portrait row keeps its natural DOM order untouched. Close-top/fullscreen-
  // 2nd/next-above-previous reads more natural for a one-handed reach down a
  // side rail than the portrait row's order does; flexbox `order` gets there
  // without a second copy of the buttons.
  const vOrder = (n: number): React.CSSProperties | undefined =>
    railVertical ? { order: n } : undefined;

  // Every camera in the house, alphabetical by DISPLAY LABEL (not raw
  // entity_id — the two can disagree, e.g. entity_id "camera.doorbell_main"
  // showing as "Main Door Camera", which used to sort under "d" while
  // reading as "M" in the picker/prev-next order) — so prev/next cycling and
  // the picker list both match the order a user would actually expect from
  // what's on screen. Wraps around at both ends.
  const cameraIds = Object.keys(entities)
    .filter((id) => id.startsWith("camera."))
    .sort((a, b) => {
      const labelA = entityLabel(a);
      const labelB = entityLabel(b);
      return labelA.localeCompare(labelB);
    });
  const camIndex = cameraIds.indexOf(mapping.entityId);
  const canCycle = !!onOpenEntity && cameraIds.length > 1 && camIndex >= 0;
  const stepCamera = (delta: number) => {
    if (!canCycle) return;
    const next = (camIndex + delta + cameraIds.length) % cameraIds.length;
    onOpenEntity!(cameraIds[next]);
  };
  // Refs so the swipe listener below (registered once, not on every render)
  // always reads the LATEST zoomed/stepCamera without needing to re-attach.
  const zoomedRef = useRef(false);
  zoomedRef.current = zoom.zoomed;
  const stepCameraRef = useRef(stepCamera);
  stepCameraRef.current = stepCamera;
  // Read at GESTURE time, not at listener-attach time — see the swipe effect.
  const canCycleRef = useRef(false);
  canCycleRef.current = canCycle;

  // ── Sideways scroll steps between cameras (trackpad / tilt wheel) ────────
  // The drag gesture below covers touch. A trackpad swipe is not a drag: it
  // arrives as wheel events with deltaX, which useMediaZoom used to swallow as
  // a zoom — so the gesture zoomed the picture instead of changing camera. The
  // hook now leaves a horizontal wheel alone while the feed is unzoomed, and it
  // is handled here. Zoomed, it goes back to the hook as a pan, so nothing
  // about the zoom behaviour changes.
  const wheelTravel = useRef(0);
  const wheelIdle = useRef(0);
  // One gesture may step ONE camera. Without this, a long trackpad swipe keeps
  // feeding deltaX after the first step, crosses the threshold again and walks
  // through several cameras from a single flick — the accumulator resets, but
  // the gesture has not ended. The lock is released only by the idle timeout,
  // i.e. by the user actually stopping.
  const wheelSpent = useRef(false);
  const onFeedWheel = useCallback((e: { deltaX: number; deltaY: number }) => {
    // ⚠️ ONE PREDICATE, ASKED BY BOTH SIDES. `useMediaZoom` read the exact
    // complement of this line; see `cameraGestures.wheelOwner` for why the
    // tie has to be decided once.
    if (wheelOwner(e.deltaX, e.deltaY, zoomedRef.current) !== "camera") return;
    window.clearTimeout(wheelIdle.current);
    // A gesture ends after a quiet moment; that is what re-arms it.
    wheelIdle.current = window.setTimeout(() => {
      wheelTravel.current = 0;
      wheelSpent.current = false;
    }, WHEEL_IDLE_MS);
    if (wheelSpent.current) return; // already stepped for this flick
    wheelTravel.current += e.deltaX;
    const step = wheelStep(wheelTravel.current);
    if (step === 0) return;
    stepCameraRef.current(step);
    wheelTravel.current = 0;
    wheelSpent.current = true;
  }, []);
  // Read by the capture-phase listener below, which is registered once.
  const onFeedWheelRef = useRef(onFeedWheel);
  onFeedWheelRef.current = onFeedWheel;
  useEffect(() => () => window.clearTimeout(wheelIdle.current), []);

  // Long-press (or hold, on mouse) either prev/next arrow opens a picker
  // listing every camera by name — jump straight to one instead of cycling
  // through them one at a time. Same tap-vs-hold convention as the Rooms
  // dial / default-view anchor buttons elsewhere in the app: a plain tap
  // still steps as before; only a HOLD opens the picker, so this is purely
  // additive and never intrudes on the existing gesture.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Press-and-hold from the shared hook, not a fourth hand-rolled timer. The
  // version this replaces had no movement origin, so a hold that DRIFTED still
  // opened the picker — a different gesture from every other hold in the app,
  // on the one surface most likely to be touched mid-swipe. HOLD_MS_HUD keeps
  // the 480ms this button has always used.
  // nativeButton: this is a real <button> with its own onClick, and a native
  // button fires that click on ENTER'S KEYDOWN — arming the hold on Enter too
  // would step the camera AND open the picker from one press. 2.380.0 shipped
  // exactly that for one release.
  const pickerHold = useLongPress(
    () => setPickerOpen(true), { holdMs: HOLD_MS_HUD, nativeButton: true });
  const onCycleBtnClick = (delta: number) => {
    // A hold that already opened the picker must not ALSO step to the next
    // camera the instant the button is released (a held pointer still fires
    // a native click on release) — swallow exactly that one click.
    if (pickerHold.consumeClick()) return;
    stepCamera(delta);
  };
  // The picker is a surface too, so it registers like one — that is what puts
  // it ABOVE the feed on the stack and makes "innermost first" a fact of the
  // registration order rather than a rule either gesture has to remember.
  useBackToClose(closePicker, pickerOpen);

  // ── Left/Right arrows step cameras — the keyboard's swipe ────────────────
  // Same action as the on-screen prev/next arrows and the same direction as
  // the touch gesture, so Right always means "the next camera" whichever way
  // you reach for it. Deliberately NOT gated on zoom the way the swipe is:
  // that gate exists because a one-finger drag is also how you pan a zoomed
  // feed, and a key press competes with nothing.
  //
  // Not registered while the picker is open — the arrows belong to whatever is
  // on top, and stepping the feed behind an open list would change the thing
  // the list is offering to change.
  useEffect(() => {
    if (!canCycle || pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // A modifier means the browser's own navigation, and a caret in a field
      // means the user is editing text, not driving the panel.
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.isContentEditable
        || el instanceof HTMLInputElement
        || el instanceof HTMLTextAreaElement
        || el instanceof HTMLSelectElement)) return;
      e.preventDefault();
      stepCameraRef.current(e.key === "ArrowRight" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canCycle, pickerOpen]);

  // Swipe left/right on the feed itself cycles cameras — the touch
  // equivalent of the prev/next buttons. Gated on NOT zoomed: a single-finger
  // drag is already a complete no-op in useMediaZoom until the feed is zoomed
  // in (panning only starts once scale > 1 there), so this coexists with pinch
  // /pan without fighting over the same pointer events — swipes only resolve
  // to a camera change while the feed is at its default 1x framing.
  //
  // Attached to the PANEL ROOT, once, and never torn down. It used to hang off
  // the feed element and bail when that element or `canCycle` was not ready —
  // with `zoom.ref` as a dep, and a ref object never changing identity, the
  // effect then had nothing to re-run on. A feed still negotiating HLS has no
  // element yet, so the listener was simply never attached and swiping did
  // nothing until something unrelated re-rendered. That is the "wait a few
  // seconds before it lets me swipe".
  //
  // The root is mounted for the panel's whole life and the feed sits inside
  // it, so pointer events reach it either way. Both conditions are read from
  // refs when the gesture finishes instead, which also means a swipe works
  // while the next camera is still loading — the point of the gesture is to
  // move on quickly.
  useEffect(() => {
    const inPanel = (e: Event) =>
      !!rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target);
    let downX = 0, downY = 0, downT = 0, tracking = false;
    const onDown = (e: PointerEvent) => {
      if (zoomedRef.current || !canCycleRef.current || !inPanel(e)) return;
      tracking = true;
      downX = e.clientX; downY = e.clientY; downT = Date.now();
    };
    const onUp = (e: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      if (zoomedRef.current) return;
      const step = swipeStep(e.clientX - downX, e.clientY - downY,
                             Date.now() - downT);
      if (step !== 0) stepCameraRef.current(step);
    };
    const onCancel = () => { tracking = false; };
    // CAPTURE phase, on the window. Bubbling was still being lost: while a
    // feed is starting up the panel puts overlays over it, hls.js takes pointer
    // capture on the <video>, and any of those can stop an event before it
    // reaches the root — which is why a quick swipe straight after a camera
    // appeared did nothing. A capture-phase listener runs BEFORE any of them
    // and cannot be cancelled by them, so the gesture is read whatever the feed
    // is doing. It only ever observes; nothing here consumes the event.
    // The trackpad swipe listens the same way, and for the same reason it had
    // to move off the feed element: as a React onWheel it only fired while the
    // cursor happened to be over the video, so the gesture did nothing until
    // the mouse had been moved there first. Anywhere in the panel is enough now.
    const onWheelCapture = (e: WheelEvent) => {
      if (!canCycleRef.current || !inPanel(e)) return;
      onFeedWheelRef.current(e);
    };
    const opts = true;
    window.addEventListener("wheel", onWheelCapture, opts);
    window.addEventListener("pointerdown", onDown, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("pointercancel", onCancel, opts);
    return () => {
      window.removeEventListener("wheel", onWheelCapture, opts);
      window.removeEventListener("pointerdown", onDown, opts);
      window.removeEventListener("pointerup", onUp, opts);
      window.removeEventListener("pointercancel", onCancel, opts);
    };
  }, []);

  // Bottom status bar: this camera's own online/offline history, layered with
  // its MOTION sensor's (mapping.motionEntityId, set in Advanced Settings)
  // on/off history — merged into ONE composite timeline (see
  // mergeStateHistories) and rendered through the SAME StateTimeline every
  // other panel's "Last 24 hours" chart uses, just slim and pinned to the
  // screen edge instead of sitting in a scrollable panel body. Reads the
  // motion sensor, NOT linkedEntityId: this band answers "did it detect
  // anything", which is the sensor's job — linkedEntityId only says whether
  // detection was armed (and drives the badge ring, see EntityVisuals).
  const motionId = mapping.motionEntityId;
  const { data: statusHistory, loading: statusLoading } = useHistory<StateHistoryPoint[]>(
    `${mapping.entityId}|${motionId ?? ""}`, async () => {
    // ⚠️ THIS BAR'S SUBJECT IS REACHABILITY, so a gap is the signal, not
    // noise. Both series used to pass a `keepUnavailable` opt-out to get that;
    // the flag is gone because keeping them is now the only behaviour — every
    // other caller was broken by the old default. Why it matters here:
    //   * the camera's own `unavailable` is what the "offline" band below is
    //     for, and without this it never arrives to be drawn;
    //   * the motion sensor's matters too, in the other direction — dropping
    //     its unavailable points leaves the last known state standing, so a
    //     sensor that went offline while reading `on` would paint red for the
    //     whole outage. Kept, it stops being `on` and the bar stops claiming
    //     motion nobody detected.
    const [camHist, motionHist] = await Promise.all([
      fetchStateHistory(mapping.entityId, 24),
      motionId
        ? fetchStateHistory(motionId, 24)
        : Promise.resolve<StateHistoryPoint[]>([]),
    ]);
    return mergeStateHistories(
      { camera: camHist, motion: motionHist },
      (cur) => {
        if (!cur.camera || UNKNOWN_STATES.has(cur.camera)) return "offline";
        if (motionId && cur.motion === "on") return "motion";
        return "online";
      },
    );
  }, []);

  // ⚠️ THERE IS NO SNAPSHOT STAND-IN ANY MORE (2.496.52). While HLS started,
  // this panel showed the camera's still image on the theory that the swap to
  // video would be invisible. It was the opposite: the still comes from a
  // different stream (4:3, renewed every ~2s) so the owner watched a slideshow
  // in the wrong shape for 7s and then saw it jump to 16:9. A spinner for
  // WebRTC's second is honest, and a wrong picture is not.

  useEffect(() => {
    const unpin = pinContinuous?.();
    return () => unpin?.();
  }, [pinContinuous]);

  // Keep the button icon in sync if the user leaves fullscreen via the Esc key
  // or the OS gesture rather than our button.
  useEffect(() => {
    const onFsChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Auto-hiding chrome (title + status/controls row) ──────────────────────
  // The standard video-viewer contract, which this panel didn't follow: the
  // picture is the content, so it gets the WHOLE screen and the chrome is
  // transient — it appears on any pointer/touch/key activity and fades back
  // out after a few idle seconds. Previously the status+controls row sat in
  // normal flow permanently, so a phone in portrait spent a fixed slice of an
  // already-small screen on a bar the user only needs for a moment at a time.
  //
  // `chromeHeld` is a separate, non-expiring reason to stay visible (hovering
  // the controls with a mouse, or having the camera picker open) — a cluster
  // that vanished from under the cursor mid-reach would be worse than one
  // that never hid at all. The timer restarts on every activity event; the
  // effect re-runs only when a HELD state changes, not on every mouse move,
  // so this costs one timeout per burst of activity rather than per event.
  // Starts HIDDEN. The feed is the content, so opening the panel shows the
  // feed and nothing else; the chrome is summoned by hovering (mouse) or
  // tapping (touch). A first tap anywhere on the video reveals it, which is
  // also how the close button is reached.
  const [chromeVisible, setChromeVisible] = useState(false);
  const [hoveringControls, setHoveringControls] = useState(false);
  // Read through a ref, not a dependency: bumpChrome must keep a STABLE
  // identity or every hover/picker change would re-run the effect below and
  // re-show chrome the user had just dismissed.
  const heldRef = useRef(false);
  heldRef.current = hoveringControls || pickerOpen;
  const idleTimer = useRef<number | undefined>(undefined);

  /** Show, and (re)start the idle countdown unless something is holding it. */
  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(idleTimer.current);
    if (heldRef.current) return;
    idleTimer.current = window.setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
  }, []);
  const hideChrome = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    setChromeVisible(false);
  }, []);

  // Holding (mouse over the controls, or the camera picker menu open) freezes
  // the countdown; releasing restarts it. Also supplies the initial "visible"
  // state on mount, since it runs once with nothing held.
  // Freeze the countdown while something holds the chrome open, and re-arm it
  // when that hold RELEASES. Deliberately not on mount: the previous version
  // called bumpChrome() unconditionally here, which is what made the chrome
  // appear for its first few seconds on every open.
  const wasHeld = useRef(false);
  useEffect(() => {
    const held = hoveringControls || pickerOpen;
    if (held) window.clearTimeout(idleTimer.current);
    else if (wasHeld.current) bumpChrome();
    wasHeld.current = held;
  }, [hoveringControls, pickerOpen, bumpChrome]);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  // ── Input-type-specific chrome behaviour (the standard video contract) ──
  // MOUSE: movement reveals, idling hides, hovering the controls holds.
  // TOUCH: a tap TOGGLES. That distinction is the whole point — a touch user
  // has no hover, so "any activity re-shows" leaves them with chrome they can
  // only dismiss by waiting, which is what this originally did (pointerdown
  // was wired straight to the show path for every input type, so a second tap
  // just re-showed what was already up). Keyboard is treated as mouse-like.
  const chromeActivity = {
    onPointerMove: (e: React.PointerEvent) => { if (e.pointerType === "mouse") bumpChrome(); },
    onKeyDown: bumpChrome,
  };

  // Tap detection for the touch toggle above. Deliberately not a plain
  // onClick: the feed is pinch-zoomable and pannable (useMediaZoom), and a
  // drag that happens to start and end on the video still fires a click — so
  // panning a zoomed camera would flip the chrome on every gesture. A tap is
  // a press that neither travelled nor lingered.
  const tapStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onFeedPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    tapStart.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onFeedPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const start = tapStart.current;
    tapStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    // Swipe is NOT handled here — the pointer listener above owns it. It was
    // handled in both places, so one drag stepped TWICE: two forward on a
    // left swipe, two back on a right one, which with three cameras lands on
    // the same entry either way and read as "every swipe goes to the next
    // camera". A gesture gets exactly one reader.
    //
    // No guard is needed against a swipe also toggling the chrome: the tap
    // test below requires the finger to have travelled less than TAP_SLOP_PX,
    // and a swipe travels several times that.
    if (Math.hypot(dx, dy) > TAP_SLOP_PX) return;
    if (performance.now() - start.t > TAP_MAX_MS) return;
    if (chromeVisible) hideChrome(); else bumpChrome();
  };

  // The feed is an <img> (MJPEG/snapshot), so there's no native video control
  // bar; a live camera has no timeline to scrub or pause. Fullscreen is the one
  // meaningful control, so we expose it via the Fullscreen API — but iPhone
  // Safari (unlike iPadOS and every desktop/Android browser) does not
  // support requestFullscreen() on an arbitrary element at all: the method
  // exists on the prototype, but document.fullscreenEnabled is false and the
  // call rejects every time. The button used to render unconditionally, so
  // on iPhone specifically it looked pressable but silently did nothing —
  // the icon never flipped to "exit fullscreen" because
  // document.fullscreenElement never became truthy, either. Feature-detected
  // below (not platform-sniffed, so this keeps working correctly if/when
  // Apple ever adds support) and the button is hidden entirely where it
  // can't do anything, rather than offer a control that doesn't work. The
  // feed itself is unaffected either way — .camera-fullscreen already covers
  // the whole viewport via CSS regardless of the native Fullscreen API.
  const fullscreenSupported =
    typeof document !== "undefined" && document.fullscreenEnabled;
  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    } else {
      void el.requestFullscreen?.().catch(() => {});
    }
  };

  // A different camera starts un-zoomed. (It starts at the first tier too, but
  // that is simply a new player — see "The feed".)
  useEffect(() => { zoom.reset(); }, [mapping.entityId, zoom.reset]);

  const renderView = () => {
    if (!connected) return <Unavailable label="Not connected to Home Assistant." />;
    if (mode === "failed") return <Unavailable label="Camera stream unavailable." />;
    if (!player) return null; // this camera's player is being made — the spinner shows

    // The tier drives the element itself (srcObject, hls.js, an <img> src);
    // this only mounts the right KIND of element. Keyed on camera and mode, so
    // each attempt gets a fresh one and never inherits a torn-down stream.
    const key = `${mapping.entityId}:${mode}`;
    if (mode === "webrtc" || mode === "hls") {
      return (
        <div className="camera-hls-wrap" key={key}>
          <video ref={attachFeed} autoPlay muted playsInline />
        </div>
      );
    }
    return <img key={key} ref={attachFeed} alt={mapping.label} />;
  };

  return (
    <div
      className={`camera-fullscreen${chromeVisible || hoveringControls || pickerOpen ? "" : " chrome-hidden"}`}
      ref={rootRef}
      {...chromeActivity}
    >
      {/* Everything that visually belongs to "the live feed" (video, title
          watermark, loading spinner) is grouped under ONE wrapper so it can be
          sized as a distinct region — flex:1 above the status/controls row
          (see .camera-viewport) — on every screen size/orientation, instead
          of every layer sharing the same full-bleed box the bottom row also
          overlaps. Used to be desktop-only (gated behind a min-width media
          query); a phone in portrait needs this exactly as much as a laptop
          does, so it's now the only layout. */}
      {/* Title — anchored to the TOP OF THE PANEL, i.e. the top of the screen,
          NOT to the video region. It used to live inside .camera-viewport, so
          it followed that region's own top edge: on a phone in portrait that
          left it stranded in the middle of the black bar above the feed, and
          on a wide screen (where the feed is letterboxed the other way) it
          landed ON the video's top-left corner. Pinning it here puts it above
          the feed in every aspect/orientation, which is the one placement
          that reads the same everywhere. */}
      <div className="camera-header">
        <div className="label">{mapping.label}</div>
        {/* Exiting zoom used to add a button to .camera-controls — every
            existing icon there shifted position the instant you zoomed in,
            which read as broken chrome rather than a new control appearing.
            A pill under the title instead: same "Reset zoom" action, same
            tap-to-clear affordance, but it doesn't perturb a cluster of
            controls the user is about to reach for (prev/next/fullscreen/
            close) while they're mid-gesture on the feed. */}
        {zoom.zoomed && (
          <button className="camera-zoom-pill" onClick={zoom.reset} title="Reset zoom" aria-label="Reset zoom">
            <ZoomOut size={16} /> Zoomed in — tap to reset
          </button>
        )}
      </div>

      {/* Ring the feed itself while the sensor is tripped, so someone WATCHING
          the stream is told a detection is happening now — the status bar below
          only answers the same question in retrospect. On the viewport, not on
          .camera-zoom: that element carries the pinch-zoom transform, so a
          border there would scale and slide with the zoom instead of framing
          the feed. Colour from the shared vocabulary, so it is the same red the
          bar and the legend already use for a detection. */}
      {/* The ring is drawn on the media ELEMENT (see .camera-detecting in
          styles.css), which is already sized to exactly the picture — the
          feed's own max-width/max-height sizing means its box IS the contained
          image, with the letterbox being empty space around it rather than
          part of the element. So the outline lands on the picture with no
          aspect-ratio maths at all. Colour passed down as a custom property so
          it still comes from the shared vocabulary. */}
      <div
        className={`camera-viewport${motionActive ? " camera-detecting" : ""}`}
        style={{ ["--detect-color" as string]: STATUS_COLOR.alert }}
        // On the FEED region, not the panel root: a tap on a control is that
        // control's business, and must not also toggle the chrome away from
        // under the finger that is pressing it.
        onPointerDown={onFeedPointerDown}
        onPointerUp={onFeedPointerUp}
        onPointerCancel={() => { tapStart.current = null; }}
      >
        {/* Zoom/pan layer — FIRST child so the controls below paint on top of
            it and stay clickable while it captures pinch/wheel/drag gestures. */}
        <div className="camera-zoom" ref={zoom.ref} style={zoom.style}>
          {renderView()}
        </div>

        {/* An empty <video>/<img> mid-setup reads as "broken" rather than
            "loading" — cover it with a spinner until a real frame arrives. */}
        {connected &&
          mode !== "failed" &&
          !frameReady && (
            <div className="camera-loading">
              <div className="spinner" />
            </div>
          )}
      </div>

      {/* Bottom row: status strip (green online / red motion / black gap)
          sharing the same offset + height as the control cluster, sized to
          fill the space left of it (see .camera-bottom-row flex rule) so it
          stays aligned with prev/next/zoom/fullscreen/close regardless of
          how many of those are currently rendered. */}
      <div
        className="camera-bottom-row"
        // Mouse only (pointer:fine): a hover that pins the chrome open is
        // meaningless on touch, where the finger IS the tap and a lingering
        // "hover" state would just never clear.
        onPointerEnter={(e) => { if (e.pointerType === "mouse") setHoveringControls(true); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setHoveringControls(false); }}
      >
        <div className="camera-status-bar">
          <StateTimeline
            data={statusHistory}
            loading={statusLoading}
            height={56}
            vertical={railVertical}
            // 5-minute buckets: 288 across the day. This bar answers "was
            // there presence / was the camera down in this slice", not "for
            // exactly how long" — a motion sensor fires far too often for
            // per-change segments, which is what made this bar overstate
            // motion and visibly reshuffle between renders. See
            // StateTimeline's bucketMinutes docstring.
            hours={24}
            bucketMinutes={5}
            // `online` is the resting state — the camera being fine is not
            // news, so it is neither painted nor listed. What remains is a
            // bare track marked only where something actually happened.
            baselineStates={["online"]}
            // Straight from the shared vocabulary the "Map colours" legend
            // documents (utils/stateColors STATUS_COLOR) — this bar used to
            // paint a camera HA had lost contact with in its own literal
            // black, while the legend told the user that means amber.
            //
            // Written out rather than routed through statusKeyFor, because
            // these three words are SYNTHESIZED here (see the status
            // derivation above) and don't all mean what HA means by them:
            // "offline" here is us failing to reach the camera — genuinely
            // unavailable — whereas an entity whose STATE STRING is "offline"
            // is a device successfully reporting a fault, which that map
            // paints red alongside "error"/"unreachable". Same word, two
            // vocabularies; don't collapse them.
            colorFor={(s) => (
              s === "motion" ? STATUS_COLOR.alert
                : s === "offline" ? STATUS_COLOR.unavailable
                  // A camera that is up and recording is ON, which the legend
                  // calls "On / active" and paints green. It is emphatically
                  // not "Off / idle" — that token means a device at rest, and
                  // using it here painted a perfectly healthy camera the same
                  // colour as the empty track behind it.
                  : STATUS_COLOR.active
            )}
          />
        </div>
        <div className="camera-controls">
          {/* Linked entity on/off — the camera's stand-in for the switch
              BasePanel shows at the top of every other panel. Styled as an
              icon-btn so it sits in this cluster naturally; .on marks the
              live state, matching the badge's red ring.
              Vertical (phone-landscape) rail order deliberately differs from
              this DOM/portrait order — see vOrder: Close top, Fullscreen 2nd,
              Next above Previous, this detection toggle last. Portrait order
              (this DOM order) is untouched.
              No explicit icon `size` on any button below — .camera-controls
              .icon-btn svg (styles.css) sizes every icon in this cluster to
              a consistent 55% of its button uniformly, at every breakpoint,
              instead of a hand-picked pixel value per icon. */}
          {linked && (
            <button
              className={`icon-btn camera-linked-btn${linked.isOn ? " on" : ""}`}
              onClick={linked.toggle}
              role="switch"
              aria-checked={linked.isOn}
              aria-label={`${linked.label}: ${linked.isOn ? "on" : "off"}`}
              title={`${linked.label} — ${linked.isOn ? "turn off" : "turn on"}`}
              style={vOrder(5)}
            >
              <Power />
            </button>
          )}
          {canCycle && (
            <>
              {/* Plain step-back button: no hold-to-pick. Offering the same
                  camera picker on BOTH arrows was redundant — one entry point
                  is enough, and it stays on Next (below). Calls stepCamera
                  directly rather than onCycleBtnClick, so it can't be
                  swallowed by the hook's consumeClick, which exists only to
                  suppress the click at the end of a hold. */}
              <button
                className="icon-btn cam-prev"
                onClick={() => stepCamera(-1)}
                title="Previous camera"
                aria-label="Previous camera"
                style={vOrder(4)}
              >
                <ChevronLeft />
              </button>
              <button
                className="icon-btn cam-next has-hold-action"
                {...pickerHold}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => onCycleBtnClick(1)}
                title="Next camera — hold to pick a camera"
                aria-label="Next camera — hold to pick a camera"
                style={vOrder(3)}
              >
                <ChevronRight />
              </button>
            </>
          )}
          {fullscreenSupported && (
            <button
              className="icon-btn fs-btn"
              onClick={toggleFullscreen}
              title={isFs ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFs ? "Exit fullscreen" : "Fullscreen"}
              style={vOrder(2)}
            >
              {isFs ? <Minimize2 /> : <Maximize2 />}
            </button>
          )}
          <button className="icon-btn close" onClick={onClose} style={vOrder(1)}>
            <X />
          </button>
        </div>
      </div>

      {/* Camera picker — opened by holding the NEXT arrow. A plain
          list rather than a radial dial (the Rooms menu's style): this is a
          flat list of names, nothing spatial about it. */}
      {pickerOpen && (
        <>
          <div className="camera-picker-backdrop" onClick={() => setPickerOpen(false)} />
          <div className="hud-menu camera-picker-menu" role="menu" aria-label="Choose a camera">
            <div className="hud-menu-header">Cameras</div>
            <div className="camera-picker-list">
              {cameraIds.map((id) => {
                const isCurrent = id === mapping.entityId;
                const label = entityLabel(id);
                return (
                  <button
                    key={id}
                    role="menuitemradio"
                    aria-checked={isCurrent}
                    className={`hud-menu-item${isCurrent ? " active" : ""}`}
                    onClick={() => {
                      setPickerOpen(false);
                      if (!isCurrent) onOpenEntity?.(id);
                    }}
                  >
                    {isCurrent ? <Check size={16} /> : <Video size={16} />}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Unavailable({ label }: { label: string }) {
  return (
    <div className="center" style={{ color: "var(--text-secondary)" }}>
      <VideoOff size={48} />
      <p>{label}</p>
    </div>
  );
}
