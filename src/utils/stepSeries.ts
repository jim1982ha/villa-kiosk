/**
 * A state series is a STEP function, and drawing it any other way invents data.
 *
 * ⚠️ MEASURED ON THE VILLA, 2026-09-19. The owner asked why a pump's power
 * trend showed repeating ramps with nothing in between. The recorder held no
 * gaps and no `unavailable` at all — 167 changes in 24 hours, almost all of
 * them `0.0`. What it held for one blip was:
 *
 *     00:10:00  0.0      00:52:01  3.1      00:52:03  0.0
 *
 * 0 W for FORTY-TWO MINUTES, 3.1 W for two seconds, then 0 W. A polyline
 * through those three points draws a 42-minute diagonal climbing through
 * values that never existed, then a two-second vertical fall. Every sawtooth
 * on that chart was one stretch of held zero, drawn as a gradual rise.
 *
 * ⚠️ THIS IS NOT THE GAP PROBLEM AND THE TWO ARE OFTEN CONFUSED. A gap is the
 * absence of knowledge and should be shown as absence. This is the OPPOSITE:
 * the value is perfectly known — Home Assistant records a change and the value
 * holds until the next one — and linear interpolation throws that knowledge
 * away. A sensor that reports every minute hides it; a sensor that reports on
 * change, which is most of them, shows it on every chart in the app.
 */

export interface Reading {
  t: number;
  v: number;
}

/**
 * The same series with the horizontal runs made explicit: for every change, a
 * point carrying the PREVIOUS value at the new time, so the line holds flat
 * and then rises vertically.
 *
 * ⚠️ FOR THE LINE ONLY, NEVER FOR HOVER OR FOR STATISTICS. The points added
 * here are not readings — nothing was recorded at those instants — so a chart
 * must keep its real points for what it reports to the reader, or hovering a
 * flat run would name a measurement the villa never took.
 */
export function stepped(data: readonly Reading[]): Reading[] {
  if (data.length < 2) return data.slice();
  const out: Reading[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    const previous = data[i - 1];
    const next = data[i];
    // ⚠️ ONLY WHERE THE VALUE ACTUALLY CHANGES. A riser of zero height is a
    // duplicate point: harmless to look at, but it doubles the length of every
    // series on a chart that may hold thousands, for nothing.
    if (next.v !== previous.v) out.push({ t: next.t, v: previous.v });
    out.push(next);
  }
  return out;
}
