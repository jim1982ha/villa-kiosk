// The (i) cards (owner, 2026-10-14): one component for every (i), opened by a TAP on every phone — iOS Safari does not
// focus a tapped <button>, so the old :focus-within-only card never opened on an iPhone — and the Faults tab's (i)
// beside "Raise a fault", saying when a fault opens and closes and how often the list is read again.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { faultTiming } = await import("@/fm/faultTiming");
const { STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } = await import("@/hooks/useStoreRefresh");

const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
const tip = src("components/common/InfoTip.tsx"), css = src("styles/04-modals.css");

console.log("  one (i), opened by a tap:");
ck("a tap toggles it (onClick), not focus alone", /onClick=\{\(\) => setOpen\(\(v\) => hovering\.current \|\| !v\)\}/.test(tip));
ck("a tap outside it or on its card's outside, or Escape, closes it (the popover hook, the card counted inside)",
   /useOutsideClose\(\[ref, pop\], open, \(\) => setOpen\(false\)\)/.test(tip));
ck("its card is out of every window's box (portalled to <body>), fixed and opaque, above every window",
   /createPortal\(/.test(tip) && /document\.body/.test(tip)
   && /\.info-pop \{\s*position: fixed; z-index: 400;/.test(css) && /\.info-pop \{[^}]*background: var\(--bg-modal\);/.test(css)
   && !/\.info-tip \.info-pop/.test(css));

console.log("\n  where the card goes (infoTipPlacement), by value:");
const { infoTipPlacement } = await import("@/components/common/infoTipPlacement");
const ipad = { width: 1120, height: 1600 }, phone = { width: 390, height: 844 };
// the Overview's (i): near the right end of the title line, near the top — the owner's screenshot
const ov = infoTipPlacement({ left: 790, right: 828, top: 236, bottom: 274 }, ipad, 560);
ck("the Overview's (i) on an iPad: below it, its right edge on the (i)'s, as tall as the whole table (no cut line)",
   !ov.above && ov.top === 282 && ov.left + ov.width === 828 && ov.maxHeight >= 560, ov);
const lefty = infoTipPlacement({ left: 40, right: 70, top: 300, bottom: 330 }, ipad, 300);
ck("an (i) on the left of the screen: the card's left edge on it", lefty.left === 40, lefty);
const low = infoTipPlacement({ left: 300, right: 330, top: 760, bottom: 790 }, phone, 500);
ck("an (i) at the foot of a phone: the card opens ABOVE it, inside the screen", low.above && low.bottom === 844 - 760 + 8 && low.maxHeight <= 760 - 20, low);
const narrow = infoTipPlacement({ left: 340, right: 370, top: 100, bottom: 130 }, phone, 400);
ck("a phone: the card fits the screen's width with a margin each side", narrow.width === 390 - 24 && narrow.left >= 12 && narrow.left + narrow.width <= 390 - 12, narrow);
const tall = infoTipPlacement({ left: 300, right: 330, top: 100, bottom: 130 }, phone, 2000);
ck("a card taller than the screen stops at its edge (and scrolls inside only then)", !tall.above && tall.top + tall.maxHeight <= 844 - 12, tall);

// every (i) in the app is this component: no hand-built .info-tip left
const tsx = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx")) tsx.push(p); } };
walk(new URL("../../src", import.meta.url).pathname);
const handBuilt = tsx.filter((p) => !p.endsWith("common/InfoTip.tsx") && /className="info-tip/.test(readFileSync(p, "utf8")));
ck("no (i) is hand-built any more", handBuilt.length === 0, handBuilt);

console.log("\n  the Overview's (i) beside Raise a fault — with or without the VESTA Agent:");
const withAgent = faultTiming(true), alone = faultTiming(false);
ck("with an Agent: its four sources, then a person's ticket and a guest's report, each saying when it opens and closes",
   withAgent.rows.length === 6 && withAgent.rows.every((r) => r.length === 3 && r.every((c) => c.length > 0)), withAgent.rows.length);
ck("  ...the nightly ones say so, and the Agent's defaults are said as defaults",
   withAgent.rows.filter((r) => r[1] === "Nightly check").length === 2 && /02:00 by default/.test(withAgent.note));
ck("without an Agent: a person's ticket and a guest's report only — nothing claims to open or close by itself",
   alone.rows.length === 2 && /person/.test(alone.rows[0][0]) && /guest/.test(alone.rows[1][0]) && !/Agent|nightly/i.test(alone.note + alone.rows.flat().join(" ")), alone);
ck("both say how a fault becomes a ticket", [withAgent, alone].every((t) => /becomes a ticket when someone presses Open ticket on its card/.test(t.note)));
ck(`  ...and the list's own refresh, from the app's own numbers (${STORE_ACTIVE_MS / 1000} s open, ${STORE_HEARTBEAT_MS / 60000} min else)`,
   [withAgent, alone].every((t) => t.note.includes(`every ${STORE_ACTIVE_MS / 1000} seconds while it is open`)
     && t.note.includes(`every ${STORE_HEARTBEAT_MS / 60000} minutes otherwise`)));
const card = src("components/fm/FaultTiming.tsx");
ck("the card asks whether an Agent is connected, and shows that table", /faultTiming\(agentVisible\(status\)\)/.test(card)
   && /rows\.map/.test(card) && /\{note\}/.test(card) && /<table className="info-pop-table">/.test(card));
ck("it sits just before Open a ticket, on the Overview's title line", /<FaultTiming \/>\s*<button[^>]*>[^<]*<Plus size=\{16\} \/> Open a ticket/.test(src("components/cockpit/CockpitOverview.tsx")));

done("✅ one (i), tap-opened; the Overview says when faults open and close, with or without the Agent");
