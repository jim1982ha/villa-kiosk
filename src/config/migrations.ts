// src/config/migrations.ts
// Every shape an older version of this app stored a config in, read into today's, ONCE, in one table (architecture
// review round 17). A row: its `name`, the keys it `retires` (dropped once read, never written again), and `read`,
// which takes a stored config and returns it in today's shape (as it is when it already is: every row runs on every
// config entering memory, AppConfig normaliseConfig). Before, the full-screen reading was called by hand on two read
// paths, the retired keys dropped in two places and a save filtered them a third time.
//
// The villa's copy (device-config.json) is the add-on server's to migrate: it reads it in today's shape and writes it
// back once (supervisor-proxy.py _device_config_today, the same examples: villa-settings.json `examples`). This table
// is for a config this tablet holds itself (its localStorage) and anything put into memory.

import { FULL_SCREEN_SECONDS } from "./villaSettings";

/** One announcement that takes the whole screen (AppConfig.fullScreen): its title, as the villa writes it, and how long
 *  it holds the screen, in seconds. */
export interface FullScreenAnnouncement { title: string; seconds: number }

/** A full-screen time the villa may hold: whole seconds from 1 to 600 (villa-settings.json `fullScreenSeconds`). The one
 *  rule, for the field and for what is stored. */
export const fullScreenSecondsOk = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= FULL_SCREEN_SECONDS.min && (v as number) <= FULL_SCREEN_SECONDS.max;

/** A stored "full-screen announcements" list: each item with a title and an accepted time, each title once; anything
 *  else left out. undefined when it is not a list. Pure: tests/oracles/messages_settings.mjs. */
export function parseFullScreen(raw: unknown): FullScreenAnnouncement[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  return raw.flatMap((f): FullScreenAnnouncement[] => {
    const r = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
    if (typeof r.title !== "string" || !r.title || seen.has(r.title) || !fullScreenSecondsOk(r.seconds)) return [];
    seen.add(r.title);
    return [{ title: r.title, seconds: r.seconds }];
  });
}

/**
 * ⚠️ A CONFIG STORED BEFORE 2.496.670 (formats outlive their writer): the picked titles (`fullScreenFor`) and one time
 * for all (`ringShownForS`). Read as each title with that time, or the default when it was not a time the field
 * accepted, so nothing the owner set is lost; undefined when it holds no such list.
 */
export function fullScreenFromRetired(stored: Record<string, unknown>): FullScreenAnnouncement[] | undefined {
  if (!Array.isArray(stored.fullScreenFor)) return undefined;
  const seconds = fullScreenSecondsOk(stored.ringShownForS) ? stored.ringShownForS : FULL_SCREEN_SECONDS.default;
  return parseFullScreen(stored.fullScreenFor.map((title) => ({ title, seconds })));
}

interface Migration {
  name: string;
  /** The keys it reads from and that are dropped after it. */
  retires: readonly string[];
  /** A stored config in today's shape (returned as it is when nothing applies). */
  read(stored: Record<string, unknown>): Record<string, unknown>;
}

/** Every migration, in the order they run. */
export const MIGRATIONS: readonly Migration[] = [
  {
    // per-sensor min/max limits no screen ever set (removed 2.496.450): nothing to read
    name: "alert thresholds removed",
    retires: ["alertThresholds"],
    read: (stored) => stored,
  },
  {
    // each full-screen announcement its own time (2.496.670): today's list as the field takes it, else the old keys'
    name: "full-screen announcements, each its own time",
    retires: ["fullScreenFor", "ringShownForS"],
    read: (stored) => {
      const fullScreen = parseFullScreen(stored.fullScreen) ?? fullScreenFromRetired(stored);
      // as it is when already so: the same list, not a copy, on every config entering memory
      if (fullScreen === undefined || JSON.stringify(fullScreen) === JSON.stringify(stored.fullScreen)) return stored;
      return { ...stored, fullScreen };
    },
  },
];

/** Keys an older version stored and nothing reads any more: each migration's. */
export const RETIRED_KEYS: readonly string[] = MIGRATIONS.flatMap((m) => m.retires);

/** A stored config in today's shape: every migration read, then its retired keys dropped. Pure. */
export function migrate<T extends Record<string, unknown>>(stored: T): T {
  let out: Record<string, unknown> = stored;
  for (const m of MIGRATIONS) {
    out = m.read(out);
    if (m.retires.some((k) => k in out)) {
      out = { ...out };
      for (const k of m.retires) delete out[k];
    }
  }
  return out as T;
}
