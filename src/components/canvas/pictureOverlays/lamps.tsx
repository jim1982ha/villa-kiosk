// src/components/canvas/pictureOverlays/lamps.tsx
// ⚠️ A LAMP ON SHOWS ON THE PICTURE, EACH AT ITS PLACE (owner, 2026-11-25: one glow at the badge, not as the 3D view
// shows it): the pictures are taken with every lamp dark (EntityVisuals.lampsOff), so each lamp of a light this
// profile may see that is on is lit here, its bulb and its pool, at the 3D view's own pool spots
// (EntityVisuals.lampSpots: a strip's row, each pool its share of the strip's light).

import type { LampSpot } from "@/babylon/EntityVisuals";
import { hasNumbers, overlayKind, type PlacedItem } from "./kind";

/** One lamp's pool: its middle (u, v), its reach `r` as a share of the picture's width, `s` its share of its
 *  fixture's light. */
export interface PictureLamp extends PlacedItem { u: number; v: number; r: number; s: number }

const round = (n: number) => Math.round(n * 1e3) / 1e3;

export const lamps = overlayKind<LampSpot, PictureLamp>({
  key: "lamps",
  rule: 1,
  record: (scene) => ({ back: scene.lampsOff(), items: scene.lampSpots() }),
  place: (l, at) => {
    const [u, v] = at.uv(l.x, l.z);
    return { id: l.id, u, v, r: at.width(l.r), s: round(l.s) };
  },
  read: (raw): raw is PictureLamp => hasNumbers(raw, ["u", "v", "r", "s"]),
  draw: (items, rect, live) => items.filter((l) => live.entities[l.id]?.state === "on" && live.mayShow(l.id)).map((l) => (
    <span key={`${l.id}@${l.u},${l.v}`} className="picture-lamp-pool"
      style={{ left: `${l.u * 100}%`, top: `${l.v * 100}%`, width: l.r * 2 * rect.w, height: l.r * 2 * rect.w,
        opacity: Math.min(1, l.s) }} />
  )),
});
