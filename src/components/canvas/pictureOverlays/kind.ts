// src/components/canvas/pictureOverlays/kind.ts
// What a kind of thing drawn live over the villa pictures (a lamp's light, a ceiling fan, a curtain) is made of: how
// the capture records it from the 3D view and puts the 3D view back, where it lands on the shared frame, how its
// stored items are read back, and how the picture view draws the ones of one floor. One file per kind (covers.tsx,
// lamps.tsx, fans.tsx), listed once in index.ts; the capture (villaPictureCapture), the manifest
// (pictureManifest.buildManifest, configKey) and the picture view (PictureView) each loop over that list.
//
// ⚠️ A NEW KIND WAS EIGHT EDITS IN FIVE FILES (architecture review, 2026-11-25): a method in EntityVisuals, a slot
// and a put-back in the capture, a type and a conversion in the manifest, the global framing number raised by hand
// (forgotten, the TV kept the old pictures), and its drawing inline in PictureView. Now it is one file, and its own
// `rule` is in configKey.
//
// No Babylon at run time here: a device shown the pictures never downloads the 3D engine (the scene comes in as a
// type only).

import type { ReactNode } from "react";
import type { HassEntity } from "@/types/ha.types";
import type { EntityVisuals } from "@/babylon/EntityVisuals";
import type { Rect } from "../pictureLayout";

/** What the capture reads from the 3D view for the overlays. */
export type PictureScene = Pick<EntityVisuals, "lampsOff" | "lampSpots" | "coversOpen" | "ceilingFansHidden">;

/** A world item on its floor (the capture puts an unstamped one on the lowest floor). */
export interface WorldItem { floor: number | null }
/** A stored item: on its floor's picture, for its entity. */
export interface PlacedItem { id: string; floor: number }

/** The shared frame, for `place`: a world point's (u, v), and a length in metres as a share of the picture's width. */
export interface PicturePlacer {
  uv(x: number, z: number): [number, number];
  width(metres: number): number;
}

/** What the picture view knows when it draws: the villa's states now, and whether this profile may see a device. */
export interface OverlayLive {
  entities: Record<string, HassEntity | undefined>;
  mayShow(entityId: string): boolean;
}

export interface PictureOverlay<W extends WorldItem, P extends PlacedItem> {
  /** Its items' key in the manifest's `overlays`. */
  key: string;
  /** Goes up when how it is recorded or stored changes, so every stored set is made again (configKey). */
  rule: number;
  /** Before the pictures: its items, and the function that puts the 3D view back as it was. */
  record(scene: PictureScene): { items: W[]; back: () => void };
  /** One item on the shared frame, its floor already a number (the manifest adds it). */
  place(item: W, at: PicturePlacer): Omit<P, "floor">;
  /** Whether a stored item is one of its own (a set made by an older rule is not drawn wrong). */
  read(raw: unknown): raw is P;
  /** Its items on one floor's picture, drawn over the picture at `rect`. */
  draw(items: readonly P[], rect: Rect, live: OverlayLive): ReactNode;
}

/** A kind as the loops over every kind see it. */
export type OverlayKind = PictureOverlay<WorldItem, PlacedItem>;

/** A kind for the list (index.ts): its own types kept inside it. */
export function overlayKind<W extends WorldItem, P extends PlacedItem>(kind: PictureOverlay<W, P>): OverlayKind {
  return kind as unknown as OverlayKind;
}

/** Whether `raw` is an object whose named fields are all finite numbers, with a string id and a floor. */
export function hasNumbers(raw: unknown, fields: readonly string[]): raw is PlacedItem & Record<string, number> {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return typeof o.id === "string" && Number.isFinite(o.floor) && fields.every((f) => Number.isFinite(o[f]));
}
