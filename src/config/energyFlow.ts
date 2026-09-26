// src/config/energyFlow.ts
// Where a period's energy went, as Home Assistant's Energy dashboard draws it
// (owner, 2026-09-26: "the same as what is used in the HA energy dashboard",
// starting at the house rather than Grid → house): the house, then each
// top-level device, then the devices inside each — every level with what its
// devices do NOT account for ("Untracked") — and the same split flattened
// into slices for the pie of every device.
//
// Built on energyModel's split (HA's own hierarchy and numbers); PURE, laid
// out here in viewBox units so the component only draws.
// tests/oracles/energy_flow.mjs drives it with the villa's day.

import { deviceRanking, fmtKwh, fmtPower, type EnergySetup, type EnergySplit, type NodeUse } from "./energyModel";
import { share } from "./energyObservations";

/**
 * A device worth showing: above what "0.00 kWh" rounds away. ONE threshold for
 * the flow, the pie, the history chart and the ranking — it was written six
 * times in two files (round 9, 2.496.142).
 */
export const SHOWN_KWH = 0.005;
export const shows = (kwh: number): boolean => kwh > SHOWN_KWH;

export type FlowKind = "house" | "device" | "untracked" | "other";

export interface FlowNode {
  id: string;
  label: string;
  kwh: number;
  kind: FlowKind;
  /** Its colour class (a stable palette slot). */
  cls: string;
  /** Its power statistic, for "now". */
  rateId: string | null;
  /** The devices an "Other" stands for, and every child for a tooltip. */
  members: { label: string; kwh: number }[];
  children: FlowNode[];
}

/** Top-level devices are e-s0..5; everything below takes the wider palette. */
const PALETTE = 12;

/** The colour of what no device accounts for, and of a folded "Other". */
export const UNTRACKED_CLS = "e-untracked";
export const OTHER_CLS = "e-other";

/**
 * EVERY DEVICE'S COLOUR, ONCE, for the whole Energy window: the flow, the
 * history bars and their legend, and the pie. Decided by HA's own setup —
 * the top-level devices in the order HA lists them (e-s0..5), every device
 * inside one in its order (e-p0..11) — so a device keeps its colour whatever
 * the period and however much it used.
 *
 * ⚠️ FOUR SITES DECIDED IT BY THREE RULES (round 7, 2.496.122): the flow's
 * counter also counted the devices INSIDE a phase, the history legend counted
 * the phases that used something, the pie counted slices by size — Phase A
 * pink in the flow and blue in the chart on the same day.
 */
export function deviceColours(setup: EnergySetup): (id: string) => string {
  const m = new Map<string, string>();
  setup.roots.forEach((r, i) => m.set(r.id, `e-s${i % 6}`));
  setup.devices.filter((d) => !m.has(d.id)).forEach((d, i) => m.set(d.id, `e-p${i % PALETTE}`));
  return (id) => m.get(id) ?? UNTRACKED_CLS;
}

/**
 * The tree. A child worth less than `otherBelow` of the house's total is
 * folded, with its small siblings, into one "Other" — too thin to carry a
 * label (HA does the same); one small child alone keeps its name.
 */
export function flowTree(split: EnergySplit, house: string, colourOf: (id: string) => string, otherBelow = 0.01): FlowNode {
  const tracked = split.roots.reduce((a, r) => a + r.kwh, 0);
  const total = Math.max(split.used, tracked);
  const cut = total * otherBelow;
  const untracked = (parentId: string, kwh: number): FlowNode =>
    ({ id: `${parentId}/_untracked`, label: "Untracked", kwh, kind: "untracked", cls: UNTRACKED_CLS, rateId: null, members: [], children: [] });
  const kids = (parentId: string, uses: NodeUse[], rest: number, depth: number): FlowNode[] => {
    const nodes = uses.filter((u) => shows(u.kwh)).map((u) => node(u, depth));
    const small = nodes.filter((n) => n.kwh < cut);
    const kept = small.length >= 2 ? nodes.filter((n) => n.kwh >= cut) : nodes;
    const out = [...kept];
    if (small.length >= 2) {
      out.push({
        id: `${parentId}/_other`, label: `Other (${small.length})`, kwh: small.reduce((a, n) => a + n.kwh, 0),
        kind: "other", cls: OTHER_CLS, rateId: null, members: small.map((n) => ({ label: n.label, kwh: n.kwh })), children: [],
      });
    }
    if (shows(rest)) out.push(untracked(parentId, rest));
    return out;
  };
  const node = (u: NodeUse, depth: number): FlowNode => {
    const cls = colourOf(u.node.id);
    const children = u.children.length ? kids(u.node.id, u.children, u.untracked, depth + 1) : [];
    return {
      id: u.node.id, label: u.node.name, kwh: u.kwh, kind: "device", cls, rateId: u.node.rateId,
      members: children.map((c) => ({ label: c.label, kwh: c.kwh })), children,
    };
  };
  const children = kids("_house", split.roots, split.untracked, 1);
  return { id: "_house", label: house, kwh: total, kind: "house", cls: "e-house", rateId: null, members: children.map((c) => ({ label: c.label, kwh: c.kwh })), children };
}

/**
 * The tree as rows, in READING order — each device followed by what is inside
 * it — for a phone, where the diagram's text would be 7 px. The layout's
 * boxes are in COLUMN order (every top-level device, then everything inside
 * any of them), which on a phone put the pool pump under phase A when it is
 * inside phase C (owner's screenshot, 2026-09-26).
 */
export function flowRows(tree: FlowNode): { node: FlowNode; depth: number }[] {
  const out: { node: FlowNode; depth: number }[] = [];
  const walk = (n: FlowNode, depth: number) => { out.push({ node: n, depth }); n.children.forEach((c) => walk(c, depth + 1)); };
  walk(tree, 0);
  return out;
}

export interface FlowBox { node: FlowNode; depth: number; x: number; y: number; h: number }
export interface FlowLink { from: FlowBox; to: FlowBox; sy: number; dy: number; w: number }
export interface FlowLayout { W: number; H: number; boxes: FlowBox[]; links: FlowLink[]; nodeW: number }

/**
 * Columns by depth, each node a bar sized by its kWh (at least `slot` of
 * room, so a label fits beside it), its links leaving the parent in order and
 * arriving at the child. The last column keeps `labelW` on its right for the
 * labels. Heights in viewBox units; `bar` is the house's height.
 */
export function flowLayout(tree: FlowNode, o: { W?: number; bar?: number; slot?: number; gap?: number; nodeW?: number; labelW?: number } = {}): FlowLayout {
  const W = o.W ?? 800, bar = o.bar ?? 150, slot = o.slot ?? 20, gap = o.gap ?? 4, nodeW = o.nodeW ?? 12, labelW = o.labelW ?? 250;
  const scale = bar / Math.max(1e-6, tree.kwh);
  const hOf = (n: FlowNode) => Math.max(2, Math.max(n.kwh, n.children.reduce((a, c) => a + c.kwh, 0)) * scale);
  // Depth-first, so each column lists the children in their parents' order.
  const columns: FlowNode[][] = [];
  const depthOf = new Map<FlowNode, number>();
  const visit = (n: FlowNode, d: number) => {
    (columns[d] ??= []).push(n);
    depthOf.set(n, d);
    n.children.forEach((c) => visit(c, d + 1));
  };
  visit(tree, 0);
  const D = columns.length - 1;
  const colX = (d: number) => (D === 0 ? 0 : (d / D) * (W - labelW - nodeW));
  const boxOf = new Map<FlowNode, FlowBox>();
  let H = 0;
  columns.forEach((col, d) => {
    let y = 0;
    for (const n of col) {
      const h = hOf(n);
      boxOf.set(n, { node: n, depth: d, x: colX(d), y, h });
      y += Math.max(h, slot) + gap;
    }
    H = Math.max(H, y - gap);
  });
  const links: FlowLink[] = [];
  for (const [n, from] of boxOf) {
    let sy = from.y;
    for (const c of n.children) {
      const to = boxOf.get(c)!;
      const w = Math.max(1, c.kwh * scale);
      links.push({ from, to, sy, dy: to.y, w });
      sy += w;
    }
  }
  return { W, H: Math.max(H, bar), boxes: [...boxOf.values()], links, nodeW };
}

/**
 * The pie of every device, as HA's "Individual devices" draws it: the
 * devices with nothing inside them, each parent's own untracked remainder
 * ("Main Power Phase C (untracked)") and what no device accounts for — which
 * add up to what was used, where the ranking's rows (a parent AND its
 * children) count the same kWh twice. Largest first.
 */
export function energySlices(split: EnergySplit, colourOf: (id: string) => string): { id: string; label: string; kwh: number; cls: string }[] {
  const out: { id: string; label: string; kwh: number; cls: string }[] = [];
  const walk = (u: NodeUse) => {
    if (u.children.length === 0) { out.push({ id: u.node.id, label: u.node.name, kwh: u.kwh, cls: colourOf(u.node.id) }); return; }
    u.children.forEach(walk);
    // A parent's own remainder takes the PARENT's colour, as HA's pie does.
    out.push({ id: `${u.node.id}/_untracked`, label: `${u.node.name} (untracked)`, kwh: u.untracked, cls: colourOf(u.node.id) });
  };
  split.roots.forEach(walk);
  out.push({ id: UNTRACKED_ID, label: "Untracked", kwh: split.untracked, cls: UNTRACKED_CLS });
  return out.filter((s) => shows(s.kwh)).sort((a, b) => b.kwh - a.kwh);
}

/** The pie's ring slice from `from` to `to` (turns, from the top, clockwise)
 *  between radii r0 and r1 about (c, c), as an SVG path. A whole turn is two
 *  halves, since one arc cannot close. */
export function ringArc(from: number, to: number, r0: number, r1: number, c: number): string {
  if (to - from >= 0.9999) return `${ringArc(0, 0.5, r0, r1, c)} ${ringArc(0.5, 1, r0, r1, c)}`;
  const [x0, y0] = ringPoint(from, r1, c), [x1, y1] = ringPoint(to, r1, c), [x2, y2] = ringPoint(to, r0, c), [x3, y3] = ringPoint(from, r0, c);
  const big = to - from > 0.5 ? 1 : 0;
  return `M${x0} ${y0} A${r1} ${r1} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${big} 0 ${x3} ${y3} Z`;
}
/** A point on the ring, `f` turns from the top, clockwise. */
export function ringPoint(f: number, r: number, c: number): [number, number] {
  const a = f * 2 * Math.PI - Math.PI / 2;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
}

/** One row of the history chart's legend, and the key of its segment. */
export interface DeviceSeries { id: string; label: string; cls: string }

/** The history chart's series: each top-level device that used something
 *  worth showing over the period, in HA's order, then what none accounts for. */
export function deviceSeries(whole: EnergySplit, colourOf: (id: string) => string): DeviceSeries[] {
  return [
    ...whole.roots.filter((r) => shows(r.kwh)).map((r) => ({ id: r.node.id, label: r.node.name, cls: colourOf(r.node.id) })),
    { id: UNTRACKED_ID, label: "Untracked", cls: UNTRACKED_CLS },
  ];
}

/** One bucket's stacked segments for those series (0 for a device silent in it). */
export function seriesSegs(series: readonly DeviceSeries[], bucket: EnergySplit): { key: string; label: string; v: number; cls: string }[] {
  return series.map((s) => ({
    key: s.id, label: s.label, cls: s.cls,
    v: s.id === UNTRACKED_ID ? bucket.untracked : bucket.roots.find((x) => x.node.id === s.id)?.kwh ?? 0,
  }));
}

/** The id every "what no device accounts for" row carries. */
export const UNTRACKED_ID = "_untracked";

/** A row of "Every device". */
export interface DeviceRow { id: string; label: string; kwh: number; cls: string; untracked: boolean }

/** Every device ranked (a meter AND the devices inside it — as HA's list),
 *  each worth showing, then what none accounts for. */
export function rankRows(whole: EnergySplit, colourOf: (id: string) => string): DeviceRow[] {
  return [
    ...deviceRanking(whole).filter((u) => shows(u.kwh))
      .map((u) => ({ id: u.node.id, label: u.node.name, kwh: u.kwh, cls: colourOf(u.node.id), untracked: false })),
    ...(shows(whole.untracked) ? [{ id: UNTRACKED_ID, label: "Untracked", kwh: whole.untracked, cls: UNTRACKED_CLS, untracked: true }] : []),
  ];
}

/** The house's power now: the sum of its top-level devices' live power —
 *  undefined when none of them has a power statistic. */
export function houseKw(split: EnergySplit, rateKw: (id: string | null) => number | undefined): number | undefined {
  return split.roots.reduce<number | undefined>((a, r) => {
    const k = rateKw(r.node.rateId);
    return k === undefined ? a : (a ?? 0) + k;
  }, undefined);
}

/** A flow node's "now" aside ("1.2 kW now"), or "" for none. */
export function flowNow(n: FlowNode, split: EnergySplit, rateKw: (id: string | null) => number | undefined): string {
  const kw = n.kind === "house" ? houseKw(split, rateKw) : n.kind === "device" ? rateKw(n.rateId) : undefined;
  return kw === undefined ? "" : `${fmtPower(kw)} now`;
}

/** The flow's tooltip, line by line: the node, its share, its power now, up
 *  to eight of what is inside it, and what "Untracked" means. */
export function flowTipRows(n: FlowNode, tree: FlowNode, now: string): { key: string; text: string }[] {
  return [
    { key: "t", text: `${n.label} · ${fmtKwh(n.kwh)} kWh` },
    ...(n.kind !== "house" ? [{ key: "p", text: `${share(n.kwh, tree.kwh)}% of the ${fmtKwh(tree.kwh)} kWh used` }] : []),
    ...(now ? [{ key: "n", text: now }] : []),
    ...n.members.slice(0, 8).map((m, k) => ({ key: `m${k}`, text: `↳ ${m.label} ${fmtKwh(m.kwh)} kWh` })),
    ...(n.members.length > 8 ? [{ key: "more", text: `↳ ${n.members.length - 8} more` }] : []),
    ...(n.kind === "untracked" ? [{ key: "x", text: "no device meter in Home Assistant accounts for it" }] : []),
  ];
}

/** Each slice's start and end as fractions of the turn, from the top, clockwise. */
export function sliceTurns(values: readonly number[]): { from: number; to: number }[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  let at = 0;
  return values.map((v) => {
    const from = at;
    at += total > 0 ? Math.max(0, v) / total : 0;
    return { from, to: at };
  });
}
