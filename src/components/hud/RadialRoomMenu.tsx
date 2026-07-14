// src/components/hud/RadialRoomMenu.tsx
// The overlay half of the long-press "marking menu" for the Rooms button: a
// purely presentational set of floating chips laid out on semi-circular arcs to
// the right of the button. All the gesture logic (open on long-press, slide to
// highlight, dwell on a floor to expand its rooms, release to navigate) lives in
// HUD, which drives this with a computed `items` list — this component just
// paints them. It is pointer-events:none so it never competes with the button's
// captured pointer that's driving the selection.

export interface RadialItem {
  key: string;
  label: string;
  /** Viewport coordinates (position: fixed) of the chip centre. */
  x: number;
  y: number;
  kind: "floor" | "room";
  /** Highlighted — the item currently under the finger, or the expanded floor. */
  active: boolean;
}

export default function RadialRoomMenu({ items }: { items: RadialItem[] }) {
  if (!items.length) return null;
  return (
    <div className="radial-room-menu" aria-hidden="true">
      {items.map((it) => (
        <div
          key={it.key}
          className={`radial-item radial-${it.kind}${it.active ? " active" : ""}`}
          style={{ left: `${it.x}px`, top: `${it.y}px` }}
        >
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
