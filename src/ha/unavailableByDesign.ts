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
//     access); found nothing (it has not reported within the history kept): "unknown" — "it reports, with no value to
//     give yet", never lost, never a guessed state.

import type { HassEntity } from "@/types/ha.types";
import { contactOf } from "@/utils/stateColors";
import type { StateRow } from "./historySource";
import { DAY_MS } from "@/utils/localDay";

/** One recorded state, as the history read returns it (minimal_response: a state and when it changed). */
export type RecordedState = StateRow;

/** How far back a fresh load looks for a sleeping device's last report: the villa system's default history (its
 *  recorder keeps 10 days unless told otherwise). Older than that, it is "unknown" until it next reports. */
export const RECALL_DAYS = 10;

/** Where that look starts, at `now` (epoch ms): a duration back, never a calendar edge. */
export function recallFrom(now: number): number {
  return now - RECALL_DAYS * DAY_MS;
}

/**
 * A device's recorded states as its charts draw them: asleep is no change. Each "unavailable" row holds the state
 * before it (dropped: the run goes on); one before any report is dropped too — the chart starts at its first report,
 * never on an outage that was only sleep. Rows of a device not asleep by design are the caller's to leave alone.
 */
export function heldRows<R extends { state: string | null }>(rows: readonly R[]): R[] {
  return rows.filter((r) => r.state !== "unavailable");
}

/** The last real report among `rows` (oldest first), or null — never "unavailable" or "unknown". */
export function lastReport(rows: readonly RecordedState[]): RecordedState | null {
  for (let i = rows.length - 1; i >= 0; i--) if (contactOf(rows[i].state) === "ok") return rows[i];
  return null;
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
    return this.last.get(id) ?? { ...e, state: "unknown" };
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
