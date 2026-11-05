// Each icon on a card opens ITS row of the (i)'s table (owner, 2026-11-06: "the same way each icon has a specific line
// in the tooltip table, make sure each card shows the specific icon's tooltip for the hovered/clicked icon"). The tip
// and the table are drawn here from the same rows (fm/faultTiming), side by side, and compared word for word; the
// cards are drawn and each icon's tip is followed from the icon to the words it opens.
import { h, draw, text } from "../consistency/screen.mjs";
import { ck, done } from "../consistency/check.mjs";
import { parseTsx, elements, propText } from "../consistency/jsx.mjs";
import ts from "typescript";
const { faultTiming, timingRow, TIMING_HEADS } = await import("@/fm/faultTiming");
const { ISSUE_SOURCES } = await import("@/fm/issueSource");
const I = await import("@/components/fm/sourceIcons");
const { FaultTimingTable } = await import("@/components/fm/FaultTiming");
const { AttentionCard } = await import("@/components/cockpit/IssueCard");
const { default: InfoTip, KEEP_PRESS } = await import("@/components/common/InfoTip");

const cadence = { checkMinutes: 15, nightlyAt: "04:30" };
const KEYS = [...ISSUE_SOURCES, "watch"];

/** Words as a reader sees them, one string. */
const words = (html) => text(html).split("|").map((w) => w.trim()).filter((w) => w && w !== "[icon]").join(" ");
/** An icon's name where the table and a tip draw it: the bold word after the icon. */
const nameIn = (html) => words(/<b>([\s\S]*?)<\/b>/.exec(html)?.[1] ?? "");
/** The cells of the table's row for `k`, as a reader sees them: its name, then its three columns. */
const tableRow = (html, k) => {
  const m = new RegExp(`<tr data-source="${k}">([\\s\\S]*?)</tr>`).exec(html);
  if (!m) return null;
  const cells = m[1].split(/<\/td>/).filter((c) => c.includes("<td"));
  return [nameIn(cells[0]), ...cells.slice(1).map(words)];
};
/** A tip's lines, as a reader sees them: its name, then [label, words] three times. */
const tipLines = (html) => ({
  name: nameIn(html),
  lines: [...html.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => [words(m[1]), words(m[2])]),
});

console.log("  each icon's tip is its row of the (i)'s table, word for word:");
for (const c of [null, cadence]) {
  const table = draw(h(FaultTimingTable, { timing: faultTiming(true, c) }));
  const bad = KEYS.filter((k) => {
    const tip = tipLines(draw(h(I.SourceTipCard, { k, cadence: c })));
    const row = tableRow(table, k), want = timingRow(k, c);
    return !(row && tip.name === I.timingWords(k) && row[0] === tip.name
      && JSON.stringify(tip.lines) === JSON.stringify([[TIMING_HEADS.what, want.what], [TIMING_HEADS.opens, want.opens], [TIMING_HEADS.goes, want.goes]])
      && JSON.stringify(row.slice(1)) === JSON.stringify(tip.lines.map((l) => l[1])));
  });
  ck(`${c ? "an Agent that told its timing" : "no timing told"}: every icon (${KEYS.length}) — its name, What it is, Appears, Goes as the table's row`, bad.length === 0, bad);
}
{
  const live = tipLines(draw(h(I.SourceTipCard, { k: "live", cadence })));
  const night = tipLines(draw(h(I.SourceTipCard, { k: "night", cadence })));
  const alert = tipLines(draw(h(I.SourceTipCard, { k: "alert", cadence })));
  const watch = tipLines(draw(h(I.SourceTipCard, { k: "watch", cadence })));
  ck("  ...Live: what the map shows, at once, as soon as the device is back",
     live.name === "Live" && /^What the map shows right now/.test(live.lines[0][1]) && live.lines[1][1] === "At once"
     && live.lines[2][1] === "As soon as the device is back to normal", live);
  ck("  ...Maintenance check: in the Agent's own numbers (04:30, within 15min)",
     night.name === "Maintenance check" && night.lines[1][1].includes("(04:30)") && night.lines[2][1].includes("within 15min"), night);
  ck("  ...Alert: a VESTA alert, as soon as it is raised", alert.name === "Alert" && /^A VESTA alert/.test(alert.lines[0][1])
     && alert.lines[1][1] === "As soon as the alert is raised", alert);
  ck("  ...On watch: the Watch check, closed at its refresh pill's time", watch.name === "On watch"
     && /still watches/.test(watch.lines[0][1]) && watch.lines[2][1].includes("within 15min once that time is past"), watch);
  ck("  ...the three labels are the table's own column heads", /<th>What it is<\/th><th>Appears<\/th><th>Goes<\/th>/.test(draw(h(FaultTimingTable, { timing: faultTiming(true, null) }))));
}

{
  const tip = elements(parseTsx("components/fm/sourceIcons.tsx"), "SourceTipCard").map((e) => propText(e, "cadence"));
  ck("  ...a card's tip reads the Agent's own timing, as the (i)'s table does", JSON.stringify(tip) === '["useAgentCadence()"]', tip);
}

console.log("\n  every icon a card draws opens its own tip:");
/** The tips an element tree holds, by walking it as React would call its pure parts: each IconTip's source, its
 *  button's label, the tip it opens (drawn). */
const tipsOf = (el) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === I.IconTip) {
      const tip = I.IconTip(n.props);
      out.push({ k: n.props.k, isTip: tip.type === InfoTip, label: tip.props.label, button: draw(tip.props.trigger), opens: tipLines(draw(tip.props.children)) });
      return;
    }
    if (typeof n.type === "function" && [I.SourceIcons, I.SourceIconRow].includes(n.type)) return walk(n.type(n.props));
    walk(n.props?.children); walk(n.props?.lead); walk(n.props?.parts?.map((p) => p.lead));
  };
  walk(el);
  return out;
};
const rowOf = (k) => timingRow(k, null);
const right = (t) => t.isTip && t.label === `${I.timingWords(t.k)}: what it means` && t.opens.name === I.timingWords(t.k)
  && t.opens.lines.map((l) => l[1]).join("|") === [rowOf(t.k).what, rowOf(t.k).opens, rowOf(t.k).goes].join("|");

const two = tipsOf(h(I.SourceIcons, { sources: ["live", "night"], severities: ["lost", "warn"] }));
ck("two icons on one line: two tips, Live's and Maintenance check's, each its own row", two.length === 2
   && two.map((t) => t.k).join() === "live,night" && two.every(right) && /cockpit-attention-lost/.test(two[0].button)
   && /cockpit-attention-warn/.test(two[1].button), two.map((t) => [t.k, t.label]));
const row = tipsOf(h(I.SourceIconRow, { sources: ["night", "alert", "chat"], severity: "warn" }));
ck("the Recap's \"Check the faults\" icons: one tip each, its own", row.map((t) => t.k).join() === "night,alert,chat" && row.every(right), row.map((t) => t.k));

const ov = [];
const card = (o) => ({ key: "c", title: "Hall Motion Sensor", room: "Hall", tone: "warn", ...o });
const line = (key, sources, severities) => ({ key, text: "x", own: { sources, severities }, story: [], closing: null, openedAt: "2026-11-04T22:12:00Z", actions: ov, records: [] });
const one = card({ lead: { sources: ["alert"], severities: ["danger"] }, lines: [line("l", ["alert"], ["danger"])] });
const several = card({ lead: { sources: ["live", "night"], severities: ["lost", "warn"] }, lines: [line("l1", ["live"], ["lost"]), line("l2", ["night"], ["warn"])] });
const watched = card({ look: "watched", tone: "handled", nextCheck: { when: "Closes 15:06", tip: "x" }, lines: [line("l", ["night"], ["warn"])] });
const drawnTips = (c) => [...draw(h(AttentionCard, { card: c, onOpenEntity() {} })).matchAll(/<button type="button" class="info-btn info-btn-icon" aria-label="([^"]+)"/g)].map((m) => m[1]);
const walked = (c) => tipsOf(AttentionCard({ card: c, onOpenEntity() {} }));
ck("an Inbox card of one problem: its Alert icon in its strip is a button that opens the Alert row",
   drawnTips(one).join() === "Alert: what it means" && walked(one).every(right) && walked(one).length >= 1, [drawnTips(one), walked(one).map((t) => t.k)]);
ck("a card of two problems: the strip's two icons and each part's icon, every one its own tip",
   drawnTips(several).join() === ["Live", "Maintenance check", "Live", "Maintenance check"].map((w) => `${w}: what it means`).join()
   && walked(several).map((t) => t.k).join() === "live,night,live,night" && walked(several).every(right), drawnTips(several));
ck("a Watch card: its check opens the On watch row", drawnTips(watched)[0] === "On watch: what it means"
   && walked(watched)[0]?.k === "watch" && right(walked(watched)[0]), drawnTips(watched));
ck("the Tickets tab's lead is the source icons, so its icon opens its tip too",
   elements(parseTsx("components/fm/TicketsTab.tsx"), "SourceIcons").length === 1);

console.log("\n  a press on an icon is its own, never the card's:");
const ev = (o) => { const e = { stopped: false, stopPropagation() { e.stopped = true; }, ...o }; return e; };
const press = ["onPointerDown", "onClick"].map((k) => { const e = ev(); KEEP_PRESS[k](e); return e.stopped; });
const keys = ["Enter", " ", "Escape", "Tab"].map((key) => { const e = ev({ key }); KEEP_PRESS.onKeyDown(e); return e.stopped; });
ck("its press and its tap stop at it (the card's tap opens it, its hold erases it); Enter and Space too, Escape and Tab go on",
   press.every(Boolean) && JSON.stringify(keys) === "[true,true,false,false]", { press, keys });
{
  const tree = parseTsx("components/common/InfoTip.tsx");
  const span = elements(tree, "span").find((s) => /className=\{`info-tip/.test(s.getText().slice(0, 200)));
  const attrs = span ? (ts.isJsxElement(span) ? span.openingElement : span).attributes.properties : [];
  ck("  ...on the wrapper that holds the button and its card (portalled, still inside it in React's tree)",
     attrs.some((a) => ts.isJsxSpreadAttribute(a) && a.expression.getText() === "KEEP_PRESS"));
}
const hook = (await import("node:fs")).readFileSync(new URL("../../src/hooks/useOutsideClose.ts", import.meta.url), "utf8");
ck("  ...and a press elsewhere still closes an open tip: the outside-close listens first (capture)",
   /addEventListener\("pointerdown", onDown, true\)/.test(hook) && /addEventListener\("keydown", onKey, true\)/.test(hook));

done("✅ each icon, its own tip, from the table's rows");
