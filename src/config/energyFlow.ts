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

import type { EnergySplit, NodeUse } from "./energyModel";

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

/**
 * The tree. A child worth less than `otherBelow` of the house's total is
 * folded, with its small siblings, into one "Other" — too thin to carry a
 * label (HA does the same); one small child alone keeps its name.
 */
export function flowTree(split: EnergySplit, house: string, otherBelow = 0.01): FlowNode {
  const tracked = split.roots.reduce((a, r) => a + r.kwh, 0);
  const total = Math.max(split.used, tracked);
  const cut = total * otherBelow;
  let slot = 0;
  const untracked = (parentId: string, kwh: number): FlowNode =>
    ({ id: `${parentId}/_untracked`, label: "Untracked", kwh, kind: "untracked", cls: "e-untracked", rateId: null, members: [], children: [] });
  const kids = (parentId: string, uses: NodeUse[], rest: number, depth: number): FlowNode[] => {
    const nodes = uses.filter((u) => u.kwh > 0.005).map((u) => node(u, depth));
    const small = nodes.filter((n) => n.kwh < cut);
    const kept = small.length >= 2 ? nodes.filter((n) => n.kwh >= cut) : nodes;
    const out = [...kept];
    if (small.length >= 2) {
      out.push({
        id: `${parentId}/_other`, label: `Other (${small.length})`, kwh: small.reduce((a, n) => a + n.kwh, 0),
        kind: "other", cls: "e-other", rateId: null, members: small.map((n) => ({ label: n.label, kwh: n.kwh })), children: [],
      });
    }
    if (rest > 0.005) out.push(untracked(parentId, rest));
    return out;
  };
  const node = (u: NodeUse, depth: number): FlowNode => {
    const cls = depth === 1 ? `e-s${slot % 6}` : `e-p${slot % PALETTE}`;
    slot++;
    const children = u.children.length ? kids(u.node.id, u.children, u.untracked, depth + 1) : [];
    return {
      id: u.node.id, label: u.node.name, kwh: u.kwh, kind: "device", cls, rateId: u.node.rateId,
      members: children.map((c) => ({ label: c.label, kwh: c.kwh })), children,
    };
  };
  slot = 0;
  const children = kids("_house", split.roots, split.untracked, 1);
  return { id: "_house", label: house, kwh: total, kind: "house", cls: "e-house", rateId: null, members: children.map((c) => ({ label: c.label, kwh: c.kwh })), children };
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
export function energySlices(split: EnergySplit): { id: string; label: string; kwh: number }[] {
  const out: { id: string; label: string; kwh: number }[] = [];
  const walk = (u: NodeUse) => {
    if (u.children.length === 0) { out.push({ id: u.node.id, label: u.node.name, kwh: u.kwh }); return; }
    u.children.forEach(walk);
    out.push({ id: `${u.node.id}/_untracked`, label: `${u.node.name} (untracked)`, kwh: u.untracked });
  };
  split.roots.forEach(walk);
  out.push({ id: "_untracked", label: "Untracked", kwh: split.untracked });
  return out.filter((s) => s.kwh > 0.005).sort((a, b) => b.kwh - a.kwh);
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

/** The pie's legend shows this many devices a page (owner, 2026-09-26). */
export const LEGEND_PAGE = 10;

/** One page of a legend of `total` rows: which rows, and how many pages. A
 *  page past the end (the period changed and has fewer devices) is the last. */
export function legendPage(total: number, page: number, size = LEGEND_PAGE): { from: number; to: number; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { from: p * size, to: Math.min(total, (p + 1) * size), page: p, pages };
}
