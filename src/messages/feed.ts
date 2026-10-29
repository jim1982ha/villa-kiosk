// src/messages/feed.ts
// A feed the add-on keeps for every page (supervisor-proxy.py Feed, review Q 4, 2026-10-28): a numbered list, read whole
// or after the page's last, the add-on holding a read open until the next one comes. ONE watch for every feed: the
// villa's announcements are its first kind (messages/announcements); the reports and VESTA's conversation (tickets
// 20-21 of "One inbox") bring only their address and how a record is read, so a tablet that slept recovers every
// list the same way.

import { ingressPath } from "@/ha/ingress";
import { backendFetch } from "@/auth/sessionLost";

/** One read: the records, the last number given, the first still kept (a page drops what it holds below it), and
 *  every number still kept (a page drops what it holds that is not: one erased); null from an add-on before 2.496.581.
 *  `said`: what else the add-on answered beside them (the conversation's: whether VESTA runs). */
export interface FeedRead<T> { items: T[]; last: number; first: number; kept: number[] | null; said: Record<string, unknown> }

/** What a page holds that the add-on still keeps, after a read said `first` (the first number it keeps) and `kept`
 *  (every number it keeps; null from an older add-on: nothing more dropped). ⚠️ ONE RULE FOR EVERY FEED (architecture
 *  review, 2026-10-30): the announcements' and the conversation's readers each wrote it. Pure. */
export function stillKept<T extends { seq: number }>(held: readonly T[], first: number, kept: readonly number[] | null): T[] {
  return held.filter((h) => h.seq >= first && (kept === null || kept.includes(h.seq)));
}

/** Pause before asking again when the add-on could not be reached. */
const RETRY_MS = 5_000;
/** A read the add-on holds open waits at most 25s (ANNOUNCEMENT_WAIT_S); one still open well after that is a
 *  connection a sleeping tablet left behind, given up so the next read can start. */
const READ_GIVE_UP_MS = 40_000;

/** One read of the feed at `path` (its records under `field`, each read by `parse`; one it cannot read left out); with
 *  `after`, only newer ones, the add-on waiting for one to come. null = not reached. */
export async function fetchFeed<T>(path: string, field: string, parse: (raw: unknown) => T | null,
  after: number | null, stop: AbortSignal): Promise<FeedRead<T> | null> {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  stop.addEventListener("abort", abort);
  const giveUp = setTimeout(abort, READ_GIVE_UP_MS);
  try {
    const r = await backendFetch(ingressPath(after === null ? path : `${path}?after=${after}`),
      { credentials: "same-origin", signal: ctl.signal });
    if (!r.ok) return null;
    const b = (await r.json()) as Record<string, unknown>;
    const raw = b[field];
    const items = Array.isArray(raw) ? raw.map(parse) : [];
    const last = typeof b.last === "number" ? b.last : 0;
    // an add-on before review Q round 2 does not say it: nothing is dropped
    const kept = Array.isArray(b.kept) && b.kept.every((n) => typeof n === "number") ? (b.kept as number[]) : null;
    return { items: items.filter((x): x is T => x !== null), last, first: typeof b.first === "number" ? b.first : 0, kept,
      said: b };
  } catch {
    return null;
  } finally {
    clearTimeout(giveUp);
    stop.removeEventListener("abort", abort);
  }
}

/** Reads the feed until `stop`, calling `onRead` with each read (and the read itself, for what else it said): `full` when it is everything the add-on keeps (the
 *  first read, after a pause, after the store started again), else what came after the last — what is NEW: what was
 *  kept before a full read never is (a page reloaded does not announce the last ring again, nor a tablet waking up what
 *  came while it slept). `first`: the first number the add-on still keeps — what the page holds below it was tidied
 *  away; `kept`: every number it keeps (null: not said). `read` is a fetchFeed (a check passes its own). */
export async function watchFeed<T>(
  read: (after: number | null, stop: AbortSignal) => Promise<FeedRead<T> | null>,
  onRead: (items: T[], full: boolean, first: number, kept: number[] | null, got: FeedRead<T>) => void,
  stop: AbortSignal,
  pause: (ms: number, stop: AbortSignal) => Promise<void>,
): Promise<void> {
  let last: number | null = null;
  while (!stop.aborted) {
    const got = await read(last, stop);
    if (stop.aborted) return;
    if (got === null) {
      // Not reached, or a read a sleeping tablet left open: what was kept meanwhile is not news now, and the next
      // read starts again from what is kept (a ring from an hour ago is never a notice).
      last = null;
      await pause(RETRY_MS, stop);
      continue;
    }
    if (last !== null && got.last < last) {
      // The add-on's store started again (a reinstall: its count went back): this read asked for what came after a
      // number it never reached, so it holds nothing; read it again whole, at once, as a new baseline.
      last = null;
      continue;
    }
    onRead(got.items, last === null, got.first, got.kept, got);
    last = got.last;
  }
}

/** Waits `ms`, or less when `stop` comes first. */
export function pauseFor(ms: number, stop: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      stop.removeEventListener("abort", done);
      resolve();
    }
    stop.addEventListener("abort", done);
  });
}
