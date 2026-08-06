// src/utils/devLog.ts
// Verbose diagnostic logging. Two gates, so the console stays clean by default:
//   1. Compiled out of production builds — Vite statically replaces
//      `import.meta.env.DEV` with `false` in `vite build`, so these calls (and the
//      strings they build) are tree-shaken away entirely.
//   2. Off by default even in `npm run dev` — opt in at runtime when you actually
//      want the glass/calibration diagnostics, without a rebuild:
//        • add `?debug` to the URL, or
//        • run `localStorage.setItem("villa:debug", "1")` in the console, then reload.
//      Turn it back off with `localStorage.removeItem("villa:debug")`.

/** Shared `?debug` URL-param / `villa:debug` localStorage-key check — the one
 *  opt-in flag every debug-logging surface in the app reads. devLog() additionally
 *  requires a dev build (see below); tapDebug.ts intentionally does not, since the
 *  failures it exists to diagnose have only ever reproduced on a real kiosk. */
export function debugFlagEnabled(): boolean {
  try {
    if (typeof location !== "undefined" && /[?&]debug\b/.test(location.search)) return true;
    return typeof localStorage !== "undefined" && localStorage.getItem("villa:debug") === "1";
  } catch {
    return false;
  }
}

export function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV && debugFlagEnabled()) console.log(...args);
}
