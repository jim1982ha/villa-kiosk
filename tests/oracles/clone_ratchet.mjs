// DRY guard 1 of 2: copy-pasted code may only SHRINK (2.496.263).
//
// A dependency-free clone scan over src/: every run of WINDOW tokens (comments
// stripped, nothing else normalised — the same notion jscpd uses by default)
// that appears twice is duplicated code. The CEILING is today's count; a
// release that removes copies lowers it, a change that adds them fails here.
// `node tests/oracles/clone_ratchet.mjs --list` prints the copies, largest first.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ck, done } from "../consistency/check.mjs";

/** Duplicated tokens allowed in src/ — lower it when copies go, never raise it.
 *  5,028 (1.60%) when this was written; 712 (0.23%) after 2.496.263 took out
 *  every TRUE copy. What remains was reviewed and left on purpose — same
 *  shape, different reasons to change:
 *    • the two camera controllers' listener wiring and pointer-move opening
 *      (each binds its OWN handlers; canvasInput owns the set);
 *    • SceneManager's tap and long-press routing (same hit, different answers);
 *    • two Dashboard handlers that both start by asking panelMapping;
 *    • the Facility forms' useState lists, and placementPass's two box tests
 *      (absorb vs refuse: different margins on purpose — see their comments). */
const CEILING = Number(process.env.CLONE_CEILING ?? 712);
const WINDOW = 50;

const ROOT = new URL("../../", import.meta.url).pathname;
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { if (n !== "assets") walk(p); }
    else if (/\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n)) files.push(p);
  }
})(join(ROOT, "src"));

const TOKEN = /[A-Za-z_$][\w$]*|\d[\w.]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`|=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\.\.\.|\S/g;
const ids = new Map();
const docs = files.map((f) => {
  // Comments out, LINE BREAKS KEPT — so the line numbers --list prints are the file's.
  const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const toks = [], lines = [];
  // The line number by a running count: re-splitting the file up to every
  // token was quadratic — 9 s of the 74 s oracle run (2026-10-05).
  let line = 1, at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (!ids.has(m[0])) ids.set(m[0], ids.size + 1);
    toks.push(ids.get(m[0]));
    for (let nl = text.indexOf("\n", at); nl !== -1 && nl < m.index; nl = text.indexOf("\n", nl + 1)) { line++; at = nl + 1; }
    lines.push(line);
  }
  return { f: relative(ROOT, f), toks, lines, dup: new Uint8Array(toks.length) };
});

// Rolling hash of every window; a hash seen at two places marks both.
const B = 1_000_003n, M = (1n << 61n) - 1n;
let pow = 1n; for (let i = 0; i < WINDOW; i++) pow = (pow * B) % M;
const seen = new Map();
for (let d = 0; d < docs.length; d++) {
  const t = docs[d].toks;
  if (t.length < WINDOW) continue;
  let h = 0n;
  for (let i = 0; i < t.length; i++) {
    h = (h * B + BigInt(t[i])) % M;
    if (i >= WINDOW) h = (h - (BigInt(t[i - WINDOW]) * pow) % M + M) % M;
    if (i < WINDOW - 1) continue;
    const at = i - WINDOW + 1, key = h.toString();
    const prev = seen.get(key);
    if (prev === undefined) { seen.set(key, [d, at]); continue; }
    // Same window twice (hash confirmed token by token), not overlapping itself.
    const [pd, pa] = prev;
    if (pd === d && Math.abs(pa - at) < WINDOW) continue;
    const a = docs[pd].toks, ok = (() => { for (let k = 0; k < WINDOW; k++) if (a[pa + k] !== t[at + k]) return false; return true; })();
    if (!ok) continue;
    for (let k = 0; k < WINDOW; k++) { docs[pd].dup[pa + k] = 1; docs[d].dup[at + k] = 1; }
  }
}
const dupTokens = docs.reduce((n, d) => n + d.dup.reduce((a, b) => a + b, 0), 0);
const allTokens = docs.reduce((n, d) => n + d.toks.length, 0);

if (process.argv.includes("--list")) {
  const runs = [];
  for (const d of docs) {
    let s = -1;
    for (let i = 0; i <= d.dup.length; i++) {
      if (d.dup[i] && s < 0) s = i;
      if (!d.dup[i] && s >= 0) { runs.push({ f: d.f, from: d.lines[s], to: d.lines[i - 1], n: i - s }); s = -1; }
    }
  }
  runs.sort((x, y) => y.n - x.n);
  for (const r of runs) console.log(`  ${String(r.n).padStart(5)} tokens  ${r.f}:${r.from}-${r.to}`);
}
console.log(`  ${dupTokens} of ${allTokens} tokens are in a ${WINDOW}-token run that appears twice (${(100 * dupTokens / allTokens).toFixed(2)}%)`);
ck(`copy-pasted code does not grow (ceiling ${CEILING}; lower it when copies go)`, dupTokens <= CEILING, { dupTokens, CEILING });
done("✅ no new copy-paste");
