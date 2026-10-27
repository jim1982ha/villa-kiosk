// src/babylon/placementReport.ts
// One layout pass as a REPORT an agent can read and REPLAY: what the pass was given (its frame of values, the shown
// badges with their boxes, the glass), what the self-check found (placementCheck: failures, counts, the pairs by id),
// and the camera. `?debug=place` copies it from the debug box ("Copy placement report") and sends it to the telemetry
// ring (EntityVisuals, throttled); tools/placement-probe.mjs replays it through the real pass offline.
//
// ⚠️ TWO OVERLAP ROUNDS WERE FIXED BLIND (2.496.552-553): the check's findings printed only on the phone, so neither
// fix was confirmed against the pose the owner saw, and the second cause (a tapped room) is still an inference. A
// report carries the pass's whole input, so the replay runs the same code on the same values.
//
// The snapshot the check reads is built HERE, for the live pass and the replay alike: one projection of what a
// pass drew, never two that could disagree.

import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { roomKey } from "@/config/roomKey";
import { cardLift } from "./badgeCard";
import { drawnThisPass } from "./badgeFrame";
import { PlacementCheck, type PassSnapshot, type PlacementCounts, type PlacementFindings, type ScreenBox } from "./placementCheck";
import {
  PlacementPass, glassScratch, layoutOf, placementItems, roomOfEntity,
  type PassClearance, type PendingEntityGroup, type PlacementFrame, type PassResult, type ShownLabel,
} from "./placementPass";
import type { RoomChip } from "./roomChips";
import { RoomFocus } from "./roomFocus";
import type { LabelControls } from "./EntityVisuals";

type Box = { halfW: number; halfH: number; cy: number };

/** What one pass drew, for the check: every shown badge, every surviving card, every chip. */
export interface SnapshotInput {
  shown: readonly ShownLabel[];
  boxes: readonly Box[];
  /** The cards that SURVIVED placement (a dropped one still leaves its members marked covered). */
  groups: readonly PendingEntityGroup[];
  chips: readonly RoomChip[];
  pass: PlacementPass;
  frame: PlacementFrame;
  /** Whether badge `i` is drawn: the renderer's own answer live (container.isVisible), the pass's in a replay. */
  drawn: (i: number) => boolean;
  /** Badge `i`'s X offset as drawn (a badge never moves: the check counts any). Absent: 0, as the pass writes it. */
  offsetX?: (i: number) => number;
  /** The renderer's view-projection matrix and viewport. */
  tm: Matrix;
  vp: Viewport;
  chipDrawnWidth: (key: string) => number | undefined;
  overlapAllow: number;
  solve: PassSnapshot["solve"];
}

/** The check's snapshot of a pass, in TRUE perspective (Vector3.ProjectToRef): what was painted, not what was solved. */
export function passSnapshot(i: SnapshotInput): PassSnapshot {
  const { shown, boxes, frame, pass, tm, vp } = i;
  const focus = frame.focus.rooms;
  const covered = new Set<string>();
  for (const g of i.groups) for (const m of g.members) covered.add(shown[m].id);
  const badges = shown.map((s, k) => {
    const room = roomKey(roomOfEntity(frame.rooms, s.id));
    return {
      id: s.id,
      box: { cx: s.x, cy: s.y + boxes[k].cy, hw: boxes[k].halfW, hh: boxes[k].halfH },
      visible: i.drawn(k), inFront: s.inFront, occluded: s.occluded,
      exempt: focus.has(room), roomChipped: !!pass.roomClustered.get(room),
      covered: covered.has(s.id), offsetX: i.offsetX?.(k) ?? 0,
    };
  });
  // A card is drawn ENTIRELY ABOVE its anchor — updateEntityGroups sets
  // linkOffsetYInPixels = -cardLift(lay, scale) so the card's bottom edge lands
  // on the anchor, exactly as a badge's does. The LAYOUT models the same card as
  // a disc centred ON the anchor (cardHalfOf), a documented asymmetry; using the
  // layout's model here would report overlaps nobody can see and miss the ones
  // they can.
  const cards: { box: ScreenBox; ink: ScreenBox; focused: boolean; key: string }[] = [];
  const p = new Vector3();
  for (const g of i.groups) {
    const lay = layoutOf(frame, g, g.members.length);
    p.set(g.wx, g.wy, g.wz);
    Vector3.ProjectToRef(p, Matrix.IdentityReadOnly, tm, vp, p);
    if (!(p.z >= 0 && p.z <= 1)) continue;
    const hw = (lay.width / 2) * frame.scale;
    const hh = cardLift(lay, frame.scale);
    // The square INSCRIBED in the card: a badge under it is BURIED, one under the
    // rest of the box only under the card's END (the self-check's two counters).
    const inner = Math.min(hw, hh);
    const box = { cx: p.x, cy: p.y - hh, hw, hh };
    cards.push({ box, ink: { cx: box.cx, cy: box.cy, hw: inner, hh: inner }, focused: g.focused, key: g.key });
  }
  return {
    viewport: { x: vp.x, y: vp.y, width: vp.width, height: vp.height }, badges, cards, chips: i.chips,
    chipDrawnWidth: i.chipDrawnWidth, chipScale: frame.scale, minGapPx: frame.metrics.minGapPx,
    overlapAllow: i.overlapAllow, solve: i.solve,
  };
}

/** One shown badge as the pass reads it: identity, rank inputs, anchor and screen point. */
export interface ReportBadge {
  id: string; type: string; category: string;
  x: number; y: number; wx: number; wy: number; wz: number; ty?: number;
  inFront: boolean; occluded: boolean;
}

/** A pass as plain values: the input to replay it, and what the check found on the device. */
export interface PlacementReport {
  kind: "vesta-placement";
  v: 1;
  /** The build that drew it. */
  app?: string;
  viewport: { x: number; y: number; width: number; height: number };
  /** The view-projection matrix, 16 numbers. */
  tm: number[];
  frame: Omit<PlacementFrame, "focus" | "exempt" | "chips"> & {
    focus: string[]; exempt: string[];
    chips: { members: { id: string; room: string; pos: { x: number; y: number; z: number } }[];
             text: PlacementFrame["chips"]["text"]; budget: number };
  };
  shown: ReportBadge[];
  boxes: Box[];
  clearance: PassClearance;
  suppressOthers: boolean;
  /** Each chip's width as the GUI laid it out, CSS px (for the estimate check). */
  chipWidths: Record<string, number>;
  overlapAllow: number;
  mode: PassSnapshot["solve"]["mode"];
  drawableMax: number;
  found: Pick<PlacementFindings, "failures" | "pairs" | "lines" | "chipWidthErr" | "orderDependent">
    & { counts: Partial<PlacementCounts> };
}

/** The non-zero counts of a finding, so a report says only what happened. */
function countsOf(f: PlacementFindings): Partial<PlacementCounts> {
  const out: Partial<PlacementCounts> = {};
  const keys: (keyof PlacementCounts)[] = [
    "overlaps", "focusOverlaps", "buried", "overhung", "focusCardHits", "summaryOverlaps", "summaryFocusOverlaps",
    "chipHits", "chipHitsFocused", "chipPairs", "moved", "leaked", "orphaned", "byWall"];
  for (const k of keys) if (f[k]) out[k] = f[k];
  return out;
}

/** A pass and its findings as one report (see PlacementReport). Rounded, so a report fits the telemetry ring. */
export function placementReport(a: {
  app?: string; frame: PlacementFrame; shown: readonly ShownLabel[]; boxes: readonly Box[];
  clearance: PassClearance; suppressOthers: boolean; snapshot: PassSnapshot; found: PlacementFindings;
  chipKeys: readonly string[]; tm: Matrix;
}): PlacementReport {
  const r = (n: number) => Math.round(n * 100) / 100;
  const { frame: f, snapshot: s } = a;
  const rooms: Record<string, string | undefined> = {};
  for (const b of a.shown) rooms[b.id] = f.rooms[b.id];
  const chipWidths: Record<string, number> = {};
  for (const k of a.chipKeys) {
    const w = s.chipDrawnWidth(k);
    if (typeof w === "number" && w > 0) chipWidths[k] = r(w);
  }
  return {
    kind: "vesta-placement", v: 1, app: a.app,
    viewport: s.viewport,
    tm: Array.from(a.tm.m),
    frame: {
      metrics: f.metrics, summary: f.summary, perCardCap: f.perCardCap, rooms,
      focus: [...f.focus.rooms], exempt: [...f.exempt], scale: f.scale, cardBudget: f.cardBudget, cellCap: f.cellCap,
      chips: {
        members: f.chips.members.map((m) => ({ id: m.id, room: m.room, pos: { x: r(m.pos.x), y: r(m.pos.y), z: r(m.pos.z) } })),
        text: f.chips.text, budget: f.chips.budget,
      },
    },
    shown: a.shown.map((b) => ({
      id: b.id, type: b.lbl.type, category: b.lbl.category, x: r(b.x), y: r(b.y), wx: r(b.wx), wy: r(b.wy), wz: r(b.wz),
      ...(b.ty === undefined ? {} : { ty: r(b.ty) }), inFront: b.inFront, occluded: b.occluded,
    })),
    boxes: a.boxes.map((b) => ({ halfW: r(b.halfW), halfH: r(b.halfH), cy: r(b.cy) })),
    clearance: a.clearance, suppressOthers: a.suppressOthers, chipWidths,
    overlapAllow: s.overlapAllow, mode: s.solve.mode, drawableMax: s.solve.drawableMax,
    found: {
      failures: a.found.failures, counts: countsOf(a.found), pairs: a.found.pairs, lines: a.found.lines,
      chipWidthErr: r(a.found.chipWidthErr), orderDependent: a.found.orderDependent,
    },
  };
}

/** What a replay changes: another focus (room keys; [] for none) and whether the other rooms are held at chips. */
export interface ReplayOptions { focus?: readonly string[]; suppressOthers?: boolean }

/** Run a report's pass again through the REAL PlacementPass and PlacementCheck, at the pose it was captured at. */
export function replayPlacement(rep: PlacementReport, opt: ReplayOptions = {}):
  { found: PlacementFindings; snapshot: PassSnapshot; result: PassResult; pass: PlacementPass } {
  const tm = Matrix.FromArray(rep.tm);
  const vp = new Viewport(rep.viewport.x, rep.viewport.y, rep.viewport.width, rep.viewport.height);
  const focus = new RoomFocus();
  focus.grant(opt.focus ? [...opt.focus] : rep.frame.focus);
  const frame: PlacementFrame = {
    ...rep.frame, focus, exempt: new Set(opt.focus ?? rep.frame.exempt),
    chips: { ...rep.frame.chips, view: { tm, vp } },
  };
  // The pass reads a badge's rank inputs from its controls, and nothing else of them.
  const shown: ShownLabel[] = rep.shown.map((b) => ({
    id: b.id, lbl: { type: b.type, category: b.category, valueWrap: { isVisible: false } } as unknown as LabelControls,
    x: b.x, y: b.y, wx: b.wx, wy: b.wy, wz: b.wz, ty: b.ty, sx: 0, sy: 0, sz: 0, inFront: b.inFront, occluded: b.occluded,
  }));
  const pass = new PlacementPass();
  const result = pass.run(frame, shown, rep.boxes, rep.clearance, opt.suppressOthers ?? rep.suppressOthers);
  const snapshot = passSnapshot({
    shown, boxes: rep.boxes, groups: result.pending, chips: result.chips, pass, frame,
    drawn: (k) => drawnThisPass(shown[k], pass), tm, vp,
    chipDrawnWidth: (k) => rep.chipWidths[k], overlapAllow: rep.overlapAllow,
    solve: {
      items: placementItems(shown, rep.boxes, rep.clearance, frame.rooms, focus.rooms, [], glassScratch()),
      gap: rep.clearance.gap, mode: rep.mode, drawableMax: rep.drawableMax,
    },
  });
  return { found: new PlacementCheck().check(snapshot), snapshot, result, pass };
}

/** How often a failing pass may reach the telemetry ring: the ring is shared by every device, so never unthrottled
 *  (rules/kiosk-code.md#performance-instruments). */
export const PLACEMENT_TELEMETRY_MS = 60_000;
/** Under the proxy's TELEMETRY_MAX_BODY (64 kB), with room for the stamps. */
export const PLACEMENT_TELEMETRY_BYTES = 60_000;

/** One telemetry event: the report, whole when it fits (replayable), else its findings only. */
export interface PlacementEvent { placement: PlacementReport; whole: boolean }

/**
 * Sends a FAILING pass's report to the telemetry ring: at most once a PLACEMENT_TELEMETRY_MS, and only when what
 * failed changed (the same overlap held on screen is one event, not one a minute).
 */
export class PlacementTelemetry {
  private last = -Infinity;
  private said = "";
  private readonly send: (e: PlacementEvent) => void;
  constructor(send: (e: PlacementEvent) => void) { this.send = send; }

  /** Offer a pass's report at time `now` (ms). True when it was sent. */
  offer(rep: PlacementReport, now: number): boolean {
    if (rep.found.failures === 0) return false;
    const what = JSON.stringify([rep.found.counts, rep.found.pairs]);
    if (what === this.said || now - this.last < PLACEMENT_TELEMETRY_MS) return false;
    this.last = now;
    this.said = what;
    const whole = new TextEncoder().encode(JSON.stringify(rep)).length <= PLACEMENT_TELEMETRY_BYTES;
    this.send({
      placement: whole ? rep : { ...rep, shown: [], boxes: [], frame: { ...rep.frame, chips: { ...rep.frame.chips, members: [] } } },
      whole,
    });
    return true;
  }
}
