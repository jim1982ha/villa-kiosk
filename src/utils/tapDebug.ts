// src/utils/tapDebug.ts
// A visible, on-screen tap/badge-hit-test diagnostic (PLUS a mirrored
// console.log) — deliberately NOT gated behind import.meta.env.DEV like
// devLog.ts, because the failures this exists to diagnose (a state badge
// intermittently not responding to taps, camera-beam mesh lookups, etc.)
// have only ever been reproduced on a real production kiosk, never in dev.
// It's opt-in via the same "?debug" URL param / localStorage flag devLog.ts
// uses, so it costs nothing unless deliberately enabled, and does not appear
// in the production bundle's behavior for ordinary users. The on-screen box
// is for reading at a glance on a locked-down kiosk tablet with no devtools;
// the console.log mirror is for whenever real devtools ARE available (e.g.
// testing from a desktop browser), where the console's native scrollback,
// search and copy beat a custom on-screen div.

const DEBUG_KEY = "villa:debug";

function debugEnabled(): boolean {
  try {
    if (typeof location !== "undefined" && /[?&]debug\b/.test(location.search)) return true;
    return typeof localStorage !== "undefined" && localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

let box: HTMLDivElement | null = null;
function ensureBox(): HTMLDivElement {
  if (box) return box;
  box = document.createElement("div");
  // pointer-events:auto + user-select:text (not "none") so the box can be
  // long-pressed/dragged to select and copy text on a kiosk TABLET, where
  // there's no browser devtools to read the console from. Safe to make
  // interactive: this element only exists at all when debug mode is
  // deliberately opted into (?debug / localStorage), never for ordinary use,
  // so there's no risk of it stealing taps from real kiosk controls.
  box.style.cssText =
    "position:fixed;bottom:8px;left:8px;z-index:99999;max-width:92vw;max-height:60vh;overflow-y:auto;" +
    "background:rgba(0,0,0,0.85);color:#4ade80;font:11px/1.4 monospace;" +
    "padding:8px 12px;border-radius:8px;white-space:pre-wrap;pointer-events:auto;user-select:text;-webkit-user-select:text;";
  document.body.appendChild(box);
  return box;
}

/** Log one line to the on-screen debug box AND the browser console (only
 *  active with ?debug or localStorage villa:debug=1). The on-screen box is a
 *  rolling window (last 40 entries) for at-a-glance reading on a kiosk
 *  tablet with no devtools; `console.log` is unbounded and searchable/
 *  copyable properly whenever real devtools ARE available (e.g. testing from
 *  a desktop browser pointed at the kiosk) — plain console.log is ordinary
 *  JS, not stripped in production like devLog.ts's calls are, so this works
 *  in the deployed build same as the on-screen box does. */
export function tapDebug(msg: string): void {
  if (!debugEnabled()) return;
  const stamp = new Date().toISOString().slice(11, 23);
  console.log(`[tapDebug] ${stamp} ${msg}`);
  const el = ensureBox();
  const lines = (el.dataset.lines ?? "").split("\n").filter(Boolean);
  lines.push(`${stamp} ${msg}`);
  while (lines.length > 40) lines.shift();
  el.dataset.lines = lines.join("\n");
  el.textContent = lines.join("\n");
}
