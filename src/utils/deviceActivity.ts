// src/utils/deviceActivity.ts
// One place that turns a live HA entity into "on"/"off"/"alert"/"info" —
// used everywhere a device needs a coloured badge/ring: the 3D map badge
// (babylon/EntityVisuals.ts, which additionally overlays its own
// linkActiveIds signal for a linked entity), the panel header icon
// (Dashboard.tsx) and the device-group list (SummaryGroupPanel.tsx).
// Exhaustive over EntityType: every domain must resolve its OWN "on" from
// its own state vocabulary — camera and assist_satellite are never
// literally "on". Does NOT handle "unavailable"/"unknown" — callers check
// that first (see isUnavailable), since it outranks this classification
// everywhere it's used.

import type { HassEntity } from "@/types/ha.types";
import type { EntityType } from "@/types/scene.types";

export type DeviceActivity = "on" | "off" | "alert" | "info";

// A known-bad enum/status reading — the value stays shown and the badge
// rings red/alerts, so a real change is never silently swallowed. An
// unrecognised value (e.g. a weather "sunny") is neither: shown as "info",
// un-ringed.
const SENSOR_ALERT_STATES = new Set([
  "disconnected", "offline", "error", "fault", "faulted", "failed", "fail",
  "unreachable", "down", "disabled", "problem", "alarm", "tripped",
]);

export function classifyDeviceActivity(type: EntityType, s: HassEntity): DeviceActivity {
  switch (type) {
    // Locked is the normal, secure state — quiet, no signal. Only an
    // unlocked door demands attention (alert, not a plain "on").
    case "lock":          return s.state === "locked" ? "off" : "alert";
    case "binary_sensor": return s.state === "on" ? "alert" : "off";
    case "climate":       return s.state === "off" ? "off" : "on";
    case "cover": {
      const pos = s.attributes.current_position as number | undefined;
      if (pos != null) return pos > 0 ? "on" : "off";
      return s.state === "closed" ? "off" : "on";
    }
    case "media_player":  return s.state === "playing" || s.state === "buffering" ? "on" : "off";
    case "camera":        return s.state === "recording" || s.state === "streaming" ? "on" : "off";
    case "assist_satellite": return s.state === "idle" ? "off" : "on"; // listening/processing/responding
    case "sensor":
      return SENSOR_ALERT_STATES.has(s.state.trim().toLowerCase()) ? "alert" : "info";
    default:              return s.state === "on" ? "on" : "off"; // light/fan/switch/input_boolean
  }
}
