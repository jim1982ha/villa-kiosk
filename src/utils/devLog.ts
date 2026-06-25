// src/utils/devLog.ts
// Verbose diagnostic logging. Two gates, so the console stays clean by default:
//   1. Compiled out of production builds — Vite statically replaces
//      `import.meta.env.DEV` with `false` in `vite build`, so these calls (and the
//      strings they build) are tree-shaken away entirely.
//   2. Off by default even in `npm run dev` — opt in at runtime when you actually
//      want the glass/grass/calibration diagnostics, without a rebuild:
//        • add `?debug` to the URL, or
//        • run `localStorage.setItem("villa:debug", "1")` in the console, then reload.
//      Turn it back off with `localStorage.removeItem("villa:debug")`.

function debugEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    if (typeof location !== "undefined" && /[?&]debug\b/.test(location.search)) return true;
    return typeof localStorage !== "undefined" && localStorage.getItem("villa:debug") === "1";
  } catch {
    return false;
  }
}

export function devLog(...args: unknown[]): void {
  if (debugEnabled()) console.log(...args);
}
