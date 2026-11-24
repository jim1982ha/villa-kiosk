// src/utils/pictureManifest.ts
// The villa pictures' arithmetic (villaPictures.ts has the format): where a point of the villa lands on a picture,
// how big a picture is, what the pictures were made from (config_key) and whether a stored set is still right.
// Pure, so the oracle drives it in node (tests/oracles/villa_pictures.mjs); the capture itself is
// babylon/villaPictureCapture.ts.

import type { AppConfig } from "@/config/AppConfig";
import { COSMETIC_MAPPING_FIELDS } from "@/babylon/entityMapDiff";
import type { PictureBadge, PictureFloor, PictureRoom, PicturesManifest, ViewFile } from "@/utils/villaPictures";

export type PictureFrame = PicturesManifest["frame"];
export type Look = "day" | "night";

/** The pictures' long side, in pixels: sharp on a 1080p TV showing both floors side by side or stacked, and a few
 *  hundred KB as webp. */
export const PICTURE_LONG_SIDE = 1600;

/** The floors a set holds: VIEW_FILES names two (f1, f2). A third storey has no picture. */
export const PICTURE_FLOORS = [1, 2] as const;

/** The world frame every picture shows: the whole model's ground extents (x and z), the same for every floor. */
export function pictureFrame(min: { x: number; z: number }, max: { x: number; z: number }): PictureFrame {
  return { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z };
}

/** A picture's pixel size: the frame's aspect (spanX / spanZ), the long side PICTURE_LONG_SIDE. */
export function pictureSize(frame: PictureFrame, longSide = PICTURE_LONG_SIDE): { width: number; height: number } {
  const sx = Math.max(frame.maxX - frame.minX, 1e-6), sz = Math.max(frame.maxZ - frame.minZ, 1e-6);
  return sx >= sz
    ? { width: longSide, height: Math.max(1, Math.round((longSide * sz) / sx)) }
    : { width: Math.max(1, Math.round((longSide * sx) / sz)), height: longSide };
}

/** Where a world point (x, z) sits on every picture: u to the right, v down, both 0..1, north (+z) up. */
export function toUv(frame: PictureFrame, x: number, z: number): [number, number] {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return [r((x - frame.minX) / (frame.maxX - frame.minX)), r((frame.maxZ - z) / (frame.maxZ - frame.minZ))];
}

/** A floor's picture file for a look ("f2-night.webp"). */
export function viewFileFor(floor: number, look: Look): ViewFile {
  return `f${floor}-${look}.webp` as ViewFile;
}

/** Keys sorted at every depth, so the same content always writes the same text whatever order it was built in. */
function stableText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableText).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableText(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A 53-bit string hash (cyrb53), as 14 hex digits: not a defence, a change detector. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export type PlacementConfig = Pick<AppConfig, "entityMap" | "meshBindings" | "deviceGroups" | "sh3dEntities" | "sh3dRooms">;

/**
 * What in the config moves a badge or a room on the pictures, as one key: which mesh is which device (the entity
 * map without its cosmetic fields, the mesh bindings), which device of a group carries the badge, and the floor
 * plan's devices and rooms the plan → world fit is made from. A label or a colour is drawn live over the pictures,
 * so it changes nothing here.
 */
export function configKey(config: PlacementConfig): string {
  const entityMap: Record<string, unknown> = {};
  for (const [id, m] of Object.entries(config.entityMap)) {
    const placed: Record<string, unknown> = { ...m };
    for (const f of COSMETIC_MAPPING_FIELDS) delete placed[f];
    entityMap[id] = placed;
  }
  return hash53(stableText({
    entityMap,
    meshBindings: config.meshBindings,
    deviceGroups: config.deviceGroups.map((g) => ({ primary: g.primaryEntityId, members: [...g.memberEntityIds].sort() })),
    sh3dEntities: config.sh3dEntities ?? [],
    sh3dRooms: config.sh3dRooms ?? [],
  }));
}

/** What the pictures on screen now would be made from. */
export interface PictureSource { model_version: string; rooms_version: string; config_key: string }

/** Whether the stored set must be made again: none stored, or made from another model, room data or placement. */
export function picturesStale(stored: PicturesManifest | null, now: PictureSource): boolean {
  return !stored || stored.model_version !== now.model_version || stored.rooms_version !== now.rooms_version
    || stored.config_key !== now.config_key;
}

/** A badge's anchor in the world, on its 1-based floor (EntityVisuals.anchorSnapshot). */
export interface WorldAnchor { id: string; x: number; y: number; z: number; floor: number }
/** A room outline in the world, on its 1-based floor (SceneManager.pictureRooms). */
export interface WorldOutline { name: string; floor: number; pts: { x: number; z: number }[] }

/** The manifest of a set just made: every position turned into (u, v) on the shared frame. Only the floors that
 *  have pictures keep their badges and rooms. */
export function buildManifest(input: {
  source: PictureSource;
  madeAt: Date;
  frame: PictureFrame;
  floors: readonly number[];
  size: { width: number; height: number };
  anchors: readonly WorldAnchor[];
  rooms: readonly WorldOutline[];
}): PicturesManifest {
  const { frame, size } = input;
  const floors: PictureFloor[] = input.floors.map((floor) => ({
    floor, label: `${floor}F`, day: viewFileFor(floor, "day"), night: viewFileFor(floor, "night"),
    width: size.width, height: size.height,
  }));
  const shown = new Set(input.floors);
  const badges: PictureBadge[] = input.anchors.filter((a) => shown.has(a.floor))
    .map((a) => { const [u, v] = toUv(frame, a.x, a.z); return { id: a.id, floor: a.floor, u, v }; })
    .sort((a, b) => a.floor - b.floor || a.id.localeCompare(b.id));
  const rooms: PictureRoom[] = input.rooms.filter((r) => shown.has(r.floor) && r.pts.length >= 3)
    .map((r) => ({ name: r.name, floor: r.floor, pts: r.pts.map((p) => toUv(frame, p.x, p.z)) }));
  return {
    v: 1,
    model_version: input.source.model_version,
    rooms_version: input.source.rooms_version,
    config_key: input.source.config_key,
    made_at: input.madeAt.toISOString(),
    frame,
    floors,
    badges,
    rooms,
  };
}
