// src/components/hud/RoomChoiceSheet.tsx
// Which of these rooms did you mean?
//
// Room chips MERGE when they would overlap (see EntityVisuals.updateClusters —
// they are never pushed apart, because a chip that travels stops naming the
// room it sits in). A merged chip reads "Master Bedroom +1", and tapping it
// used to fly to whichever room won the label, silently discarding the other.
// The user had no way to reach it and no way to know it had been chosen for
// them.
//
// So a merged chip asks. One row per room it stands for, with that room's
// device count, and a tap goes there — the same "disambiguate rather than
// guess" pattern a map uses when several places share a pin.
//
// Deliberately NOT a full modal: it is a lightweight consequence of a tap on
// the map, so it uses the same centred-pill language as the rest of the HUD and
// dismisses on backdrop, Escape or choosing. A modal would imply the map had
// been left behind.

import { MapPin } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";

export interface RoomChoice {
  room: string;
  count: number;
}

export default function RoomChoiceSheet({
  choices, onPick, onClose,
}: {
  choices: RoomChoice[];
  onPick: (room: string) => void;
  onClose: () => void;
}) {
  // Escape, focus trap and focus restore, from the one place every other
  // dialog in the app gets them.
  const dialogRef = useModalA11y(onClose);
  return (
    <div className="modal-backdrop room-choice-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="room-choice-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a room"
      >
        <div className="room-choice-title">Which room?</div>
        <div className="room-choice-list">
          {choices.map((c) => (
            <button
              key={c.room}
              type="button"
              className="room-choice-row"
              onClick={() => onPick(c.room)}
              // The count is the point of the row: it is what tells you which
              // of two similarly-named rooms is the one you were looking at.
              title={`Go to ${c.room} — ${c.count} device${c.count === 1 ? "" : "s"}`}
            >
              <MapPin size={16} className="room-choice-icon" />
              <span className="room-choice-name">{c.room}</span>
              <span className="room-choice-count">{c.count}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
