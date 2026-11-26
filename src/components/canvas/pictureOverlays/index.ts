// src/components/canvas/pictureOverlays/index.ts
// Every kind of thing drawn live over the villa pictures (kind.ts says what one is), in drawing order: a new kind is
// one file and one line here.

import { covers } from "./covers";
import { lamps } from "./lamps";
import { fans } from "./fans";
import type { OverlayKind } from "./kind";

export const PICTURE_OVERLAYS: readonly OverlayKind[] = [covers, lamps, fans];

export type { OverlayKind, OverlayLive, PictureScene, WorldItem } from "./kind";
