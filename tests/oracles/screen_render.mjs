// A screen, RENDERED, in Node (2026-10-14): the alias hook now transpiles a .tsx screen and empties its stylesheet
// imports, so a test can check what a screen SHOWS instead of matching its source text — the regex checks broke at
// every refactor while catching no bug. Two shared pieces here prove the path, through the one harness every drawing
// oracle uses (tests/consistency/screen.mjs).
import { h, draw } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
const { default: InfoTip } = await import("@/components/common/InfoTip");
const { default: Fold } = await import("@/components/settings/Fold");

const tip = draw(h(InfoTip, { label: "How it works" }, "The card's words"));
ck("the (i): a button named for what it explains, closed until tapped", /<button[^>]*class="info-btn"[^>]*aria-label="How it works"[^>]*aria-expanded="false"/.test(tip), tip);
ck("  ...its card is not drawn until it opens (it is placed on the screen then, InfoTip)", !/role="tooltip"/.test(tip) && !tip.includes("The card"), tip);
ck("  ...and not marked open", !/class="info-tip open/.test(tip), tip);

const fold = draw(h(Fold, { summary: "9 groups · 15 suggested" }, h("p", null, "inside")));
ck("a Settings fold opens folded: its one line, not its content", fold.includes("9 groups · 15 suggested") && !fold.includes("inside") && /aria-expanded="false"/.test(fold), fold);

done("✅ a screen can be rendered and read in a test");
