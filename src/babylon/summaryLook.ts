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

import type { BadgeMark, DeviceLook, LinkPill } from "@/utils/deviceActivity";
import { groupLook } from "@/utils/deviceActivity";
import type { DeviceSurfaceState } from "@/config/EntityCategories";
import { formatCountBadge } from "@/utils/countBadge";
import { chipFolds, chipSlots, chipToggleLabel, type RoomChip } from "./roomChips";

/** Which of the three summary surfaces a card or a chip wears — "alert" (red:
 *  needs attention), "active" (the neutral "a member is on" ring) or "rest".
 *  The surfaces themselves are categorySurface's. */
export type SummaryFrame = "alert" | "active" | "rest";

export function summaryFrame(ring: { ringRed: boolean; ringOn: boolean }): SummaryFrame {
  return ring.ringRed ? "alert" : ring.ringOn ? "active" : "rest";
}

/** One device a group card stands for, as the map holds it. */
interface CardMember {
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

interface GroupCardModel {
  /** Every member is behind a wall while walking: the card is behind it too. */
  hidden: boolean;
  entityIds: string[];
  /** Cells drawn, as the layout counted them (placementPass.drawnCells). */
  drawn: number;
  /** The grid the card's chips are laid out on — 0 for a count badge. */
  gridN: number;
  /** One per drawn cell, in member order: what that cell's badge shows — its face, its top-right mark, its bottom-right (linked) pill. */
  cells: { id: string; face: DeviceSurfaceState; mark: BadgeMark | null; linkPill: LinkPill }[];
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
      ? members.slice(0, drawn).map((m) => ({ id: m.id, face: m.look.face, mark: m.look.mark, linkPill: m.look.linkPill }))
      : [],
    frame: summaryFrame(ring),
  };
}

/** One printed line of a room chip: one room. */
interface RoomChipLine {
  /** roomKey() of the room — what a tap on this line names. */
  key: string;
  /** The room as spelt. */
  room: string;
  /** What is printed: the room's name, truncated on its own. */
  label: string;
  /** This room's devices. */
  entityIds: string[];
  /** The line's pill number, capped ("99+"): this room's devices only. */
  count: string;
  /** The line's pill colour: this room's HEALTH (roomHealth), as its own chip would show. */
  health: RoomHealth;
}

export interface RoomChipModel {
  /** Every device it stands for is behind a wall while walking. */
  hidden: boolean;
  entityIds: string[];
  /** The room a tap names, and every room a merged chip swallowed. */
  displayName: string;
  roomNames: string[];
  /** One line per room, top to bottom (roomChips.orderLines), each with its
   *  own name, count and health. One line for an unmerged chip. */
  lines: RoomChipLine[];
  /** The lines drawn, top to bottom (roomChips.chipSlots): the first one
   *  folded, every one open or when it does not fold. */
  slots: number[];
  /** The pill on the bottom border that opens a folded chip or folds an open
   *  one; null when it does not fold. */
  toggle: ChipToggle | null;
}

/** A folded chip's `+N` pill, or an open one's `−`. */
export interface ChipToggle {
  /** "+N" (the rooms it hides) or "−" (roomChips.chipToggleLabel). */
  label: string;
  /** Its pill's colour: folded, the WORST health among the lines it hides
   *  (red beats amber beats grey), so folding never hides trouble; open,
   *  "ok" — every line shows its own. */
  health: RoomHealth;
}

const HEALTH_ORDER: readonly RoomHealth[] = ["alert", "fault", "unavailable", "ok"];

/** A room's health, worst first: "alert" — something needs attention (a
 *  leak, a jammed lock, a critical device silent; a device in use never is); "fault" — a device has an
 *  open Cockpit fault, check soon; "unavailable" — contact with a device is
 *  lost; "ok" — none of these.
 *
 *  ⚠️ IT WAS TWO SIGNALS ON ONE CHIP. "Needs attention" was the chip's red
 *  BORDER and "lost contact" its count's colour, so a red border sat beside a
 *  green count (owner, 2026-10-04: "confusing"). One place answers "is this
 *  room all right?" now — the number — and the border only says something is
 *  on. Attention outranks lost contact: a leak is the thing to act on first, and a room with both still reads "not all right". */
export type RoomHealth = "alert" | "fault" | "unavailable" | "ok";

/** ⚠️ A FAULT OUTRANKS LOST CONTACT, AS ON THE BADGE (owner, 2026-10-22: badge proposal 2): red act now, amber check
 *  soon, grey no contact — the order of the badges' own corner marks (deviceActivity.MARK_ORDER). */
export function roomHealth(ring: { ringRed: boolean; fault: boolean; unavailable: boolean }): RoomHealth {
  return ring.ringRed ? "alert" : ring.fault ? "fault" : ring.unavailable ? "unavailable" : "ok";
}

/* ⚠️ A ROOM CHIP HAS NO "SOMETHING IS ON" BORDER (owner, 2026-11-14): it
   was a thick light border no device badge has, and the owner chose to drop
   the "on" signal from room chips rather than move it. Every room chip, and
   every row of the "Which room?" list, rests; its health is the count's. */

/** A room chip, from the chip the placement derived (bucketRoomChips, whose
 *  ring is groupLook's count rule, and combineChips). */
export function roomChipModel(chip: RoomChip, walking: boolean, occluded: (id: string) => boolean): RoomChipModel {
  const open = !!chip.open;
  const slots = chipSlots(chip.lines.length, open);
  return {
    hidden: walking && chip.ids.length > 0 && chip.ids.every(occluded),
    entityIds: chip.ids,
    displayName: chip.room,
    roomNames: chip.roomNames,
    lines: chip.lines.map((l) => ({
      key: l.key, room: l.room, label: l.label, entityIds: l.ids,
      count: formatCountBadge(l.ids.length), health: roomHealth(l),
    })),
    slots,
    toggle: chipFolds(chip.lines.length) ? {
      label: chipToggleLabel(chip.lines.length, open),
      health: open ? "ok" : HEALTH_ORDER[Math.min(...chip.lines
        .filter((_, i) => !slots.includes(i)).map((l) => HEALTH_ORDER.indexOf(roomHealth(l))))],
    } : null,
  };
}

/** What ONE room's chip would wear — its pill's colour — from that room's
 *  members' looks (undefined: not yet reported, rings nothing). The same
 *  groupLook count rule bucketRoomChips applies, so a row in the merged
 *  chip's "Which room?" list carries exactly the pill the room's own chip
 *  shows on the map when it stands alone. */
export function roomLook(looks: readonly (DeviceLook | undefined)[]): { health: RoomHealth } {
  return { health: roomHealth(groupLook(looks, { showingDevices: false })) };
}
