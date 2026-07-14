// src/components/hud/RadialRoomMenu.tsx
// The overlay half of the Rooms dial: floating chips laid out on semi-circular
// arcs beside the button (floors on the inner ring, the active floor's rooms on
// the outer ring). It's a tapped popup — tap a chip to pick it, tap the backdrop
// to dismiss. HUD computes the chip positions (buildRadialItems) so it can also
// pre-expand the current floor; this component just paints + wires the taps.

export interface RadialItem {
  key: string;
  label: string;
  /** Viewport coordinates (position: fixed) of the chip centre. */
  x: number;
  y: number;
  kind: "floor" | "room";
  /** Highlighted — e.g. the currently-active floor. */
  active: boolean;
}

interface Props {
  items: RadialItem[];
  open: boolean;
  onPick: (item: RadialItem) => void;
  /** Tap outside any chip → dismiss. */
  onBackdrop: () => void;
}

export default function RadialRoomMenu({ items, open, onPick, onBackdrop }: Props) {
  if (!open) return null;
  return (
    <div className="radial-room-menu" onClick={onBackdrop}>
      {items.map((it) => (
        <button
          key={it.key}
          className={`radial-item radial-${it.kind}${it.active ? " active" : ""}`}
          style={{ left: `${it.x}px`, top: `${it.y}px` }}
          onClick={(e) => { e.stopPropagation(); onPick(it); }}
        >
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
