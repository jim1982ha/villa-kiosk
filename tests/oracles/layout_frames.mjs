// Every way the badge layout is marked out of date ALSO gets a frame.
//
// The render loop draws on demand, and the layout (EntityVisuals.cullLabels)
// runs inside a frame — so a mark with no frame leaves the new layout computed
// but undrawn until some unrelated frame. Owner, 2026-10-12: "when I move the
// mouse over the villa, without hovering anything or moving the camera, badges
// regroup or open into cards". A buttonless mouse move wakes the loop
// (SceneManager: any pointer event is motion), and setResolvedRooms — a room
// recompute on Home Assistant's reconnect or registry change — marked the
// layout and asked for nothing, so the mouse drew a regrouping made earlier.
//
// The check, per public EntityVisuals method that marks the layout: it asks
// for a frame itself, or every SceneManager method calling it asks for one after the call.
import { readFileSync } from "node:fs";
import { ck, done } from "../consistency/check.mjs";

const read = (p) => readFileSync(new URL(`../../src/babylon/${p}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ev = read("EntityVisuals.ts"), sm = read("SceneManager.ts");

// Public methods of EntityVisuals and their bodies (two-space indent, brace-balanced).
const methods = [];
for (const m of ev.matchAll(/^  (?!private |protected |static |get |set |constructor)(?:async )?([a-zA-Z]\w*)\([^)]*\)[^{;]*\{$/gm)) {
  let depth = 0, i = m.index + m[0].length - 1, end = i;
  for (; end < ev.length; end++) { if (ev[end] === "{") depth++; else if (ev[end] === "}" && --depth === 0) break; }
  methods.push({ name: m[1], body: ev.slice(i, end) });
}
const FRAME = /requestRender\(|requestAnimationRender\(|frames\.(repaint|motion|pin)\(/;
const marking = methods.filter((m) => /markLayoutDirty\(\)/.test(m.body));
ck(`read EntityVisuals' public methods (${methods.length}, ${marking.length} mark the layout)`, methods.length > 20 && marking.length >= 3);
const unframed = marking.filter((m) => {
  if (FRAME.test(m.body)) return false;
  const calls = [...sm.matchAll(new RegExp(`visuals\\.${m.name}\\(`, "g"))];
  // from the call to the end of the SceneManager method that makes it
  return calls.length === 0 || calls.some((c) => !FRAME.test(sm.slice(c.index).split(/\n  \}\n/)[0]));
}).map((m) => m.name);
ck("each one gets a frame — in its body, or right after every SceneManager call", unframed.length === 0, unframed);
ck("the room recompute is one of them (the reported case)", marking.some((m) => m.name === "setResolvedRooms"));

done("✅ a layout marked out of date is drawn, not left for the next mouse move");
