// What a badge DRAWS — measured on Babylon's real GUI controls, laid out on a
// NullEngine (round 9, 2.496.148). The arithmetic oracles (badge_geometry,
// badge_look) pin the numbers; this pins what Babylon does with them.
//
// ⚠️ THREE BADGE DEFECTS WERE FOUND ONLY BY A LOCAL, UNTRACKED BROWSER PROBE
// (tests/_probe/badge): Babylon floors every control's measure on its own, so
// a 0.8 px strut drew as 0 — the value card's chip flush on its edge
// (2.496.137) — and a 20.5 px unit floored a group card and its chips in
// opposite directions: 3 px above each chip, 1 px below (2.496.138). CI could
// not see any of it. GUI layout is pure arithmetic on the controls' measures,
// so it runs here with no browser. The badges are built by the map's OWN
// builders (badgeControls, 2.496.269 — this file used to copy the recipe by
// hand), the geometry and frames from the app's own modules.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
globalThis.OffscreenCanvas ??= class {
  constructor(w, h) { this.width = w; this.height = h; }
  // Layout needs no pixels; a value's width is measured, at 7 px a character.
  getContext() {
    return new Proxy({}, {
      get: (_, k) => (k === "measureText"
        ? (s) => ({ width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 })
        : () => ({})),
    });
  }
};
const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
const { FreeCamera } = await import("@babylonjs/core/Cameras/freeCamera.js");
const { Vector3 } = await import("@babylonjs/core/Maths/math.vector.js");
const { AdvancedDynamicTexture } = await import("@babylonjs/gui/2D/advancedDynamicTexture.js");
const { Rectangle } = await import("@babylonjs/gui/2D/controls/rectangle.js");
const { StackPanel } = await import("@babylonjs/gui/2D/controls/stackPanel.js");
const { Image } = await import("@babylonjs/gui/2D/controls/image.js");
const { TextBlock } = await import("@babylonjs/gui/2D/controls/textBlock.js");
const { arrange, MAX_GRID_CHIPS } = await import("@/babylon/badgeCard");
const { buildCardBadge, growGroupCard, placeGroupCard, setValueParts } = await import("@/babylon/badgeControls");
const { badgeMetricsFor } = await import("@/babylon/badgeMetrics");
const { glyphDrawPx } = await import("@/babylon/badgeLayout");
const { badgeRing, applyBadgeFrame } = await import("@/babylon/badgeLook");


const engine = new NullEngine({ renderWidth: 1600, renderHeight: 1200 });
// A font's vertical metrics come from a DOM span; fixed ones stand in.
engine.getFontOffset = () => ({ ascent: 10, height: 13, descent: 3 });
const scene = new Scene(engine);
new FreeCamera("c", new Vector3(0, 0, -5), scene);
const ui = AdvancedDynamicTexture.CreateFullscreenUI("ui", true, scene);
const layout = () => { ui.markAsDirty(); scene.render(); };
const M = (c) => c._currentMeasure;
const RESTING = { ring: "#ccc", ringHairline: true };
const ALERT = { ring: "#c33" };
let slot = 0;
const place = (c) => { c.horizontalAlignment = 0; c.verticalAlignment = 0; c.left = `${(slot % 6) * 250 + 10}px`; c.top = `${Math.floor(slot / 6) * 150 + 10}px`; slot++; ui.addControl(c); };

/** A lone card badge, built by the map's OWN builder (badgeControls.buildCardBadge,
 *  2.496.269 — this file used to rebuild it by hand, a twin that could drift):
 *  framed, placed, and its value shown the way the map shows one. */
function card(m, surface, value) {
  const g = glyphDrawPx(m, true);
  const glyph = new Image("g");
  const cc = buildCardBadge("t", m, g, glyph);
  applyBadgeFrame(cc.badge, badgeRing(surface, m.cardHeightPx, m), m.cardHeightPx);
  place(cc.badge);
  if (value) {
    const t = new TextBlock("t", value); t.fontSize = m.cardHeightPx * 0.4; t.resizeToFit = true;
    cc.valueWrap.addControl(t);
    setValueParts(cc, true);
  }
  return { badge: cc.badge, glyph };
}

/** A group's summary card, laid out by the map's own pools and layout
 *  (badgeControls.growGroupCard / placeGroupCard) from badgeCard.arrange. */
function group(m, n, perCard) {
  const lay = arrange(n, m.cardHeightPx, m.cardIconFraction, m.minGapPx, undefined, 0, perCard);
  const host = new Rectangle("h"); host.thickness = 0; host.background = ""; host.clipChildren = false;
  place(host);
  const c = { container: host, cards: [], chips: [], zones: [] };
  growGroupCard(c, lay.cells, lay.cards.length);
  placeGroupCard(c, lay, lay.cells);
  for (const r of c.cards) applyBadgeFrame(r, badgeRing(RESTING, m.cardHeightPx, m), lay.pitch);
  return { lay, subs: c.cards, chips: c.chips };
}

const built = [];
for (const cls of ["coarse", "fine"]) {
  const m = badgeMetricsFor(cls);
  built.push({ cls, m, bare: card(m, RESTING), alert: card(m, ALERT), valued: card(m, RESTING, "26°"),
    groups: [2, 3, 4].map((n) => ({ n, perCard: n === 4 ? MAX_GRID_CHIPS : 2, ...group(m, n, n === 4 ? MAX_GRID_CHIPS : 2) })) });
}
layout();

const margins = (outer, inner) => {
  const o = M(outer), i = M(inner);
  return { L: i.left - o.left, R: o.left + o.width - i.left - i.width, T: i.top - o.top, B: o.top + o.height - i.top - i.height };
};

for (const b of built) {
  console.log(`\n  ${b.cls} (card ${b.m.cardHeightPx} px):`);
  const bare = margins(b.bare.badge, b.bare.glyph);
  ck("a bare card's icon is centred: the same margin on all four sides", bare.L === bare.R && bare.T === bare.B && bare.L === bare.T, bare);
  const alert = margins(b.alert.badge, b.alert.glyph);
  ck("  ...at the alert ring's weight too (the ring is drawn over the margins, never moves the icon)", JSON.stringify(alert) === JSON.stringify(bare), alert);
  const v = margins(b.valued.badge, b.valued.glyph);
  ck("a card with a value: its icon is off the left edge (2.496.137: flush at 0) and centred top to bottom", v.L >= 1 && v.T === v.B, v);
  for (const gr of b.groups) {
    const bad = [];
    gr.chips.forEach((chip, k) => {
      const ci = gr.lay.cards.findIndex((c, i) => k >= c.first && (i === gr.lay.cards.length - 1 || k < gr.lay.cards[i + 1].first));
      const c = gr.lay.cards[ci], sub = M(gr.subs[ci]), ch = M(chip);
      const i = k - c.first, row = Math.floor(i / c.cols), col = i % c.cols, p = gr.lay.pitch;
      const above = ch.top - (sub.top + row * p), below = sub.top + (row + 1) * p - ch.top - ch.height;
      const beside = ch.left - (sub.left + col * p);
      if (!(above === below && beside === above && above >= 1)) bad.push({ k, above, below, beside });
    });
    ck(`a group of ${gr.n} (${gr.lay.cards.length} card${gr.lay.cards.length > 1 ? "s" : ""}): every chip centred in its cell — as far from its card's edge above as below and beside (2.496.138: 3 px above, 1 below)`, bad.length === 0, bad);
  }
}

{
  const { readFileSync } = await import("node:fs");
  const ev = readFileSync(new URL("../../src/babylon/EntityVisuals.ts", import.meta.url), "utf8");
  console.log("\n  the map draws with the same builders:");
  ck("its card is buildCardBadge's, its group card growGroupCard's and placeGroupCard's, its value toggle setValueParts'",
     /= buildCardBadge\(entityId, m, glyphPx, glyph\)\);/.test(ev) && /growGroupCard\(c, drawn, lay\.cards\.length\);/.test(ev)
     && /placeGroupCard\(c, lay, drawn\);/.test(ev) && /setValueParts\(lbl, on\);/.test(ev)
     && !/private growGrid|new StackPanel\(`lbl_row_/.test(ev));
}
done("✅ every badge draws centred, as Babylon lays it out");
