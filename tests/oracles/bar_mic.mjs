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

// A top bar as the browser lays it out: its grid's three tracks, the right-hand side's width, the gear and the gap
// its pill puts between buttons, the microphone when drawn, and the category row's content against its box.
const bar = ({ tracks, right, gear = 32, gap = 4, mic = null, cats = [250, 250] }) => {
  const box = (w) => ({ getBoundingClientRect: () => ({ width: w }) });
  const parts = { [BAR_PARTS.right]: box(right), [BAR_PARTS.gearGroup]: { gap }, [BAR_PARTS.gear]: box(gear),
    [BAR_PARTS.mic]: mic === null ? null : box(mic), [BAR_PARTS.categories]: { scrollWidth: cats[0], clientWidth: cats[1] } };
  return { tracks, querySelector: (sel) => parts[sel.slice(1)] ?? null };
};
globalThis.getComputedStyle = (el) => (el.tracks !== undefined ? { gridTemplateColumns: el.tracks } : { columnGap: `${el.gap}px` });
const fits = (b) => micFits(measureBarRoom(bar(b)));

console.log("  room, read from the bar:");
// a phone with room: the gear's pill (42px) in a 110px share
ck("enough width on the right: the microphone is drawn", fits({ tracks: "110px 182px 110px", right: 42 }) === true);
ck("  ...and stays drawn once it is (the right-hand side measured without it)",
   fits({ tracks: "110px 182px 110px", right: 78, mic: 32 }) === true);
ck("too narrow: absent (the gear's pill and one more button exceed the share)",
   fits({ tracks: "60px 188px 60px", right: 42 }) === false);
// drawn on a bar too narrow for it, the grid widens its own track to hold it: the smaller share still says no
ck("  ...and a button that did not fit does not keep itself (its own track widened, the other did not)",
   fits({ tracks: "40px 190px 78px", right: 78, mic: 32 }) === false);
ck("a category row that already scrolls: absent, whatever the side tracks",
   fits({ tracks: "200px 150px 200px", right: 42, cats: [320, 150] }) === false);
ck("  ...exactly enough fits; a pixel short does not",
   fits({ tracks: "78px 200px 78px", right: 42 }) === true && fits({ tracks: "77px 200px 77px", right: 42 }) === false);
ck("the maintenance mark beside the gear takes its share too",
   fits({ tracks: "110px 182px 110px", right: 42 + 6 + 40 }) === false);
ck("where the gear is not drawn (a roomy screen: its own talk button sits by the robot): absent",
   fits({ tracks: "300px 400px 300px", right: 120, gear: 0 }) === false);
ck("a bar with no grid read: absent", micFits(measureBarRoom(bar({ tracks: "none", right: 42 }))) === false
   && micFits(null) === false);

console.log("\n  who sees it:");
const roomy = measureBarRoom(bar({ tracks: "110px 182px 110px", right: 42 }));
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
