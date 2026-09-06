// tests/when_test.ts
// Run: npm run test:when   (node strips the types; no runner, no deps)
//
// ⚠️ NONE OF THIS WAS REACHABLE BEFORE 2026-09-06. Eight copies of this
// formatter lived inside .tsx files that import React, so the bare-node harness
// could not load one — and the case that actually shipped a bug (a stamp with
// no timezone suffix, formatted on one half of a card and not the other) had no
// gate at any price.

import { whenShort, whenLong, timeOnly } from "../../src/vesta/shared/when.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}

console.log("— the failure policy is the caller's decision —");
check("an unparseable stamp is blank by default",
  whenShort("not-a-date") === "");
check("...and raw when the caller asks",
  whenShort("not-a-date", "raw") === "not-a-date");
check("an empty stamp is blank, not 'Invalid Date'",
  whenShort("") === "");
check("...and empty stays empty even under 'raw'",
  whenShort("", "raw") === "");
check("timeOnly obeys the same policy",
  timeOnly("nope", "raw") === "nope" && timeOnly("nope") === "");
check("whenLong obeys the same policy",
  whenLong("nope", "raw") === "nope" && whenLong("nope") === "");

console.log("\n— a real stamp formats, and formats consistently —");
{
  const iso = "2026-08-27T09:23:55Z";
  const short = whenShort(iso), long = whenLong(iso), clock = timeOnly(iso);
  check("a valid stamp is not returned raw", short !== iso && short.length > 0);
  check("no 'Invalid Date' reaches a screen",
    ![short, long, clock].some((s) => s.includes("Invalid")));
  // ⚠️ THE BUG THAT SHIPPED: half a card formatted, half not. The three views
  // must agree about the clock they are showing.
  check("every view shows the same minute",
    long.includes(clock) && short.includes(clock),
    `short=${short} long=${long} clock=${clock}`);
  check("the long form adds the weekday the short one omits",
    long.length > short.length);
}

console.log("\n— a stamp with no zone suffix still parses —");
check("no trailing Z is not a failure",
  whenShort("2026-08-27T09:23:55") !== "");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
