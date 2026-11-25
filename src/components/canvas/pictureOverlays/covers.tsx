// src/components/canvas/pictureOverlays/covers.tsx
// ⚠️ A CURTAIN SHOWS AS IT IS (owner, 2026-11-25): the pictures are taken with every cover open
// (EntityVisuals.coversOpen), so the pose a cover's state asks for now (the 3D view's rule: meshVariants) is drawn
// over them, outlined, unless it is open.

import type { CoverPoseExtent } from "@/babylon/EntityVisuals";
import { desiredVariantWord, orderVariantWords, pickNearestVariant } from "@/babylon/meshVariants";
import { hasNumbers, overlayKind, type PlacedItem } from "./kind";

/** A cover's pose other than open: its ground extents, (u, v) top-left and bottom-right. */
export interface PictureCoverPose extends PlacedItem {
  /** The pose word, as the model names it ("closed", "half"). */
  word: string;
  u0: number; v0: number; u1: number; v1: number;
}

export const covers = overlayKind<CoverPoseExtent, PictureCoverPose>({
  key: "covers",
  rule: 1,
  record: (scene) => {
    const { poses, back } = scene.coversOpen();
    return { items: poses, back };
  },
  place: (c, at) => {
    const [u0, v0] = at.uv(c.minX, c.maxZ), [u1, v1] = at.uv(c.maxX, c.minZ);
    return { id: c.id, word: c.word, u0, v0, u1, v1 };
  },
  read: (raw): raw is PictureCoverPose => hasNumbers(raw, ["u0", "v0", "u1", "v1"]) && typeof (raw as { word?: unknown }).word === "string",
  draw: (items, _rect, live) => {
    const byId = new Map<string, PictureCoverPose[]>();
    for (const c of items) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
    const shown = [...byId].flatMap(([id, poses]) => {
      const entity = live.entities[id];
      if (!entity || !live.mayShow(id)) return [];
      const words = [...poses.map((c) => c.word), "open"];
      const chosen = pickNearestVariant(orderVariantWords(words), desiredVariantWord(entity), words);
      return poses.filter((c) => c.word === chosen);
    });
    if (!shown.length) return null;
    return (
      <svg className="picture-rooms" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {shown.map((c) => (
          <rect key={`${c.id}:${c.word}`} className="picture-cover" x={c.u0} y={c.v0} width={Math.max(c.u1 - c.u0, 0.004)}
            height={Math.max(c.v1 - c.v0, 0.004)} />
        ))}
      </svg>
    );
  },
});
