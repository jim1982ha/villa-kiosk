// src/components/panels/CameraPanel.tsx
// Full-screen camera takeover (not a bottom sheet).
//
// Three tiers, tried in order, each falling through to the next on failure:
//  1. HLS — the same "stream" pipeline Home Assistant's own frontend prefers
//     for any camera that supports it (see HACameraProxy.cameraHlsUrl for why
//     this is usually the smoothest option, and often the ONLY thing that
//     matches how the camera looks in the HA UI itself).
//  2. MJPEG (camera_proxy_stream) — for cameras without stream support, or
//     wherever HLS setup/playback fails for any reason.
//  3. Still-image polling (camera_proxy) — works for essentially any camera,
//     the least smooth but the most universally compatible fallback.

import { useEffect, useRef, useState } from "react";
// Type-only import: hls.js (~165 KB gzipped) is loaded on demand — see the HLS
// setup effect's dynamic import() — so a kiosk that never opens a camera panel
// never pays for it in the main bundle. This line compiles away entirely.
import type Hls from "hls.js";
import { X, VideoOff, Maximize2, Minimize2 } from "lucide-react";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { isIngress } from "@/ha/ingress";
import { cameraStreamUrl, cameraSnapshotUrl, cameraHlsUrl } from "@/ha/HACameraProxy";
import { devLog } from "@/utils/devLog";

interface Props extends PanelProps {
  /** Lets the camera pin continuous rendering while the stream is open. */
  pinContinuous?: () => () => void;
}

type Mode = "hls" | "stream" | "snapshot" | "failed";

// How often to refresh the fallback snapshot, and how many consecutive snapshot
// failures to tolerate before declaring the camera unavailable.
const SNAPSHOT_INTERVAL_MS = 800;
const SNAPSHOT_MAX_ERRORS = 3;
// How long to wait for the MJPEG stream to paint its FIRST frame before giving
// up on it. A camera that doesn't actually serve an MJPEG stream (most
// RTSP/ONVIF/HLS cameras) leaves HA's camera_proxy_stream connection open
// without ever sending a frame — the <img> then fires neither load nor error,
// so without this watchdog we'd sit on a blank view forever.
const STREAM_WATCHDOG_MS = 1000;
// Same idea for HLS: asking HA for a stream URL, letting hls.js fetch the
// playlist + first segment, and getting a decoded frame on screen all take a
// bit longer than a raw MJPEG connection — give it more room before assuming
// this camera doesn't support the stream pipeline and dropping to MJPEG.
const HLS_WATCHDOG_MS = 4000;

export default function CameraPanel({ entity, mapping, onClose, pinContinuous }: Props) {
  const { connected, ws } = useHA();
  const { config } = useConfig();
  const [mode, setMode] = useState<Mode>("hls");
  const [tick, setTick] = useState(0);
  const snapErrors = useRef(0);
  // Set once the MJPEG <img> paints a frame — tells the watchdog the stream is live.
  const streamLoaded = useRef(false);
  // Same, for the HLS <video> — set on its first real playing frame.
  const hlsLoaded = useRef(false);
  const hlsVideoRef = useRef<HTMLVideoElement>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  // TEMPORARY diagnostics (see CHANGELOG): a plain <video>/<img> gives no way
  // to tell which tier actually ended up active, or why it fell back, from
  // the kiosk screen itself — this makes that visible without needing
  // devtools on the tablet. A running LOG (not just the latest line) because
  // the tiers can fall through fast enough (HLS -> MJPEG -> snapshot in
  // under a couple seconds) that a single overwritten status line never
  // gets read before the next fallback replaces it. `frameReady` drives a
  // loading spinner so an empty <video> element mid-HLS-setup doesn't read
  // as "broken".
  const [diagLog, setDiagLog] = useState<string[]>([]);
  const [frameReady, setFrameReady] = useState(false);
  const logTransition = (line: string) => setDiagLog((prev) => [...prev, line]);

  const fallBackToStream = (reason: string) => {
    streamLoaded.current = false;
    logTransition(`HLS failed: ${reason}`);
    setFrameReady(false);
    setMode("stream");
  };
  const fallBackToSnapshot = (reason: string) => {
    snapErrors.current = 0;
    logTransition(`MJPEG failed: ${reason}`);
    setFrameReady(false);
    setMode("snapshot");
  };

  useEffect(() => {
    const unpin = pinContinuous?.();
    return () => unpin?.();
  }, [pinContinuous]);

  // Log the moment a tier actually starts painting real frames, so the trace
  // shows not just failures but which tier (if any) ended up working.
  useEffect(() => {
    if (frameReady) logTransition(`${mode.toUpperCase()} playing`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameReady]);

  // Keep the button icon in sync if the user leaves fullscreen via the Esc key
  // or the OS gesture rather than our button.
  useEffect(() => {
    const onFsChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // The feed is an <img> (MJPEG/snapshot), so there's no native video control
  // bar; a live camera has no timeline to scrub or pause. Fullscreen is the one
  // meaningful control, so we expose it via the Fullscreen API (graceful no-op
  // where unsupported — the panel already covers the screen via CSS).
  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void el.requestFullscreen?.();
    }
  };

  // Start over (try HLS again, from the top) whenever the target camera changes.
  useEffect(() => {
    setMode("hls");
    setDiagLog([]);
    setFrameReady(false);
    snapErrors.current = 0;
    streamLoaded.current = false;
    hlsLoaded.current = false;
  }, [mapping.entityId]);

  // HLS setup: ask HA for a stream URL (camera/stream over the websocket),
  // then hand it to hls.js (or the <video> element directly on Safari/iOS,
  // which speaks HLS natively). Anything going wrong here — the camera
  // doesn't support the stream pipeline, the websocket call fails, hls.js
  // hits a fatal error, or the video never actually starts playing within
  // the watchdog window — falls straight through to the MJPEG tier, exactly
  // as if HLS had never been attempted.
  useEffect(() => {
    if (mode !== "hls") return;
    if (!connected) return;
    const video = hlsVideoRef.current;
    if (!video) return;
    let cancelled = false;
    hlsLoaded.current = false;

    const watchdog = setTimeout(() => {
      if (!hlsLoaded.current) fallBackToStream("HLS timed out (no frame)");
    }, HLS_WATCHDOG_MS);

    const onPlaying = () => { hlsLoaded.current = true; setFrameReady(true); };
    video.addEventListener("playing", onPlaying);

    (async () => {
      try {
        // Loaded on demand (see the type-only import up top) — most kiosks
        // never open a camera panel at all, so this shouldn't cost first paint.
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        const canNative = video.canPlayType("application/vnd.apple.mpegurl") !== "";
        const canHlsJs = Hls.isSupported();
        if (!canNative && !canHlsJs) {
          fallBackToStream("HLS unsupported in this browser");
          return;
        }

        const url = await cameraHlsUrl(ws, config.haUrl, mapping.entityId);
        if (cancelled) return;
        // The URL HA (and our ingress/standalone resolution) actually
        // produced — the single most useful line for spotting a wrong path
        // vs. a stream that connects fine but never starts playing.
        logTransition(`HLS url: ${url}`);

        if (canNative) {
          // Safari/iOS speaks HLS natively (hardware-accelerated) — prefer it
          // over hls.js's MediaSource-based playback where both are available.
          video.src = url;
          void video.play().catch(() => {}); // autoplay may need the user's first tap; not an error
        } else {
          const hls = new Hls({ lowLatencyMode: true });
          hlsInstanceRef.current = hls;
          let loggedNonFatal = false;
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) {
              devLog("[Camera] hls.js fatal error, falling back to MJPEG:", data);
              fallBackToStream(`HLS error (${data.details})`);
            } else if (!loggedNonFatal) {
              // Only the FIRST one — hls.js retries these automatically (and
              // often silently recovers), but if the stream is stuck
              // retrying the SAME thing for the whole watchdog window, this
              // is exactly what reveals why (e.g. a 404 on the segment URL
              // means the proxy path is wrong; a CORS/network error means
              // something else entirely).
              loggedNonFatal = true;
              const status = data.response?.code;
              logTransition(
                `HLS warning: ${data.details}${status ? ` (HTTP ${status})` : ""}` +
                (data.url ? ` — ${data.url}` : ""),
              );
            }
          });
          // Wait for the manifest before calling play() — calling it
          // immediately after attachMedia (before hls.js has anything
          // buffered) is a known source of autoplay getting silently
          // dropped instead of resuming once data actually arrives.
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            void video.play().catch(() => {});
          });
          hls.loadSource(url);
          hls.attachMedia(video);
        }
      } catch (err) {
        if (!cancelled) {
          devLog("[Camera] HLS unavailable for this entity, falling back to MJPEG:", err);
          fallBackToStream(`HLS unavailable (${(err as Error).message})`);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      video.removeEventListener("playing", onPlaying);
      hlsInstanceRef.current?.destroy();
      hlsInstanceRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mapping.entityId, connected]);

  // Stream watchdog: if the MJPEG <img> hasn't painted a frame within the window,
  // assume the camera doesn't serve MJPEG and drop to snapshot polling. This is
  // the case the bare onError handler can't catch (the request just hangs open).
  useEffect(() => {
    if (mode !== "stream") return;
    streamLoaded.current = false;
    const id = setTimeout(() => {
      if (!streamLoaded.current) fallBackToSnapshot("MJPEG timed out (no frame)");
    }, STREAM_WATCHDOG_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mapping.entityId]);

  // Once we've fallen back to snapshots, re-fetch on an interval for liveness.
  useEffect(() => {
    if (mode !== "snapshot") return;
    const id = setInterval(() => setTick((t) => t + 1), SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [mode]);

  // Standalone (non-Ingress) camera URLs must carry the CAMERA'S OWN signed
  // token (its `access_token` attribute), not the long-lived token — see
  // HACameraProxy. It rides on the live entity and HA rotates it, so reading it
  // here each render keeps the URL valid.
  const camAccessToken =
    typeof entity?.attributes.access_token === "string" ? entity.attributes.access_token : "";
  const haveCreds = isIngress() || Boolean(config.haUrl && camAccessToken);
  const streamUrl = haveCreds ? cameraStreamUrl(config.haUrl, camAccessToken, mapping.entityId) : "";
  const snapshotBase = haveCreds ? cameraSnapshotUrl(config.haUrl, camAccessToken, mapping.entityId) : "";
  // Cache-bust each poll so the browser actually re-requests the frame.
  const snapshotUrl = snapshotBase
    ? `${snapshotBase}${snapshotBase.includes("?") ? "&" : "?"}_=${tick}`
    : "";

  const lastMotion = entity?.attributes.last_motion ?? entity?.last_changed;

  const onSnapshotError = () => {
    snapErrors.current += 1;
    if (snapErrors.current >= SNAPSHOT_MAX_ERRORS) {
      logTransition("Snapshot failed repeatedly");
      setMode("failed");
    }
  };

  const renderView = () => {
    if (!connected) return <Unavailable label="Not connected to Home Assistant." />;
    if (mode === "failed") return <Unavailable label="Camera stream unavailable." />;

    if (mode === "hls") {
      // No src set here — the HLS setup effect drives this element directly
      // (hls.js attachMedia, or a native .src on Safari/iOS), and doesn't
      // need camAccessToken/haveCreds at all (auth rides the websocket).
      return (
        <video
          ref={hlsVideoRef}
          autoPlay
          muted
          playsInline
          onError={() => fallBackToStream("Video element error")}
        />
      );
    }

    if (!haveCreds) return <Unavailable label="Camera stream unavailable." />;

    if (mode === "stream") {
      // MJPEG attempt — on error (or the watchdog timing out on a silent stream),
      // drop to the universally-supported snapshot poll.
      return (
        <img
          src={streamUrl}
          alt={mapping.label}
          onLoad={() => { streamLoaded.current = true; setFrameReady(true); }}
          onError={() => fallBackToSnapshot("MJPEG error")}
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
    <div className="camera-fullscreen" ref={rootRef}>
      <div className="label">
        {mapping.label}
        {lastMotion && (
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            updated {new Date(lastMotion as string).toLocaleTimeString()}
          </span>
        )}
      </div>
      <button
        className="icon-btn fs-btn"
        onClick={toggleFullscreen}
        title={isFs ? "Exit fullscreen" : "Fullscreen"}
        aria-label={isFs ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFs ? <Minimize2 size={22} /> : <Maximize2 size={22} />}
      </button>
      <button className="icon-btn close" onClick={onClose}>
        <X size={24} />
      </button>

      {renderView()}

      {/* An empty <video>/<img> mid-setup reads as "broken" rather than
          "loading" — cover it with a spinner until a real frame arrives. */}
      {connected && mode !== "failed" && !frameReady && (
        <div className="camera-loading">
          <div className="spinner" />
        </div>
      )}

      {/* TEMPORARY diagnostics while tuning the stream pipeline (see
          CHANGELOG) — the full transition trace (not just the latest line),
          since tiers can fall through fast enough that a single overwritten
          status line never gets read. Reportable straight off the kiosk
          screen without devtools. Safe to remove once HLS is confirmed
          working reliably. */}
      {connected && (
        <div className="camera-diag">
          <div>Now: {mode.toUpperCase()}</div>
          {diagLog.map((line, i) => <div key={i}>{line}</div>)}
        </div>
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
