// tests/oracles/babylon_side_effects.mjs
//
// ⚠️ THIS FILE WAS PROMISED AND NEVER WRITTEN.
//
// `babylonSideEffects.ts` says, in its own header: "`tests/oracles/
// babylon_side_effects.mjs` fails the build if a module calls a patched API
// without it." For eleven releases that sentence described nothing. A comment
// asserting a guard exists is worse than no comment — it tells the next reader
// the invariant is protected, so they stop checking.
//
// THE HAZARD, restated because it is invisible to tsc and has bitten four
// times: several Babylon APIs are DECLARED on Scene/Mesh by the types but
// IMPLEMENTED by a sibling module that patches the prototype when imported for
// its side effects. Unpatched, `Scene.prototype.createPickingRay` throws
// `_WarnImport("Ray")` and `Scene.prototype.pick` quietly returns an empty
// PickingInfo after a console warning. The type checker sees a method that
// exists and says nothing; the build is green and the villa is untappable.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../../", import.meta.url).pathname;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", cwd: ROOT })
  .split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const src = new Map(files.map((f) => [f, readFileSync(ROOT + f, "utf8")]));
if (src.size < 100) { console.log(`    FAIL  the scan reached the source tree  →  ${src.size}`); process.exit(1); }
console.log(`  scanned ${src.size} tracked source files\n`);

const OWNER = "src/babylon/babylonSideEffects.ts";
const owner = src.get(OWNER);
eq("the owner module still exists", owner !== undefined, true);

// Each patched API, and the sibling that implements it. A module calling the
// API must import the owner (directly or transitively through a file that
// does) — importing the raw sibling is the per-caller pattern this replaced.
const PATCHED = [
  { call: /\bscene\.createPickingRay\s*\(|\.createPickingRay\s*\(/, api: "createPickingRay", sibling: "@babylonjs/core/Culling/ray" },
  { call: /\.pickWithRay\s*\(|\.multiPickWithRay\s*\(|\.multiPick\s*\(|\.pickWithBoundingInfo\s*\(/, api: "pickWithRay/multiPick", sibling: "@babylonjs/core/Culling/ray" },
  // ⚠️ `.pick(` WAS MISSING FROM THIS LIST on the first draft, so PickHandler —
  // the module whose un-declared `scene.pick` is named in the owner's header as
  // one of the two original offenders — was never checked by the very oracle
  // written to check it. Unpatched, `Scene.prototype.pick` returns an empty
  // PickingInfo after a console warning: nothing in the villa is tappable and
  // the build is green.
  { call: /\.pick\s*\(/,                                                    api: "scene.pick",        sibling: "@babylonjs/core/Culling/ray" },
  { call: /\bgetForwardRay\s*\(/,                                       api: "getForwardRay",     sibling: "@babylonjs/core/Culling/ray" },
  { call: /\.beginAnimation\s*\(|\.beginDirectAnimation\s*\(/,          api: "beginAnimation",    sibling: "@babylonjs/core/Animations/animatable" },
  { call: /\.renderOutline\s*=|\.renderOverlay\s*=|\.outlineWidth\s*=/, api: "renderOutline",     sibling: "@babylonjs/core/Rendering/outlineRenderer" },
  // Both forms: the Scene one nothing currently calls, and the Mesh one
  // SceneManager.applyStructure does. Naming only the Scene form made this
  // entry vacuous — zero callers, a green line, and no cover for the call that
  // exists. A pattern with no caller proves nothing; see the census below.
  { call: /\.createOrUpdateSelectionOctree\s*\(|\.createOrUpdateSubmeshesOctree\s*\(|\.useOctreeForPicking\s*=/,
    api: "the picking octree", sibling: "@babylonjs/core/Culling/Octrees/octreeSceneComponent" },
  { call: /SceneLoader\.|\bImportMeshAsync\b|\bAppendSceneAsync\b/,     api: "the glTF loader",   sibling: "@babylonjs/loaders/glTF" },
];

console.log("  every patched sibling is declared in one place:");
for (const { api, sibling } of PATCHED) {
  eq(`${api}'s sibling (${sibling}) is imported by the owner`,
     (owner ?? "").includes(`import "${sibling}"`), true);
}

// ⚠️ DIRECT IMPORT, NOT TRANSITIVE — AND THIS ORACLE FIRST GOT IT WRONG.
// It walked the local import graph and gave a module credit for importing
// something that imports the owner. That is precisely the guarantee the owner's
// own header calls unsafe: PickHandler and OverviewController both worked for
// months only because five unrelated modules happened to value-import `Ray`, so
// the sibling was in the bundle. Credit-by-transitivity restores that. The rule
// the module states is "IMPORT THIS FILE", and this asserts that rule.
const declares = (f) => /import "\.\/babylonSideEffects"|import "@\/babylon\/babylonSideEffects"/
  .test(src.get(f) ?? "");

console.log("\n  every caller of a patched API imports the owner ITSELF:");
const offenders = [];
for (const [f, s] of src) {
  if (f === OWNER) continue;
  // Strip comments so a mention in prose is not a call.
  const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const { call, api } of PATCHED) {
    if (call.test(code) && !declares(f)) offenders.push(`${f} (${api})`);
  }
}
eq("no module calls a patched API without it",
   offenders.length ? [...new Set(offenders)] : "none", "none");
// ⚠️ THE SCAN IS THE WHOLE TRACKED TREE, not just src/babylon/. The rule is
// about who CALLS the API, and a .tsx calling scene.pick is exactly as broken
// as a .ts doing it — a 3D-layer-only scan cannot see that.

// ⚠️ A PATTERN WITH NO CALLER IS A GREEN LINE THAT PROVES NOTHING. The first
// draft carried one (it named only the Scene-level octree call, which nothing
// makes). Count the callers and say so, rather than letting an empty set read
// as a pass.
console.log("\n  every pattern above is watching a real caller:");
for (const { call, api } of PATCHED) {
  const n = [...src].filter(([f, s]) => f !== OWNER &&
    call.test(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"))).length;
  eq(`${api} has callers to watch`, n > 0, true);
}

console.log("\n  and nobody hand-imports a sibling behind the owner's back:");
const direct = [...src].filter(([f, s]) => f !== OWNER &&
  /import "@babylonjs\/(?:core\/(?:Culling\/ray|Animations\/animatable|Rendering\/outlineRenderer|Collisions\/collisionCoordinator|Culling\/Octrees\/octreeSceneComponent)|loaders\/glTF)"/.test(s)).map(([f]) => f);
eq("the per-caller pattern has not come back", direct.length ? direct : "nobody", "nobody");

// ── the other invisible hazard: a Babylon default that FETCHES ───────────
// ⚠️ SAME CLASS, DIFFERENT REGISTRY. The patches above are APIs Babylon leaves
// as stubs until a sibling is imported. These are URLs Babylon leaves pointed
// at its own CDN until someone configures them. Both are invisible to tsc, and
// both fail only in the place we cannot watch — the second one on a villa iPad
// with no WAN. Draco and KTX2 were each found reaching cdn.babylonjs.com and
// each fixed by naming the asset; EXT_meshopt_compression is the third member
// of that set and was missed for the life of the branch, because importing
// "@babylonjs/loaders/glTF" registers the WHOLE extension barrel.
//
// tests/hard-rules.py cannot see any of this: it walks `git ls-files`, and the
// URL lives in node_modules.
console.log("\n  no Babylon default is left pointing at the internet:");
const ML = src.get("src/babylon/ModelLoader.ts") ?? "";
eq("the CDN host is rewritten for every default at once",
   /Tools\.ScriptBaseUrl\s*=/.test(ML), true);
eq("...and Draco is still named explicitly", /DracoCompression\.Configuration\s*=/.test(ML), true);
eq("...and so is the KTX2 transcoder", /KhronosTextureContainer2\.URLConfig\s*=/.test(ML), true);
// The UASTC entries stay null ON PURPOSE — pointing them at a CDN is exactly
// the dependency this whole block exists to refuse. Babylon's
// Tools.GetBabylonScriptURL returns "" for a falsy url rather than
// substituting a default, so null is safe, and only the ETC1S path is wired.
eq("the UASTC entries are still null, not a URL",
   /wasmUASTCToASTC:\s*null/.test(ML), true);

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ one declaration of what Babylon must patch"}`);
process.exit(fail ? 1 : 0);
