// src/components/canvas/pictureOverlays/fans.tsx
// ⚠️ A CEILING FAN TURNS (owner, 2026-11-25: "instead of seeing the ceiling fan spinning, i see this red circle"):
// the pictures are made without the ceiling fans (EntityVisuals.ceilingFansHidden), so their blades are drawn here,
// at their size on the axle the 3D view turns them round (fanRigs.fanAxle), turning as fast as the 3D view turns them
// (fanSpin.fanTurnSpeed) for a profile that may see the fan; a ventilation fan stays in the picture, still.

import type { CeilingFanCircle } from "@/babylon/EntityVisuals";
import { fanTurnSpeed } from "@/babylon/fanSpin";
import { hasNumbers, overlayKind, type PlacedItem } from "./kind";

/** A ceiling fan: its axle (u, v), its blade tips' radius `r` as a share of the picture's width. One entity driving
 *  several fans has one item for each. */
export interface PictureFan extends PlacedItem { u: number; v: number; r: number }

/** Three blades round a hub, on a disc of radius 1: a ceiling fan seen from below the ceiling. */
const FAN_BLADES = (
  <>
    {[0, 120, 240].map((a) => (
      <path key={a} transform={`rotate(${a})`} d="M-0.13,-0.12 L-0.2,-0.95 Q0,-1.02 0.2,-0.95 L0.13,-0.12 Z" />
    ))}
    <circle r={0.16} />
  </>
);

export const fans = overlayKind<CeilingFanCircle, PictureFan>({
  key: "fans",
  rule: 1,
  record: (scene) => {
    const { fans: items, back } = scene.ceilingFansHidden();
    return { items, back };
  },
  place: (f, at) => {
    const [u, v] = at.uv(f.x, f.z);
    return { id: f.id, u, v, r: at.width(f.r) };
  },
  read: (raw): raw is PictureFan => hasNumbers(raw, ["u", "v", "r"]),
  draw: (items, rect, live) => items.map((f) => {
    const speed = live.mayShow(f.id) ? fanTurnSpeed(live.entities[f.id]) : null;
    return (
      <svg key={`${f.id}@${f.u},${f.v}`} className={`picture-fan${speed ? " on" : ""}`} aria-hidden="true"
        viewBox="-1 -1 2 2" style={{ left: `${f.u * 100}%`, top: `${f.v * 100}%`, width: f.r * 2 * rect.w, height: f.r * 2 * rect.w }}>
        {/* one turn in 2π / speed seconds, as the 3D view turns it */}
        <g className="picture-fan-blades" style={speed ? { animationDuration: `${((2 * Math.PI) / speed).toFixed(2)}s` } : undefined}>
          {FAN_BLADES}
        </g>
      </svg>
    );
  }),
});
