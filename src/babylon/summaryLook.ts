// src/babylon/summaryLook.ts
// What a SUMMARY on the map shows — a group card standing for co-located
// devices, a room chip standing for a crowded room — as a model, before a
// single GUI control is touched. EntityVisuals only draws it.
//
// ⚠️ THE RULES LIVED INSIDE THE DRAWING CODE (to 2.496.244). updateEntityGroups
// and renderChips each decided, inline among a hundred lines of Babylon GUI
// writes, whether the summary was hidden behind a wall, which frame (red /
// "on" / resting) it wore, what each cell's face and ring were and what its
// count pill said — and the only checks on any of it were regexes over
// EntityVisuals' source text (room_chips.mjs), which pass as long as a line is
// spelled the same whatever it does. The rules are here now, pure, and the
// oracle drives values through them; the colours stay where they were
// (categorySurface for the frames, the reporting pill's two hexes in
// EntityVisuals) — only WHICH one is shown is decided here.
//
// Every member's look is utils/deviceActivity's deviceLook, and the ring rule
// is its groupLook — this module adds only what is particular to a summary
// drawn on the map: hiding, cells, the count.
//
// Pure: tests/oracles/summary_look.mjs.

import type { DeviceLook } from "@/utils/deviceActivity";
import { groupLook } from "@/utils/deviceActivity";
import type { DeviceSurfaceState } from "@/config/EntityCategories";
import { formatCountBadge } from "@/utils/countBadge";
import type { RoomChip } from "./roomChips";

/** Which of the three summary surfaces a card or a chip wears — "alert" (red:
 *  needs attention), "active" (the neutral "a member is on" ring) or "rest".
 *  The surfaces themselves are categorySurface's. */
export type SummaryFrame = "alert" | "active" | "rest";

export function summaryFrame(ring: { ringRed: boolean; ringOn: boolean }): SummaryFrame {
  return ring.ringRed ? "alert" : ring.ringOn ? "active" : "rest";
}

/** One device a group card stands for, as the map holds it. */
export interface CardMember {
  id: string;
  /** Its look — painted from a phantom (unavailable) when Home Assistant has
   *  never reported it, so its cell is never blank. */
  look: DeviceLook;
  /** Whether Home Assistant has reported it to the map at all. An unreported
   *  member draws its phantom cell but rings nothing. */
  reported: boolean;
  /** Behind a wall from where the walker stands (the occlusion sweep). */
  occluded: boolean;
}

export interface GroupCardModel {
  /** Every member is behind a wall while walking: the card is behind it too. */
  hidden: boolean;
  entityIds: string[];
  /** Cells drawn, as the layout counted them (placementPass.drawnCells). */
  drawn: number;
  /** The grid the card's chips are laid out on — 0 for a count badge. */
  gridN: number;
  /** One per drawn cell, in member order: what that cell's badge shows. */
  cells: { id: string; face: DeviceSurfaceState; ring: DeviceSurfaceState }[];
  frame: SummaryFrame;
}

/**
 * A group card. `drawn` is the layout's (drawnCells — a card showing two or
 * more cells shows its devices; fewer, it draws a count). `walking`: the
 * first-person view, the only one with an occlusion sweep.
 *
 * Hidden by `every`, not `some`: one visible member and the card still has
 * something to show, and its other cells are the honest statement that those
 * devices are co-located with it — the same rule the room chip applies.
 */
export function groupCardModel(members: readonly CardMember[], drawn: number, walking: boolean): GroupCardModel {
  const showingDevices = drawn >= 2;
  const ring = groupLook(members.map((m) => (m.reported ? m.look : null)), { showingDevices });
  return {
    hidden: walking && members.length > 0 && members.every((m) => m.occluded),
    entityIds: members.map((m) => m.id),
    drawn,
    gridN: showingDevices ? drawn : 0,
    cells: showingDevices
      ? members.slice(0, drawn).map((m) => ({ id: m.id, face: m.look.face, ring: m.look.ring }))
      : [],
    frame: summaryFrame(ring),
  };
}

export interface RoomChipModel {
  /** Every device it stands for is behind a wall while walking. */
  hidden: boolean;
  /** What is printed (the room, truncated, + any "+N"). */
  label: string;
  entityIds: string[];
  /** The room a tap names, and every room a merged chip swallowed. */
  displayName: string;
  roomNames: string[];
  frame: SummaryFrame;
  /** The corner pill's number, capped ("99+"). */
  count: string;
  /** The corner pill's colour, by REPORTING status — a separate signal from
   *  the ring: a room can be fully reporting and have something on. */
  reporting: "unavailable" | "available";
}

/** A room chip, from the chip the placement derived (bucketRoomChips, whose
 *  ring is groupLook's count rule, and combineChips). */
export function roomChipModel(chip: RoomChip, walking: boolean, occluded: (id: string) => boolean): RoomChipModel {
  return {
    hidden: walking && chip.ids.length > 0 && chip.ids.every(occluded),
    label: chip.label,
    entityIds: chip.ids,
    displayName: chip.room,
    roomNames: chip.roomNames,
    frame: summaryFrame(chip),
    count: formatCountBadge(chip.ids.length),
    reporting: chip.unavailable ? "unavailable" : "available",
  };
}

/** What ONE room's chip would wear — its frame and its pill's colour — from
 *  that room's members' looks (undefined: not yet reported, rings nothing).
 *  The same groupLook count rule bucketRoomChips applies, so a row in the
 *  merged chip's "Which room?" list carries exactly the border and pill the
 *  room's own chip shows on the map when it stands alone. */
export function roomLook(looks: readonly (DeviceLook | undefined)[]): Pick<RoomChipModel, "frame" | "reporting"> {
  const ring = groupLook(looks, { showingDevices: false });
  return { frame: summaryFrame(ring), reporting: ring.unavailable ? "unavailable" : "available" };
}
