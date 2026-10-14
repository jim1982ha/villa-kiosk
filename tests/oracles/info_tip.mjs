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
ck("a tap toggles it (onClick), not focus alone", /onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/.test(tip));
ck("  ...and the card shows while it is open", /\.info-tip\.open \.info-pop \{ opacity: 1; visibility: visible/.test(css)
   || /\.info-tip:focus-within \.info-pop, \.info-tip\.open \.info-pop \{ opacity: 1; visibility: visible/.test(css));
ck("  ...the phone's centred card too", /\.info-tip:focus-within \.info-pop, \.info-tip\.open \.info-pop \{ transform: translateY\(-50%\); \}/.test(css));
ck("a tap outside or Escape closes it (the popover hook)", /useOutsideClose\(\[ref\], open, \(\) => setOpen\(false\)\)/.test(tip));
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
ck("both say how a fault becomes a ticket", [withAgent, alone].every((t) => /becomes a ticket when someone marks it in progress/.test(t.note)));
ck(`  ...and the list's own refresh, from the app's own numbers (${STORE_ACTIVE_MS / 1000} s open, ${STORE_HEARTBEAT_MS / 60000} min else)`,
   [withAgent, alone].every((t) => t.note.includes(`every ${STORE_ACTIVE_MS / 1000} seconds while it is open`)
     && t.note.includes(`every ${STORE_HEARTBEAT_MS / 60000} minutes otherwise`)));
const card = src("components/fm/FaultTiming.tsx");
ck("the card asks whether an Agent is connected, and shows that table", /faultTiming\(agentVisible\(status\)\)/.test(card)
   && /rows\.map/.test(card) && /\{note\}/.test(card) && /<table className="info-pop-table">/.test(card));
ck("it sits just before Open a ticket, on the Overview's title line", /<FaultTiming \/>\s*<button[^>]*>[^<]*<Plus size=\{16\} \/> Open a ticket/.test(src("components/cockpit/CockpitOverview.tsx")));

done("✅ one (i), tap-opened; the Overview says when faults open and close, with or without the Agent");
