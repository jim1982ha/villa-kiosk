// src/components/panels/cameraPlayer.ts
// Play a camera through an ordered list of ways to reach it, falling to the
// next whenever one fails or stays silent.
//
// ⚠️ THIS CHAIN USED TO BE CameraPanel's STATE. Four tiers were three states,
// eight refs, five effects and three `fallBackToX` functions, each naming the
// tier after it, interleaved with the panel's gestures and chrome. Reordering
// a tier meant rewiring eight call sites; each "loaded" flag was reset in
// three places; the cancellation guard was applied at two of five fail sites;
// and on a camera change the old tier's effect fired a request for the NEW
// camera before the reset took effect. None of it could be tested.
//
// Now a tier only knows how to start itself on an element, and reports back:
// `frame()` when a real picture is painted, `connected()` when its transport
// is up but the picture is still coming, `fail(reason)` when it gives up. The
// player owns everything between: the order, the watchdogs, the generation
// that makes a torn-down tier's late report harmless, the step to the next
// tier, the log line, and the terminal `failed`.
//
// No React, no DOM of its own: tests/oracles/camera_player.mjs drives it with
// fake tiers and fake timers.

export type CameraMode = "webrtc" | "hls" | "stream" | "snapshot" | "failed";

/** What a tier may tell the player. Every call is ignored once the attempt it
 *  belongs to has been torn down — a tier never has to check that itself. */
export interface TierReport {
  /** A real picture is on screen. Ends the watchdogs for good. */
  frame(): void;
  /** The transport is up but no picture yet — switches to `afterConnectMs`. */
  connected(): void;
  /** Give up on this tier; the player moves to the next. */
  fail(reason: string): void;
}

export interface CameraTier {
  mode: Exclude<CameraMode, "failed">;
  /** Which element the tier plays into. */
  element: "video" | "img";
  /** Silence allowed before the tier is abandoned: to `connected()` when
   *  `afterConnectMs` is set, otherwise to the first `frame()`. Omitted, the
   *  tier is never abandoned for silence (only for its own `fail`). */
  watchdogMs?: number;
  /** Silence allowed after `connected()`, before the first frame. */
  afterConnectMs?: number;
  /** Start on `el`; return the teardown. Must not throw — report `fail`. */
  start(el: HTMLVideoElement | HTMLImageElement, report: TierReport): () => void;
}

export interface CameraPlayerState {
  mode: CameraMode;
  /** Whether the current tier has painted a real frame. */
  frameReady: boolean;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface CameraPlayer {
  getState(): CameraPlayerState;
  /** For React's useSyncExternalStore. */
  subscribe(listener: () => void): () => void;
  /** The element for the CURRENT mode is mounted — start that tier on it. */
  attach(el: HTMLVideoElement | HTMLImageElement): void;
  /** That element is gone — tear the attempt down, stay on this tier. */
  detach(): void;
  /** Tear down for good. */
  dispose(): void;
}

export function createCameraPlayer(
  tiers: readonly CameraTier[],
  opts: { log?: (line: string) => void; timers?: Timers } = {},
): CameraPlayer {
  const log = opts.log ?? (() => {});
  const timers: Timers = opts.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  let index = 0;
  let state: CameraPlayerState = {
    mode: tiers.length ? tiers[0].mode : "failed", frameReady: false,
  };
  const listeners = new Set<() => void>();
  // Bumped whenever an attempt ends, however it ends. A report carries the
  // generation it was started under and is dropped if that is no longer now.
  let generation = 0;
  let teardown: (() => void) | null = null;
  let watchdog: unknown = null;
  let disposed = false;

  const set = (next: CameraPlayerState) => {
    if (next.mode === state.mode && next.frameReady === state.frameReady) return;
    state = next;
    listeners.forEach((l) => l());
  };
  const clearWatchdog = () => {
    if (watchdog !== null) timers.clearTimeout(watchdog);
    watchdog = null;
  };
  const endAttempt = () => {
    generation++;
    clearWatchdog();
    const t = teardown;
    teardown = null;
    t?.();
  };
  const advance = (reason: string) => {
    const from = tiers[index];
    endAttempt();
    index++;
    const to = tiers[index];
    log(`camera: ${from.mode} unavailable, ${to ? `falling back to ${to.mode}` : "giving up"} — ${reason}`);
    set({ mode: to ? to.mode : "failed", frameReady: false });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attach(el) {
      if (disposed || state.mode === "failed") return;
      endAttempt();
      const tier = tiers[index];
      const mine = generation;
      const live = () => mine === generation && !disposed;
      const arm = (ms: number | undefined, why: string) => {
        clearWatchdog();
        if (ms === undefined) return;
        watchdog = timers.setTimeout(() => {
          watchdog = null;
          if (live()) advance(why);
        }, ms);
      };
      arm(tier.watchdogMs, tier.afterConnectMs !== undefined
        ? "not connected within watchdog window"
        : "no frame within watchdog window");
      let painted = false;
      const report: TierReport = {
        frame() {
          if (!live()) return;
          painted = true;
          clearWatchdog();
          set({ mode: state.mode, frameReady: true });
        },
        connected() {
          if (!live() || painted) return;
          arm(tier.afterConnectMs, "connected, but no frame within watchdog window");
        },
        fail(reason) {
          if (live()) advance(reason);
        },
      };
      teardown = tier.start(el, report);
      // A tier that failed synchronously inside start() has already been
      // replaced; its teardown belongs to an attempt that is over.
      if (!live()) { const t = teardown; teardown = null; t?.(); }
    },
    detach() {
      endAttempt();
      set({ mode: state.mode, frameReady: false });
    },
    dispose() {
      disposed = true;
      endAttempt();
      listeners.clear();
    },
  };
}
