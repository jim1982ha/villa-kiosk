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

// Full history for this page load, independent of the rolling on-screen
// window below — this is what "Copy all" grabs. Bounded generously (not to
// 40) so a whole model-load-to-toggle debugging session survives even though
// only the tail is visible at once; a kiosk session that somehow produced
// tens of thousands of lines would be a bug in its own right.
const MAX_HISTORY = 5000;
const VISIBLE_LINES = 40;
let history: string[] = [];

let box: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let copyBtn: HTMLButtonElement | null = null;

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function copyAll(): void {
  const text = history.join("\n");
  const flash = (label: string) => {
    if (!copyBtn) return;
    copyBtn.textContent = label;
    setTimeout(() => {
      if (copyBtn) copyBtn.textContent = "Copy all";
    }, 1500);
  };
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => flash("Copied!"),
      () => flash(fallbackCopy(text) ? "Copied!" : "Copy failed"),
    );
  } else {
    flash(fallbackCopy(text) ? "Copied!" : "Copy failed");
  }
}

function ensureBox(): HTMLDivElement {
  if (box) return box;
  box = document.createElement("div");
  box.style.cssText =
    "position:fixed;bottom:8px;left:8px;z-index:99999;max-width:92vw;" +
    "background:rgba(0,0,0,0.85);color:#4ade80;font:11px/1.4 monospace;" +
    "padding:8px 10px;border-radius:8px;pointer-events:auto;";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;";

  const title = document.createElement("span");
  title.textContent = "villa:debug";
  title.style.cssText = "color:#86efac;font-weight:bold;";
  header.appendChild(title);

  copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy all";
  // pointer-events:auto + a real <button> so this is reliably tappable on a
  // kiosk tablet with no devtools — the whole point of this control is to
  // get the FULL log (not just the last 40 visible lines, which scroll past
  // too fast to read during model load) into the clipboard for sharing.
  copyBtn.style.cssText =
    "font:11px monospace;background:#166534;color:#eafff0;border:none;" +
    "border-radius:4px;padding:3px 10px;cursor:pointer;pointer-events:auto;";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    copyAll();
  });
  header.appendChild(copyBtn);
  box.appendChild(header);

  bodyEl = document.createElement("div");
  // The scrollable region is this inner div, not the outer box — so the
  // header (and its Copy all button) stays pinned in place instead of
  // scrolling out of view as lines accumulate.
  bodyEl.style.cssText =
    "max-height:55vh;overflow-y:auto;white-space:pre-wrap;" +
    "pointer-events:auto;user-select:text;-webkit-user-select:text;";
  box.appendChild(bodyEl);

  document.body.appendChild(box);
  return box;
}

/** Log one line to the on-screen debug box AND the browser console (only
 *  active with ?debug or localStorage villa:debug=1). The on-screen box shows
 *  a rolling window (last 40 entries) for at-a-glance reading on a kiosk
 *  tablet with no devtools, but its "Copy all" button copies the FULL
 *  history for this page load — useful when relevant lines (e.g. during
 *  model indexing) scroll past faster than they can be read. `console.log`
 *  is unbounded and searchable/copyable properly whenever real devtools ARE
 *  available (e.g. testing from a desktop browser) — plain console.log is
 *  ordinary JS, not stripped in production like devLog.ts's calls are, so
 *  this works in the deployed build same as the on-screen box does. */
export function tapDebug(msg: string): void {
  if (!debugEnabled()) return;
  const stamp = new Date().toISOString().slice(11, 23);
  const line = `${stamp} ${msg}`;
  console.log(`[tapDebug] ${line}`);
  history.push(line);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  ensureBox();
  if (bodyEl) {
    bodyEl.textContent = history.slice(-VISIBLE_LINES).join("\n");
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }
}
