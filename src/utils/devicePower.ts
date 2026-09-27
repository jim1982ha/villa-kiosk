// src/utils/devicePower.ts
// A device's POWER: which way its switch sits, and the one service that
// throws it — for every panel's big button, the 3D quick tap, a device's
// linked-entity switch, the device lists' row switches and the linked ring on
// the map.
//
// ⚠️ EIGHT SITES DECIDED IT THEMSELVES (round 11, 2.496.164). The Fan, Light
// and Switch panels tested `state === "on"`, the Media panel its own list, the
// linked switch and the map's linked ring `=== "on"` — so a LOCK or a COVER
// chosen as a device's linked entity read "Off" when unlocked or open, and
// "Off" again when Home Assistant had lost it — and the flip was
// `homeassistant.toggle` for the linked switch and the quick tap (a lock has
// no toggle), `light.toggle` / `fan.toggle` / `media_player.toggle` in their
// panels, lock/unlock in the lists. entityState.switchPosition already owned
// the three answers; nothing but the lists asked it.
//
// POWER, NOT ACTIVITY: a paused TV is ON here (its power button), while its
// map badge — deviceActivity, a different question — rests until it plays.
//
// Pure: tests/oracles/device_power.mjs.

import type { HassEntity } from "@/types/ha.types";
import { isUnavailable } from "@/utils/stateColors";
import { switchPosition, type SwitchPosition } from "@/utils/entityState";

export interface DevicePower {
  /** "unknown": not observed (unavailable, a lock in motion) — no switch. */
  position: SwitchPosition;
  /** The service that throws it the other way; null when it cannot be thrown. */
  flip: { domain: string; service: string } | null;
}

/** A media player is powered in any of these (a paused or idle TV is ON). */
const MEDIA_POWERED = new Set(["on", "idle", "playing", "paused", "buffering"]);
/** Domains with their own toggle service. */
const OWN_TOGGLE = new Set(["light", "switch", "fan", "input_boolean", "media_player"]);

export function devicePower(e: HassEntity | undefined, entityId?: string): DevicePower {
  const id = e?.entity_id ?? entityId ?? "";
  const domain = id.split(".")[0];
  let position: SwitchPosition;
  if (domain === "media_player") {
    position = isUnavailable(e) || !e ? "unknown" : MEDIA_POWERED.has(e.state) ? "on" : "off";
  } else if (domain === "cover") {
    // Open (or partly open) is "on" — the state a person acts on — and a
    // cover in motion is unknown, like a lock.
    position = isUnavailable(e) || !e ? "unknown"
      : e.state === "opening" || e.state === "closing" ? "unknown"
      : e.state === "closed" ? "off" : "on";
  } else {
    position = switchPosition(e, domain);
  }
  if (position === "unknown") return { position, flip: null };
  const on = position === "on";
  const flip = domain === "lock" ? { domain, service: on ? "lock" : "unlock" }
    : domain === "cover" ? { domain, service: on ? "close_cover" : "open_cover" }
    : OWN_TOGGLE.has(domain) ? { domain, service: "toggle" }
    : { domain: "homeassistant", service: "toggle" };
  return { position, flip };
}

/** Every domain a flip can be sent to — held to the one table of what the
 *  kiosk may send (ha-commands.json) by tests/oracles/device_power.mjs. */
export const POWER_DOMAINS = ["lock", "cover", ...OWN_TOGGLE, "homeassistant"] as const;
