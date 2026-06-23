// src/utils/ghostClick.ts
// After a touch/pen tap, browsers emit a single *synthesized* `click` a moment
// later (mouse-compatibility event). When a tap opens UI via an async React
// state update — e.g. an entity control panel and its full-screen backdrop —
// that ghost click arrives AFTER the backdrop has mounted, lands on it, and
// instantly dismisses what the tap just opened. On phones this made tapping a
// mesh / label / marker look like "nothing happens".
//
// Call this right when a touch tap is confirmed: it swallows the one upcoming
// click at (roughly) the tap location, then removes itself. A short timeout
// cleans up if the browser emits no click at all, so a later genuine click is
// never eaten.
export function suppressGhostClick(x: number, y: number): void {
  let timer = 0;
  const swallow = (ev: MouseEvent): void => {
    // Only the ghost click — same spot as the tap — gets cancelled; a real
    // click elsewhere passes through untouched.
    if (Math.hypot(ev.clientX - x, ev.clientY - y) < 24) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    window.removeEventListener("click", swallow, true);
    window.clearTimeout(timer);
  };
  window.addEventListener("click", swallow, true); // capture: beat any target handler
  timer = window.setTimeout(() => window.removeEventListener("click", swallow, true), 700);
}
