// How much room a badge needs, with or without its value (src/babylon/badgeBox.ts,
// 2.496.269), driven by value. The decision "does this badge draw its value?"
// lived only in the Babylon control and the box maths read it back, so "zoom to
// this room" hid every value, measured and restored — none of it testable.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { badgeBox, valuesWithText, dropTouchingValues } = await import("@/babylon/badgeBox");
const { badgeMetricsFor } = await import("@/babylon/badgeMetrics");
const M = badgeMetricsFor("coarse");

console.log("  the box:");
const card = (shown, chars = 5) => badgeBox({ card: true, type: "sensor", valueText: "8".repeat(chars), valueShown: shown }, M, 1);
ck("a card with its value drawn is wider than without; same height either way",
   card(true).halfW > card(false).halfW && card(true).halfH === card(false).halfH, [card(true), card(false)]);
ck("  ...a value that is not drawn costs no width, however long its text",
   card(false, 2).halfW === card(false, 40).halfW);
ck("  ...it hangs above its anchor by half a card", card(false).cy === -M.cardHeightPx / 2);
const classic = (type, shown, chars = 6) => badgeBox({ card: false, type, valueText: "8".repeat(chars), valueShown: shown }, M, 1);
ck("a classic badge that can EVER carry a value reserves its pill's height whether or not it shows one now",
   classic("sensor", false).halfH === classic("sensor", true).halfH && classic("sensor", false).halfH > classic("lock", false).halfH);
ck("  ...only the width follows a drawn value (wide text, wide box)",
   classic("sensor", true, 20).halfW > classic("sensor", false, 20).halfW);
ck("scale multiplies every dimension", (() => { const a = card(true), b = badgeBox({ card: true, type: "sensor", valueText: "88888", valueShown: true }, M, 2);
   return Math.abs(b.halfW - 2 * a.halfW) < 1e-9 && Math.abs(b.halfH - 2 * a.halfH) < 1e-9 && Math.abs(b.cy - 2 * a.cy) < 1e-9; })());

// owner's phone screenshot, 2026-10-27: "929 W" drawn over most of a camera. A reading's width was its length times one
// average advance (0.56 em); the font draws digits at 0.62-0.66 em, "%" at 0.92, "W" at 0.96.
const { valueAdvanceEm } = await import("@/babylon/valueAdvance");
const reading = (text) => badgeBox({ card: true, type: "sensor", valueText: text, valueShown: true }, M, 1);
const valueW = (text) => 2 * reading(text).halfW - 2 * card(false).halfW;
ck("a reading is as wide as its characters are drawn: 'W' and '%' wider than '1' and '.', at the same length",
   valueW("929 W") > valueW("1.1.1") && valueW("100%") > valueW("1.0.") && valueW("88%") > valueW("8.8"), [valueW("929 W"), valueW("1.1.1")]);
ck("  ...the font's own advances (Public Sans 600): '929 W' is 3.10 em, '100%' 2.60 em, '88%' 2.24 em",
   Math.abs(valueAdvanceEm("929 W") - 3.099) < 0.005 && Math.abs(valueAdvanceEm("100%") - 2.6) < 0.005 && Math.abs(valueAdvanceEm("88%") - 2.243) < 0.005,
   [valueAdvanceEm("929 W"), valueAdvanceEm("100%"), valueAdvanceEm("88%")]);
ck("  ...a character the table does not know counts as its widest, never as nothing",
   valueAdvanceEm("Ω") === valueAdvanceEm("W") && valueAdvanceEm("Ω") > valueAdvanceEm("8"));

console.log("\n  the pass's answer:");
ck("every badge with text starts with its value shown; one without does not",
   valuesWithText([3, 0, 1]).join() === "true,false,true");
ck("a badge that touches another drops its value; the others keep theirs",
   dropTouchingValues([true, true, true], [0, 1, 0]).join() === "true,false,true");

console.log("\n  the caller:");
const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
const boxes = ev.slice(ev.indexOf("  private labelBoxes("), ev.indexOf("  // ── Entity groups (tier 4"));
ck("labelBoxes measures from the pass's answer through badgeBox — it never reads the controls",
   /badgeBox\(\{ card, type: lbl\.type, valueText: lbl\.valueText\.text, valueShown: valueShown\[i\] \}/.test(boxes)
   && !/isVisible/.test(boxes));
const solver = ev.slice(ev.indexOf("  solveRoomZoomRadius("), ev.indexOf("    return solveRoomZoom("));
ck("'zoom to this room' measures icon-only by ANSWER — no hide, measure, restore",
   /this\.labelBoxes\(members, members\.map\(\(\) => false\), \[\], \[\], mScale\)/.test(solver) && !/setValueVisible|wasVisible/.test(solver));
ck("the pass decides, then writes the controls from its answer",
   /dropTouchingValues\(valueShown, markContacts\(/.test(ev)
   && /for \(let i = 0; i < shown\.length; i\+\+\) this\.setValueVisible\(shown\[i\]\.lbl, valueShown\[i\]\);/.test(ev)
   && /const boxes = this\.labelBoxes\(shown, valueShown\);/.test(ev));
// 2.496.553: a state update showed every non-empty reading, over a neighbour the pass had dropped it for, and re-ran the
// layout only when the reading's LENGTH changed.
const updAt = ev.indexOf("  private updateLabel(");
const upd = ev.slice(updAt, ev.indexOf("\n  private ", updAt + 10));
ck("a new reading never shows itself (only an empty one is hidden); the layout reruns when it grows wider",
   /if \(!value\) this\.setValueVisible\(lbl, false\);/.test(upd)
   && (upd.match(/setValueVisible\(/g) ?? []).length === 1
   && /valueAdvanceEm\(value\) > valueAdvanceEm\(prevText\)/.test(upd) && /if \(dirty\) this\.markLayoutDirty\(\);/.test(upd));
done("✅ a badge's box is a value; the pass owns whether its value shows");
