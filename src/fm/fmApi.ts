// src/fm/fmApi.ts
// Client for the Facility Manager store (/fm-data) and evidence photos
// (/fm-evidence), both served from the add-on's own /data volume — so the
// maintenance record is central and every device sees the same one, exactly
// like the shared device configuration and scenes.

import { ingressPath } from "@/ha/ingress";
import {
  EMPTY_FM_DATA, FM_COLLECTIONS, NOT_STATUS_CHANGE_KINDS,
  type FmCollection, type FmData, type FmSavedDocument, type FmTicket, type FmTicketUpdate, recapKind,
} from "./fmTypes";
import { backendFetch } from "@/auth/sessionLost";
import { storeSaveResult } from "@/utils/storeSave";
import type { FmRetention } from "./fmEngine";
import {
  keyBy, diffKeyed, applyKeyed, applyKeyedMerging, keyedDiffIsEmpty, mergeItem, mineWins, names,
  type FieldMerge, type KeyedDiff, type StoreFetch, type StoreSaveResult,
} from "@/utils/keyedSync";
import type { UnsentCopy, UnsentKeeper } from "@/utils/syncedDocument";
import { readString, removeStored, writeJson } from "@/utils/storedJson";

/** Narrow an arbitrary parsed value to FmData, dropping anything unrecognised.
 *  A store written by a newer app version must not be able to inject unknown
 *  shapes; a store written by an older one must not crash this one. */
function parseFmData(raw: unknown): FmData {
  if (!raw || typeof raw !== "object") return { ...EMPTY_FM_DATA };
  const b = raw as Record<string, unknown>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    schedules: arr(b.schedules),
    completions: arr(b.completions),
    costs: arr(b.costs),
    tickets: arr(b.tickets),
    // Absent on a store written before saved documents existed — defaults to
    // empty rather than dropping the field, same as every array above.
    savedDocuments: arr<FmSavedDocument>(b.savedDocuments).map(recapKind),
  };
}

/** Returns null on a transport failure so the caller can tell "server has
 *  nothing" from "couldn't reach it" — the latter must never overwrite local
 *  state or be shown as an empty maintenance record.
 *
 *  Also returns the revision and the RAW stored object: this store is edited
 *  by the owner AND the facility manager, frequently from different devices
 *  at the same time, so writes need optimistic concurrency and unknown-key
 *  carry-over exactly like the device-config store. See utils/keyedSync.ts. */
/** The server's retention windows, read beside the record (null: not said — an older add-on). */
export function parseRetention(raw: unknown): FmRetention | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const day = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const clearedDays = day(r.clearedDays), repairedDays = day(r.repairedDays);
  if (clearedDays === null || repairedDays === null) return null;
  // an add-on before 2.496.449 does not say `recordsDays`: it kept completions and costs for ever (0)
  return { clearedDays, repairedDays, recordsDays: day(r.recordsDays) ?? 0 };
}

export async function fetchFmData(signal?: AbortSignal): Promise<(StoreFetch<FmData> & { retention: FmRetention | null }) | null> {
  try {
    const r = await backendFetch(ingressPath("fm-data"), { credentials: "same-origin", signal });
    if (!r.ok) return null;
    const d = (await r.json()) as { data?: unknown; rev?: unknown; retention?: unknown };
    const raw = d.data && typeof d.data === "object"
      ? (d.data as Record<string, unknown>) : {};
    return {
      doc: parseFmData(d.data),
      rev: typeof d.rev === "string" ? d.rev : "0",
      raw,
      retention: parseRetention(d.retention),
    };
  } catch {
    return null;
  }
}

/** Write the store. Owner and facility manager only (the server enforces it
 *  too).
 *
 *  `expectedRev` is the revision this write was computed against — the server
 *  rejects it with 409 if another device wrote in the gap, so a concurrent
 *  edit is rebased instead of silently overwritten. `carryOver` writes back
 *  keys this app version doesn't recognise, so an older client can't delete a
 *  newer one's field. This used to be a bare whole-document PUT with neither:
 *  the owner resolving a ticket on one device and the facility manager logging
 *  a completion on another would simply lose whichever landed first, with no
 *  error shown — on the records that evidence the property's maintenance. */
export async function saveFmData(
  data: FmData,
  expectedRev: string | null,
  carryOver: Record<string, unknown> = {},
  /** Single-use superadmin token, required by the server for any write that
   *  removes an evidence record (see auth/elevation.ts). Sent alongside the
   *  document, never inside it — it authorises this one request and is
   *  consumed by it, so it must not be stored. */
  elevation?: string,
  /** Aborts the request: the push it belongs to ran out of time (utils/syncedDocument PUSH_DEADLINE_MS). */
  signal?: AbortSignal,
): Promise<StoreSaveResult> {
  try {
    const merged = { ...carryOver, ...data };
    const r = await backendFetch(ingressPath("fm-data"), {
      method: "PUT",
      signal,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: merged,
        ...(expectedRev === null ? {} : { rev: expectedRev }),
        ...(elevation ? { elevation } : {}),
      }),
    });
    // The server's NO is an answer, with its reason, not a blip to retry: one reading for both stores (utils/storeSave).
    return await storeSaveResult(r);
  } catch {
    return { ok: false, conflict: false };
  }
}

// ── Per-item diff/merge for the FM document ──────────────────────────────
// Every FM collection is a list of records with their own `id`, so the shared
// keyed machinery applies directly — no bespoke merge logic here.
// The collections are the shared table's (fmTypes.FM_COLLECTIONS, read from
// fm-records.json — the same list the add-on judges writes by).

export type FmDataDiff = Record<FmCollection, KeyedDiff<{ id: string }>>;

const keyFm = (d: FmData, k: FmCollection) =>
  keyBy(d[k] as { id: string }[], (r) => r.id);

/** A fault changed on two devices merges field by field (keyedSync mergeItem): its status goes with when it was
 *  resolved and the cost filed with it; its steps are append-only, by their whole content (a step has no id), and a
 *  status step of this device's is left out when the status kept the other device's (the record must read as one fault:
 *  fmEngine.ticketAt takes the status from the last status step). The VESTA Agent writes the same faults. */
const NOT_A_STATUS_STEP: ReadonlySet<string> = new Set(NOT_STATUS_CHANGE_KINDS);
const TICKET_FIELDS: FieldMerge = {
  groups: [["status", "resolvedAt", "costId"]],
  lists: {
    updates: {
      id: (u) => JSON.stringify(u),
      dropMine: (u, clashed) => clashed.has("status") && !NOT_A_STATUS_STEP.has((u as FmTicketUpdate).kind ?? ""),
    },
  },
};
export const mergeTicket = (was: FmTicket, mine: FmTicket, theirs: FmTicket) => mergeItem(was, mine, theirs, TICKET_FIELDS);

/** Only the faults merge (their `was` is kept): every other record is still replaced whole. */
export function diffFmData(base: FmData, next: FmData): FmDataDiff {
  const out = {} as FmDataDiff;
  for (const k of FM_COLLECTIONS) out[k] = diffKeyed(keyFm(base, k), keyFm(next, k), k === "tickets");
  return out;
}

export function fmDiffIsEmpty(diff: FmDataDiff): boolean {
  return FM_COLLECTIONS.every((k) => keyedDiffIsEmpty(diff[k]));
}

/** Replay one device's changes onto the server's freshest copy. A fault `target` holds changed since the copy the
 *  change was made against is merged field by field, `target`'s value kept on a field both changed (mergeTicket). */
export function applyFmDiff(target: FmData, diff: FmDataDiff): FmData {
  const out = { ...target } as Record<string, unknown>;
  for (const k of FM_COLLECTIONS) {
    out[k] = Object.values(k === "tickets"
      ? applyKeyedMerging(keyFm(target, k), diff[k], (was, mine, theirs) =>
        mergeTicket(was as FmTicket, mine as FmTicket, theirs as FmTicket).item)
      : applyKeyed(keyFm(target, k), diff[k]));
  }
  return out as unknown as FmData;
}

/** What a push that landed brings to the screen: the other devices' changes (`others`, utils/syncedDocument) laid on
 *  the screen as it is NOW, under every record this device has changed itself since `synced` (keyedSync mineWins, the
 *  config store's rule too), except a fault: changed on both sides it is merged field by field, as the push merged it
 *  in the store (mergeTicket), and `changedOnBoth` names it when a field both changed kept the other device's value.
 *  FmDataContext mutate says it. */
export function foldOthers(screen: FmData, pushed: { synced: FmData; others: FmDataDiff }): { doc: FmData; changedOnBoth: string[] } {
  const mine = diffFmData(pushed.synced, screen);
  const was = keyFm(pushed.synced, "tickets"), now = keyFm(screen, "tickets");
  const merged: Record<string, FmTicket> = {};
  const changedOnBoth: string[] = [];
  for (const [id, theirs] of Object.entries(pushed.others.tickets.set)) {
    if (!names(mine.tickets, id) || !(id in was) || !(id in now)) continue;
    const r = mergeTicket(was[id] as FmTicket, now[id] as FmTicket, theirs as FmTicket);
    merged[id] = r.item;
    if (r.clashed.length > 0) changedOnBoth.push(id);
  }
  const laid = applyFmDiff(screen, mineWins(pushed.others, mine));
  return { doc: { ...laid, tickets: laid.tickets.map((t) => merged[t.id] ?? t) }, changedOnBoth };
}

// ── This device's unsent Facility work, kept across a reload ────────────
// ⚠️ "SAVED ON THIS DEVICE" WAS THE PAGE'S MEMORY (architecture review i_k3, 2026-10-23): a fault reported, or work
// logged, while the add-on could not be reached was told "it will be sent automatically", and the 04:00 reload, iOS
// dropping the tab or a pull to refresh lost it, nothing said. Kept here (utils/syncedDocument spec.keep) from the moment
// it is handed to a push until the add-on has it; read back when the store starts, and sent by the first refresh onto the
// store's fresh copy, item by item: a fault changed meanwhile on another device is merged field by field (mergeTicket),
// so an older copy here never overwrites a newer value there.
//
// Only the change and the records it touches as the add-on last held them (`was` for a fault's merge, a removed record's
// id): never the whole record, which is the add-on's. Photos and documents are not in it: a photo is uploaded on its own
// before the fault or the work that names it (uploadEvidence; with the add-on out of reach it fails there, said by the
// form), so what is kept names only photos the add-on already holds.
//
// ⚠️ FM_UNSENT_FORMAT goes up whenever the record's shape or the change's shape (FmDataDiff) changes: a copy written in
// another format is dropped, never replayed blindly. Storage refused (private mode, full): nothing is kept, as before.

export const FM_UNSENT_KEY = "villa-kiosk:fm-unsent";
export const FM_UNSENT_FORMAT = 1;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isRecordMap = (v: unknown) => isObj(v) && Object.entries(v).every(([id, r]) => isObj(r) && r.id === id);

/** A stored change, if it is one: every collection's set (records under their own id), removed ids and `was`. */
function parseFmDiff(raw: unknown): FmDataDiff | null {
  if (!isObj(raw)) return null;
  const out = {} as FmDataDiff;
  for (const k of FM_COLLECTIONS) {
    const d = raw[k];
    if (!isObj(d) || !isRecordMap(d.set) || !Array.isArray(d.del) || !d.del.every((id) => typeof id === "string")) return null;
    if (d.was !== undefined && !isRecordMap(d.was)) return null;
    out[k] = { set: d.set as Record<string, { id: string }>, del: d.del as string[],
      ...(d.was !== undefined ? { was: d.was as Record<string, { id: string }> } : {}) };
  }
  return out;
}

/** The records of `baseline` the change touches (changed, removed, or merged against): what a replay needs of it. */
function touchedBy(baseline: FmData, unsent: FmDataDiff): FmData {
  const out = { ...EMPTY_FM_DATA } as Record<string, unknown>;
  for (const k of FM_COLLECTIONS) {
    const d = unsent[k];
    const ids = new Set([...Object.keys(d.set), ...d.del, ...Object.keys(d.was ?? {})]);
    out[k] = (baseline[k] as { id: string }[]).filter((r) => ids.has(r.id));
  }
  return out as unknown as FmData;
}

/** The Facility store's keeper (FmDataContext). */
export const fmUnsentKeeper: UnsentKeeper<FmData, FmDataDiff> = {
  load: (): UnsentCopy<FmData, FmDataDiff> | null => {
    const text = readString(FM_UNSENT_KEY);
    if (text === null) return null;
    let raw: unknown = null;
    try { raw = JSON.parse(text); } catch { /* not JSON: dropped below */ }
    const unsent = isObj(raw) && raw.v === FM_UNSENT_FORMAT ? parseFmDiff(raw.unsent) : null;
    if (!isObj(raw) || unsent === null || !isObj(raw.baseline)) {
      removeStored(FM_UNSENT_KEY);   // another format, or not one at all: dropped, never replayed
      return null;
    }
    return { baseline: parseFmData(raw.baseline), unsent };
  },
  save: (copy) => {
    if (copy === null) removeStored(FM_UNSENT_KEY);
    else writeJson(FM_UNSENT_KEY, { v: FM_UNSENT_FORMAT, baseline: touchedBy(copy.baseline, copy.unsent), unsent: copy.unsent });
  },
};

/** Short, URL-safe, collision-resistant enough for one villa's records. */
export function fmId(prefix = ""): string {
  const rand = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

/** Longest edge, in pixels, an evidence photo is downscaled to before upload.
 *  Enough to read a serial number or see a stain; small enough that a year of
 *  evidence is tens of megabytes, and comfortably inside the Supervisor's
 *  ingress body cap (which a raw modern phone photo would blow straight past). */
const EVIDENCE_MAX_EDGE = 1600;
const EVIDENCE_QUALITY = 0.8;

/** Downscale + re-encode a captured image to a modest JPEG.
 *  Done on the CLIENT deliberately: it keeps the upload small on a villa's
 *  patchy uplink, and means the add-on never has to carry an image library. */
async function downscaleToJpeg(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, EVIDENCE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the photo on this device.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/jpeg", EVIDENCE_QUALITY));
  if (!blob) throw new Error("Couldn't prepare the photo on this device.");
  return blob;
}

/** Downscale, upload, and return the id to store on the completion/ticket.
 *  Throws with a message safe to show the operator. */
export async function uploadEvidence(file: Blob): Promise<string> {
  const jpeg = await downscaleToJpeg(file);
  const id = fmId("ph");
  const r = await backendFetch(`${ingressPath("fm-evidence")}?id=${encodeURIComponent(id)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "image/jpeg" },
    body: jpeg,
  });
  if (!r.ok) {
    const msg = r.status === 403
      ? "Only the owner or facility manager can add photos."
      : r.status === 413
        ? "That photo is too large even after resizing."
        : `Upload failed (HTTP ${r.status}).`;
    throw new Error(msg);
  }
  return id;
}

/** URL for displaying a stored evidence photo. */
export function evidenceUrl(photoId: string): string {
  return `${ingressPath("fm-evidence")}/${encodeURIComponent(photoId)}`;
}

/** URL for opening a fault's document (an investigation report): served sandboxed by the add-on, nothing fetched. */
export function documentUrl(documentId: string): string {
  return ingressPath(`fm-document/${encodeURIComponent(documentId)}`);
}
