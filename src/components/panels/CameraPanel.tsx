// src/components/panels/CameraPanel.tsx
// Full-screen camera takeover (not a bottom sheet).
//
// Three tiers, tried in order, each falling through to the next on failure:
//  1. HLS — the same "stream" pipeline Home Assistant's own frontend prefers
//     for any camera that supports it (see HACameraProxy.cameraHlsUrl). Played
//     via hls.js whenever it's supported (which fetches the playlist/segments
//     over XHR and feeds MediaSource itself, so it works through the
//     Ingress/proxy chain where the native <video> HLS player chokes on the
//     Content-Type); native HLS is used only as a fallback for browsers
//     without MSE (real iOS Safari).
//  2. MJPEG (camera_proxy_stream) — for cameras without stream support, or
//     wherever HLS setup/playback fails for any reason.
//  3. Still-image polling (camera_proxy) — works for essentially any camera,
//     the least smooth but the most universally compatible fallback.

import { useCallback, useEffect, useRef, useState } from "react";
// Type-only import: hls.js (~165 KB gzipped) is loaded on demand — see the HLS
// setup effect's dynamic import() — so a kiosk that never opens a camera panel
// never pays for it in the main bundle. This line compiles away entirely.
import type Hls from "hls.js";
import { X, VideoOff, Maximize2, Minimize2, ZoomOut, ChevronLeft, ChevronRight, Power, Check, Video } from "lucide-react";
import type { PanelProps } from "@/types/panel.types";
import { usePanelActions } from "./PanelActionsContext";
import { useHA } from "@/ha/HAStateStore";
import { cameraStreamUrl, cameraSnapshotUrl, cameraHlsUrl } from "@/ha/HACameraProxy";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useMediaZoom } from "@/hooks/useMediaZoom";
import { devLog } from "@/utils/devLog";
import { STATUS_COLOR } from "@/utils/stateColors";
import { fetchStateHistory } from "@/ha/HAHistoryAPI";
import { mergeStateHistories } from "./chartUtils";
import StateTimeline from "./StateTimeline";
import type { StateHistoryPoint } from "@/types/ha.types";

interface Props extends PanelProps {
  /** Lets the camera pin continuous rendering while the stream is open. */
  pinContinuous?: () => () => void;
  /** Swap this panel to another entity — drives the prev/next camera buttons. */
  onOpenEntity?: (entityId: string) => void;
}

type Mode = "hls" | "stream" | "snapshot" | "failed";

// How long the title + status/controls chrome stays up after the last bit of
// pointer/touch/key activity before fading back out. Long enough to read the
// status bar and reach a control without racing it; short enough that the
// feed is unobstructed whenever nobody is actually interacting.
const CHROME_IDLE_MS = 3200;
// A touch counts as a TAP (and so toggles the chrome) only if the finger
// neither travelled nor lingered — otherwise a pan/pinch of a zoomed feed
// would flip the chrome on every gesture. Slop is generous because a finger
// on glass always drifts a little.
const TAP_SLOP_PX = 12;
const TAP_MAX_MS = 400;
// A horizontal drag across an UNZOOMED feed steps to the neighbouring camera.
// Needs real travel and a clearly horizontal direction, so it can't be
// confused with a tap or with a vertical drag. useMediaZoom only begins a pan
// once already zoomed in, so at 1x this gesture is otherwise unused.
const SWIPE_MIN_PX = 48;
const SWIPE_DIR_RATIO = 1.6;
// How often to refresh the fallback snapshot, and how many consecutive snapshot
// failures to tolerate before declaring the camera unavailable.
const SNAPSHOT_INTERVAL_MS = 800;
const SNAPSHOT_MAX_ERRORS = 3;
// How long to wait for the MJPEG stream to paint its FIRST frame before giving
// up on it. A camera that doesn't actually serve an MJPEG stream (most
// RTSP/ONVIF/HLS cameras) leaves HA's camera_proxy_stream connection open
// without ever sending a frame — the <img> then fires neither load nor error,
// so without this watchdog we'd sit on a blank view forever. Generous: seen
// in the field going through an external tunnel (Ingress -> Supervisor ->
// Core -> tunnel), where the extra hops add real latency on top of whatever
// HA itself takes to start decoding the camera's feed.
const STREAM_WATCHDOG_MS = 6000;
// Same idea for HLS, but longer still: on the FIRST request for a given
// camera, HA has to spin up its own FFmpeg-based stream worker before it can
// serve even the master playlist, and the extra hops over a tunnel add
// latency on top. If this still isn't enough, the fallback chain means
// nothing breaks either way — it just takes longer to drop to MJPEG/snapshot.
const HLS_WATCHDOG_MS = 15000;

export default function CameraPanel({ mapping, onClose, pinContinuous, onOpenEntity }: Props) {
  const { connected, ws, entities } = useHA();
  const entityLabel = useEntityLabel();
  // Same linked-entity switch every OTHER panel gets from the shared BasePanel
  // chrome — this panel is the one that doesn't use BasePanel (it's a
  // fullscreen feed, not a modal card), so it reads the identical context and
  // renders the control in its own bottom bar instead of re-deriving anything.
  const { linked } = usePanelActions();
  const [mode, setMode] = useState<Mode>("hls");
  const [tick, setTick] = useState(0);
  const snapErrors = useRef(0);
  // Set once the MJPEG <img> paints a frame — tells the watchdog the stream is live.
  const streamLoaded = useRef(false);
  // Same, for the HLS <video> — set on its first real playing frame.
  const hlsLoaded = useRef(false);
  const hlsVideoRef = useRef<HTMLVideoElement>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);
  // Whether hls.js (not native HLS) drives this <video> element. Deliberately
  // NOT the same thing as "hlsInstanceRef.current is set": that ref gets nulled
  // out during cleanup, but the native <video> `error` event it can trigger
  // (hls.js's own destroy() does this) fires asynchronously — by the time it
  // arrives the ref is already null. This ref answers "is hls.js this
  // element's player" and is never reset once set (a browser's HLS path
  // doesn't change within a session), so the onError guard can rely on it
  // regardless of teardown timing.
  const usingHlsJsRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
  const [railVertical, setRailVertical] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (max-height: 560px)");
    const sync = () => setRailVertical(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
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

  // Long-press (or hold, on mouse) either prev/next arrow opens a picker
  // listing every camera by name — jump straight to one instead of cycling
  // through them one at a time. Same tap-vs-hold convention as the Rooms
  // dial / default-view anchor buttons elsewhere in the app: a plain tap
  // still steps as before; only a HOLD opens the picker, so this is purely
  // additive and never intrudes on the existing gesture.
  const CAMERA_PICKER_HOLD_MS = 480;
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerLongFired = useRef(false);
  const onCycleBtnDown = () => {
    pickerLongFired.current = false;
    if (pickerPressTimer.current) clearTimeout(pickerPressTimer.current);
    pickerPressTimer.current = setTimeout(() => {
      pickerLongFired.current = true;
      setPickerOpen(true);
    }, CAMERA_PICKER_HOLD_MS);
  };
  const onCycleBtnUp = () => {
    if (pickerPressTimer.current) { clearTimeout(pickerPressTimer.current); pickerPressTimer.current = null; }
  };
  const onCycleBtnClick = (delta: number) => {
    // A hold that already opened the picker must not ALSO step to the next
    // camera the instant the button is released (a held pointer still fires
    // a native click on release) — swallow exactly that one click.
    if (pickerLongFired.current) { pickerLongFired.current = false; return; }
    stepCamera(delta);
  };
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPickerOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  // Swipe left/right on the feed itself cycles cameras — the touch
  // equivalent of the prev/next buttons. Gated on NOT zoomed: a single-finger
  // drag is already a complete no-op in useMediaZoom until the feed is zoomed
  // in (panning only starts once scale > 1 there), so this coexists with pinch
  // /pan without fighting over the same pointer events — swipes only resolve
  // to a camera change while the feed is at its default 1x framing.
  useEffect(() => {
    const el = zoom.ref.current;
    if (!el || !canCycle) return;
    let downX = 0, downY = 0, downT = 0, tracking = false;
    const SWIPE_MIN_PX = 60;
    const SWIPE_MAX_MS = 600;
    const onDown = (e: PointerEvent) => {
      if (zoomedRef.current) return;
      tracking = true;
      downX = e.clientX; downY = e.clientY; downT = Date.now();
    };
    const onUp = (e: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      if (zoomedRef.current) return;
      const dx = e.clientX - downX, dy = e.clientY - downY;
      if (Date.now() - downT <= SWIPE_MAX_MS
          && Math.abs(dx) >= SWIPE_MIN_PX
          && Math.abs(dx) > Math.abs(dy) * 1.5) {
        stepCameraRef.current(dx < 0 ? 1 : -1); // swipe left -> next, right -> previous
      }
    };
    const onCancel = () => { tracking = false; };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
    };
  }, [canCycle, zoom.ref]);

  // Bottom status bar: this camera's own online/offline history, layered with
  // its MOTION sensor's (mapping.motionEntityId, set in Advanced Settings)
  // on/off history — merged into ONE composite timeline (see
  // mergeStateHistories) and rendered through the SAME StateTimeline every
  // other panel's "Last 24 hours" chart uses, just slim and pinned to the
  // screen edge instead of sitting in a scrollable panel body. Reads the
  // motion sensor, NOT linkedEntityId: this band answers "did it detect
  // anything", which is the sensor's job — linkedEntityId only says whether
  // detection was armed (and drives the badge ring, see EntityVisuals).
  const [statusHistory, setStatusHistory] = useState<StateHistoryPoint[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    const motionId = mapping.motionEntityId;
    // keepUnavailable on BOTH series — this bar's entire subject is
    // reachability, so a gap is the signal, not noise:
    //   * the camera's own `unavailable` is what the "offline" band below is
    //     for, and without this it never arrives to be drawn;
    //   * the motion sensor's matters too, in the other direction — dropping
    //     its unavailable points leaves the last known state standing, so a
    //     sensor that went offline while reading `on` would paint red for the
    //     whole outage. Kept, it stops being `on` and the bar stops claiming
    //     motion nobody detected.
    Promise.all([
      fetchStateHistory(mapping.entityId, 24, { keepUnavailable: true }),
      motionId
        ? fetchStateHistory(motionId, 24, { keepUnavailable: true })
        : Promise.resolve<StateHistoryPoint[]>([]),
    ]).then(([camHist, motionHist]) => {
      if (cancelled) return;
      setStatusHistory(mergeStateHistories(
        { camera: camHist, motion: motionHist },
        (cur) => {
          if (!cur.camera || cur.camera === "unavailable" || cur.camera === "unknown") return "offline";
          if (motionId && cur.motion === "on") return "motion";
          return "online";
        },
      ));
      setStatusLoading(false);
    }).catch(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, [mapping.entityId, mapping.motionEntityId]);

  // Whether the current tier has painted a real frame yet — drives the loading
  // spinner so an empty <video>/<img> mid-setup reads as "loading", not "broken".
  const [frameReady, setFrameReady] = useState(false);
  // Whether the instant snapshot preview (see below) has a frame to show.
  // HLS setup can take several seconds on a camera's first open (HA has to
  // spin up its own FFmpeg stream worker) — showing a spinner for all of that
  // reads as "slow"/"broken" even though it's working as intended. Overlaying
  // an immediately-available snapshot, refreshed every SNAPSHOT_INTERVAL_MS
  // until HLS actually starts playing, gives the user something live-ish to
  // look at with no visible transition once the real video takes over (it's
  // already decoding underneath by the time the overlay disappears).
  const [previewReady, setPreviewReady] = useState(false);

  const fallBackToStream = (reason: string) => {
    devLog("[Camera] HLS unavailable, falling back to MJPEG:", reason);
    streamLoaded.current = false;
    setFrameReady(false);
    setMode("stream");
  };
  const fallBackToSnapshot = (reason: string) => {
    devLog("[Camera] MJPEG unavailable, falling back to snapshot:", reason);
    snapErrors.current = 0;
    setFrameReady(false);
    setMode("snapshot");
  };

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

    // Swipe first: it is the only reading of a long horizontal drag, and
    // checking it before the tap test means a swipe can never also toggle the
    // chrome. Skipped while zoomed, where the same drag is a pan (and
    // useMediaZoom has already consumed it).
    if (!zoom.zoomed && Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_DIR_RATIO) {
      // Content follows the finger: dragging LEFT pulls the next camera in
      // from the right, which is the direction every carousel uses.
      if (cameraIds.length > 1) stepCamera(dx < 0 ? 1 : -1);
      return;
    }

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

  // Start over (try HLS again, from the top) whenever the target camera changes.
  useEffect(() => {
    setMode("hls");
    setFrameReady(false);
    setPreviewReady(false);
    snapErrors.current = 0;
    streamLoaded.current = false;
    hlsLoaded.current = false;
    zoom.reset(); // a different camera starts un-zoomed
  }, [mapping.entityId, zoom.reset]);

  // HLS setup: ask HA for a stream URL (camera/stream over the websocket), then
  // play it with hls.js (preferred whenever supported) or the native <video>
  // element (fallback for browsers without MSE — real iOS Safari). Anything
  // going wrong — the camera doesn't support the stream pipeline, the websocket
  // call fails, hls.js hits a fatal error, or the video never starts playing
  // within the watchdog window — falls straight through to the MJPEG tier.
  //
  // Deliberately NOT keyed on `connected`: any brief websocket blip (a
  // reconnect over the tunnel, harmless to everything else) would otherwise
  // tear down and rebuild this whole effect, interrupting a healthy stream.
  // The websocket is only needed for the one-time camera/stream call below,
  // which rejects cleanly (caught, falls to MJPEG) if it isn't connected then.
  useEffect(() => {
    if (mode !== "hls") return;
    const video = hlsVideoRef.current;
    if (!video) return;
    let cancelled = false;
    hlsLoaded.current = false;

    const watchdog = setTimeout(() => {
      if (!hlsLoaded.current) fallBackToStream("no frame within watchdog window");
    }, HLS_WATCHDOG_MS);

    const onPlaying = () => { hlsLoaded.current = true; setFrameReady(true); };
    video.addEventListener("playing", onPlaying);

    (async () => {
      try {
        // Loaded on demand (see the type-only import up top) — most kiosks
        // never open a camera panel at all, so this shouldn't cost first paint.
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        const canHlsJs = Hls.isSupported();
        // canPlayType("application/vnd.apple.mpegurl") is NOT a reliable "can
        // actually play HLS" signal — Chrome/Chromium returns a truthy "maybe"
        // but then can't demux the playlist (DEMUXER_ERROR_COULD_NOT_PARSE).
        // So native HLS is only trusted as a fallback for when hls.js's
        // MediaSource path isn't available (real iOS Safari). hls.js first,
        // native only when hls.js can't run.
        const canNative =
          !canHlsJs && video.canPlayType("application/vnd.apple.mpegurl") !== "";
        if (!canHlsJs && !canNative) {
          fallBackToStream("HLS unsupported in this browser");
          return;
        }

        const url = await cameraHlsUrl(ws, mapping.entityId);
        if (cancelled) return;

        if (canNative) {
          // Native HLS (iOS Safari) — hardware-accelerated, and the only
          // option here since hls.js can't run.
          video.src = url;
          void video.play().catch(() => {}); // autoplay may need the user's first tap; not an error
        } else {
          usingHlsJsRef.current = true;
          const hls = new Hls({ lowLatencyMode: true });
          hlsInstanceRef.current = hls;
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            // Non-fatal errors (e.g. a transient bufferStalledError) are
            // retried and recovered by hls.js on its own — only a fatal one
            // means the stream can't continue, so only that drops to MJPEG.
            if (data.fatal) {
              fallBackToStream(`hls.js fatal error: ${data.details}`);
            }
          });
          // Wait for the manifest before calling play() — calling it
          // immediately after attachMedia (before hls.js has anything
          // buffered) is a known source of autoplay getting silently dropped.
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            void video.play().catch(() => {});
          });
          hls.loadSource(url);
          hls.attachMedia(video);
        }
      } catch (err) {
        if (!cancelled) fallBackToStream(`stream URL request failed: ${(err as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      video.removeEventListener("playing", onPlaying);
      if (hlsInstanceRef.current) {
        // hls.js owns the MediaSource/SourceBuffers it attached — destroy()
        // detaches and tears them down cleanly. Doing our own
        // removeAttribute("src") + load() on top of that fires a spurious
        // native <video> error from our own teardown, so let destroy() be the
        // only teardown on this path.
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
        usingHlsJsRef.current = false;
      } else {
        // Native HLS — we set video.src ourselves, so we clear it too.
        video.removeAttribute("src");
        video.load();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mapping.entityId]);

  // Stream watchdog: if the MJPEG <img> hasn't painted a frame within the window,
  // assume the camera doesn't serve MJPEG and drop to snapshot polling. This is
  // the case the bare onError handler can't catch (the request just hangs open).
  useEffect(() => {
    if (mode !== "stream") return;
    streamLoaded.current = false;
    const id = setTimeout(() => {
      if (!streamLoaded.current) fallBackToSnapshot("no frame within watchdog window");
    }, STREAM_WATCHDOG_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mapping.entityId]);

  // Refresh the cache-busted snapshot URL on an interval for liveness — either
  // because we've fallen back to snapshot polling as the real tier, or because
  // it's standing in as the instant preview while HLS is still setting up (see
  // previewReady). Stops the moment HLS actually starts playing.
  useEffect(() => {
    if (mode !== "snapshot" && !(mode === "hls" && !frameReady)) return;
    const id = setInterval(() => setTick((t) => t + 1), SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [mode, frameReady]);

  // Camera frames route through the add-on's Supervisor proxy, which injects
  // real auth server-side — so the URLs carry no token at all (see HACameraProxy).
  const streamUrl = cameraStreamUrl(mapping.entityId);
  const snapshotBase = cameraSnapshotUrl(mapping.entityId);
  // Cache-bust each poll so the browser actually re-requests the frame.
  const snapshotUrl = snapshotBase
    ? `${snapshotBase}${snapshotBase.includes("?") ? "&" : "?"}_=${tick}`
    : "";

  const onSnapshotError = () => {
    snapErrors.current += 1;
    if (snapErrors.current >= SNAPSHOT_MAX_ERRORS) setMode("failed");
  };

  const renderView = () => {
    if (!connected) return <Unavailable label="Not connected to Home Assistant." />;
    if (mode === "failed") return <Unavailable label="Camera stream unavailable." />;

    if (mode === "hls") {
      // No src set here — the HLS setup effect drives this element directly
      // (hls.js attachMedia, or a native .src on iOS Safari); auth rides the
      // websocket / same-origin proxy.
      return (
        <div className="camera-hls-wrap">
          <video
            ref={hlsVideoRef}
            autoPlay
            muted
            playsInline
            onError={() => {
              // hls.js reports its OWN errors via Hls.Events.ERROR (see the
              // setup effect) — that's the authoritative signal while it's in
              // control, so a native <video> error on top of it (its internal
              // recovery churn, or our own teardown) is not a real failure.
              // Only treat a native error as fatal on the native-HLS path,
              // where there's no other error signal.
              if (!usingHlsJsRef.current) fallBackToStream("native video element error");
            }}
          />
          {/* Instant stand-in while HLS is still setting up (HA has to spin up
              its own FFmpeg worker on first open, which can take several
              seconds) — snapshot polling is already near-instant, so this
              covers the gap. Disappears the moment the video paints its own
              first frame (frameReady), by which point it's already decoding
              underneath, so the swap is invisible. */}
          {!frameReady && (
            <img
              className="camera-preview"
              src={snapshotUrl}
              alt=""
              onLoad={() => setPreviewReady(true)}
              onError={() => setPreviewReady(false)}
            />
          )}
        </div>
      );
    }

    if (mode === "stream") {
      // MJPEG attempt — on error (or the watchdog timing out on a silent stream),
      // drop to the universally-supported snapshot poll.
      return (
        <img
          src={streamUrl}
          alt={mapping.label}
          onLoad={() => { streamLoaded.current = true; setFrameReady(true); }}
          onError={() => fallBackToSnapshot("MJPEG image error")}
        />
      );
    }

    // mode === "snapshot"
    return (
      <img
        key="snapshot"
        src={snapshotUrl}
        alt={mapping.label}
        onError={onSnapshotError}
        onLoad={() => {
          snapErrors.current = 0;
          setFrameReady(true);
        }}
      />
    );
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
            "loading" — cover it with a spinner until a real frame arrives.
            Skipped on the hls tier once the instant snapshot preview is up:
            that already reads as "live", not "loading". */}
        {connected &&
          mode !== "failed" &&
          !frameReady &&
          !(mode === "hls" && previewReady) && (
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
                  swallowed by the shared long-press flag that exists only to
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
                onPointerDown={onCycleBtnDown}
                onPointerUp={onCycleBtnUp}
                onPointerLeave={onCycleBtnUp}
                onPointerCancel={onCycleBtnUp}
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
