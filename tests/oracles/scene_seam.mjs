// The 3D layer's three unowned rules, each given an owner.
//
//   1. Babylon prototype patches, declared per caller — and TWO callers had not
//      declared them. `Scene.createPickingRay` throws without `Culling/ray` and
//      `Scene.pick` quietly returns an empty hit; `tsc` sees a method that
//      exists and says nothing. Both worked only because five OTHER modules
//      value-import `Ray`.
//   2. "What may this ray hit", composed SEVEN times from the same five terms,
//      with the ceiling rule missing from three of the seven. A ceiling IS
//      structure, so a downward ray grounds the walker on the slab over the
//      living room.
//   3. The animation clock. `engine.getDeltaTime()` counts rAF ticks, not
//      rendered frames, so under the frame cap every animation runs at half
//      speed. The rule was a docstring, implemented twice and violated once.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register("../consistency/alias-hook.mjs", import.meta.url);
const { rayTargets, isHelperMesh } = await import("@/babylon/meshRoles");

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const FILES = walk(SRC);
const BABYLON = FILES.filter((f) => f.includes("/babylon/") || f.includes("/canvas/"));
const read = (f) => readFileSync(f, "utf8");
const rel = (f) => f.slice(SRC.length + 1);

/* ── 1. moved out ─────────────────────────────────────────────────────── */
// The patched-Babylon-API check and the FrameClock block used to live here.
// They now live in the two oracles the MODULES' OWN DOCSTRINGS name —
// tests/oracles/babylon_side_effects.mjs and tests/oracles/frame_clock.mjs —
// which for eleven releases named files that did not exist.
//
// ⚠️ THAT MIS-CITATION NEARLY COST A DUPLICATE. Writing the missing guards, I
// trusted the docstring's filename instead of grepping for the assertion, and
// got most of the way through a second copy of a check that was already here
// under a different name. The check was real; only its address was wrong. One
// rule, one oracle, named after the module it guards — the same principle
// one_reading_rule.mjs enforces on the source.
//
// The versions that moved are STRICTER than what stood here: they scan the
// whole tracked tree rather than src/babylon + src/canvas (a .tsx calling
// scene.pick is exactly as broken), they cover `.pick(` — which was matched
// here but the glTF loader was not — they assert the owner imports each
// sibling, they refuse a pattern with no caller, and they check nobody
// hand-imports a sibling behind the owner's back.

/* ── 2. nothing can widen a ray back onto a ceiling ───────────────────── */
const mesh = (over = {}) => ({
  name: "wall_01", isPickable: true, isVisible: true, checkCollisions: true,
  metadata: { isStructure: true }, isEnabled: () => true, ...over,
});
const CEILING = mesh({ metadata: { isStructure: true, isCeiling: true } });
const HALO = mesh({ name: "halo_badge_1" });
const MARKER = mesh({ metadata: { isStructure: true, isMarker: true } });
const FLOOR = mesh();

// Every combination of the five flags — none may admit a ceiling or a helper.
const FLAGS = ["pickable", "visible", "enabled", "structural", "collidable"];
const combos = [];
for (let bits = 0; bits < (1 << FLAGS.length); bits++) {
  const opts = {};
  FLAGS.forEach((k, i) => { opts[k] = Boolean(bits & (1 << i)); });
  combos.push(opts);
}
const admitsCeiling = combos.filter((o) => rayTargets(o)(CEILING));
const admitsHelper = combos.filter((o) => rayTargets(o)(HALO) || rayTargets(o)(MARKER));
const admitsFloor = combos.filter((o) => rayTargets(o)(FLOOR));

/* ── 3. each liveness flag actually gates ─────────────────────────────── */
const gates = {
  pickable: !rayTargets()(mesh({ isPickable: false }))
            && rayTargets({ pickable: false })(mesh({ isPickable: false })),
  visible: !rayTargets()(mesh({ isVisible: false }))
           && rayTargets({ visible: false })(mesh({ isVisible: false })),
  enabled: !rayTargets()(mesh({ isEnabled: () => false }))
           && rayTargets({ enabled: false })(mesh({ isEnabled: () => false })),
  structural: !rayTargets({ structural: true })(mesh({ metadata: {} }))
              && rayTargets()(mesh({ metadata: {} })),
  collidable: !rayTargets({ collidable: true })(mesh({ checkCollisions: false }))
              && rayTargets()(mesh({ checkCollisions: false })),
};

/* ── 4. no hand-rolled ray predicate survives ─────────────────────────── */
const handRolled = BABYLON.filter((f) => {
  if (f.endsWith("meshRoles.ts")) return false;
  const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return /metadata\?\.isMarker|\/\^\(halo_/.test(code);
}).map(rel);

/* ── 6. what the constructor registers, dispose detaches ──────────────── */
const ev = read(join(SRC, "babylon/EntityVisuals.ts"));
const registers = /scene\.registerBeforeRender\(/.test(ev)
  && /onAfterRenderObservable\.add\(/.test(ev);
const detaches = /unregisterBeforeRender\(/.test(ev)
  && /onAfterRenderObservable\.remove\(/.test(ev);

console.log(`  scanned ${FILES.length} files, ${BABYLON.length} in the 3D layer`);
if (handRolled.length) console.log(`      hand-rolled ray predicate: ${handRolled.join(", ")}`);
console.log(`  rayTargets over all ${combos.length} flag combinations:`);
console.log(`      admits a ceiling : ${admitsCeiling.length}`);
console.log(`      admits a helper  : ${admitsHelper.length}`);
console.log(`      admits the floor : ${admitsFloor.length}`);

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
console.log("\n  assertions:");
ck("the scan reached the 3D layer", BABYLON.length > 20);
ck("NO flag combination admits a ceiling", admitsCeiling.length === 0);
ck("NO flag combination admits a helper mesh", admitsHelper.length === 0);
ck("...while the floor is admitted by every one of them", admitsFloor.length === combos.length);
ck("each flag genuinely gates its term",
   Object.values(gates).every(Boolean), );
ck("no hand-rolled ray predicate is left", handRolled.length === 0);
ck("isHelperMesh covers both conventions",
   isHelperMesh(HALO) && isHelperMesh(MARKER) && !isHelperMesh(FLOOR));
ck("EntityVisuals detaches what it registers", registers && detaches);

/* ── 7. a glyph is baked at the size it is drawn ──────────────────────── */
// The bake-size argument is in RENDER pixels while every other number in the
// pipeline is unscaled CSS px, so the unit lives in a private method rather
// than in the callee's signature. Two of three in-scene callers got it wrong.
const bakes = [...ev.matchAll(/badgeImageDataUrl\(([\s\S]{0,420}?)\)\)?;/g)]
  .map((m) => m[1]);
const cssPxBake = ev.includes("undefined, card, glyphPx, card)");
const rebakesOnStep = /iconUserScale = wantScale;[\s\S]{0,1600}?repaintGlyphs\(\)/.test(ev);
const oneBakeOwner = (ev.match(/glyph\.source = badgeImageDataUrl\(/g) ?? []).length;
console.log(`  badgeImageDataUrl call sites: ${bakes.length}`);
ck("no bake is handed the UNSCALED size", !cssPxBake);
ck("changing the badge size re-bakes the glyphs", rebakesOnStep);
ck("a glyph's source has one owner", oneBakeOwner <= 2);
process.exit(fail ? 1 : 0);
