/**
 * `statusKeyFor` must be TOTAL over what Home Assistant actually sends.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE A NEW SMOKE DETECTOR CRASHED THE MAP (2026-09-08,
 * reported from the wall tablet on 2.496.0). Tapping its badge threw
 * `Cannot read properties of null (reading 'trim')` out of `statusKeyFor`, took
 * the React tree with it, and the whole panel went to the error screen.
 *
 * The signature says `state: string` and TypeScript believed it, because the
 * value comes from `HAHistoryAPI` — an ADAPTER over Home Assistant's JSON,
 * where the declared type is a hope rather than a guarantee. A freshly added
 * entity has history rows whose `state` is null, `UNKNOWN_STATES.has(null)` is
 * false so the filter passed it through, and the first thing this function does
 * is `.trim()`.
 *
 * ⚠️ A NULL STATE IS "NOTHING TO REPORT", NOT "UNKNOWN", and the existing
 * comment inside `statusKeyFor` is what settles which. It already separates a
 * blank state from `UNKNOWN_STATES` deliberately: same colour, different fact,
 * and folding them together would make `isUnavailable` start answering true for
 * an entity that simply has nothing to say. Null belongs on the blank side.
 */
import { statusKeyFor, STATUS_COLOR, UNKNOWN_STATES } from "@/utils/stateColors";

let failures = 0;
function check(what: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}: ${JSON.stringify(got)}`
    + (ok ? "" : ` (expected ${JSON.stringify(want)})`));
}

// ── the crash itself ───────────────────────────────────────────────────────
// ⚠️ CAST, BECAUSE THE POINT IS THAT THE TYPE LIED. A test that only passed
// well-typed values would pass on the unfixed code and measure nothing.
const nothing = [null, undefined] as unknown as string[];
for (const bad of nothing) {
  let key: string;
  try {
    key = statusKeyFor(bad, "binary_sensor");
  } catch (err) {
    failures++;
    console.log(`FAIL  statusKeyFor(${String(bad)}) threw: ${(err as Error).message}`);
    continue;
  }
  check(`statusKeyFor(${String(bad)}) is "unavailable"`, key, "unavailable");
  check(`statusKeyFor(${String(bad)}) has a colour`,
        typeof STATUS_COLOR[key as keyof typeof STATUS_COLOR], "string");
}

// ⚠️ AND WITH NO DOMAIN, which is the `paletteColorFor` / bare-timeline path.
try {
  check("statusKeyFor(null) with no domain", statusKeyFor(nothing[0]), "unavailable");
} catch (err) {
  failures++;
  console.log(`FAIL  statusKeyFor(null) with no domain threw: ${(err as Error).message}`);
}

// ── the distinction the module already draws must SURVIVE the fix ──────────
// ⚠️ THE CHEAP FIX IS TO ADD null TO `UNKNOWN_STATES`, AND IT WOULD BE WRONG.
// That set is the FACT "this entity is unreachable", read by `isUnavailable`
// and by the devices layer across the language boundary; a null history row on
// a brand-new entity is not an outage. The colour is shared, the fact is not —
// which is what `statusKeyFor`'s own comment says about the blank state.
check("UNKNOWN_STATES did not grow a blank", UNKNOWN_STATES.has(""), false);
check("UNKNOWN_STATES still means unreachable", UNKNOWN_STATES.has("unavailable"), true);
check("UNKNOWN_STATES stayed exactly two", UNKNOWN_STATES.size, 2);

// ── ordinary values are untouched ──────────────────────────────────────────
// ⚠️ `binary_sensor` IS NOT IN `DOMAIN_STATES`, so `on` falls through to the
// universal map and is "active". Written down because my first draft asserted
// "alert" from memory and the test failed for a reason that was not the bug.
check("'on' for a binary_sensor", statusKeyFor("on", "binary_sensor"), "active");
check("'off' for a binary_sensor", statusKeyFor("off", "binary_sensor"), "idle");
check("whitespace is still blank", statusKeyFor("   "), "unavailable");
check("case and padding still fold", statusKeyFor("  ON  ", "binary_sensor"), "active");
check("a lock still inverts", statusKeyFor("unlocked", "lock.front"), "alert");


// ════════════════════════════════════════════════════════════════════════════
//  A missing reading is not a reading of zero
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ THE SILENT HALF OF THE SAME DEFECT. The crash above was loud; this one
// draws a plausible line. `Number(null)` and `Number("")` are both 0 and both
// pass `Number.isFinite`, so a history row with no reading became a measured
// zero on the sparkline — a power sensor reading "stopped drawing power", a
// temperature reading 0°C.
const { numericState } = await import("@/ha/HAHistoryAPI");

for (const absent of [null, undefined, "", "   ", "unknown", "unavailable"]) {
  check(`numericState(${JSON.stringify(absent)}) is not a number`,
        Number.isFinite(numericState(absent)), false);
}
check("a real zero still reads as zero", numericState("0"), 0);
check("a real zero as a number still reads as zero", numericState(0), 0);
check("an ordinary reading survives", numericState("21.5"), 21.5);
check("a padded reading survives", numericState(" 21.5 "), 21.5);

console.log(failures === 0 ? "\nall good" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
