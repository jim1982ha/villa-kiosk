// src/ha/unavailableByDesign.ts
// The devices whose "unavailable" is their design (AppConfig.unavailableByDesign): what the app sees of them.
//
// ⚠️ ONE PLACE, AT THE SOURCE (owner, 2026-10-21: "a single place every consumer reads"). A battery sensor that
// sleeps between reports — a Wi-Fi door contact drops off three minutes after each report, until the door moves again
// — is not lost: its last report still holds. Every screen reads a device through the entity store, and every one of
// them asks "is contact lost" of the state it is given (utils/stateColors.contactOf): the live "Unavailable" card, the
// offline counts, the top bar's and the Recap's badges, the critical devices, the map's amber look, a panel's
// "Unavailable" notice. Twenty such readers. So the store hands them the device as it last reported, and none of them
// needs to know the list: the lens below is applied where the villa's states come in (ha/entityStore), once.
//
// What it shows, and why it is honest:
//   * its last real report, as it was — its state, and its own last_changed, so "since …" says when it last reported;
//   * on a fresh load, while the villa's system still says "unavailable", that report is read from the villa's
//     history (the store's `recall`, through the same history/period read a panel's chart already makes — no new
//     access), as far back as the villa keeps (historySource.readBackFrom: the same depth its chart reads to); found
//     nothing (it has not reported within the history kept): "unknown" — "it reports, with no value to give yet",
//     never lost, never a guessed state.

import type { HassEntity } from "@/types/ha.types";
import { contactOf } from "@/utils/stateColors";
import type { StateRow } from "./historySource";

/** One recorded state, as the history read returns it (minimal_response: a state and when it changed). */
export type RecordedState = StateRow;

/**
 * A device's recorded states as its charts draw them: asleep is no change. Each "unavailable" row holds the state
 * before it (dropped: the run goes on); one before any report is dropped too — the chart starts at its first report,
 * never on an outage that was only sleep. Rows of a device not asleep by design are the caller's to leave alone.
 */
export function heldRows<R extends { state: string | null }>(rows: readonly R[]): R[] {
  return rows.filter((r) => r.state !== "unavailable");
}

/**
 * A window of a device asleep by design (`rows`, led by the state it was in at `from`), as its charts draw it: its
 * sleep is no change (heldRows), and a window that OPENS asleep opens on the report it holds — the last one in
 * `before`, the rows leading up to `from` — never on bare track.
 *
 * ⚠️ OPENING ASLEEP DREW THE WRONG DAY (owner, 2026-10-22: a lock's door contact, asleep since its last report the
 * day before, read "Unknown" across its band): the leading "unavailable" row was dropped with the rest, the window held
 * nothing, and the chart moved it back to end at the last report, so the door's band covered another day than the
 * lock's band above it.
 */
export function heldWindow<R extends RecordedState>(rows: readonly R[], before: readonly R[], from: number): R[] {
  const held = heldRows(rows);
  if (!opensAsleep(rows)) return held;
  const last = lastReport(before);
  return last ? [{ ...(last as R), last_changed: new Date(from).toISOString() }, ...held] : held;
}

/** Does a window (led by the state at its start) open asleep — so its held report lies before it? */
export function opensAsleep(rows: readonly RecordedState[]): boolean {
  return rows.length === 0 || rows[0].state === "unavailable";
}

/** The last real report among `rows` (oldest first), or null — never "unavailable" or "unknown". */
export function lastReport(rows: readonly RecordedState[]): RecordedState | null {
  for (let i = rows.length - 1; i >= 0; i--) if (contactOf(rows[i].state) === "ok") return rows[i];
  return null;
}

/**
 * The states this lens handed out IN PLACE of the villa's "unavailable" — a sleeping device shown with its last report
 * (or "unknown" before one is known). Marked on the very object every reader is given (the store and the map's live
 * cache hold the same one), so a badge can say "asleep by design" with its grey "z" without any reader learning the
 * list (owner, 2026-10-22: badge proposal 2). A WeakSet: nothing is added to the state a person reads.
 */
const asleep = new WeakSet<HassEntity>();

/** Is `e` a sleeping device shown with its last report (or "unknown") — not the villa's own live state? */
export function shownAsleep(e: HassEntity | undefined): boolean {
  return !!e && asleep.has(e);
}

function asleepCopy(e: HassEntity): HassEntity {
  const copy = { ...e };
  asleep.add(copy);
  return copy;
}

/**
 * The lens: what the app is given for each state the villa's system sends. Holds, for the listed devices only, the
 * villa's own latest state (`raw`, given back whole when a device leaves the list) and its last real report (`last`).
 */
export class UnavailableByDesign {
  private ids: ReadonlySet<string> = new Set();
  private readonly raw = new Map<string, HassEntity>();
  private readonly last = new Map<string, HassEntity>();

  has(id: string): boolean { return this.ids.has(id); }

  /** What the app shows for `e`, the villa's own state. */
  see(e: HassEntity): HassEntity {
    const id = e.entity_id;
    if (!this.ids.has(id)) return e;
    this.raw.set(id, e);
    if (contactOf(e.state) === "ok") {
      this.last.set(id, e);
      return e;
    }
    if (e.state !== "unavailable") return e;              // "unknown" is the villa's own word: not ours to change
    const last = this.last.get(id);
    return asleepCopy(last ?? { ...e, state: "unknown" });
  }

  /** A listed device the app has no real report of while its system says "unavailable": its history is worth a read. */
  needsRecall(id: string): boolean {
    return this.ids.has(id) && !this.last.has(id) && this.raw.get(id)?.state === "unavailable";
  }

  /** Its last report, read from history: kept unless a live one came in meanwhile. Returns what the app shows now. */
  recall(id: string, row: RecordedState): HassEntity | null {
    const now = this.raw.get(id);
    if (!now || !this.ids.has(id) || this.last.has(id)) return null;
    if (contactOf(row.state) !== "ok") return null;                     // a report, never an outage
    this.last.set(id, { ...now, state: row.state as string, last_changed: row.last_changed, last_updated: row.last_changed });
    return this.see(now);
  }

  /**
   * A new list. Returns, for every device that joined or left it, what the app shows now — `current` is what the app
   * shows today (the villa's own state for a device not listed yet).
   */
  setIds(next: ReadonlySet<string>, current: Readonly<Record<string, HassEntity>>): HassEntity[] {
    const out: HassEntity[] = [];
    for (const id of this.ids) {
      if (next.has(id)) continue;
      const own = this.raw.get(id) ?? current[id];
      this.raw.delete(id);
      this.last.delete(id);
      if (own) out.push(own);
    }
    const joined = [...next].filter((id) => !this.ids.has(id));
    this.ids = new Set(next);
    for (const id of joined) if (current[id]) out.push(this.see(current[id]));
    return out;
  }
}
