// The (i) cards (owner, 2026-10-14): one component for every (i), opened by a TAP on every phone — iOS Safari does not
// focus a tapped <button>, so the old :focus-within-only card never opened on an iPhone — and the Faults tab's (i)
// beside "Raise a fault", saying when a fault opens and closes and how often the list is read again.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
const { faultTiming } = await import("@/fm/faultTiming");
const { STORE_ACTIVE_MS, STORE_HEARTBEAT_MS } = await import("@/hooks/useStoreRefresh");
const { fmtDuration } = await import("@/components/panels/chartUtils");

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
const wide = infoTipPlacement({ left: 790, right: 828, top: 236, bottom: 274 }, { width: 1400, height: 1000 }, 560, 847);
ck("an (i) may ask for a wider card (the Overview's table: 847 px) — kept inside the screen's margin when it does not fit",
   wide.width === 847 && wide.left === 12, wide);
const roomy = infoTipPlacement({ left: 1340, right: 1378, top: 236, bottom: 274 }, { width: 1920, height: 1000 }, 560, 847);
ck("  ...with room, its right edge on the (i)'s", roomy.width === 847 && roomy.left + roomy.width === 1378, roomy);
ck("  ...the Overview's (i) asks for twice the default: four columns (owner, 2026-10-19: \"too big as tooltip\")", /width=\{INFO_TIP_WIDTH \* 2\}/.test(src("components/fm/FaultTiming.tsx"))
   && /<th>Source<\/th><th>What it is<\/th><th>Appears<\/th><th>Goes<\/th>/.test(src("components/fm/FaultTiming.tsx")));
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
const { ISSUE_SOURCES } = await import("@/fm/issueSource");
ck("with an Agent: ONE row per icon a card can show, each saying what it is, when it appears and when it goes",
   withAgent.rows.map((r) => r.source).join() === ISSUE_SOURCES.join() && withAgent.rows.every((r) => r.what && r.opens && r.goes),
   withAgent.rows.map((r) => r.source));
ck("  ...the Kiosk's sources first, then the Agent's, each group under its heading (owner, 2026-10-15)",
   withAgent.groups.map((g) => g.title).join() === "From the Kiosk,From the VESTA Agent"
   && withAgent.groups[0].rows.every((r) => !["alert", "night", "chat"].includes(r.source))
   && withAgent.groups[1].rows.map((r) => r.source).join() === "alert,night,chat"
   && alone.groups.length === 1, withAgent.groups.map((g) => [g.title, g.rows.map((r) => r.source)]));
// owner, 2026-10-23: "include the new icon (validated ones)" — the check of a fault being confirmed, last of the Agent's
{
  const told15 = faultTiming(true, { checkMinutes: 15, nightlyAt: "04:30" }).confirming;
  const src = readFileSync(new URL("../../src/components/fm/FaultTiming.tsx", import.meta.url), "utf8");
  ck("  ...the Agent's group ends with \"Being confirmed\", its check icon explained; none without an Agent",
     withAgent.confirming?.words === "Being confirmed" && withAgent.confirming.what && withAgent.confirming.opens
     && /then at its next look/.test(withAgent.confirming.goes) && /then within 15min/.test(told15.goes)
     && alone.confirming === null
     && /confirming && g === groups\[groups\.length - 1\]/.test(src) && /<CheckCircle2 size=\{15\} className="fault-watched-icon"/.test(src),
     withAgent.confirming);
}
ck("  ...Live is what the Kiosk's map shows, and nobody is told",
   /What the map shows right now/.test(withAgent.rows[0].what) && /Nobody is told/.test(withAgent.rows[0].what)
   && withAgent.rows[0].source === "live");
const told = faultTiming(true, { checkMinutes: 15, nightlyAt: "04:30" });
ck("  ...the nightly check's say so; the Agent's timing is the one it TOLD, never a copy (architecture review, 2026-10-15)",
   /^Within minutes for a device that goes offline; at the nightly check for everything else$/.test(withAgent.rows.find((r) => r.source === "night")?.opens ?? "")
   && told.rows.find((r) => r.source === "night")?.opens === "Within minutes for a device that goes offline; at the nightly check (04:30) for everything else"
   && /it checks every 15min, and its nightly check runs at 04:30\./.test(told.note) && !/02:00|every 5\s?min/.test(told.note), told.note);
ck("  ...an Agent that did not say: no number at all", !/\d\d:\d\d|every \d+\s?min,/.test(withAgent.note)
   && /at the time set in the VESTA Agent/.test(withAgent.note), withAgent.note);
const { parseAgentStatus } = await import("@/agent/agentApi");
// owner, 2026-10-20: the Agent reads every open maintenance-check finding again at every look — the night row says when,
// in the Agent's own numbers when it said them; none said: no number. An older Agent's day times change nothing.
{
  const goes = (c) => faultTiming(true, c).rows.find((r) => r.source === "night")?.goes ?? "";
  const told = goes({ checkMinutes: 5, nightlyAt: "02:00" });
  ck("  ...a maintenance-check problem goes when the Agent no longer finds it, at its next look or its nightly check",
     told === "When the VESTA Agent no longer finds it. Each card's Next check says when it looks again: within 5min, or at the nightly check (02:00)", told);
  ck("  ...an older Agent still sending day times: the same words, no time of day",
     goes({ checkMinutes: 5, nightlyAt: "02:00", dayChecksAt: ["08:00", "16:00"] }) === told);
  const none = goes(null);
  ck("  ...an Agent that said nothing: generic words, no number",
     /every few minutes, or at its nightly check$/.test(none) && !/\d\d:\d\d|time/.test(none), none);
}
const beat = JSON.parse(readFileSync(new URL("../../rootfs/usr/share/vesta/agent-contract.json", import.meta.url), "utf8")).heartbeat.sample;
ck("  ...the Kiosk reads the timing the agreement's heartbeat carries, as the proxy shows it",
   JSON.stringify(parseAgentStatus({ state: "online", status: beat.status, cadence: beat.cadence }).cadence) === JSON.stringify(beat.cadence)
   && parseAgentStatus({ state: "online" }).cadence === null);
// the proxy withholds the cadence while the Agent is offline (tests/agent-interface.py, architecture review 2026-10-19):
// the (i) then says no number, from the same words it has for an Agent that never said
{
  const gone = parseAgentStatus({ state: "offline", last_seen: "2026-09-29T00:00:00Z", cadence: null });
  const said = faultTiming(true, gone.cadence).note;
  ck("  ...an Agent gone quiet: 'it checks regularly', never the last heartbeat's number",
     gone.cadence === null && /it checks regularly, and runs its nightly check at the time set in the VESTA Agent/.test(said)
     && !/it checks every \d+\s?min|nightly check runs at \d\d:\d\d/.test(said), said);
}
ck("  ...Live does not name Home Assistant (owner, 2026-10-14)", !/Home Assistant/.test(withAgent.rows.find((r) => r.source === "live").what));
ck("without an Agent: no row of the Agent's — nothing claims to open or close by itself",
   !alone.rows.some((r) => ["alert", "night", "chat"].includes(r.source)) && alone.rows.some((r) => r.source === "guest")
   && !/Agent|nightly/i.test(alone.note + alone.rows.map((r) => r.what + r.opens + r.goes).join(" ")), alone.rows.map((r) => r.source));
ck("both say how a fault becomes a ticket", [withAgent, alone].every((t) => /becomes a ticket when someone presses Open Ticket on its card/.test(t.note)));
ck(`  ...and the list's own refresh, from the app's own numbers (${STORE_ACTIVE_MS / 1000} s open, ${STORE_HEARTBEAT_MS / 60000} min else)`,
   [withAgent, alone].every((t) => t.note.includes(`every ${fmtDuration(STORE_ACTIVE_MS)} while it is open`)
     && t.note.includes(`every ${fmtDuration(STORE_HEARTBEAT_MS)} otherwise`)));
const card = src("components/fm/FaultTiming.tsx");
ck("the card shows the Agent's rows when an Agent is connected OR one of its faults is open (its icons are on the list)",
   /faultTiming\(agent, status\?\.cadence \?\? null\)/.test(card) && /groups\.map\(\(g\) =>/.test(card) && /const agent = agentSourcesShown\(status, data\.tickets\.some\(\(t\) => agentOwned\(t\) && stageOf\(t\) !== "closed"\)\);/.test(card)   // the rule by value: agent_view.mjs
   && /rows\.map/.test(card) && /\{note\}/.test(card) && /<table className="info-pop-table">/.test(card));
ck("it sits just before Open a ticket, on the Overview's title line", /<FaultTiming \/>\s*<button[^>]*>[^<]*<Plus size=\{16\} \/> Open a ticket/.test(src("components/cockpit/CockpitOverview.tsx")));

done("✅ one (i), tap-opened; the Overview says when faults open and close, with or without the Agent");
