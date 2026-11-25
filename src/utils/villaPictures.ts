// src/utils/villaPictures.ts
// THE VILLA PICTURES (owner, 2026-11-24): a device too weak for the 3D villa (deviceVerdict) shows a still picture of
// each floor instead, 2F stacked over 1F, with live badges and room glow drawn over it in HTML. A capable device that
// opens the 3D villa as a profile that may manage the model makes them (babylon/villaPictureCapture) and stores them
// on the add-on (POST /model-views); every profile reads them from /model/views/.
//
// The pictures are taken top down with an orthographic camera framed on the WHOLE model's ground extents, the same
// frame for every floor, so a point (x, z) of the villa sits at the same place on each floor's picture:
//   u = (x - frame.minX) / (frame.maxX - frame.minX),  v = (frame.maxZ - z) / (frame.maxZ - frame.minZ)
// (u to the right, v down, both 0..1; north, +z, is up). Every position in the manifest is that (u, v).

import { modelUrl } from "@/utils/centralModel";
import { ingressPath } from "@/ha/ingress";
import { backendFetch } from "@/auth/sessionLost";

/** The files the add-on accepts under views/ (POST /model-views?name=...), and nothing else. */
export const VIEW_FILES = ["manifest.json", "f1-day.webp", "f1-night.webp", "f2-day.webp", "f2-night.webp"] as const;
export type ViewFile = (typeof VIEW_FILES)[number];

export interface PictureFloor {
  /** 1-based, as FloorManager counts. */
  floor: number;
  /** "1F", "2F". */
  label: string;
  day: ViewFile;
  night: ViewFile;
  /** The pictures' pixel size (day and night are the same size). */
  width: number;
  height: number;
}

export interface PictureBadge {
  /** The entity whose badge sits here (the primary entity of a device group). */
  id: string;
  floor: number;
  u: number;
  v: number;
}

export interface PictureRoom {
  /** The room's name, as the room data and resolvedRooms name it. */
  name: string;
  floor: number;
  /** Its outline, (u, v) points in order. */
  pts: [number, number][];
}

/** A cover's pose other than open (the pictures show every cover open): its outline on the picture, drawn live over
 *  it while the cover's state asks for that pose (meshVariants: the 3D view's own rule). */
export interface PictureCoverPose {
  id: string;
  /** The pose word, as the model names it ("closed", "half"). */
  word: string;
  floor: number;
  /** Its ground extents: (u, v) top-left and bottom-right. */
  u0: number; v0: number; u1: number; v1: number;
}

/** A ceiling fan (hidden on the pictures): its blades drawn live over them, turning while it is on. One entity
 *  driving several fans has one entry for each. */
export interface PictureFan {
  id: string;
  floor: number;
  /** Its axle, (u, v). */
  u: number; v: number;
  /** Its blade tips' radius, as a fraction of the picture's width. */
  r: number;
}

export interface PicturesManifest {
  v: 1;
  /** What the pictures were made from: when any of these changed, a capable owner device makes them again. */
  model_version: string;
  rooms_version: string;
  /** A hash of the device placement config (entity map, mesh bindings, groups, room calibration). */
  config_key: string;
  /** ISO time they were made. */
  made_at: string;
  /** The world frame every picture shows (metres, the scene's x and z). */
  frame: { minX: number; maxX: number; minZ: number; maxZ: number };
  floors: PictureFloor[];
  badges: PictureBadge[];
  rooms: PictureRoom[];
  /** Missing in a set made before 2.496.897: no cover drawn. */
  covers?: PictureCoverPose[];
  /** Missing in a set made before 2.496.899: the fans are in the picture. */
  fans?: PictureFan[];
}

/** A file's URL under /model/views/, stamped with the manifest's version so a new set is never served from cache. */
export function viewUrl(file: ViewFile, viewsVersion: string | null | undefined): string {
  return modelUrl(`views/${file}`, viewsVersion);
}

/** A manifest as read from the add-on, or null when it is not one (missing fields, another version). */
export function parseManifest(raw: unknown): PicturesManifest | null {
  const m = raw as Partial<PicturesManifest> | null;
  if (!m || typeof m !== "object" || m.v !== 1 || !Array.isArray(m.floors) || !Array.isArray(m.badges)
    || !Array.isArray(m.rooms) || !m.frame) return null;
  return m as PicturesManifest;
}

/** The stored set's manifest, null when none is stored (no version) or it cannot be read as one. */
export async function readStoredManifest(viewsVersion: string | null | undefined): Promise<PicturesManifest | null> {
  if (!viewsVersion) return null;
  try {
    const resp = await backendFetch(viewUrl("manifest.json", viewsVersion), { cache: "no-store" });
    return resp.ok ? parseManifest(await resp.json()) : null;
  } catch {
    return null;
  }
}

/** Store one file of a set on the add-on (POST /model-views, for a profile that may manage the model). The pictures
 *  first and the manifest last, so a reader never finds a manifest naming pictures not yet written. Throws with the
 *  add-on's reason on a refusal. */
export async function uploadView(name: ViewFile, body: Blob): Promise<void> {
  const resp = await backendFetch(ingressPath(`model-views?name=${encodeURIComponent(name)}`), {
    method: "POST",
    headers: { "Content-Type": name.endsWith(".json") ? "application/json" : "image/webp" },
    body,
  });
  if (!resp.ok) {
    const why = await resp.json().then((j: { error?: string }) => j.error, () => null);
    throw new Error(`${name}: ${why || `HTTP ${resp.status}`}`);
  }
}
