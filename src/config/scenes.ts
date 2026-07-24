// src/config/scenes.ts
// Kiosk-side "scenes" — user-defined snapshots of the villa's controllable
// state that can be re-applied with one tap from the SummaryBar. Distinct from
// Home Assistant's own `scene.*` entities (those still work too, activated
// directly) — these live in the kiosk's config so a user can capture "how the
// villa is set up right now" without touching HA's scene editor.
//
// Deliberately NOT called "profiles" — that word is the RBAC role concept
// (Owner/Family/…). A scene captures DEVICE STATE; a profile is WHO you are.

import type { HassEntity, HassServiceTarget } from "@/types/ha.types";

/** One replayable service call, precomputed at capture time so applying a
 *  scene is just "fire these calls" with no per-domain logic at apply time. */
export interface SceneCall {
  domain: string;
  service: string;
  entityId: string;
  data?: Record<string, unknown>;
}

export interface KioskScene {
  id: string;
  name: string;
  createdAt: string;
  /** Optional lucide-ish icon key for the tile (reserved; defaults to a spark). */
  icon?: string;
  calls: SceneCall[];
}

// Only domains whose state can be meaningfully SET are captured — sensors,
// cameras and binary_sensors are readings, not settables, so they're skipped.
const CONTROLLABLE = new Set([
  "light", "switch", "input_boolean", "fan", "climate", "cover", "lock",
]);

const OFF_LIKE = new Set(["off", "unavailable", "unknown", ""]);

/** The service call(s) that reproduce this entity's CURRENT state. */
function callsForEntity(e: HassEntity): SceneCall[] {
  const domain = e.entity_id.split(".")[0];
  const id = e.entity_id;
  switch (domain) {
    case "switch":
    case "input_boolean":
      return [{ domain, service: e.state === "on" ? "turn_on" : "turn_off", entityId: id }];

    case "light": {
      if (e.state !== "on") return [{ domain, service: "turn_off", entityId: id }];
      const data: Record<string, unknown> = {};
      if (typeof e.attributes.brightness === "number") data.brightness = e.attributes.brightness;
      const ct = (e.attributes as Record<string, unknown>).color_temp;
      if (typeof ct === "number") data.color_temp = ct;
      const rgb = (e.attributes as Record<string, unknown>).rgb_color;
      if (Array.isArray(rgb)) data.rgb_color = rgb;
      return [{ domain, service: "turn_on", entityId: id, data }];
    }

    case "fan": {
      if (e.state !== "on") return [{ domain, service: "turn_off", entityId: id }];
      const p = e.attributes.percentage;
      return [{ domain, service: "turn_on", entityId: id, data: typeof p === "number" ? { percentage: p } : undefined }];
    }

    case "climate": {
      const calls: SceneCall[] = [
        { domain, service: "set_hvac_mode", entityId: id, data: { hvac_mode: e.state } },
      ];
      const t = e.attributes.temperature;
      if (typeof t === "number" && e.state !== "off") {
        calls.push({ domain, service: "set_temperature", entityId: id, data: { temperature: t } });
      }
      return calls;
    }

    case "cover": {
      const pos = e.attributes.current_position;
      if (typeof pos === "number") {
        return [{ domain, service: "set_cover_position", entityId: id, data: { position: pos } }];
      }
      return [{ domain, service: e.state === "closed" ? "close_cover" : "open_cover", entityId: id }];
    }

    case "lock":
      return [{ domain, service: e.state === "locked" ? "lock" : "unlock", entityId: id }];

    default:
      return [];
  }
}

/** Snapshot every controllable entity's current state into a named scene. */
export function captureScene(name: string, entities: Record<string, HassEntity>): KioskScene {
  const calls: SceneCall[] = [];
  for (const e of Object.values(entities)) {
    if (!CONTROLLABLE.has(e.entity_id.split(".")[0])) continue;
    if (OFF_LIKE.has(e.state) && e.state !== "off") continue; // skip unavailable/unknown
    calls.push(...callsForEntity(e));
  }
  return {
    id: `kscene_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "Scene",
    createdAt: new Date().toISOString(),
    calls,
  };
}

/** Fire a scene's calls (best-effort, in parallel) — one failing device never
 *  aborts the rest. */
export async function applyScene(
  scene: KioskScene,
  callService: (domain: string, service: string, data?: Record<string, unknown>, target?: HassServiceTarget) => Promise<void>,
): Promise<void> {
  await Promise.allSettled(
    scene.calls.map((c) => callService(c.domain, c.service, c.data ?? {}, { entity_id: c.entityId })),
  );
}
