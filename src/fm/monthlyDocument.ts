// src/fm/monthlyDocument.ts
// The Cockpit's three generated documents — the month's operations recap, the
// month's spend statement, the readiness snapshot — as ONE thing with three
// kinds: what each is called, the file it downloads as, and the months it can
// be made for. Pure; useMonthlyDocument holds the make / save / reopen /
// download state, and RecapTab, SpendTab and ReadinessTab only draw it.
//
// ⚠️ EACH TAB HAD ITS OWN COPY OF "MAKE, SAVE, REOPEN, DOWNLOAD" (until
// 2.496.403), and the shared saved list knew two kinds: readiness snapshots
// were listed as "Saved statements", could not be downloaded, and their
// "Saved" went back to "Save snapshot" after 2.5 s where the other two stayed
// (architecture review, round two, 2026-10-17).

import { momentText } from "@/utils/dateText";
import { monthKey, monthLabel } from "./fmEngine";
import { localMonthStart } from "@/utils/localDay";
import type { FmData, FmSavedDocument, FmTerms } from "./fmTypes";
import type { ReadinessResult } from "./readiness";
import { buildMonthlyRecap, buildReadinessSnapshot, buildSpendStatement } from "./fmDocuments";

export type DocumentKind = FmSavedDocument["kind"];

/**
 * Everything a document is made from — built ONCE, by the Cockpit's Facility tabs (FacilitySections), and handed to
 * each kind's `build`.
 *
 * ⚠️ EACH TAB GATHERED ITS OWN (architecture review, 2026-10-19): the recap, the statement and the snapshot each read
 * the record, the terms, the device identity and the villa's name themselves, and the recap was handed device counts
 * beside the readiness that already held them.
 */
export interface DocumentInputs {
  fm: FmData;
  /** The owner's contract terms (cap, currency, category names). */
  terms: FmTerms;
  /** The live readiness, for the profile looking (fm/readiness — the Recap tab's own). */
  readiness: ReadinessResult;
  villaName: string;
  /** The moment of the document; absent: the clock when it is made (a document is of the moment someone asked). */
  now?: number;
  /** The device a record's entity field names (VillaModel.useDeviceIdentity) — open work counted per device card. */
  deviceOfRecord: (field: string) => string;
}

export interface DocumentKindInfo {
  /** What one is called on screen: "snapshot". */
  noun: string;
  /** And several: "snapshots" ("Saved snapshots (3)"). */
  plural: string;
  /** The word in its file name: villa-readiness-2026-10.md. */
  fileWord: string;
  /** What it is ABOUT: a month (the recap, the statement), or the moment it was taken (the snapshot). */
  about: "month" | "moment";
  /** Its title in the saved list: its month — or, for a moment, the moment it was saved, in the documents' fixed form
   *  (fmEngine.momentText, the "Generated:" stamp). ⚠️ THREE SNAPSHOTS THIS MONTH WERE ALL "October 2026" (architecture
   *  review, 2026-10-19): every kind was titled by its month. */
  title: (doc: Pick<FmSavedDocument, "month" | "generatedAt">) => string;
  /** The document, from the inputs, for `month`. */
  build: (inputs: DocumentInputs, month: string) => string;
}

const byMonth = (doc: Pick<FmSavedDocument, "month">) => monthLabel(doc.month);

export const DOCUMENT_KINDS: Record<DocumentKind, DocumentKindInfo> = {
  recap: {
    noun: "recap", plural: "recaps", fileWord: "operations", about: "month", title: byMonth,
    build: (i, month) => buildMonthlyRecap({ ...i, month }),
  },
  spend: {
    noun: "statement", plural: "statements", fileWord: "spend", about: "month", title: byMonth,
    build: (i, month) => buildSpendStatement(i.fm, month, i.villaName, i.terms),
  },
  readiness: {
    noun: "snapshot", plural: "snapshots", fileWord: "readiness", about: "moment",
    title: (doc) => momentText(doc.generatedAt),
    build: (i, month) => buildReadinessSnapshot(i.readiness, i.villaName, month),
  },
};

/** The file a document downloads as: the villa's name, what it is, its month. */
export function documentFileName(kind: DocumentKind, villaName: string, month: string): string {
  return `${villaName.replace(/\s+/g, "-").toLowerCase()}-${DOCUMENT_KINDS[kind].fileWord}-${month}.md`;
}

/** The month a document starts on: a recap is written about a month that has
 *  finished (due by the 10th of the one after it); a statement and a snapshot
 *  are of the month running now. */
export function defaultMonth(kind: DocumentKind, now: number = Date.now()): string {
  // the month before this one, on the villa's calendar (utils/localDay — the one month arithmetic, never by hand)
  return monthKey(kind === "recap" ? localMonthStart(now, -1) : now);
}

/** The months a document can be made for, newest first: the months that have
 *  something in them, plus the default and the current one so they are always
 *  there. A snapshot is of now only. */
export function monthsOffered(kind: DocumentKind, data: FmData, now: number = Date.now()): string[] {
  const at = (xs: { at: string }[]) => xs.map((x) => monthKey(x.at));
  const months = kind === "recap" ? [defaultMonth(kind, now), monthKey(now), ...at(data.completions), ...at(data.costs)]
    : kind === "spend" ? [monthKey(now), ...at(data.costs)]
    : [monthKey(now)];
  return [...new Set(months)].sort().reverse();
}
