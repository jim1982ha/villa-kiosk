// src/utils/swUpdate.ts
// How a new build reaches the installed app (2.496.256).
//
// The service worker serves the page from its own saved copy (public/sw.js),
// so opening the app no longer waits on the network — and a new build arrives
// as a new WORKER, which the browser installs in the background and then
// leaves WAITING (the worker never skips waiting on its own: seizing a running
// page from the cache holding its chunks once blanked the kiosk). Two moments
// move the page onto it, both followed by an immediate reload:
//
//   * the page STARTS while a new worker is waiting — reopening the app, the
//     wall tablet's 04:00 reload (autoReload): switch at once, before the villa
//     has done any work worth keeping. Without this the wall tablet, which
//     never closes the app, would stay on the old build indefinitely;
//   * a new worker finishes installing while the app is OPEN — the update
//     notice offers it (components/hud/UpdateBanner), and switches on a tap.
//
// The worker parts are passed in, so tests/oracles/sw_update.mjs drives this
// with fakes; the browser's are the default.

type Worker = {
  state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
};
export type Registration = {
  waiting: Worker | null;
  installing: Worker | null;
  addEventListener(type: "updatefound", listener: () => void): void;
};

/** How long to wait for the new worker to activate before reloading anyway:
 *  a reload alone still lands on the new build once the old page is gone. */
const ACTIVATE_TIMEOUT_MS = 4000;

/** Move onto the waiting worker, then reload. Resolves false (doing nothing)
 *  when nothing is waiting. */
export async function switchToWaiting(
  reg: Registration, reload: () => void, timeoutMs = ACTIVATE_TIMEOUT_MS,
): Promise<boolean> {
  const next = reg.waiting;
  if (!next) return false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    next.addEventListener("statechange", () => {
      if (next.state === "activated") { clearTimeout(timer); resolve(); }
    });
    next.postMessage({ type: "SKIP_WAITING" });
  });
  reload();
  return true;
}

/** Call `ready` once a new worker has finished installing while this page is
 *  controlled by an older one — an update the person can switch to now. The
 *  very first install (no controller yet) is not an update and says nothing. */
export function whenUpdateReady(reg: Registration, controlled: () => boolean, ready: () => void): void {
  const watch = (w: Worker | null) => {
    if (!w) return;
    w.addEventListener("statechange", () => {
      if (w.state === "installed" && controlled()) ready();
    });
  };
  if (reg.waiting && controlled()) ready();
  watch(reg.installing);
  reg.addEventListener("updatefound", () => watch(reg.installing));
}

// ── The page's one update state, for the notice ─────────────────────────────
let readyReg: Registration | null = null;
const listeners = new Set<() => void>();

/** Whether an update is ready to switch to (the notice shows while true). */
export const updateReady = (): boolean => readyReg !== null;

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The notice's tap: switch to the update now. */
export function applyUpdate(): void {
  if (readyReg) void switchToWaiting(readyReg, () => location.reload());
}

/**
 * Wire the installed app to its service worker: register it, switch at once
 * to an update that is already waiting, and report one that arrives later.
 * Called by main.tsx (never under Home Assistant, where no worker is used).
 */
export function startServiceWorker(url: string): void {
  const sw = navigator.serviceWorker;
  const controlled = () => !!sw.controller;
  // As early as possible: a waiting worker means the app is about to restart
  // anyway, so it should do so before the villa starts loading.
  void sw.getRegistration().then((reg) => {
    if (reg && reg.waiting && controlled()) void switchToWaiting(reg, () => location.reload());
  }).catch(() => {});
  window.addEventListener("load", () => {
    sw.register(url).then((reg) => {
      whenUpdateReady(reg, controlled, () => {
        readyReg = reg;
        listeners.forEach((l) => l());
      });
    }).catch((err) => {
      console.warn("[SW] registration failed", err);
    });
  });
}
