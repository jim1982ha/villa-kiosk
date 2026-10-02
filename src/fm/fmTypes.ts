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

// ⚠️ THE VOCABULARY IS ONE TABLE, SHARED WITH THE ADD-ON (2.496.245): a fault's
// statuses, a cost's categories and the record's collections live in
// rootfs/usr/share/vesta/fm-records.json, which supervisor-proxy.py reads to
// judge every write (_fm_record_errors). They were two literal copies, one per
// side. The literal union TYPES stay below — the compiler needs words — and
// tests/oracles/fm_records.mjs fails when they and the table part.
import FM_RECORDS from "../../rootfs/usr/share/vesta/fm-records.json" with { type: "json" };

/** Who last created or changed a record, when it was not a person
 *  (docs/agent-integration/PLAN.md F6). Set by the ADD-ON, never by this app:
 *  every record the VESTA Agent writes is stamped server-side, so the mark
 *  cannot be forgotten by the writer. Absent on a person's record. */
export interface FmProvenance {
  source?: "vesta_agent";
  /** ISO time of the agent's last change to this record. */
  updatedAt?: string;
}

/** A recurring obligation. `everyDays` is the contractual interval. */
export interface FmSchedule extends FmProvenance {
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
export interface FmCompletion extends FmProvenance {
  id: string;
  /** The scheduled task this completes. Empty for work that answers a FAULT
   *  rather than a schedule — see ticketId. */
  scheduleId: string;
  /** The fault this work resolved, when the completion was logged from a
   *  ticket. Without it a fault and the work that fixed it are two unrelated
   *  records, and no report can say "this fault, fixed on this date, at this
   *  cost" — which is the sentence the evidence exists to support. */
  ticketId?: string;
  /** ISO timestamp of when the work was done (not when it was logged). */
  at: string;
  by: string;
  note?: string;
  photoIds: string[];
  /** Set when logging the completion also recorded what it cost. */
  costId?: string;
}

/** A maintenance expense. "minor" counts against the monthly cap and is a
 *  shared direct expense; "major" is the Owner's and is excluded from the
 *  cap — whatever the underlying contract calls that split. */
export interface FmCost extends FmProvenance {
  id: string;
  at: string;
  /** The amount, in the install's own currency (FmTerms.currency, Home Assistant's own).
   *  ⚠️ THE NAME IS A STORED FIELD, NOT A CLAIM ABOUT THE CURRENCY: every
   *  install's Facility records carry `amountIdr`, so renaming it needs a
   *  migration of that data (the code-only names — the cap, the month's minor
   *  and major spend — lost their "Idr" in 2.496.163). */
  amountIdr: number;
  label: string;
  category: FmCostCategory;
  /** Free note — what the spend was actually for, beyond its one-line label.
   *  The same field faults have, for the same reason: the person reading this
   *  in six months is not the person who typed it. */
  note?: string;
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
/** Every status, in the table's order (fm-records.json). */
export const FM_TICKET_STATUSES = FM_RECORDS.ticketStatuses as readonly FmTicketStatus[];

/** A cost's category — see FmCost. */
export type FmCostCategory = "minor" | "major";
/** Every category, in the table's order (fm-records.json). */
export const FM_COST_CATEGORIES = FM_RECORDS.costCategories as readonly FmCostCategory[];

/** One recorded step in a fault's life — raised, picked up, resolved.
 *
 *  A status used to be a bare word with a timestamp: the record could say a
 *  fault moved to "in progress" but not who picked it up or what they found,
 *  and mean-time-to-resolution rested on exactly that. An update is the proof
 *  behind the transition, captured at the moment it happens rather than
 *  reconstructed afterwards. Everything but the timestamp and the status is
 *  optional — a dialog that BLOCKS progress until it is filled in gets
 *  satisfied with junk, or the fault is simply left where it is. */
export interface FmTicketUpdate {
  at: string;
  /** The status this update moved the fault TO. */
  status: FmTicketStatus;
  by?: string;
  note?: string;
  photoIds: string[];
}

/** A fault raised against a device or room. */
export interface FmTicket extends FmProvenance {
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
  /** Every status change, in order. Optional because faults raised before
   *  this existed have none — read it as "no steps recorded", never as an
   *  error. */
  updates?: FmTicketUpdate[];
  /** Set when a GUEST raised this rather than the owner or facility manager.
   *  Kept because it changes how the row should be read: a guest reports a
   *  symptom from inside the villa ("the aircon in bedroom 2 is noisy"), not
   *  a diagnosis, and whoever triages it should know that before acting. */
  reportedBy?: "guest";
}

/** A generated markdown document the operator chose to keep — the monthly
 *  owner-report annex (ReportTab), a spend statement (SpendTab), or a
 *  point-in-time readiness snapshot (ReadinessTab). Kept
 *  verbatim as generated (not recomputed live) so a saved document stays a
 *  point-in-time record even if the underlying schedules/costs/tickets
 *  change afterwards — the same reasoning ReportTab's own "Generate" button
 *  (an explicit action, not a live re-render) already follows. */
export interface FmSavedDocument extends FmProvenance {
  id: string;
  kind: "report" | "spend" | "readiness";
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

/** One of the record's collections — each a list of records with an `id`. */
export type FmCollection = keyof FmData;
/** Every collection, in the table's order (fm-records.json) — the add-on's
 *  FM_RECORD_COLLECTIONS is held to the same table by tests/proxy-rules.py. */
export const FM_COLLECTIONS = FM_RECORDS.collections as readonly FmCollection[];

export const EMPTY_FM_DATA: FmData = {
  schedules: [], completions: [], costs: [], tickets: [], savedDocuments: [],
};

/** The maintenance contract's money rules, as the OWNER sets them — stored
 *  in the shared config (`fmContract`, so every device reads the same terms)
 *  and edited on the Spend tab. Before 2.496.225 these were code: a cap of 0
 *  and a currency of "" that nothing could set, the words "Minor"/"Major" and
 *  "Owner's account" typed in the report and three screens, and the 80 %
 *  warning inline in the engine — one contract's shape in a redistributable
 *  add-on (CLAUDE.md, the hard rule).
 *
 *  Stored EMPTY by default ("" and 0) and resolved by fmTerms(): an empty
 *  name reads as the generic word, a cap of 0 as "no cap", so a fresh install
 *  shows no invented number. The stored category ids stay "minor"/"major"
 *  (FmCost.category) — only their NAMES are the owner's. */
export interface FmContract {
  /** The monthly cap on the capped category, in the install's currency. 0 = no cap. */
  monthlyCap: number;
  /** What the capped category is called ("" → "Minor"). */
  cappedName: string;
  /** What the uncapped category is called ("" → "Major"). */
  uncappedName: string;
  /** Warn when the month reaches this share of the cap, in percent (0 → 80). */
  warnAtPercent: number;
}

export const EMPTY_FM_CONTRACT: FmContract = { monthlyCap: 0, cappedName: "", uncappedName: "", warnAtPercent: 0 };

/** The contract as every Facility screen, the engine and the report read it:
 *  names and threshold resolved, plus the currency Home Assistant is set to
 *  (Settings → System → General) — the app keeps no currency of its own. */
export interface FmTerms {
  monthlyCap: number;
  currency: string;
  cappedName: string;
  uncappedName: string;
  /** 0–1. */
  warnAt: number;
}

const WARN_DEFAULT_PERCENT = 80;

/** Resolve stored terms (any shape an older or hand-edited store may hold). */
export function fmTerms(contract: Partial<FmContract> | undefined, haCurrency: string | undefined): FmTerms {
  const c = contract ?? {};
  const cap = Number(c.monthlyCap);
  const pct = Number(c.warnAtPercent);
  const name = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  return {
    monthlyCap: Number.isFinite(cap) && cap > 0 ? cap : 0,
    currency: typeof haCurrency === "string" ? haCurrency.trim() : "",
    cappedName: name(c.cappedName, "Minor"),
    uncappedName: name(c.uncappedName, "Major"),
    warnAt: (Number.isFinite(pct) && pct >= 1 && pct <= 99 ? pct : WARN_DEFAULT_PERCENT) / 100,
  };
}

/** Terms with nothing configured — what a caller that has none passes. */
export const NO_FM_TERMS: FmTerms = fmTerms(undefined, undefined);

/** The owner's name for a cost category. */
export function categoryName(terms: FmTerms, category: "minor" | "major"): string {
  return category === "minor" ? terms.cappedName : terms.uncappedName;
}
