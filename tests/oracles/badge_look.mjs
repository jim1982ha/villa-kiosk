// A card-style map badge's frame, decided once (src/babylon/badgeLook.ts,
// round 8, 2.496.136) — for the lone card, a group's chips and sub-cards, and
// the room chips. Four paths decided it four ways: a Rectangle ring at
// ringThicknessPx beside a chip that BAKED ≈1.3 px, `ringRed ? … : 1` written
// twice more, the corner 0.2826 on one path and 0.28 on the rest, the group
// chips' own bake size, the dash rule multiplied out by the caller.
import { register } from "node:module";
import { readFileSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
const L = await import("@/babylon/badgeLook");
const { badgeMetricsFor } = await import("@/babylon/badgeMetrics");

let fail = 0;
const ck = (n, ok, got) => { console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}${ok || got === undefined ? "" : `  →  ${JSON.stringify(got)}`}`); if (!ok) fail++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const m = badgeMetricsFor("coarse");

console.log("  the ring:");
const rest = { ring: "#ccc", ringHairline: true }, active = { ring: "#c33" }, gone = { ring: "#b8862e", ringDashed: true };
ck("at rest: a 1 px hairline, whatever the size", L.badgeRing(rest, m.cardHeightPx, m).px === 1 && L.badgeRing(rest, 12, m).px === 1);
ck("active or alerting: the card's state weight on a card", near(L.badgeRing(active, m.cardHeightPx, m).px, m.ringThicknessPx));
ck("  ...in proportion on a smaller chip (a group's 22 px chip rings like the 28 px card, not at 1.3 px)",
   near(L.badgeRing(active, 22, m).px, m.ringThicknessPx * 22 / m.cardHeightPx), L.badgeRing(active, 22, m).px);
const d = L.badgeRing(gone, m.cardHeightPx, m);
ck("unavailable: the state weight, DASHED by the one pattern", d.px === m.ringThicknessPx && near(d.dash[0], d.px * L.RING_DASH[0]) && near(d.dash[1], d.px * L.RING_DASH[1]));
ck("no ring colour: no ring", L.badgeRing({}, 28, m).px === 0 && L.badgeRing({}, 28, m).dash === null);
ck("the bake size is the drawn size in render px (user scale × CSS→GUI)", L.badgeBakePx(22, 1.25, 3) === 82.5);

console.log("\n  one owner for each number:");
const css = readFileSync(new URL("../../src/styles/01-base.css", import.meta.url), "utf8");
const tok = (n) => Number(css.match(new RegExp(`--chip-${n}:\\s*([\\d.]+)px`))[1]);
ck("the corner is the stylesheet's --chip-radius / --chip-size", near(L.BADGE_CORNER_FRACTION, tok("radius") / tok("size")), [L.BADGE_CORNER_FRACTION, tok("radius"), tok("size")]);
const chipSrc = readFileSync(new URL("../../src/config/chipProportions.ts", import.meta.url), "utf8");
const fb = chipSrc.match(/const FALLBACK = \{ size: (\d+), glyph: (\d+), gap: (\d+), radius: (\d+) \}/);
ck("chipProportions' fallbacks ARE the stylesheet's (the glyph said 24 where the sheet says 28)",
   !!fb && +fb[1] === tok("size") && +fb[2] === tok("glyph") && +fb[3] === tok("gap") && +fb[4] === tok("radius"), fb && fb.slice(1));
const src = (f) => readFileSync(new URL(`../../src/babylon/${f}`, import.meta.url), "utf8");
ck("badgeCard reads the ink inset and value margin from badgeLook, not mirrored literals",
   /import \{ BADGE_INSET_CARD, CARD_VALUE_MARGIN_OF_ICON_PAD \} from "\.\/badgeLook";/.test(src("badgeCard.ts")) && !/= 0\.10;|= 1\.5;/.test(src("badgeCard.ts")));
ck("badgeIcons and badgeMetrics re-export them rather than define them",
   /export \{ BADGE_CORNER_FRACTION, BADGE_INSET_CARD, RING_DASH \} from "\.\/badgeLook";/.test(src("badgeIcons.ts"))
     && /export \{ CARD_VALUE_MARGIN_OF_ICON_PAD \} from "\.\/badgeLook";/.test(src("badgeMetrics.ts")));

console.log("\n  every card-style path draws from it:");
const ev = src("EntityVisuals.ts");
ck("the lone card", /const ring = badgeRing\(surface, this\.metrics\.cardHeightPx, this\.metrics\);/.test(ev));
ck("a group's sub-cards", /const frame = badgeRing\(ringRed \? alert : rest, this\.metrics\.cardHeightPx, this\.metrics\);/.test(ev));
ck("a room chip", /const frame = badgeRing\(chip\.ringRed \? chipAlert : chipRest, this\.metrics\.cardHeightPx, this\.metrics\);/.test(ev));
ck("a group's chips: the same ring (in proportion) and the one bake size",
   /badgeRing\(categorySurfaceRinged\(s2\.lbl\.category, face, ring,/.test(ev) && /badgeBakePx\(lay\.chip, this\.iconUserScale, this\.bestCssToGui\(\)\)/.test(ev));
ck("no path writes its own ring weight or corner any more",
   !/ringRed \? this\.metrics\.ringThicknessPx : 1/.test(ev) && !/chip\.radius/.test(ev) && !/RING_DASH\[0\]/.test(ev));

if (fail) { console.log(`\n❌ ${fail} failed`); process.exit(1); }
console.log("\n✅ one frame for every card-style badge");
