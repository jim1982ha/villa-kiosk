// "Ask VESTA" beside the phone's gear, when the top bar has room for it (owner, 2026-10-31: "When there is space,
// show the microphone icon to 'Ask VESTA' directly on the left of the settings icon, in the top bar").
// The room decision driven by value through the shipped measurement, on bars laid out as a phone lays them out;
// then where the button sits, read through the compiler's tree. Placeholder sizes, no villa data.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { elements, guardsOf, parseTsx, propText, tagOf } from "../consistency/jsx.mjs";
import ts from "typescript";
const { micFits, barMicShown, measureBarRoom, BAR_PARTS } = await import("@/components/hud/barRoom");

// A top bar as the browser lays it out: its grid's three tracks, the app icon's side, the right-hand side, the gear
// and the gap its pill puts between buttons, the microphone when drawn, and the category row: its shown buttons (32px,
// 4px apart, 4px padding, 1px border, as on a phone), the (?) and its separator hidden, its box. Its scrollWidth reaches
// 6px past its last button, as the buttons' 44px touch areas make it in a browser.
const ROW = { columnGap: "4px", paddingLeft: "4px", paddingRight: "4px", borderLeftWidth: "1px", borderRightWidth: "1px" };
const bar = ({ tracks, brand = 50, right, gear = 32, gap = 4, mic = null, cats = 6, box = null }) => {
  const rect = (w) => ({ getBoundingClientRect: () => ({ width: w }) });
  const natural = cats * 32 + (cats - 1) * 4 + 10;
  const row = { ...rect(box ?? natural), style: ROW, scrollWidth: (box ?? natural) + 6, clientWidth: (box ?? natural) - 2,
    children: [...Array.from({ length: cats }, () => rect(32)), rect(0), rect(0)] };
  const parts = { [BAR_PARTS.brand]: rect(brand), [BAR_PARTS.right]: rect(right), [BAR_PARTS.gearGroup]: { style: { columnGap: `${gap}px` } },
    [BAR_PARTS.gear]: rect(gear), [BAR_PARTS.mic]: mic === null ? null : rect(mic), [BAR_PARTS.categories]: row };
  return { style: { gridTemplateColumns: tracks }, querySelector: (sel) => parts[sel.slice(1)] ?? null };
};
globalThis.getComputedStyle = (el) => el.style;
const fits = (b) => micFits(measureBarRoom(bar(b)));

console.log("  room, read from the bar (sizes the shipped stylesheet gives, measured in WebKit and Chromium):");
// owner, 2026-10-31: a portrait phone, six categories, room beside the gear, and no microphone (2.496.627). 390px:
// 370px inside the padding, the row 222px, 6px gaps, 68px each side; the gear's pill 42px.
const PHONE = { tracks: "68px 222px 68px", right: 42 };
ck("a 390px phone with six categories: the microphone is drawn (2.496.627 drew it at no width)", fits(PHONE) === true);
ck("  ...and stays drawn once it is: the grid gives the right side 78px, the row keeps its 222px",
   fits({ tracks: "58px 222px 78px", right: 78, mic: 32 }) === true);
ck("  ...a row the touch areas reach past is not a row that scrolls", measureBarRoom(bar(PHONE)).squeezed === false);
ck("375px, six categories: absent (the icon, the gear, the microphone and the row need 4px more than the bar has)",
   fits({ tracks: "60.5px 222px 60.5px", right: 42 }) === false);
// drawn on a bar too narrow for it, the grid squeezes the row to hold it: that says no, so it does not keep itself
ck("  ...and a microphone drawn there does not keep itself (it squeezed the row)",
   fits({ tracks: "43px 214px 78px", right: 78, mic: 32, box: 214 }) === false);
ck("430px, seven categories: drawn; 390px, seven: absent",
   fits({ tracks: "70px 258px 70px", right: 42, cats: 7 }) === true && fits({ tracks: "50px 258px 50px", right: 42, cats: 7 }) === false);
ck("a category row that already scrolls: absent, whatever the side tracks",
   fits({ tracks: "200px 150px 200px", right: 42, box: 150 }) === false);
ck("  ...exactly enough fits; a pixel short does not",
   fits({ tracks: "64px 222px 64px", right: 42 }) === true && fits({ tracks: "63.5px 222px 63.5px", right: 42 }) === false);
ck("the maintenance mark beside the gear takes its room too (390px, six categories)",
   fits({ tracks: "58px 222px 78px", right: 78 }) === false);
ck("where the gear is not drawn (a roomy screen: its own talk button sits by the robot): absent",
   fits({ tracks: "300px 400px 300px", right: 120, gear: 0 }) === false);
ck("a bar with no grid read: absent", micFits(measureBarRoom(bar({ tracks: "none", right: 42 }))) === false
   && micFits(null) === false);

// the 50px app icon is the whole of a phone's brand: its emptied text took 8px of gap (58px), the room's margin at 390px
const { readFileSync } = await import("node:fs");
const layout = readFileSync(new URL("../../src/styles/05-layout.css", import.meta.url), "utf8");
const phoneOnly = layout.slice(layout.indexOf("@media (max-width: 640px) {")).split("\n}")[0];
ck("  ...the brand's empty text takes no room on a phone (width only: a short wide window keeps its name)",
   /\.hud-brand-text \{ display: none; \}/.test(phoneOnly) && layout.includes("@media (max-width: 640px) {"));

console.log("\n  who sees it:");
const roomy = measureBarRoom(bar(PHONE));
ck("while VESTA runs and with room: drawn", barMicShown(true, roomy) === true);
ck("  ...a profile VESTA does not run for (the reading every way to ask VESTA uses): absent, room or not",
   barMicShown(false, roomy) === false);

console.log("\n  where it sits:");
const hud = parseTsx("components/hud/HUD.tsx");
const mics = elements(hud, "TalkButton").filter((b) => (propText(b, "className") || "").includes(BAR_PARTS.mic));
ck("one microphone beside the gear, the top bar's own talk button (tap: the conversation; held: VESTA listens)",
   mics.length === 1 && propText(mics[0], "place") === '"bar"' && propText(mics[0], "onTap") === "onAskVesta"
   && propText(mics[0], "onOpen") === "onAskVesta" && (propText(mics[0], "className") || "").startsWith('"icon-btn '),
   mics.map((m) => m.getText()));
ck("  ...drawn only by the room decision", mics.length === 1 && guardsOf(mics[0]).join() === "barMic", mics[0] && guardsOf(mics[0]));
let decided = null;
const visit = (n) => { if (ts.isVariableDeclaration(n) && n.name.getText() === "barMic") decided = n.initializer.getText(); ts.forEachChild(n, visit); };
visit(hud);
ck("  ...which is VESTA's own reading and the bar's room", decided === "barMicShown(thread.shown, useBarRoom(barRef))", decided);
const topbar = elements(hud, "div").filter((d) => propText(d, "className") === '"hud-topbar"');
ck("  ...measured on the top bar itself", topbar.length === 1 && propText(topbar[0], "ref") === "barRef");
// the element right after it among its pill's children is the gear
let slot = mics[0];
while (slot && !(ts.isJsxExpression(slot) && ts.isJsxElement(slot.parent))) slot = slot.parent;
const holder = slot?.parent;
const kids = holder && ts.isJsxElement(holder) ? holder.children.filter((c) => !(ts.isJsxText(c) && !c.getText().trim())
  && !(ts.isJsxExpression(c) && !c.expression)) : [];
const at = kids.indexOf(slot);
const next = kids[at + 1];
ck("immediately left of the settings gear, in the gear's own pill",
   holder && /hud-overflow/.test(propText(holder, "className") || "") && at === 0 && next && tagOf(next) === "button"
   && /hud-gear/.test(propText(next, "className") || "") && elements(next, "Settings").length === 1,
   [at, next && next.getText().slice(0, 80)]);
const classes = hud.getText();
ck("the measurement's pieces are the bar's own classes", Object.values(BAR_PARTS).every((c) => classes.includes(c)),
   Object.values(BAR_PARTS).filter((c) => !classes.includes(c)));

console.log("\n  one orb:");
const over = elements(parseTsx("components/messages/TalkButton.tsx"), "ListeningOverScreen");
ck("the big orb is drawn by the button held, never by every button of its place (the top bar draws \"bar\" twice)",
   over.length === 1 && guardsOf(over[0]).includes("pressed"), over.map(guardsOf));

done("✅ \"Ask VESTA\" beside the phone's gear only with room for it, measured on the bar, by value");
