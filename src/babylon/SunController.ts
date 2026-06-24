// src/babylon/SunController.ts
// Drives scene lighting from either the real sun position (configured lat/lng) or the
// HA sun.sun entity state. Day -> bright blue sky; night -> warm indoor glow.

import { Vector3, Color3, Color4, type Scene } from "@babylonjs/core";
import type { LightingSystem } from "./LightingSystem";
import { type AppConfig, DEFAULT_RENDER } from "@/config/AppConfig";
import { getSunPosition } from "@/utils/sunCalc";

export class SunController {
  private scene: Scene;
  private lighting: LightingSystem;
  private config: AppConfig;
  private requestRender: () => void = () => {};

  constructor(scene: Scene, lighting: LightingSystem, config: AppConfig) {
    this.scene = scene;
    this.lighting = lighting;
    this.config = config;
    this.applyRealSun();
  }

  setRenderHook(fn: () => void): void {
    this.requestRender = fn;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.applyRealSun();
  }

  /** Compute lighting from the computed sun altitude/azimuth right now. */
  applyRealSun(date = new Date()): void {
    const { latitude, longitude } = this.config;
    const { azimuth, altitude } = getSunPosition(date, latitude, longitude);
    const isDay = altitude > 0;

    // Direction the light travels: from the sun toward the scene.
    const dir = new Vector3(
      -Math.sin(azimuth) * Math.cos(altitude),
      -Math.max(0.05, Math.sin(altitude)),
      -Math.cos(azimuth) * Math.cos(altitude),
    ).normalize();

    this.applyDayNight(isDay, dir);
  }

  /** Override from HA sun.sun entity ("above_horizon" | "below_horizon"). */
  applyHaSunState(state: string): void {
    const isDay = state === "above_horizon";
    const dir = isDay ? new Vector3(-0.4, -1, -0.6) : new Vector3(-0.2, -1, -0.2);
    this.applyDayNight(isDay, dir.normalize());
  }

  private applyDayNight(isDay: boolean, dir: Vector3): void {
    // Render-quality multipliers let Settings rebalance the key light + fill
    // without touching the day/night base values here.
    const r = this.config.render ?? DEFAULT_RENDER;
    // Night used a cold blue key + blue ambient, which cast a strong cyan tint on
    // white/light surfaces (kitchen cabinets, tables) — the "blue kitchen" report.
    // Switch night to the warm, near-neutral indoor glow this file always claimed
    // to render (see the header comment): a low warm key + warm-neutral ambient so
    // white reads white at night, lifted a touch so interiors stay legible. The
    // sky (clearColor) stays dark so it still clearly reads as night.
    this.lighting.setSun(
      dir,
      (isDay ? 1.2 : 0.28) * r.sunIntensity,
      isDay ? new Color3(1.0, 0.95, 0.8) : new Color3(0.85, 0.78, 0.66),
    );
    this.lighting.setAmbient(
      (isDay ? new Color3(0.4, 0.35, 0.3) : new Color3(0.22, 0.2, 0.17)).scale(r.ambientIntensity),
    );
    this.scene.clearColor = isDay
      ? new Color4(0.7, 0.85, 1.0, 1)
      : new Color4(0.03, 0.03, 0.05, 1);
    this.requestRender();
  }
}
