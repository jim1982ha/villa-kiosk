// src/components/hud/RadialRoomMenu.tsx
// The overlay half of the Rooms dial: floating chips laid out on semi-circular
// arcs beside the button (floors on the inner ring, the active floor's rooms on
// the outer ring). Tap a chip to pick it, tap the backdrop to dismiss.
//
// Interaction is driven by POINTERDOWN, not click: the tap that opens the dial
// fires its pointerdown/up on the Rooms button BEFORE this backdrop mounts, so a
// fresh pointerdown here is always a new, deliberate press — no synthesized
// "ghost click" can land on the just-mounted backdrop and instantly dismiss what
// the opening tap created (which is what left the menu looking stuck).

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
  /** Press outside any chip → dismiss. */
  onBackdrop: () => void;
}

export default function RadialRoomMenu({ items, open, onPick, onBackdrop }: Props) {
  if (!open) return null;
  return (
    <div
      className="radial-room-menu"
      onPointerDown={onBackdrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.key}
          className={`radial-item radial-${it.kind}${it.active ? " active" : ""}`}
          style={{ left: `${it.x}px`, top: `${it.y}px` }}
          onPointerDown={(e) => { e.stopPropagation(); onPick(it); }}
        >
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
