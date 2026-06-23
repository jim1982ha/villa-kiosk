// src/ha/HAServiceCalls.ts
// Typed service-call wrappers. Each takes the live HAWebSocket instance.

import type { HAWebSocket } from "./HAWebSocket";

type WS = HAWebSocket;
const t = (entityId: string) => ({ entity_id: entityId });

export const HAServices = {
  // --- Lights ---
  toggleLight: (ws: WS, id: string) => ws.callService("light", "toggle", {}, t(id)),
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
  toggleFan: (ws: WS, id: string) => ws.callService("fan", "toggle", {}, t(id)),
  setFanPercentage: (ws: WS, id: string, percentage: number) =>
    ws.callService("fan", "set_percentage", { percentage }, t(id)),
  setFanPreset: (ws: WS, id: string, preset_mode: string) =>
    ws.callService("fan", "set_preset_mode", { preset_mode }, t(id)),

  // --- Switches ---
  toggleSwitch: (ws: WS, id: string) => ws.callService("switch", "toggle", {}, t(id)),

  // --- Generic toggle (works for switch, input_boolean, light, fan, …) ---
  toggleEntity: (ws: WS, id: string) => ws.callService("homeassistant", "toggle", {}, t(id)),

  // --- Media ---
  toggleMedia: (ws: WS, id: string) => ws.callService("media_player", "toggle", {}, t(id)),
  mediaPlayPause: (ws: WS, id: string) => ws.callService("media_player", "media_play_pause", {}, t(id)),
};
