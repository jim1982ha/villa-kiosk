// tests/oracles/history_heading.mjs
// ⚠️ A CHART'S HEADING IS ALWAYS ONE LINE (owner, 2026-11-05: "LAST 24 HOURS · 5-min avg (i)" pushed the range pills
// onto a second line in the device panel, on the tablet and on a phone: "it should never happen").
//
// What holds it: the row never wraps; the device panel's family is wide enough for every range's words beside the
// pills; a narrower heading (a phone) leaves out the words the pressed pill already says, its pills compact. Node
// cannot lay out text, so the widths the browser draws are MEASURED (headless Chromium, the app's own fonts, the
// real HistoryHeader and stylesheets) and kept here per heading; the room each width has comes from the CSS as
// shipped, at every phone width and the desktop panel. A heading whose words change has no measure: re-measure it.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
const { h, draw, inside } = await import("../consistency/screen.mjs");
const { RANGES } = await import("@/utils/historyRanges");
const { aggregationWords } = await import("@/components/panels/chartUtils");
const { HistoryHeader } = await import("@/components/panels/historyRange");

const css = (f) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), "utf8");
const panels = css("03-panels.css"), modals = css("04-modals.css"), layout = css("05-layout.css");
const px = (re, text) => Number(re.exec(text)?.[1] ?? NaN);

// measured 2026-11-05 (scratchpad shots/headshoot.mjs): each heading's words with their (i), at its full size; the
// same once the range words are left out; the five pills' width less their buttons' side padding
const FULL = {
  "Last hour · 5-min avg": 183, "Last hour · 5-min": 160, "Last 24 hours · 5-min avg": 216, "Last 24 hours · 5-min": 193,
  "Last week · hourly avg": 186, "Last week · hourly": 163, "Last month · daily avg": 190, "Last month · daily": 167,
  "Last year · weekly avg": 187, "Last year · weekly": 164,
};
const SHORT = { "5-min avg": 90, "5-min": 67, "hourly avg": 92, "hourly": 70, "daily avg": 84, "daily": 61, "weekly avg": 96, "weekly": 74 };
const PILLS_BARE = 88;

const panelMax = px(/\.modal\.panel-modal \{[^}]*max-width: (\d+)px/, panels);
const bodySide = px(/^\.modal-body \{[^}]*--body-left: (\d+)px/m, modals);
const phoneSide = px(/\.modal-body \{\s*--body-left: calc\((\d+)px/, layout);
const narrow = px(/@container \(max-width: (\d+)px\) \{\s*\.timeline-head \.chart-range-words/, modals);
const pad = px(/\.timeline-ranges button \{[^}]*padding: 0 (\d+)px/, modals);
const compact = px(/\.timeline-head \.timeline-ranges button \{ padding: 0 (\d+)px; \}/, modals);
const gap = px(/\.timeline-head \{\s*display: flex;[^}]*gap: (\d+)px/, modals);
const pills = (p) => PILLS_BARE + 5 * 2 * p;
const headings = RANGES.flatMap((r) => ["avg", null].map((a) => ({ range: r.title, step: aggregationWords(r.grainMs, a) })));
const full = headings.map((x) => FULL[`${x.range} · ${x.step}`]), short = headings.map((x) => SHORT[x.step]);

ck("every heading of every range is measured (a heading whose words change: measure it again)",
   full.every(Number.isFinite) && short.every(Number.isFinite) && [panelMax, bodySide, phoneSide, narrow, pad, compact, gap].every(Number.isFinite),
   { headings: headings.filter((_, i) => !Number.isFinite(full[i]) || !Number.isFinite(short[i])), panelMax, bodySide, phoneSide, narrow, pad, compact, gap });
ck("  ...the row never wraps, its words never break",
   /\.timeline-head \{ flex-wrap: nowrap; container-type: inline-size; \}/.test(modals) && /\.timeline-head \.entity-label \{ margin: 0; white-space: nowrap; \}/.test(modals));
const desktop = panelMax - 2 * bodySide - 2;
ck(`the device panel (${panelMax}px): every range's words beside the pills, on one line`,
   desktop > narrow && Math.max(...full) + gap + pills(pad) <= narrow + 1, { inner: desktop, narrow, widest: Math.max(...full) + gap + pills(pad) });
for (const w of [320, 360, 390, 430]) {
  const inner = w - 2 * phoneSide;
  const fits = inner > narrow ? Math.max(...full) + gap + pills(pad) : Math.max(...short) + gap + pills(compact);
  ck(`  ...a ${w}px phone: ${inner > narrow ? "the whole words" : "the words the pill does not say"} and the pills, on one line`, fits <= inner, { inner, fits });
}

// the words left out are the range's, and only them: still read aloud, said in full in the (i); the last report under it
const props = { title: "Last 24 hours", step: "5-min avg", about: "Every reading.", note: "Last report 04/11/2026 08:56",
  picker: h("div", { className: "segmented timeline-ranges" }) };
const html = draw(h(HistoryHeader, props));
const row = inside(html, "timeline-head");
// the (i)'s words, from the tree HistoryHeader hands its ChartStep (the tip draws them only once opened)
const abouts = [];
const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk);
  if (n.props?.about !== undefined) abouts.push(n.props.about); walk(n.props?.children); };
walk(HistoryHeader(props));
ck("the range's words in their own span, the step after them, the (i) saying the whole heading",
   /<span class="chart-range-words">Last 24 hours<\/span><span class="chart-step"><span class="chart-step-sep"> · <\/span>5-min avg/.test(row)
   && abouts.join() === "Last 24 hours, 5-min avg. Every reading.", { row, abouts });
ck("  ...the last report a moved window ends after: a line under the heading, never in it",
   !row.includes("Last report") && /<div class="chart-note">Last report 04\/11\/2026 08:56<\/div>/.test(html), html);

done("✅ a chart's heading is one line at every width");
