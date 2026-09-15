// tests/oracles/frame_clock.mjs
//
// ⚠️ ALSO PROMISED AND NEVER WRITTEN — frameClock.ts's header ends "Imports
// nothing, so it runs under plain `node` — see tests/oracles/frame_clock.mjs."
// It did not. The module's whole argument for existing is that the rule it
// owns had no code owner, only a docstring, and was therefore implemented twice
// and ignored a third time; shipping it with a docstring pointing at an absent
// test repeated the mistake one level up.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { FrameClock } from "../../src/babylon/frameClock.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
};

console.log("  the clock itself:");
const c = new FrameClock();
eq("the first step is one frame at 60Hz, not zero", c.step(1000), 16);
eq("then it measures real elapsed time",            c.step(1033), 33);
// ⚠️ THE CLAMP IS THE POINT. The on-demand render loop idles for seconds at a
// time; handing an animation a raw 4-second delta makes everything it drives
// jump to its end state at once, which reads as a glitch rather than motion.
eq("a long idle is clamped, not passed through",    c.step(5033), 100);
eq("...and the clock resumes from the real clock after it", c.step(5049), 16);
eq("a zero-length step is honest about it",         c.step(5049), 0);

console.log("\n  reset makes the next step a first step again:");
c.reset();
eq("after reset, no predecessor to measure against", c.step(9999), 16);
eq("and it measures again from there",               c.step(10020), 21);

console.log("\n  two clocks do not share state:");
const a = new FrameClock(), b = new FrameClock();
a.step(0); a.step(500);
eq("b's first step is still a first step", b.step(500), 16);

// ── the ban this module exists to make keepable ──────────────────────────
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", cwd: ROOT })
  .split("\n").filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const src = new Map(files.map((f) => [f, readFileSync(ROOT + f, "utf8")]));
if (src.size < 100) { console.log(`    FAIL  the scan reached the source tree  →  ${src.size}`); process.exit(1); }

console.log(`\n  and the banned call has no callers (${src.size} files scanned):`);
const banned = [...src].filter(([, s]) =>
  /\bgetDeltaTime\s*\(/.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ""))).map(([f]) => f);
eq("nobody calls engine.getDeltaTime()", banned.length ? banned : "nobody", "nobody");
// It counts requestAnimationFrame ticks, not rendered frames. Babylon sets the
// delta in beginFrame(), which its loop calls on every rAF tick BEFORE deciding
// whether to render — so under the rate cap every animation was told 16.7ms had
// passed when 33ms really had: half speed while idle, full speed during
// interaction, which reads as a fan surging.

console.log("\n  and nobody re-derives the clamp:");
const copies = [...src].filter(([f, s]) => f !== "src/babylon/frameClock.ts" &&
  /Math\.min\(\s*now\s*-\s*[A-Za-z_.]*last[A-Za-z_.]*\s*,/.test(s)).map(([f]) => f);
eq("the clamp has one author", copies.length ? copies : "nobody", "nobody");

console.log(`\n${fail ? `❌ ${fail} failed` : "✅ one clock, one clamp, no banned call"}`);
process.exit(fail ? 1 : 0);
