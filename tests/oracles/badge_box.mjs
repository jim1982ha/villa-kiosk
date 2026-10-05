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
const card = (shown, chars = 5) => badgeBox({ card: true, type: "sensor", valueChars: chars, valueShown: shown }, M, 1);
ck("a card with its value drawn is wider than without; same height either way",
   card(true).halfW > card(false).halfW && card(true).halfH === card(false).halfH, [card(true), card(false)]);
ck("  ...a value that is not drawn costs no width, however long its text",
   card(false, 2).halfW === card(false, 40).halfW);
ck("  ...it hangs above its anchor by half a card", card(false).cy === -M.cardHeightPx / 2);
const classic = (type, shown, chars = 6) => badgeBox({ card: false, type, valueChars: chars, valueShown: shown }, M, 1);
ck("a classic badge that can EVER carry a value reserves its pill's height whether or not it shows one now",
   classic("sensor", false).halfH === classic("sensor", true).halfH && classic("sensor", false).halfH > classic("lock", false).halfH);
ck("  ...only the width follows a drawn value (wide text, wide box)",
   classic("sensor", true, 20).halfW > classic("sensor", false, 20).halfW);
ck("scale multiplies every dimension", (() => { const a = card(true), b = badgeBox({ card: true, type: "sensor", valueChars: 5, valueShown: true }, M, 2);
   return Math.abs(b.halfW - 2 * a.halfW) < 1e-9 && Math.abs(b.halfH - 2 * a.halfH) < 1e-9 && Math.abs(b.cy - 2 * a.cy) < 1e-9; })());

console.log("\n  the pass's answer:");
ck("every badge with text starts with its value shown; one without does not",
   valuesWithText([3, 0, 1]).join() === "true,false,true");
ck("a badge that touches another drops its value; the others keep theirs",
   dropTouchingValues([true, true, true], [0, 1, 0]).join() === "true,false,true");

console.log("\n  the caller:");
const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
const boxes = ev.slice(ev.indexOf("  private labelBoxes("), ev.indexOf("  // ── Entity groups (tier 4"));
ck("labelBoxes measures from the pass's answer through badgeBox — it never reads the controls",
   /badgeBox\(\{ card, type: lbl\.type, valueChars: lbl\.valueText\.text\.length, valueShown: valueShown\[i\] \}/.test(boxes)
   && !/isVisible/.test(boxes));
const solver = ev.slice(ev.indexOf("  solveRoomZoomRadius("), ev.indexOf("    return solveRoomZoom("));
ck("'zoom to this room' measures icon-only by ANSWER — no hide, measure, restore",
   /this\.labelBoxes\(members, members\.map\(\(\) => false\), \[\], \[\], mScale\)/.test(solver) && !/setValueVisible|wasVisible/.test(solver));
ck("the pass decides, then writes the controls from its answer",
   /dropTouchingValues\(valueShown, markContacts\(/.test(ev)
   && /for \(let i = 0; i < shown\.length; i\+\+\) this\.setValueVisible\(shown\[i\]\.lbl, valueShown\[i\]\);/.test(ev)
   && /const boxes = this\.labelBoxes\(shown, valueShown\);/.test(ev));
done("✅ a badge's box is a value; the pass owns whether its value shows");
