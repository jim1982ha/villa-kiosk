// Does a device's OFFLINE time survive the fetch and reach the chart?
// Replayed over the real rows HA holds for the master-bedroom lock on
// 2026-09-14, a device that flapped unlocked<->unavailable all day.
const UNKNOWN = new Set(["unavailable", "unknown"]);

// the pipeline as it was: drop unknown states, then collapse consecutive dupes
const OLD = (rows) => {
  const kept = rows.filter(([, s]) => !UNKNOWN.has(s));
  const out = [];
  for (const p of kept) if (!out.length || out[out.length - 1][1] !== p[1]) out.push(p);
  return out;
};
// the pipeline now: keep everything, then collapse consecutive dupes
const NEW = (rows) => {
  const out = [];
  for (const p of rows) if (!out.length || out[out.length - 1][1] !== p[1]) out.push(p);
  return out;
};

const TWELVE_H = [
  ["08:03:40","unlocked"],["15:34:32","unavailable"],["15:37:46","unlocked"],
  ["16:27:33","unavailable"],["16:42:22","unlocked"],["17:31:54","unavailable"],
  ["17:38:56","unlocked"],["18:15:09","unavailable"],["18:15:10","unlocked"],
  ["18:38:49","unavailable"],["19:23:32","unlocked"],["19:37:11","unavailable"],
];
// HA returns the state active AT the window start as the first row
const ONE_H = [["19:05:00","unavailable"],["19:23:32","unlocked"],["19:37:11","unavailable"]];

let fail = 0;
const ck = (n, ok) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };

for (const [name, rows] of [["1h", ONE_H], ["12h", TWELVE_H]]) {
  const o = OLD(rows), n = NEW(rows);
  console.log(`\n  ${name} window — ${rows.length} rows from HA`);
  console.log(`    before: ${o.length} segment(s), first at ${o[0]?.[0] ?? "—"}`);
  console.log(`    after : ${n.length} segment(s), first at ${n[0]?.[0] ?? "—"}`);
}

console.log("\n  assertions:");
ck("1h now starts at the window edge, not mid-chart", NEW(ONE_H)[0][0] === "19:05:00");
ck("1h before it began late (the blank gap)", OLD(ONE_H)[0][0] === "19:23:32");
ck("12h no longer collapses to one false band", NEW(TWELVE_H).length === 12);
ck("12h before it did", OLD(TWELVE_H).length === 1);
ck("offline periods now reach the chart",
   NEW(TWELVE_H).filter(([, s]) => UNKNOWN.has(s)).length === 6);
ck("none reached it before",
   OLD(TWELVE_H).filter(([, s]) => UNKNOWN.has(s)).length === 0);

console.log("\n  the dead-window lookback in useStateHistory:");
const alive = (rows) => rows.some(([, s]) => !UNKNOWN.has(s));
const DEAD = [["19:05:00","unavailable"],["19:20:00","unavailable"]];
ck("a fully-offline window is now seen as dead", alive(NEW(DEAD)) === false);
ck("before, the filter emptied it and the test could not tell", alive(OLD(DEAD)) === false && OLD(DEAD).length === 0);
process.exit(fail ? 1 : 0);
