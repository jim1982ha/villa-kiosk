// tests/resolution_valve_test.ts
// Run: npm run test:resolution-valve   (node strips the types; no runner, no deps)
//
// ⚠️ THE NUMBERS BELOW WERE ALREADY WRITTEN DOWN — as a table in a docstring
// inside a 4,600-line Babylon class that cannot be loaded without a GPU
// context. They were the valve's ONLY validation channel: field telemetry from
// four devices, read by hand. Now they are assertions.
//
// Two of these invariants shipped broken. The upward gate was once fed the
// frame GAP instead of RENDER time (a 120Hz panel then read as twice as capable
// as the same silicon behind a 60Hz one), and the valve itself sat below a
// telemetry counter that capped at 8 records per session, so a field iPad sat
// at 13fps indefinitely.

import { resolutionValve } from "../../src/babylon/resolutionValve.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) { failures++; console.log(`FAIL  ${name} ${extra}`); }
  else console.log(`ok    ${name}`);
}

const LIMITS = { sampleMin: 20, slowMs: 40, targetMs: 22, scaleFloor: 1 };
const state = (o: Partial<Parameters<typeof resolutionValve>[0]> = {}) =>
  ({ current: 0.5, native: 1 / 3, sharpened: false, alreadyRaised: false, ...o });
const samples = (o: Partial<Parameters<typeof resolutionValve>[1]> = {}) =>
  ({ gapP50: 16.7, renderP50: 7, gapCount: 60, renderCount: 60, ...o });

console.log("— the four devices in the field dump (DPR-3, 2.25x pixel increase) —");
{
  // current 0.5 → native 1/3 is a 1.5x linear change, 2.25x the pixels.
  const raise = (renderP50: number) =>
    resolutionValve(state(), samples({ renderP50, gapP50: 16.7 }), LIMITS);
  check("Android Chrome ~7ms UPGRADES (ANGLE: resolution is free)",
    raise(7).direction === "raise", JSON.stringify(raise(7)));
  check("iPhone Safari ~11.5ms is refused", raise(11.5).direction === null);
  check("iPad (HA app) ~28ms is refused", raise(28).direction === null);
  check("Mac never reaches the test — already native",
    resolutionValve(state({ current: 0.5, native: 0.5 }), samples(), LIMITS).direction === null);
}

console.log("\n— invariant 4: ease reads the GAP, raise reads RENDER time —");
{
  // ⚠️ THE BUG THAT SHIPPED. These two are one line apart in the caller and
  // swapping them compiles. A 120Hz panel holding vsync reports gapP50 8.4ms
  // while its render cost is unchanged.
  const at60 = resolutionValve(state(), samples({ gapP50: 16.7, renderP50: 7 }), LIMITS);
  const at120 = resolutionValve(state(), samples({ gapP50: 8.4, renderP50: 7 }), LIMITS);
  check("the same silicon decides the same thing at 60Hz and 120Hz",
    at60.direction === at120.direction && at60.nextScaling === at120.nextScaling,
    `${JSON.stringify(at60)} vs ${JSON.stringify(at120)}`);
  // And the downward step must NOT be driven by render time.
  const slowGapFastRender = resolutionValve(
    state({ current: 0.5 }), samples({ gapP50: 60, renderP50: 3 }), LIMITS);
  check("a slow GAP eases even when render time is fast",
    slowGapFastRender.direction === "ease");
}

console.log("\n— invariant 1: monotonic down, never hunting —");
{
  const first = resolutionValve(state({ current: 0.5 }), samples({ gapP50: 60 }), LIMITS);
  check("a slow device coarsens", first.direction === "ease");
  check("…strictly coarser than it was", (first.nextScaling ?? 0) > 0.5);
  const again = resolutionValve(
    state({ current: first.nextScaling! }), samples({ gapP50: 60 }), LIMITS);
  check("…and never finer again on the next pass",
    again.nextScaling === null || again.nextScaling >= first.nextScaling!);
}

console.log("\n— invariant 2: never below 1x CSS (the rainbow-speckle floor) —");
{
  const atFloor = resolutionValve(state({ current: 1 }), samples({ gapP50: 200 }), LIMITS);
  check("a device already at the floor is left alone", atFloor.nextScaling === null);
  const wild = resolutionValve(state({ current: 0.9 }), samples({ gapP50: 5000 }), LIMITS);
  check("an absurdly slow frame cannot push past the floor",
    (wild.nextScaling ?? 0) <= LIMITS.scaleFloor, JSON.stringify(wild));
}

console.log("\n— invariant 3: the raise is one-shot per session —");
{
  check("a second raise is refused",
    resolutionValve(state({ alreadyRaised: true }), samples({ renderP50: 7 }), LIMITS)
      .direction === null);
  check("…but the downward valve still works afterwards",
    resolutionValve(state({ alreadyRaised: true, current: 0.5 }),
                    samples({ gapP50: 60 }), LIMITS).direction === "ease");
}

console.log("\n— invariant 5: neither step fires while sharpened —");
{
  check("no ease while sharpened",
    resolutionValve(state({ sharpened: true }), samples({ gapP50: 60 }), LIMITS)
      .nextScaling === null);
  check("no raise while sharpened",
    resolutionValve(state({ sharpened: true }), samples({ renderP50: 7 }), LIMITS)
      .nextScaling === null);
}

console.log("\n— sample minimums —");
{
  check("too few gap samples: no decision at all",
    resolutionValve(state(), samples({ gapCount: 19, gapP50: 60 }), LIMITS)
      .nextScaling === null);
  check("too few render samples: no RAISE, but ease still allowed",
    resolutionValve(state({ current: 0.5 }),
                    samples({ renderCount: 0, renderP50: Infinity, gapP50: 60 }), LIMITS)
      .direction === "ease");
  check("…and with a fast gap, no render samples means no move",
    resolutionValve(state(), samples({ renderCount: 0, renderP50: Infinity }), LIMITS)
      .nextScaling === null);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
