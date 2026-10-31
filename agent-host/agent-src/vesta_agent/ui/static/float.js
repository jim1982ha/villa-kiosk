// What a floating panel (core.floating) does when the page moves under it — plain data, no page needed (tests/test_ui.py
// runs it in Node, as markdown.js and yaml.js).
//
// ⚠️ A PHONE'S KEYBOARD IS A RESIZE (owner, 2026-10-31: the owner-only devices' list, a tap in its search
// box, the keyboard gone at once). Opening the keyboard resizes the page and scrolls the focused field into view; the
// panel closed on both, taking its search box and the keyboard with it. While the focus is inside the panel, a resize
// or a scroll of the page places it again instead; a click outside and Escape still close it.
//
// `inPanel`: the scroll was the panel's own list; `focusInside`: the focus is on something in the panel.
// Returns "keep" (nothing to do), "place" (draw it again under its anchor) or "close".
export function afterMove(inPanel, focusInside) {
  if (inPanel) return "keep";
  return focusInside ? "place" : "close";
}
