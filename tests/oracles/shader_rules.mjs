// SHADER CODE THAT RUNS THE SAME ON EVERY DEVICE (owner, 2026-11-16: the lights lit the next room on a phone and
// nothing on a Mac, while a computer showed them right). Two fixed patterns, read from the source:
//  * a GLSL integer or integer vector declared without `highp`: a fragment shader's default int precision is
//    mediump, which a phone's GPU runs at 16 bits (a room mask lost its upper rooms and its wall bit);
//  * a uniform float array uploaded with `updateFloatArray`/`updateArray`: without uniform buffers (Babylon turns them
//    off for Chrome on macOS) that is uniform1fv, which a vec4[] refuses. babylon/shaderArrays.ts is the one place.
import { readFileSync } from "node:fs";
import { ck, done, tsFiles } from "../consistency/check.mjs";

const root = new URL("../../src/", import.meta.url).pathname;
/** A GLSL declaration of an integer type not marked highp: `uint x`, `ivec2 c`, a function returning one. */
const LOW_INT = /(^|[^\w])(?<!highp\s)(uint|uvec[234]|ivec[234])\s+[A-Za-z_]\w*\s*[=;(,)]/;
const ARRAY_UPLOAD = /\.(updateFloatArray|updateArray)\(/;
const ARRAY_HOME = "babylon/shaderArrays.ts";

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const lowInts = [], uploads = [];
for (const f of tsFiles(root)) {
  const rel = f.slice(root.length);
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (isComment(line)) return;
    if (LOW_INT.test(line)) lowInts.push(`${rel}:${i + 1}`);
    if (ARRAY_UPLOAD.test(line) && rel !== ARRAY_HOME) uploads.push(`${rel}:${i + 1}`);
  });
}

console.log("  the checks themselves:");
ck("a bare `uint x = …` and `ivec2 c = …` are caught; `highp uint x` and a cast `uint(y)` are not",
   LOW_INT.test("  uint x = 1u;") && LOW_INT.test("  ivec2 c = ivec2(p);") && LOW_INT.test("uint cell(vec2 p) {")
   && !LOW_INT.test("  highp uint x = 1u;") && !LOW_INT.test("  x = uint(y);") && !LOW_INT.test("Uint32Array(4)"));
console.log("\n  the source:");
ck("every GLSL integer in src is highp (a phone runs mediump at 16 bits)", lowInts.length === 0, lowInts);
ck(`every uniform float array goes through ${ARRAY_HOME} (uniform buffers off on a Mac)`, uploads.length === 0, uploads);
done();
