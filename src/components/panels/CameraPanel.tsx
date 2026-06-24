// src/components/panels/CameraPanel.tsx
// Full-screen camera takeover (not a bottom sheet).
//
// Tries HA's MJPEG stream first (smooth, low-latency). Cameras that don't
// implement an MJPEG stream (most RTSP/ONVIF/HLS cameras — they play in HA via
// the stream component, not camera_proxy_stream) make the <img> error; we then
// fall back to polling the still-image endpoint, which works for any camera.

import { useEffect, useRef, useState } from "react";
import { X, VideoOff } from "lucide-react";
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
const SNAPSHOT_INTERVAL_MS = 1000;
const SNAPSHOT_MAX_ERRORS = 3;

export default function CameraPanel({ entity, mapping, onClose, pinContinuous }: Props) {
  const { connected } = useHA();
  const { config } = useConfig();
  const [mode, setMode] = useState<Mode>("stream");
  const [tick, setTick] = useState(0);
  const snapErrors = useRef(0);

  useEffect(() => {
    const unpin = pinContinuous?.();
    return () => unpin?.();
  }, [pinContinuous]);

  // Start over (try the stream again) whenever the target camera changes.
  useEffect(() => {
    setMode("stream");
    snapErrors.current = 0;
  }, [mapping.entityId]);

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
      // MJPEG attempt — on error, drop to the universally-supported snapshot poll.
      return (
        <img
          src={streamUrl}
          alt={mapping.label}
          onError={() => {
            snapErrors.current = 0;
            setMode("snapshot");
          }}
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
    <div className="camera-fullscreen">
      <div className="label">
        {mapping.label}
        {lastMotion && (
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            updated {new Date(lastMotion as string).toLocaleTimeString()}
          </span>
        )}
      </div>
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
