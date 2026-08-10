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
// ── Built on BasePanel, like every other short dialog (2.208.0) ────────────
// It previously wrote its own `.modal-backdrop` + `.modal` markup. That IS the
// shared shell, but only half of it: on a phone that shell deliberately
// becomes a FULL-BLEED TOP-ANCHORED SHEET (see styles.css's max-width:640px
// block), which is right for Settings' long forms and wrong for a two-row
// question. The short dialogs opt back into a centred card through a SECOND
// class, `.panel-modal` / `.panel-modal-backdrop`, and this file did not know
// that — so on a phone it rendered as a square-cornered slab pinned to the top
// left, partially wide because its own width rule fought the sheet's.
//
// Reaching for the CSS class would have fixed the screenshot and left the same
// trap for the next dialog. BasePanel is where "a short centred dialog" is
// actually defined — card shape and its phone override, backdrop dismissal,
// Escape/focus-trap/focus-restore, header, and the footer Close button every
// other modal has. Composing it means this file states only what is unique to
// it: the question, and the rows. That is also what the panel a picked room
// opens (SummaryGroupPanel) is built on, so the two steps of one gesture now
// share their chrome instead of resembling each other.
//
// No `entityId` is passed on purpose: this dialog is a question about rooms,
// not a device panel, so BasePanel's automatic history section correctly does
// not apply (it is gated on that prop).

import { MapPin } from "lucide-react";
import BasePanel from "@/components/panels/BasePanel";

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
  return (
    <BasePanel
      title="Which room?"
      icon={<MapPin size={22} />}
      className="room-choice-modal"
      onClose={onClose}
    >
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
    </BasePanel>
  );
}
