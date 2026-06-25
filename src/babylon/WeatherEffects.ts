// src/babylon/WeatherEffects.ts
// Optional rain particles driven by an HA weather entity. Kept minimal — created
// lazily so it costs nothing until weather data says it's raining.

import {
  ParticleSystem, Texture, Vector3, Color4, type Scene, type IParticleSystem,
} from "@babylonjs/core";

const RAINY = ["rainy", "pouring", "lightning-rainy", "snowy-rainy"];

export class WeatherEffects {
  private scene: Scene;
  private requestRender: () => void;
  private rain: IParticleSystem | null = null;
  // Master on/off from the Settings toggle. The last weather state is remembered
  // even while disabled, so re-enabling can immediately reflect current weather
  // without waiting for the next HA state change.
  private enabled = false;
  private lastState: string | null = null;

  constructor(scene: Scene, requestRender: () => void) {
    this.scene = scene;
    this.requestRender = requestRender;
  }

  /** Master switch (Settings → Live weather effects). Toggling off clears any
   *  active particles now; toggling on re-applies the last known weather. */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) this.stopRain();
    else if (this.lastState) this.setWeather(this.lastState);
  }

  /** Pass the HA weather entity state (e.g. "rainy", "sunny"). */
  setWeather(state: string): void {
    this.lastState = state;
    if (!this.enabled) return;
    if (RAINY.includes(state)) this.startRain();
    else this.stopRain();
  }

  private startRain(): void {
    if (this.rain) return;
    const ps = new ParticleSystem("rain", 2000, this.scene);
    // 1x1 white dot data-URI so we need no external texture asset.
    ps.particleTexture = new Texture(
      "data:image/svg+xml;base64," +
        btoa('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="8"><rect width="2" height="8" fill="white"/></svg>'),
      this.scene,
    );
    ps.emitter = new Vector3(0, 15, 0);
    ps.minEmitBox = new Vector3(-15, 0, -15);
    ps.maxEmitBox = new Vector3(15, 0, 15);
    ps.color1 = new Color4(0.7, 0.8, 1.0, 0.6);
    ps.color2 = new Color4(0.6, 0.7, 0.9, 0.4);
    ps.minSize = 0.05;
    ps.maxSize = 0.12;
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.0;
    ps.emitRate = 1500;
    ps.gravity = new Vector3(0, -40, 0);
    ps.direction1 = new Vector3(-1, -10, -1);
    ps.direction2 = new Vector3(1, -10, 1);
    ps.start();
    this.rain = ps;
    this.requestRender();
  }

  private stopRain(): void {
    if (!this.rain) return;
    this.rain.stop();
    this.rain.dispose();
    this.rain = null;
    this.requestRender();
  }
}
