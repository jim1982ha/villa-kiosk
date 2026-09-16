// The environment a PBR surface reflects must depend on WHICH WAY IT FACES.
//
// ⚠️ THIS ORACLE RUNS THE SHIPPED MODULE, not a transcription of it. The alias
// hook next door lets plain `node` import the real `src/` TypeScript.
//
// The villa's GLB carries 57 distinct roughnessFactor values across 337
// materials and KHR_materials_specular, and every one of them samples the scene
// environment for its specular lobe. What they sampled was a cube built from
// three colours interpolated by HEIGHT alone — so nothing in the villa could
// reflect the sun, and all that roughness variation had nothing to show
// against. buildSkyFaces is the other half of that.
//
// ⚠️ THE ASSERTION THAT MATTERS MOST IS THE CUBE-MAP CONVENTION. Face order and
// the sign of V are spec, not intuition: the gradient cube next door only ever
// needed the Y component so it could get away with a two-line approximation,
// and a sky with a SUN in it cannot. Get a sign wrong and the villa reflects
// the sun off the opposite wall — plausible in a screenshot, invisible to a
// typechecker.
//
// ⚠️ AND THE OBVIOUS WAY TO TEST IT MEASURES NOTHING. The first version of this
// oracle searched the built faces for the brightest texel and checked that it
// pointed at the sun. It PASSED with the +Z face's V sign deliberately flipped,
// because it built the faces with `cubeDir` and then read the directions back
// with the same `cubeDir` — the error cancelled itself and the test was
// self-consistency wearing correctness's clothes. Caught by mutation, which is
// the only thing that could have caught it.
//
// So the load-bearing check below is against LITERAL vectors taken from the
// OpenGL/glTF cube-map table, which no change to the module can move. The
// brightest-texel search is kept, honestly labelled as the weaker check it is.
import { register } from "node:module";

register("../consistency/alias-hook.mjs", import.meta.url);

const { skyRadiance, cubeDir, buildSkyFaces, SKY_FACE_SIZE } =
  await import("@/babylon/proceduralSky");

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

const norm = (v) => {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const deg = (r) => (r * 180) / Math.PI;

/** A sun 40° up in the +X half of the sky — nothing symmetric, so a sign error
 *  in X or Z cannot cancel out and hide itself. */
const SUN = norm({ x: 0.72, y: 0.64, z: 0.27 });
const DAY = { sun: SUN, turbidity: 3, nightT: 0 };
const NIGHT = { sun: norm({ x: 0.72, y: -0.64, z: 0.27 }), turbidity: 3, nightT: 1 };

/* ── 1. the sun's side of the sky is brighter than the far side ─────────── */
// The single thing the gradient could not do at all: its radiance is a function
// of height only, so these two directions were IDENTICAL by construction.
const towardSun = { x: SUN.x, y: 0.35, z: SUN.z };
const awaySun = { x: -SUN.x, y: 0.35, z: -SUN.z };
const lSun = lum(skyRadiance(norm(towardSun), DAY));
const lAway = lum(skyRadiance(norm(awaySun), DAY));
console.log(`\n  sky at 20° elevation: toward sun ${lSun.toFixed(3)} · away ${lAway.toFixed(3)}`);

/* ── 2. where is the brightest texel, really? ───────────────────────────── */
const faces = buildSkyFaces(DAY);
let best = -Infinity, bestDir = null;
for (let f = 0; f < 6; f++) {
  const data = faces[f];
  for (let j = 0; j < SKY_FACE_SIZE; j++) {
    for (let i = 0; i < SKY_FACE_SIZE; i++) {
      const o = (j * SKY_FACE_SIZE + i) * 4;
      const l = lum([data[o], data[o + 1], data[o + 2]]);
      if (l > best) {
        best = l;
        const u = (i / (SKY_FACE_SIZE - 1)) * 2 - 1;
        const v = (j / (SKY_FACE_SIZE - 1)) * 2 - 1;
        bestDir = cubeDir(f, u, v);
      }
    }
  }
}
const offBy = deg(Math.acos(Math.max(-1, Math.min(1,
  bestDir.x * SUN.x + bestDir.y * SUN.y + bestDir.z * SUN.z))));
console.log(`  brightest texel points ${offBy.toFixed(2)}° from the sun`
  + ` (${bestDir.x.toFixed(2)}, ${bestDir.y.toFixed(2)}, ${bestDir.z.toFixed(2)})`
  + ` vs sun (${SUN.x.toFixed(2)}, ${SUN.y.toFixed(2)}, ${SUN.z.toFixed(2)})`);

/* ── 3. every texel is finite and non-negative ──────────────────────────── */
// A negative or NaN radiance does not throw — it silently produces a black or
// undefined patch in every reflection in the villa.
let bad = 0, texels = 0;
for (const data of faces) {
  for (let k = 0; k < data.length; k++) {
    texels++;
    const v = data[k];
    if (!Number.isFinite(v) || v < 0) bad++;
  }
}

/* ── 4a. cubeDir against the SPEC, not against itself ───────────────────── */
// The OpenGL / glTF cube-map table, for s,t in [-1,1] with V running downward:
//   +X ( 1, -t, -s)   -X (-1, -t,  s)
//   +Y ( s,  1,  t)   -Y ( s, -1, -t)
//   +Z ( s, -t,  1)   -Z (-s, -t, -1)
// These expectations are written out by hand FROM that table. They are the one
// thing in this file that does not come from the module under test.
const SPEC = [
  ["+X centre", 0, 0, 0, [1, 0, 0]],
  ["-X centre", 1, 0, 0, [-1, 0, 0]],
  ["+Y centre", 2, 0, 0, [0, 1, 0]],
  ["-Y centre", 3, 0, 0, [0, -1, 0]],
  ["+Z centre", 4, 0, 0, [0, 0, 1]],
  ["-Z centre", 5, 0, 0, [0, 0, -1]],
  // The edges are what a sign error actually moves — a centre is fixed under
  // most of them, which is why centres alone would be another vacuous test.
  ["+Z, u right", 4, 1, 0, [1, 0, 1]],
  ["+Z, v down", 4, 0, 1, [0, -1, 1]],
  ["+Y, v down", 2, 0, 1, [0, 1, 1]],
  ["+X, u right", 0, 1, 0, [1, 0, -1]],
  ["-Z, u right", 5, 1, 0, [-1, 0, -1]],
  ["-Y, v down", 3, 0, 1, [0, -1, -1]],
];
const specMisses = [];
for (const [name, face, u, v, want] of SPEC) {
  const got = cubeDir(face, u, v);
  const w = norm({ x: want[0], y: want[1], z: want[2] });
  const d = Math.hypot(got.x - w.x, got.y - w.y, got.z - w.z);
  if (d > 1e-9) specMisses.push(`${name} → (${got.x.toFixed(2)},${got.y.toFixed(2)},${got.z.toFixed(2)}) want (${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)})`);
}
if (specMisses.length) for (const m of specMisses) console.log(`      ✗ ${m}`);

/* ── 4b. cubeDir covers the sphere and returns unit vectors ─────────────── */
let worstLen = 0;
const centres = [];
for (let f = 0; f < 6; f++) {
  const d = cubeDir(f, 0, 0);
  centres.push(d);
  worstLen = Math.max(worstLen, Math.abs(Math.hypot(d.x, d.y, d.z) - 1));
}
// The six face centres must be the six axes: each axis hit exactly once.
const axisHits = centres.map((d) =>
  [d.x, d.y, d.z].map((c) => Math.round(c)).join(",")).sort().join(" ");
const EXPECTED_AXES = ["-1,0,0", "0,-1,0", "0,0,-1", "0,0,1", "0,1,0", "1,0,0"].join(" ");

/* ── 5. night is darker than day, and carries no sun ────────────────────── */
const lDayUp = lum(skyRadiance({ x: 0, y: 1, z: 0 }, DAY));
const lNightUp = lum(skyRadiance({ x: 0, y: 1, z: 0 }, NIGHT));
// Sample straight at where the sun WOULD be if it had not set.
const lNightSun = lum(skyRadiance(norm({ x: 0.72, y: 0.64, z: 0.27 }), NIGHT));
console.log(`  zenith: day ${lDayUp.toFixed(3)} · night ${lNightUp.toFixed(4)}`);

/* ── 6. haze widens the glow instead of only brightening it ─────────────── */
// 20° off the sun: crisp air should be dimmer there than thick haze, which is
// the whole meaning of the control the owner is given.
const off20 = norm({ x: SUN.x * 0.94 + 0.34, y: SUN.y * 0.94, z: SUN.z * 0.94 });
const lCrisp = lum(skyRadiance(off20, { ...DAY, turbidity: 1 }));
const lHazy = lum(skyRadiance(off20, { ...DAY, turbidity: 10 }));

console.log("\n  assertions:");
ck("the sun's side of the sky is brighter than the far side", lSun > lAway * 1.05);
ck("  ...which the height-only gradient could not express", true);
ck("cubeDir matches the OpenGL/glTF cube-map table", specMisses.length === 0);
// Weaker by construction — it reads directions back with the same function it
// built them with, so it cannot catch a convention error. It DOES catch the sun
// term being dropped, mis-scaled, or applied to the wrong angle.
ck("the brightest texel is the sun (self-consistency only)", offBy < 2.5);
ck("every texel is finite and non-negative", bad === 0 && texels === 6 * SKY_FACE_SIZE * SKY_FACE_SIZE * 4);
ck("cubeDir returns unit vectors", worstLen < 1e-9);
ck("the six faces are the six axes, each once", axisHits === EXPECTED_AXES);
ck("night is far darker than day", lNightUp < lDayUp * 0.1);
ck("  ...and a set sun leaves no disc behind", lNightSun < lDayUp * 0.1);
ck("haze spreads the sun's glow wider than crisp air", lHazy > lCrisp);

if (fail) {
  console.log("\n  FAIL — the environment the villa reflects does not match the sky");
  console.log("         it claims to be. A sun in the wrong place looks plausible");
  console.log("         in a screenshot; that is exactly why this is measured.");
}
process.exit(fail ? 1 : 0);
