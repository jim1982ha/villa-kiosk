// src/fm/fmTypes.ts
// The Facility Manager working set: maintenance schedules, their completions,
// cost entries and fault tickets — evidence a property-management contract
// dispute would accept: a preventive-maintenance schedule with a completion
// history, spend tracked against a monthly cap, and fault tickets with a
// time-to-resolution.
//
// Deliberately carries NO contract's own numbers: an earlier version of this
// module was modelled directly against one specific property-management
// agreement (its clause numbers, its maintenance intervals, its IDR cap) and
// shipped those as the default schedule/cap for every install — meaning a
// different villa, under a different contract, silently inherited terms that
// were never theirs. Every schedule, clause reference and cap here is now
// entirely operator-entered (Schedule tab / Spend tab), the same "no
// per-site value ships in the app" rule the rest of the config follows.
//
// Everything is stored in ONE document (see fmApi) rather than several: every
// write comes from one operator on one device, and an atomic whole-document
// replace is far easier to reason about than four stores that can disagree
// mid-edit.

/** A recurring obligation. `everyDays` is the contractual interval. */
export interface FmSchedule {
  id: string;
  title: string;
  /** Free-text clause reference, shown in the UI and the report annex. */
  clause?: string;
  everyDays: number;
  /** Optional binding so the task can highlight a room on the 3D map. */
  room?: string;
  /** Optional binding to a specific device. */
  entityId?: string;
  enabled: boolean;
  /** Set when this task was added from a named template rather than typed
   *  from scratch — kept so the UI can explain where it came from and a
   *  re-apply of the same template doesn't duplicate it. No templates ship
   *  with the app itself (see the removed DEFAULT_SCHEDULES — one specific
   *  property's contract clauses have no universal default for any other
   *  villa); this field exists for whatever an operator or a future
   *  per-install template feature sets. */
  builtinKey?: string;
  /** ISO timestamp of when the task was created. The fallback baseline for its
   *  first target date (see fmEngine.scheduleStatus): a task that has never
   *  been completed still needs a "due by" date to show, and the only honest
   *  anchor for that before anyone has done the work once is when the
   *  obligation itself started existing. Optional only because schedules
   *  created before this field existed don't have one — scheduleStatus falls
   *  back to "now" for those, which reads as "due in `everyDays`" rather than
   *  a wrong date. */
  createdAt?: string;
}

/** One performance of a scheduled task. */
export interface FmCompletion {
  id: string;
  scheduleId: string;
  /** ISO timestamp of when the work was done (not when it was logged). */
  at: string;
  by: string;
  note?: string;
  photoIds: string[];
  /** Set when logging the completion also recorded what it cost. */
  costId?: string;
}

/** A maintenance expense. `category` follows Clause 3.3(i)/6.2(iii): "minor"
 *  counts against the monthly cap and is a shared Direct Expense; "major"
 *  is the Owner's and is excluded from the cap. */
export interface FmCost {
  id: string;
  at: string;
  amountIdr: number;
  label: string;
  category: "minor" | "major";
  room?: string;
  entityId?: string;
  /** The device this spend is against, as text — the entity's display name at
   *  the time of entry when `entityId` resolved to a known device, or
   *  whatever the operator typed when it didn't (a spare part, a device not
   *  yet in Home Assistant). Denormalized on purpose: a device renamed or
   *  removed later must not turn this record's device column blank. */
  deviceLabel?: string;
  photoIds: string[];
}

export type FmTicketStatus = "open" | "in_progress" | "resolved";

/** A fault raised against a device or room. */
export interface FmTicket {
  id: string;
  title: string;
  status: FmTicketStatus;
  openedAt: string;
  resolvedAt?: string;
  entityId?: string;
  /** See FmCost.deviceLabel — same reasoning, same denormalization. */
  deviceLabel?: string;
  room?: string;
  note?: string;
  photoIds: string[];
  costId?: string;
}

/** A generated markdown document the operator chose to keep — the monthly
 *  owner-report annex (ReportTab) or a spend statement (SpendTab). Kept
 *  verbatim as generated (not recomputed live) so a saved document stays a
 *  point-in-time record even if the underlying schedules/costs/tickets
 *  change afterwards — the same reasoning ReportTab's own "Generate" button
 *  (an explicit action, not a live re-render) already follows. */
export interface FmSavedDocument {
  id: string;
  kind: "report" | "spend";
  /** The period the document is ABOUT ("2026-06"), not when it was saved. */
  month: string;
  markdown: string;
  generatedAt: string;
}

export interface FmData {
  schedules: FmSchedule[];
  completions: FmCompletion[];
  costs: FmCost[];
  tickets: FmTicket[];
  savedDocuments: FmSavedDocument[];
}

export const EMPTY_FM_DATA: FmData = {
  schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [],
};

/** The monthly Minor Maintenance spend cap, in IDR — 0 means "not configured".
 *  Was a hardcoded IDR 3,000,000 (one specific contract's clause), which
 *  applied that villa's real cap to every install with no way to turn it
 *  off. budgetStatus() below treats <= 0 as "not tracked" rather than an
 *  ever-exceeded cap, so a fresh install with nothing configured shows no
 *  false "over cap" warning instead of a wrong number. No in-app editor yet
 *  (same status as ThresholdConfig's alertThresholds) — SpendTab/TodayTab
 *  read this constant directly today; wiring it to real per-install config
 *  is a follow-up, not a hardcoding fix. */
export const MINOR_MAINTENANCE_CAP_IDR = 0;
