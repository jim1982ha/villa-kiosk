// src/utils/tapDebug.ts
// A visible, on-screen tap/badge-hit-test diagnostic — deliberately NOT
// gated behind import.meta.env.DEV like devLog.ts, because the failure this
// exists to diagnose (a state badge intermittently not responding to taps)
// has only ever been reproduced on a real production kiosk, never in dev.
// It's opt-in via the same "?debug" URL param / localStorage flag devLog.ts
// uses, so it costs nothing unless deliberately enabled, and does not appear
// in the production bundle's behavior for ordinary users.

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
  box.style.cssText =
    "position:fixed;bottom:8px;left:8px;z-index:99999;max-width:92vw;" +
    "background:rgba(0,0,0,0.85);color:#4ade80;font:11px/1.4 monospace;" +
    "padding:8px 12px;border-radius:8px;white-space:pre-wrap;pointer-events:none;";
  document.body.appendChild(box);
  return box;
}

/** Log one line to the on-screen debug box (only visible with ?debug or
 *  localStorage villa:debug=1) — a rolling window of the last few entries. */
export function tapDebug(msg: string): void {
  if (!debugEnabled()) return;
  const el = ensureBox();
  const stamp = new Date().toISOString().slice(11, 23);
  const lines = (el.dataset.lines ?? "").split("\n").filter(Boolean);
  lines.push(`${stamp} ${msg}`);
  while (lines.length > 6) lines.shift();
  el.dataset.lines = lines.join("\n");
  el.textContent = lines.join("\n");
}
