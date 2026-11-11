// src/components/hud/RadialRoomMenu.tsx
// The overlay half of the Rooms dial: floating chips laid out on semi-circular
// arcs beside the button that opened it (floors on the inner ring, that
// floor's rooms on the outer ring). Tap a chip to pick it, tap the backdrop
// to dismiss.
//
// Interaction is driven by POINTERDOWN, not click: the tap/hold that opens the
// dial fires its pointerdown/up on a floor button BEFORE this backdrop mounts,
// so a fresh pointerdown here is always a new, deliberate press — no
// synthesized "ghost click" can land on the just-mounted backdrop and
// instantly dismiss what the opening gesture created (which is what left the
// menu looking stuck).

import { LayoutGrid } from "lucide-react";

import type { RadialItem } from "./roomDial";
export type { RadialItem };

interface Props {
  items: RadialItem[];
  open: boolean;
  onPick: (item: RadialItem) => void;
  /** Press outside any chip → dismiss. */
  onBackdrop: () => void;
  /** Left edge (px) of the one-column list shown when the rooms do not fit the
   *  arc on this screen (roomDial.openRoomDial); null: the arc. */
  listAt?: number | null;
}

export default function RadialRoomMenu({ items, open, onPick, onBackdrop, listAt = null }: Props) {
  if (!open) return null;
  // On the arc a room is picked on POINTERDOWN (see the header). In the column
  // a finger that lands on a name may be starting a SCROLL: there a room is
  // picked by a completed tap (click), never by the touch that begins a drag.
  const chip = (it: RadialItem, style?: React.CSSProperties) => (
    <button
      key={it.key}
      className={`radial-item radial-${it.kind}${it.active ? " active" : ""}`}
      style={style}
      {...(listAt != null
        ? { onClick: () => onPick(it) }
        : { onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); onPick(it); } })}
    >
      <span>{it.label}</span>
    </button>
  );
  return (
    <div
      className="radial-room-menu"
      onPointerDown={onBackdrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {listAt != null ? (
        // A pointerdown on the column's empty space or while scrolling must not
        // dismiss: only the backdrop around it does.
        <div className="radial-list" style={{ left: `${listAt}px` }} onPointerDown={(e) => e.stopPropagation()}>
          {items.map((it) => chip(it))}
        </div>
      ) : (
        items.map((it) => chip(it, { left: `${it.x}px`, top: `${it.y}px` }))
      )}
      {/* The Rooms window: every floor's rooms, each one's device list, and for the owner "Add room here" (the
          menu's "Rooms" row opens the same window, with the same icon). "All rooms", not "Manage rooms": only the
          owner manages them there (owner, 2026-11-10). Pinned at a fixed screen position (NOT part
          of the arc layout above) so it can never collide with a long room
          list or sit differently depending on which floor button opened the
          dial. */}
      <button
        className="radial-manage-btn"
        onPointerDown={(e) => {
          e.stopPropagation();
          onPick({ key: "manage", label: "All rooms", kind: "manage", x: 0, y: 0, active: false });
        }}
      >
        <LayoutGrid size={16} />
        <span>All rooms</span>
      </button>
    </div>
  );
}
