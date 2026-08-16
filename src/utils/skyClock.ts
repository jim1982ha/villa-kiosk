// src/utils/skyClock.ts
// A simulated clock for the SKY ONLY — sun position, moon position and phase,
// and everything that derives from them (sky colour, the twilight ramp, the
// night crossfade, shadow direction).
//
// Why this exists: the sun's bearing is only correct once the villa's north
// offset is set (AppConfig.northOffsetDeg), and there is no way to judge that
// setting at 18:00 — you need to see dawn in the east and dusk in the west,
// which otherwise means waiting twelve hours. It is equally the only way to
// check the moon without staying up.
//
// ── Deliberately URL-only, and deliberately not persisted ─────────────────
// Nothing here reads or writes localStorage. The simulation lasts exactly as
// long as the query string does, so REMOVING THE PARAMETER IS THE FULL REVERT —
// a kiosk that gets reloaded, or a phone opened from a bookmark, is on the real
// clock with no state to clear. That property is the whole design: a debug aid
// that can be left switched on by accident is a support call about a villa
// whose sun rose at the wrong time.
//
//   ?skyTime=06:30    freeze the sky at 06:30 local, today
//   ?skyTime=2026-12-21T06:30   …or a specific date, for a solstice
//   ?skySpeed=600     run the sky at 600x real time from now (or from skyTime)
//
// Both may be combined: `?skyTime=06:00&skySpeed=900` starts at dawn and walks
// a whole day past the villa in about a minute and a half.

/** Parsed once. The query string cannot change without a reload. */
interface SkySim {
  /** Simulated wall-clock at the moment the page loaded. */
  origin: number;
  /** Multiplier on elapsed real time. 1 = frozen offset, >1 = fast-forward. */
  speed: number;
  /** Real `Date.now()` when the page loaded, so elapsed time is measurable. */
  startedAt: number;
}

function parse(): SkySim | null {
  if (typeof window === "undefined") return null;
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }
  const timeRaw = q.get("skyTime");
  const speedRaw = q.get("skySpeed");
  if (!timeRaw && !speedRaw) return null;

  const startedAt = Date.now();
  let origin = startedAt;

  if (timeRaw) {
    // "HH:MM" means today at that LOCAL time; anything else is handed to Date,
    // which accepts a full ISO stamp. Local, not UTC, because the whole point
    // is to reason about what the villa looks like at a stated hour.
    const hm = /^(\d{1,2}):(\d{2})$/.exec(timeRaw.trim());
    if (hm) {
      const d = new Date();
      d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
      origin = d.getTime();
    } else {
      const parsed = new Date(timeRaw).getTime();
      if (Number.isFinite(parsed)) origin = parsed;
    }
  }

  // 0 or a negative speed would run the sky backwards or stop the fast-forward
  // silently; clamp to "frozen offset" instead, which is what skyTime alone
  // already means and is the least surprising reading of a typo.
  const speed = speedRaw ? Math.max(1, Number(speedRaw) || 1) : 1;
  return { origin, speed, startedAt };
}

const sim = parse();

/** True when the sky is running on a simulated clock. */
export function skySimActive(): boolean {
  return sim !== null;
}

/**
 * The clock the SKY should use — the real one unless a simulation is asked for.
 *
 * Every caller that positions a celestial body goes through this, so the sun
 * and the moon can never end up on two different clocks (they are computed by
 * separate calls and would otherwise each need remembering).
 */
export function skyNow(): Date {
  if (!sim) return new Date();
  const elapsed = Date.now() - sim.startedAt;
  return new Date(sim.origin + elapsed * sim.speed);
}

/**
 * How often a simulated sky needs recomputing, in ms — or 0 when it does not.
 *
 * At speed 1 (a frozen `skyTime`) nothing moves, so nothing is scheduled. Above
 * that, aim for roughly one simulated minute per update: fast enough that the
 * sun glides rather than steps, cheap enough that it is a handful of trig calls
 * a second and never a render loop of its own — the scene renders on demand and
 * the tick asks for a frame like any other change does.
 */
export function skyTickMs(): number {
  if (!sim || sim.speed <= 1) return 0;
  return Math.max(100, Math.round(60_000 / sim.speed));
}

/** One-line description for the `?debug` panel, so a simulated sky is never
 *  mistaken for a broken one. */
export function skySimLabel(): string {
  if (!sim) return "";
  const t = new Date(sim.origin).toLocaleTimeString();
  return sim.speed > 1 ? `sky sim from ${t} at ${sim.speed}x` : `sky frozen at ${t}`;
}
