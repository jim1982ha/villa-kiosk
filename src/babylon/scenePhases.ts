// src/babylon/scenePhases.ts
// The villa scene's phases, as one subscription.
//
// ⚠️ THREE CALLS FOR ONE QUESTION, WRITTEN THREE TIMES. Anything that needed
// the loaded, fitted villa wrote `if (manager.isReady()) cb();
// manager.onReady(cb); manager.onCalibrated(cb)` and kept two unsubscribes —
// Dashboard did it three times, and a one-shot "go to overview on ready" sat
// beside them re-telling the scene a mode it was already in. The ordering
// those calls encoded is this module's: "shown" once the model is on screen,
// "calibrated" after every plan→world fit, and a late subscriber told "shown"
// at once. Pure; tests/oracles/scene_phases.mjs drives it.

export type ScenePhase = "shown" | "calibrated";

export class ScenePhases {
  private listeners = new Set<(phase: ScenePhase) => void>();
  private isShown = false;

  get shownYet(): boolean { return this.isShown; }

  /** The model is on screen. */
  shown(): void {
    this.isShown = true;
    this.emit("shown");
  }

  /** The rooms were (re)fitted — the load's fit, or a mirror-toggle re-fit. */
  calibrated(): void { this.emit("calibrated"); }

  /** Hear every phase from now on; with `replay` (the default) a subscriber
   *  that arrives after the model is shown is told so at once. */
  subscribe(cb: (phase: ScenePhase) => void, replay = true): () => void {
    this.listeners.add(cb);
    if (replay && this.isShown) cb("shown");
    return () => { this.listeners.delete(cb); };
  }

  clear(): void { this.listeners.clear(); }

  private emit(phase: ScenePhase): void {
    // A copy: a listener may unsubscribe (or subscribe another) while hearing it.
    for (const cb of [...this.listeners]) cb(phase);
  }
}
