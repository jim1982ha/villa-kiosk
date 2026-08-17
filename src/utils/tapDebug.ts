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

import { debugFlagEnabled } from "@/utils/devLog";

// Full history for this page load, independent of the rolling on-screen
// window below — this is what "Copy all" grabs. Bounded generously (not to
// 40) so a whole model-load-to-toggle debugging session survives even though
// only the tail is visible at once; a kiosk session that somehow produced
// tens of thousands of lines would be a bug in its own right.
/**
 * Channels the reader asked for, via `?debug=sky,place`. Empty = everything.
 *
 * The panel is only useful if the line you need is visible in it, and four
 * emitters (per-camera beams, per-entity mapping warnings, mesh variants, and
 * the placement line re-firing on every degree of camera drag) between them
 * produce ~90% of a session's output. A capture of the sky arriving as forty
 * screens of curtain toggles is a capture nobody reads.
 *
 * Channels are additive and free-form: an untagged tapDebug() is always shown,
 * so nothing that exists today can be silently lost by asking for a channel
 * that does not match it.
 */
/**
 * Channels that are SILENT unless asked for by name (2.436.0).
 *
 * `wanted` above filters IN; this filters OUT, and the two exist for opposite
 * situations. A channel is listed here once its subsystem is settled and its
 * output is no longer what anyone is reading a capture for — the badge
 * placement/grouping family (`place`, `seat`, the `PLACEMENT:` assertions) and
 * the per-entity mesh/variant/beam chatter between them were ~95% of a
 * session's lines, and a capture of a light-pool question arriving as four
 * hundred screens of `pair` and `PLACEMENT:` is a capture nobody reads.
 *
 * ⚠️ NOT DELETED, and the difference matters. Every one of these is documented
 * in CLAUDE.md and in the debug-capture skill as the authority for its tier —
 * `chipWhy` names which rule chipped a room, `seat` gives a refusal in pixels,
 * the `PLACEMENT:` family is the only guard against a badge silently
 * disappearing. Deleting them would make the next report of a grouping bug
 * unanswerable. `?debug=place,seat` brings the whole picture back.
 *
 * ⚠️ AND THE BANNER SAYS SO, which is the point (see versionBanner). A muted
 * family that says nothing about being muted reads as "measured, nothing
 * happened" — the exact misread that has cost this project four separate
 * rounds. Every capture states which channels were off.
 */
const MUTED_BY_DEFAULT = new Set(["place", "seat", "chip", "mesh", "variant", "beam"]);
// ⚠️ `badge` is deliberately NOT in that set: it is a live investigation (the
// badge value's drawn geometry, see EntityVisuals.logBadgeGeometry) and the owner
// has to get it from a plain `?debug`. It is deduped to one line per layout, so
// it costs a line, not a stream. Move it into the set — or delete the emitter —
// the moment it has answered.

const wanted: Set<string> = (() => {
  try {
    const raw = new URLSearchParams(
      (typeof window === "undefined" ? "" : window.location.search).replace(/\?/g, "&"),
    ).get("debug") ?? "";
    return new Set(raw.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean));
  } catch { return new Set<string>(); }
})();

const MAX_HISTORY = 5000;
const VISIBLE_LINES = 40;
let history: string[] = [];

let box: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let copyBtn: HTMLButtonElement | null = null;

// Where the reader last dragged/resized the panel. Persisted because the
// panel's default corner is over the villa's own controls on some layouts,
// and having to move it again after every reload is exactly the friction
// that makes a diagnostic go unused.
const GEOM_KEY = "villa:debug:geom";

interface BoxGeom { left: number; top: number; w: number; h: number; }

function loadGeom(): BoxGeom | null {
  try {
    const raw = localStorage.getItem(GEOM_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<BoxGeom>;
    if ([g.left, g.top, g.w, g.h].some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
    return g as BoxGeom;
  } catch {
    return null;
  }
}

function saveGeom(el: HTMLDivElement): void {
  try {
    const r = el.getBoundingClientRect();
    localStorage.setItem(GEOM_KEY, JSON.stringify({
      left: Math.round(r.left), top: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
    }));
  } catch { /* private mode, quota — the panel still works, it just forgets */ }
}

/** Keep the panel reachable after a rotate or a window resize: a saved
 *  position from a wider viewport must not park it off-screen with no way to
 *  drag it back. */
function clampIntoView(el: HTMLDivElement): void {
  const r = el.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - Math.min(r.width, window.innerWidth));
  const maxTop = Math.max(0, window.innerHeight - 40); // a header's worth stays grabbable
  el.style.left = `${Math.min(Math.max(0, r.left), maxLeft)}px`;
  el.style.top = `${Math.min(Math.max(0, r.top), maxTop)}px`;
}

/** Drag the panel by its header. Pointer events (not mouse) so it works with
 *  a finger on the kiosk tablet this exists for, and setPointerCapture so a
 *  fast drag that leaves the header does not drop the panel mid-move. */
function makeDraggable(el: HTMLDivElement, handle: HTMLElement): void {
  handle.style.cursor = "move";
  handle.style.touchAction = "none";
  let dx = 0, dy = 0, dragging = false;
  handle.addEventListener("pointerdown", (e) => {
    // Let the Copy button have its own taps.
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    const r = el.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    el.style.left = `${e.clientX - dx}px`;
    el.style.top = `${e.clientY - dy}px`;
    // Anchored top-left from here on, so the two must be cleared or the
    // panel is pinned by all four edges and the drag does nothing.
    el.style.right = "auto";
    el.style.bottom = "auto";
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    clampIntoView(el);
    saveGeom(el);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

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

/** Drop the whole page-load history so the next lines logged are the only
 *  ones "Copy all" will hand over. The reader's tool for isolating one
 *  interaction out of a session's worth of noise. */
function clearAll(): void {
  history = [];
  if (bodyEl) bodyEl.textContent = "";
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
  // `resize:both` needs a non-visible overflow and an explicit size to bite,
  // and the BODY's own scroll has to be driven by the box's height rather
  // than a fixed max — otherwise resizing the panel taller shows no more log.
  box.style.cssText =
    "position:fixed;bottom:8px;left:8px;z-index:99999;" +
    "width:min(560px,92vw);height:320px;min-width:220px;min-height:90px;" +
    "max-width:100vw;max-height:100vh;resize:both;overflow:hidden;" +
    "display:flex;flex-direction:column;" +
    "background:rgba(0,0,0,0.85);color:#4ade80;font:11px/1.4 monospace;" +
    "padding:8px 10px;border-radius:8px;pointer-events:auto;";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex:0 0 auto;";

  const title = document.createElement("span");
  title.textContent = "villa:debug";
  title.style.cssText = "color:#86efac;font-weight:bold;";
  header.appendChild(title);

  // pointer-events:auto + a real <button> so these are reliably tappable on a
  // kiosk tablet with no devtools, and one factory so a second control cannot
  // drift out of style with the first.
  const headerBtn = (label: string, bg: string, onTap: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      `font:11px monospace;background:${bg};color:#eafff0;border:none;` +
      "border-radius:4px;padding:3px 10px;cursor:pointer;pointer-events:auto;";
    b.addEventListener("click", (e) => { e.stopPropagation(); onTap(); });
    header.appendChild(b);
    return b;
  };

  // Clear before Copy, in reading order: narrow the log to the thing being
  // investigated, THEN copy it. Sharing the whole page load every time is
  // what this pair exists to avoid.
  headerBtn("Clear", "#3f3f46", clearAll);
  // Copies the FULL history, not just the 40 visible lines — during model
  // load they scroll past faster than they can be read.
  copyBtn = headerBtn("Copy all", "#166534", copyAll);
  box.appendChild(header);

  bodyEl = document.createElement("div");
  // The scrollable region is this inner div, not the outer box — so the
  // header (and its Copy all button) stays pinned in place instead of
  // scrolling out of view as lines accumulate.
  // flex:1 rather than a fixed max-height: the box now has a real height the
  // reader controls, and the body has to take whatever is left of it or
  // dragging the panel taller would reveal nothing.
  bodyEl.style.cssText =
    "flex:1 1 auto;min-height:0;overflow:auto;white-space:pre;" +
    "pointer-events:auto;user-select:text;-webkit-user-select:text;";
  box.appendChild(bodyEl);

  makeDraggable(box, header);
  const saved = loadGeom();
  if (saved) {
    box.style.left = `${saved.left}px`;
    box.style.top = `${saved.top}px`;
    box.style.right = "auto";
    box.style.bottom = "auto";
    box.style.width = `${saved.w}px`;
    box.style.height = `${saved.h}px`;
  }
  // The resize grabber is a native CSS affordance with no event of its own,
  // so the size is captured by observing the element rather than by listening
  // for a gesture that does not exist.
  if (typeof ResizeObserver !== "undefined") {
    let t: ReturnType<typeof setTimeout> | null = null;
    new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => box && saveGeom(box), 300);
    }).observe(box);
  }
  window.addEventListener("resize", () => { if (box) clampIntoView(box); });

  document.body.appendChild(box);
  if (saved) clampIntoView(box);
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
/**
 * ── EVERY CAPTURE STAMPS ITS BUILD, ONCE, BEFORE ANYTHING ELSE (2.418.0) ───
 * A capture that does not say which build produced it cannot be read: the
 * fields change meaning between releases, and — the reason this exists — a
 * fix that has not reached the device is indistinguishable from a fix that did
 * not work. That cost a full round-trip: v2.417.0's whole claim is "one rung
 * ⇒ one icon scale", the returning capture showed one rung with two scales,
 * and settling whether the code was wrong or simply not running took an
 * arithmetic argument over `gapPx / zoom` instead of one line at the top.
 *
 * `__APP_VERSION__` already existed (Settings prints it, telemetry sends it,
 * diagnostics list it) — the debug panel was the one reader that did not ask.
 */
let stamped = false;
function versionBanner(): string {
  const v = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "?";
  const chans = wanted.size > 0 ? [...wanted].join(",") : "default";
  // What is OFF, named, on every capture. A reader who cannot see a `place`
  // line has to be able to tell "the grouping tier reported nothing" from
  // "the grouping tier was not asked" — see MUTED_BY_DEFAULT.
  const off = [...MUTED_BY_DEFAULT].filter((c) => !wanted.has(c));
  return `villa-kiosk v${v} — debug channels: ${chans}`
    + (off.length ? ` (silent unless asked: ?debug=${off.join(",")})` : "");
}

/**
 * Would a line on this channel be printed? The SAME predicate `tapDebug` uses —
 * it is exported so a caller can skip the WORK, not just the line.
 *
 * That distinction is the reason this exists: `assertPlacementInvariants`
 * re-solves the entire layout from a reversed input on every pass, and
 * `logPlacement`'s pair detail walks every bucket. Both are on muted channels
 * now, so without this they would burn a full second solve per frame to produce
 * output nobody is going to see — the diagnostic equivalent of leaving the
 * lights on in an empty house. Costs a set lookup at the call site.
 */
export function channelEnabled(channel: string): boolean {
  if (!debugFlagEnabled()) return false;
  // Named outright always wins; failing that, a channel is on when no filter
  // was asked for AND it is not one of the settled, muted-by-default families.
  if (wanted.has(channel)) return true;
  return wanted.size === 0 && !MUTED_BY_DEFAULT.has(channel);
}

export function tapDebug(msg: string, channel?: string): void {
  if (!debugFlagEnabled()) return;
  // Untagged lines always pass — see `wanted`. Tagged ones go through the one
  // predicate above, so a caller that gates its work and this call can never
  // disagree about whether a channel is live.
  if (channel && !channelEnabled(channel)) return;
  if (!stamped) { stamped = true; tapDebug(versionBanner()); }
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
