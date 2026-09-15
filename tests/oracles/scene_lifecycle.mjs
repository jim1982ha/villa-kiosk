// tests/oracles/scene_lifecycle.mjs
//
// SceneManager's lifecycle, pinned as text.
//
// 4,604 lines, a 50-member interface, and nothing can construct it without a
// live Engine, a Scene, a canvas and a GL context — so an oracle cannot call a
// single one of its methods. What an oracle CAN do is read it, and the three
// defects below were all reachable that way and none other.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../../", import.meta.url).pathname;
const SM = readFileSync(ROOT + "src/babylon/SceneManager.ts", "utf8");
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};
eq("the file was found", SM.length > 100000, true);

const body = (name) => {
  const i = SM.indexOf(`\n  ${name}(`);
  if (i < 0) return "";
  let d = 0, j = SM.indexOf("{", i);
  for (let k = j; k < SM.length; k++) {
    if (SM[k] === "{") d++;
    else if (SM[k] === "}" && --d === 0) return SM.slice(j, k);
  }
  return "";
};
const dispose = body("dispose");
eq("dispose() was located", dispose.length > 500, true);

// ── 1. nothing that anchors the scene graph survives dispose ─────────────
// ⚠️ THE FAILURE MODE, PRECISELY: Babylon's Node.dispose() does NOT null
// `_scene`. So any retained array of meshes keeps the entire scene graph alive
// through mesh._scene, whatever else was disposed. A field heap snapshot priced
// three retained managers at 36.8 / 35.1 / 35.0 MB — ~107 MB of a 454 MB heap.
// Only types that carry `_scene` are checked: a Map of number arrays is memory,
// not an anchor, and demanding it be cleared would make this noisy and ignored.
const ANCHORS = /\b(?:Abstract)?Mesh\b|\bTransformNode\b|\bNode\b|\bMaterial\b|\bTexture\b|\bLight\b|\bCamera\b/;
const fields = [...SM.matchAll(/^  private (?:readonly )?(\w+)\s*:\s*([^;=]+)[;=]/gm)]
  .map((m) => ({ name: m[1], type: m[2].trim() }))
  .filter((f) => ANCHORS.test(f.type));
console.log(`\n  ${fields.length} private fields hold something that carries a scene reference:`);
const uncleared = fields.filter((f) => !new RegExp(`this\\.${f.name}\\s*(?:=|\\.clear\\(\\)|\\.length\\s*=)`).test(dispose));
for (const f of fields) console.log(`      ${uncleared.includes(f) ? "✗" : "ok"}  ${f.name}: ${f.type.slice(0, 54)}`);
eq("every one of them is cleared in dispose()",
   uncleared.length ? uncleared.map((f) => f.name) : "all cleared", "all cleared");
// ceilingMeshes and worldRoomPolys were both missing. The mapped-type sweep at
// the bottom of dispose() explains why IT is a mapped type — "renaming a field
// is a compile error here instead of a silently missed reference that quietly
// restores the leak" — and that reasoning was never applied to the hand-written
// block above it, which is the list of names it disclaims.

// ── 2. the overview is framed by the model, not by a mode transition ─────
console.log("\n  the villa's own extents decide the overview framing:");
const fitToCalls = (SM.match(/\.fitTo\(/g) ?? []).length;
eq("fitTo has exactly one call site", fitToCalls, 1);
eq("...and it is inside adoptModelExtents", /adoptModelExtents\(\): void \{[\s\S]{0,900}?\.fitTo\(/.test(SM), true);
const loadModel = body("loadModel") || SM.slice(SM.indexOf("async loadModel"), SM.indexOf("async loadModel") + 9000);
eq("loadModel adopts the extents itself", /adoptModelExtents\(\)/.test(loadModel), true);
// ⚠️ WHY THIS IS PINNED. The framing used to be the body of setViewMode's
// `mode === "overview"` branch. setViewMode early-returns when handed the mode
// it already holds, and the constructor sets viewMode = "overview" while the
// model loads (a later fix, so the sky dome stays lit during the wait). The
// only boot path — Dashboard's onReady setViewMode("overview") — was therefore
// a no-op for the framing, and what actually framed a booted villa was
// OverviewController's constructor defaults: radius 30, pan bounds ±20 m,
// fitRadius 30. Per-site numbers, load-bearing, and invisible on the one villa
// whose span happens to make the real fit radius land near 30.
eq("the constructor still records overview (the sky fix, which must not regress)",
   /this\.viewMode = "overview";/.test(SM), true);
eq("...and setViewMode still early-returns on a matching mode",
   /setViewMode\(mode[^)]*\): void \{\s*\n\s*if \(mode === this\.viewMode\) return;/.test(SM), true);
// Those last two are the collision. Pinned together so the next reader sees
// both facts at once rather than one comment twenty lines above the other.

// ── 3. no Babylon API that fetches from the internet ─────────────────────
// ⚠️ THE RULE LIVES IN ModelLoader's HEADER, AND THE TEMPTATION LIVES HERE.
// SceneManager owns the Engine and the Scene, so this is where someone reaches
// for a loading screen or a default environment. Both fetch: DefaultLoadingScreen
// pulls a logo PNG, CreateDefaultEnvironment a skybox DDS. On a villa iPad with
// no WAN that is not "slower", it is a stalled loader or an untextured model.
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", cwd: ROOT })
  .split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
if (files.length < 100) { console.log(`    FAIL  the scan reached src/  →  ${files.length}`); process.exit(1); }
const TRAPS = /displayLoadingUI|DefaultLoadingScreen|createDefaultEnvironment|CreateDefaultEnvironment|EnvironmentHelper|LensFlare|cdn\.babylonjs\.com|assets\.babylonjs\.com/;
console.log(`\n  and nothing reaches the internet (${files.length} files):`);
const reaches = files.filter((f) => TRAPS.test(
  readFileSync(ROOT + f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")));
eq("no lazily-fetching Babylon API is called", reaches.length ? reaches : "none", "none");

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ the scene's lifecycle holds"}`);
process.exit(fail ? 1 : 0);
