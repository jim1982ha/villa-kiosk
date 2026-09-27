// src/ha/HAServiceCalls.ts
// Typed service-call wrappers. Each takes the live HAWebSocket instance.

import type { HAWebSocket } from "./HAWebSocket";
import type { HassEntity } from "@/types/ha.types";
import { devicePower } from "@/utils/devicePower";

type WS = HAWebSocket;
const t = (entityId: string) => ({ entity_id: entityId });

export const HAServices = {
  /** Throw a device's power switch the other way — the service is
   *  devicePower's (lock/unlock, open/close, a domain's own toggle); nothing
   *  is sent when its position is unknown. */
  power: (ws: WS, entity: HassEntity | undefined, id: string) => {
    const f = devicePower(entity, id).flip;
    if (f) void ws.callService(f.domain, f.service, {}, t(id));
  },
  // --- Lights ---
  setLightBrightness: (ws: WS, id: string, brightness: number) =>
    ws.callService("light", "turn_on", { brightness }, t(id)),
  setLightColorTemp: (ws: WS, id: string, kelvin: number) =>
    ws.callService("light", "turn_on", { color_temp_kelvin: kelvin }, t(id)),

  // --- Climate ---
  setTemperature: (ws: WS, id: string, temperature: number) =>
    ws.callService("climate", "set_temperature", { temperature }, t(id)),
  setHvacMode: (ws: WS, id: string, hvac_mode: string) =>
    ws.callService("climate", "set_hvac_mode", { hvac_mode }, t(id)),
  setFanMode: (ws: WS, id: string, fan_mode: string) =>
    ws.callService("climate", "set_fan_mode", { fan_mode }, t(id)),

  // --- Locks ---
  lockDoor: (ws: WS, id: string) => ws.callService("lock", "lock", {}, t(id)),
  unlockDoor: (ws: WS, id: string) => ws.callService("lock", "unlock", {}, t(id)),

  // --- Covers (curtains) ---
  openCover: (ws: WS, id: string) => ws.callService("cover", "open_cover", {}, t(id)),
  closeCover: (ws: WS, id: string) => ws.callService("cover", "close_cover", {}, t(id)),
  stopCover: (ws: WS, id: string) => ws.callService("cover", "stop_cover", {}, t(id)),
  setCoverPosition: (ws: WS, id: string, position: number) =>
    ws.callService("cover", "set_cover_position", { position }, t(id)),

  // --- Fans ---
  setFanPercentage: (ws: WS, id: string, percentage: number) =>
    ws.callService("fan", "set_percentage", { percentage }, t(id)),
  setFanPreset: (ws: WS, id: string, preset_mode: string) =>
    ws.callService("fan", "set_preset_mode", { preset_mode }, t(id)),

  // --- Switches ---

  // --- Generic toggle (works for switch, input_boolean, light, fan, …) ---

  // --- Media ---
  mediaPlayPause: (ws: WS, id: string) => ws.callService("media_player", "media_play_pause", {}, t(id)),
};
