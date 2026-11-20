// tests/oracles/time_order.mjs
// Times are compared as moments, never as text (owner, 2026-11-20, #204): the villa writes some times in UTC and
// some in its own zone, so "04:20+00:00" sorted before "12:19+08:00" and a 12:20 photo stood before two of 12:19.
// A sort or comparison of a time field must go through Date.parse (or a Date), never localeCompare or < on strings.
import { readFileSync } from "node:fs";
import { ck, done, tsFiles } from "../consistency/check.mjs";

const TIME_FIELD = "(?:at|when|since|until|time|[a-z]+At)";
const textSort = new RegExp(`\\.${TIME_FIELD}\\??\\.localeCompare\\(|localeCompare\\(\\s*\\w+\\.${TIME_FIELD}\\b`);
const found = [];
for (const f of tsFiles("src")) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (textSort.test(line)) found.push(`${f}:${i + 1}`); });
}
ck("no time field is sorted as text (localeCompare): compare Date.parse moments", found.length === 0, found);
done("✅ times are compared as moments");
