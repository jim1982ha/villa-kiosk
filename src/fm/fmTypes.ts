// src/fm/fmTypes.ts
// The Facility Manager working set: maintenance schedules, their completions,
// cost entries and fault tickets.
//
// Modelled directly against the Kozystay Property Management Agreement, because
// the whole point of this feature is producing evidence a contract dispute
// would accept:
//   * Clause 3.7 fixes a preventive-maintenance schedule (AC every 3 months,
//     pest control twice a month, hydrowash every 3/12 months, pool and
//     landscaping twice a week). DEFAULT_SCHEDULES below is that clause.
//   * Clause 3.3(i) caps "Minor Maintenance" at IDR 3,000,000 per month per
//     property; above that it is Major and the Owner bears it (Clause 6.2(iii)).
//   * Clause 1.1(iv)(b) obliges "maintenance inspections and supervision" —
//     which a ticket's time-to-resolution is what actually evidences.
//   * Appendix C §7(b) makes property condition "materially below the agreed
//     standard" grounds for termination, so a completion record without a date,
//     a person and a photo is worth very little.
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
  /** Seeded from DEFAULT_SCHEDULES — kept so the UI can explain where a task
   *  came from, and so a re-seed doesn't duplicate it. */
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

export interface FmData {
  schedules: FmSchedule[];
  completions: FmCompletion[];
  costs: FmCost[];
  tickets: FmTicket[];
}

export const EMPTY_FM_DATA: FmData = {
  schedules: [], completions: [], costs: [], tickets: [],
};

/** Clause 3.3(i): "Minor Maintenance is the maintenance or repair expense with
 *  a total sum of less than IDR 3,000,000.00 per month per property". */
export const MINOR_MAINTENANCE_CAP_IDR = 3_000_000;

/**
 * Clause 3.7's schedule, verbatim in intent.
 *
 * Intervals are the contractual MINIMUM frequency expressed in days:
 *   "at least once every 3 months"  -> 90
 *   "at least twice every month"    -> 15
 *   "at least once every 12 months" -> 365
 *   "at least twice a week"         -> 3   (rounded down from 3.5 — rounding UP
 *                                           would let a genuinely late task read
 *                                           as compliant, which is the one error
 *                                           this must never make)
 */
export const DEFAULT_SCHEDULES: ReadonlyArray<Omit<FmSchedule, "id">> = [
  {
    builtinKey: "ac_service", title: "Air conditioning service",
    clause: "3.7(i)", everyDays: 90, enabled: true,
  },
  {
    builtinKey: "pest_control", title: "Pest control (ants, mosquitoes, cockroaches)",
    clause: "3.7(ii)", everyDays: 15, enabled: true,
  },
  {
    builtinKey: "hydrowash_soft", title: "Hydrowash — sofa, chairs, carpets",
    clause: "3.7(iii)", everyDays: 90, enabled: true,
  },
  {
    builtinKey: "hydrowash_mattress", title: "Hydrowash — mattresses",
    clause: "3.7(iii)", everyDays: 365, enabled: true,
  },
  {
    builtinKey: "pool_landscaping", title: "Pool and landscaping",
    clause: "3.7(iv)", everyDays: 3, enabled: true,
  },
];
