// src/vesta/brief/recordTally.ts
//
// WHAT DID YOUR AUTOMATIONS DO — the wall tablet's half of a two-language
// answer whose other half is `adapters/record.tally_automations`.
//
// ⚠️ THE TWO HALVES DISAGREED, AND THE PIN WAS GREEN THROUGH IT. Python counts
// a firing once per INCIDENT — `if phase in ("", "opened")` — because a rule
// that opens and later times out is ONE thing that happened, reported twice.
// This side counted every row. So the same rows over the same window read
// "1 time · 1 ended by timeout" in the Brief and "2 times" on the wall tablet,
// under a header promising "not a similar query, the same one, over the same
// window".
//
// `test_record_wire` asserts `'held["times"] += 1' in record` and
// `"held.times += 1" in tab`. Both literals were present. The divergence was
// the GUARD above one of them, which a substring check cannot see — which is
// why the rule now lives somewhere a suite can execute.
//
// ⚠️ IMPORTS NOTHING AT RUNTIME (`RecordEntry` is a type-only import, erased),
// so `tests/consistency/villa_rules.ts` can run it.

import type { RecordEntry } from "./reportsApi.ts";

/** One row as rendered: an entry, or several firings of ONE automation. */
export interface TallyRow extends RecordEntry {
  times: number;
  /** Firings by the blueprint's own phase word, for the phases it sent. */
  phases: Record<string, number>;
}

/** The blueprint's phase vocabulary. ⚠️ MIRRORS `record.PHASES`; an absent
 *  phase means "not said", never zero. */
export const PHASES = ["opened", "cleared", "timeout"] as const;

/** ⚠️ A FIRING IS AN INCIDENT, NOT A ROW. An empty phase is a villa whose rules
 *  send none, which tallies plainly by count; `opened` is the start of one
 *  incident. `cleared` and `timeout` are the SAME incident ending, so counting
 *  them again would report every phase-sending rule at twice its rate. */
const opensAnIncident = (phase: string): boolean => phase === "" || phase === "opened";

const phaseOf = (row: RecordEntry): string =>
  String((row.payload as Record<string, unknown> | undefined)?.phase ?? "");

const num = (v: unknown): number => (Number(v) || 0);

/**
 * Group repeated firings of one automation into one row.
 *
 * ⚠️ THE OWNER'S REASON (2026-08-30): a motion-triggered light fires dozens of
 * times a day, so one line per firing turns this into a wall of identical rows
 * nobody reads. Grouped, it says WHICH automation, HOW OFTEN, and what it cost.
 *
 * ⚠️ ONLY `automation` ROWS GROUP. An alert and a flagged item are each about a
 * specific moment and a specific judgement; collapsing two investigations of
 * one pump into "×2" would hide that the agent concluded two different things.
 *
 * ⚠️ FIGURES ARE SUMMED, NEVER SAMPLED — and summed on EVERY firing, including
 * the phases that do not open an incident, because the energy a run used is
 * real whichever phase reported it.
 */
export function tallyAutomations(rows: readonly RecordEntry[]): TallyRow[] {
  const out: TallyRow[] = [];
  const seen = new Map<string, TallyRow>();
  for (const row of rows) {
    if (row.source !== "automation") {
      out.push({ ...row, times: 1, phases: {} });
      continue;
    }
    const key = row.subject || row.title;
    const phase = phaseOf(row);
    let held = seen.get(key);
    if (!held) {
      held = { ...row, times: 0, phases: {} };
      seen.set(key, held);
      out.push(held);
    } else {
      // Keep the NEWEST time: the list is newest-first, so the row already
      // carries it and later firings are older.
      held.payload = sumFigures(held, row);
    }
    if ((PHASES as readonly string[]).includes(phase)) {
      held.phases[phase] = (held.phases[phase] ?? 0) + 1;
    }
    if (opensAnIncident(phase)) held.times += 1;
  }
  return out;
}

/** Add one firing's figures into the row's running total. */
function sumFigures(held: TallyRow, next: RecordEntry): RecordEntry["payload"] {
  const a = held.payload as Record<string, unknown> | undefined;
  const b = next.payload as Record<string, unknown> | undefined;
  return {
    ...(a ?? {}),
    kwh: num(a?.kwh) + num(b?.kwh),
    cost_local: num(a?.cost_local) + num(b?.cost_local),
    wasted_minutes: num(a?.wasted_minutes) + num(b?.wasted_minutes),
  } as RecordEntry["payload"];
}

/** The summed figures as the sentence the row prints. */
export function figuresLine(row: TallyRow): string {
  const p = row.payload as Record<string, unknown> | undefined;
  const mins = num(p?.wasted_minutes);
  const kwh = num(p?.kwh);
  const cost = num(p?.cost_local);
  const bits: string[] = [];
  if (mins) bits.push(`${Math.round(mins)} min total`);
  if (kwh) bits.push(`${kwh.toFixed(1)} kWh total`);
  if (cost) bits.push(`about ${Math.round(cost)} total`);
  return bits.join(" · ");
}

/** How a row's phases read beside its count: "1 ended by timeout". */
export function phasesLine(row: TallyRow): string {
  const words: Record<string, string> = {
    cleared: "cleared", timeout: "ended by timeout",
  };
  return PHASES.filter((p) => p !== "opened" && row.phases[p])
    .map((p) => `${row.phases[p]} ${words[p] ?? p}`)
    .join(" · ");
}
