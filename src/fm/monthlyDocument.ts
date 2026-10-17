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

import { monthKey } from "./fmEngine";
import type { FmData, FmSavedDocument } from "./fmTypes";

export type DocumentKind = FmSavedDocument["kind"];

export interface DocumentKindInfo {
  /** What one is called on screen: "snapshot". */
  noun: string;
  /** And several: "snapshots" ("Saved snapshots (3)"). */
  plural: string;
  /** The word in its file name: villa-readiness-2026-10.md. */
  fileWord: string;
}

export const DOCUMENT_KINDS: Record<DocumentKind, DocumentKindInfo> = {
  recap: { noun: "recap", plural: "recaps", fileWord: "operations" },
  spend: { noun: "statement", plural: "statements", fileWord: "spend" },
  readiness: { noun: "snapshot", plural: "snapshots", fileWord: "readiness" },
};

/** The file a document downloads as: the villa's name, what it is, its month. */
export function documentFileName(kind: DocumentKind, villaName: string, month: string): string {
  return `${villaName.replace(/\s+/g, "-").toLowerCase()}-${DOCUMENT_KINDS[kind].fileWord}-${month}.md`;
}

/** The month a document starts on: a recap is written about a month that has
 *  finished (due by the 10th of the one after it); a statement and a snapshot
 *  are of the month running now. */
export function defaultMonth(kind: DocumentKind, now: number = Date.now()): string {
  if (kind !== "recap") return monthKey(now);
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return monthKey(d);
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
