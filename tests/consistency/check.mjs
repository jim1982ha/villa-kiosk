// tests/consistency/check.mjs
// The oracles' assertion helper, ONCE. `ck` was pasted verbatim into 82
// oracle files (and drifted into three shapes) before 2.496.200.
//
//   import { ck, done } from "../consistency/check.mjs";
//   ck("what must hold", holds, gotValueShownOnFailure);
//   done("✅ one line for the green run");   // exits 1 with a red count otherwise

let fail = 0;

export function ck(name, ok, got) {
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`);
  if (!ok) fail++;
}

/** Equality by JSON, printing both sides on a miss. */
export function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(got)}${ok ? "" : `  (wanted ${JSON.stringify(want)})`}`);
  if (!ok) fail++;
}

export function failed() { return fail; }

export function done(green) {
  console.log(fail ? `\n❌ ${fail} failed` : `\n${green}`);
  process.exit(fail ? 1 : 0);
}
