// What a finger hit is decided ONCE — for tap, long-press, double-tap, hover
// and the hand cursor.
//
// ⚠️ THE ORDER WAS WRITTEN FIVE TIMES. Each gesture walked the GUI tiers
// itself; two copies had already drifted in production (2.293.0 hover named
// nothing on a group card; 2.430.0 a room chip took taps from badges drawn over
// it), the double-tap copy asked in another order, and the mouse cursor asked
// for badges alone — so a tappable card or chip showed the plain arrow.
//
// Part 1 runs the REAL resolveHit through fake pickers. Part 2 pins the CALLER:
// SceneManager cannot be constructed without a live engine, so the one thing
// checked by reading its source is that no gesture reaches a picker except
// through resolveHit — the drift this exists to stop.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const { resolveHit } = await import("@/babylon/hitResolution");

let fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `  →  ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};
/** Fake pickers: which tiers are drawn under the point. */
const at = ({ card, cell = null, badge = null, chip = false }) => ({
  entityGroupAt: () => card ? { room: "Patio", entityIds: ["light.a", "light.b"], entityId: cell } : null,
  badgeAt: () => badge,
  clusterAt: () => chip ? { room: "Kitchen", entityIds: ["light.k"], roomNames: ["Kitchen"] } : null,
});
const kind = (h) => h.kind === "device" ? `device:${h.entityId}` : h.kind === "none" ? "none" : `${h.kind}:${h.room}`;

console.log("  the order:");
eq("a card's cell is that device, even over a badge",
   kind(resolveHit(at({ card: true, cell: "light.a", badge: "switch.x" }), 0, 0)), "device:light.a");
eq("on the card but in NO cell, a badge drawn there answers",
   kind(resolveHit(at({ card: true, badge: "switch.x", chip: true }), 0, 0)), "device:switch.x");
eq("on the card, no cell, no badge: the group",
   kind(resolveHit(at({ card: true, chip: true }), 0, 0)), "group:Patio");
eq("a badge beats the room chip it is drawn over (2.430.0)",
   kind(resolveHit(at({ badge: "switch.x", chip: true }), 0, 0)), "device:switch.x");
eq("a chip alone: the room",
   kind(resolveHit(at({ chip: true }), 0, 0)), "room:Kitchen");
eq("nothing drawn: the 3D scene's turn",
   kind(resolveHit(at({}), 0, 0)), "none");

console.log("\n  the callers:");
const sm = readFileSync(new URL("../../src/babylon/SceneManager.ts", import.meta.url), "utf8");
const body = (name) => {
  const i = sm.indexOf(name);
  if (i < 0) return "";
  const open = sm.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < sm.length; j++) {
    if (sm[j] === "{") depth++;
    else if (sm[j] === "}" && --depth === 0) return sm.slice(open, j + 1);
  }
  return "";
};
for (const g of ["const handleTap = ", "const handleLongPress = ", "const handleDoubleTap = ", "hoverBadgeAt(clientX"]) {
  eq(`${g.replace(/[=(].*/, "").trim()} asks resolveHit`, body(g).includes("resolveHit("), true);
}
eq("the hand cursor asks resolveHit", /resolveHit\(this\.hitPickers\(false\), x, y\)\.kind !== "none"/.test(sm), true);
// Outside the adapter, nothing in SceneManager may call a picker directly.
const adapter = body("private hitPickers(");
const outside = sm.replace(adapter, "");
eq("no picker is called outside the adapter",
   (outside.match(/this\.visuals\.pick(EntityGroupAt|BadgeAt|ClusterAt)\(/g) ?? []).length, 0);

console.log(fail ? `\n❌ ${fail} failed` : "\n✅ every gesture names the same thing under the finger");
process.exit(fail ? 1 : 0);
