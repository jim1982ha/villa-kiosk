// src/fm/fmApi.ts
// Client for the Facility Manager store (/fm-data) and evidence photos
// (/fm-evidence), both served from the add-on's own /data volume — so the
// maintenance record is central and every device sees the same one, exactly
// like the shared device configuration and scenes.

import { ingressPath } from "@/ha/ingress";
import { EMPTY_FM_DATA, type FmData } from "./fmTypes";

/** Narrow an arbitrary parsed value to FmData, dropping anything unrecognised.
 *  A store written by a newer app version must not be able to inject unknown
 *  shapes; a store written by an older one must not crash this one. */
export function parseFmData(raw: unknown): FmData {
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
    savedDocuments: arr(b.savedDocuments),
  };
}

/** Returns null on a transport failure so the caller can tell "server has
 *  nothing" from "couldn't reach it" — the latter must never overwrite local
 *  state or be shown as an empty maintenance record. */
export async function fetchFmData(): Promise<FmData | null> {
  try {
    const r = await fetch(ingressPath("fm-data"), { credentials: "same-origin" });
    if (!r.ok) return null;
    const d = (await r.json()) as { data?: unknown };
    return parseFmData(d.data);
  } catch {
    return null;
  }
}

/** Replace the whole store. Owner and facility manager only (the server
 *  enforces it too). Resolves false so the UI can say the save failed rather
 *  than silently pretending it worked. */
export async function saveFmData(data: FmData): Promise<boolean> {
  try {
    const r = await fetch(ingressPath("fm-data"), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

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
export async function downscaleToJpeg(file: Blob): Promise<Blob> {
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
  const r = await fetch(`${ingressPath("fm-evidence")}?id=${encodeURIComponent(id)}`, {
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
