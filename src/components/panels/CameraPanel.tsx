// src/components/panels/CameraPanel.tsx
// Full-screen camera takeover (not a bottom sheet).
//
// Tries HA's MJPEG stream first (smooth, low-latency). Cameras that don't
// implement an MJPEG stream (most RTSP/ONVIF/HLS cameras — they play in HA via
// the stream component, not camera_proxy_stream) make the <img> error; we then
// fall back to polling the still-image endpoint, which works for any camera.

import { useEffect, useRef, useState } from "react";
import { X, VideoOff, Maximize2, Minimize2 } from "lucide-react";
import type { PanelProps } from "@/types/panel.types";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { isIngress } from "@/ha/ingress";
import { cameraStreamUrl, cameraSnapshotUrl } from "@/ha/HACameraProxy";

interface Props extends PanelProps {
  /** Lets the camera pin continuous rendering while the stream is open. */
  pinContinuous?: () => () => void;
}

type Mode = "stream" | "snapshot" | "failed";

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

export default function CameraPanel({ entity, mapping, onClose, pinContinuous }: Props) {
  const { connected } = useHA();
  const { config } = useConfig();
  const [mode, setMode] = useState<Mode>("stream");
  const [tick, setTick] = useState(0);
  const snapErrors = useRef(0);
  // Set once the MJPEG <img> paints a frame — tells the watchdog the stream is live.
  const streamLoaded = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);

  const fallBackToSnapshot = () => {
    snapErrors.current = 0;
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

  // Start over (try the stream again) whenever the target camera changes.
  useEffect(() => {
    setMode("stream");
    snapErrors.current = 0;
    streamLoaded.current = false;
  }, [mapping.entityId]);

  // Stream watchdog: if the MJPEG <img> hasn't painted a frame within the window,
  // assume the camera doesn't serve MJPEG and drop to snapshot polling. This is
  // the case the bare onError handler can't catch (the request just hangs open).
  useEffect(() => {
    if (mode !== "stream") return;
    streamLoaded.current = false;
    const id = setTimeout(() => {
      if (!streamLoaded.current) fallBackToSnapshot();
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

  const haveCreds = isIngress() || Boolean(config.haUrl && config.haToken);
  const streamUrl = haveCreds ? cameraStreamUrl(config.haUrl, config.haToken, mapping.entityId) : "";
  const snapshotBase = haveCreds ? cameraSnapshotUrl(config.haUrl, config.haToken, mapping.entityId) : "";
  // Cache-bust each poll so the browser actually re-requests the frame.
  const snapshotUrl = snapshotBase
    ? `${snapshotBase}${snapshotBase.includes("?") ? "&" : "?"}_=${tick}`
    : "";

  const lastMotion = entity?.attributes.last_motion ?? entity?.last_changed;

  const onSnapshotError = () => {
    snapErrors.current += 1;
    if (snapErrors.current >= SNAPSHOT_MAX_ERRORS) setMode("failed");
  };

  const renderView = () => {
    if (!connected) return <Unavailable label="Not connected to Home Assistant." />;
    if (!haveCreds || mode === "failed") return <Unavailable label="Camera stream unavailable." />;

    if (mode === "stream") {
      // MJPEG attempt — on error (or the watchdog timing out on a silent stream),
      // drop to the universally-supported snapshot poll.
      return (
        <img
          src={streamUrl}
          alt={mapping.label}
          onLoad={() => { streamLoaded.current = true; }}
          onError={fallBackToSnapshot}
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
