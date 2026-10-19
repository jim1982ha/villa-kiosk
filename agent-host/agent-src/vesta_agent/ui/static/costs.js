// VESTA Agent page — the Costs tab.
import { alertButton, api, card, dropdown, figures, fill, h, infoButton, moreButton, page, paged, place, plural, svg, tabbed, titleWithInfo, $view, where } from "./core.js";

// ---------------------------------------------------------------- costs
export const usd = (v) => "US$ " + (v || 0).toFixed((v || 0) > 0 && v < 0.01 ? 4 : 2);
export const ktok = (n) => (n === null || n === undefined ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(n >= 1e5 ? 0 : 1) + "k" : String(n));
let PROFILES = {};                     // the brains' names, from this tab's own answer (no shared page field)
export const brain = (p, m) => [p ? (PROFILES[p] || p).replace(/ \(.*/, "") : null, m ? m.replace(/^claude-/, "") : null].filter(Boolean).join(" · ") || "—";

// A run's "What" (owner, 2026-10-19): its label, the chat it came from, and the question as it was asked — whole,
// held to three lines here, all of it in its tooltip and on the run's line underneath (runMore). The steps open on
// demand under the row, across every column: squeezed into this column they pushed the row tall.
export function runWhat(r) {
  const label = r.kind === "job" ? r.work : `Reply to ${r.person || "someone"}`;
  const steps = r.steps || [];
  // the steps' pill on the title's line (owner, 2026-10-19: "show the pills X steps on the same line as Reply to…"),
  // after the chat it came from and at the line's right end (owner, 2026-10-20)
  return h("div", { class: "what" },
    h("div", { class: "what-head" }, h("b", {}, label),
      r.kind === "chat" && r.chat ? h("span", { class: "muted" }, r.chat) : null,
      steps.length || r.asked ? moreButton(steps.length ? plural(steps.length, "step", "steps") : "Whole question") : null),
    r.asked ? h("div", { class: "muted what-asked", title: r.asked }, `“${r.asked}”`) : null);
}

// Under a run, across the table: what was asked, whole, then each step in a line — its number, its tool, and the
// agent's summary of what it asked for (status.step_summary); the arguments as they were are the line's tooltip.
export function runMore(r) {
  const steps = r.steps || [];
  return h("div", { class: "run-more" },
    r.asked ? h("p", { class: "run-asked" }, `“${r.asked}”`) : null,
    // a header, and the skill each step read or ran a script of first (owner, 2026-10-20: the Tools called column
    // repeated these steps, and went)
    steps.length ? h("ol", { class: "steps" },
      h("li", { class: "steps-head" }, h("span", {}, "Skill"), h("span", { class: "step-n" }, "#"), h("span", {}, "Tool"),
        h("span", {}, "What it did")),
      steps.map((x) => h("li", { title: x.raw || null },
        h("span", { class: "step-skill" }, x.skill || "—"), h("span", { class: "step-n" }, String(x.n)),
        h("span", { class: "chip gray" }, x.tool), h(x.code ? "code" : "span", { class: "step-sum" }, x.summary || "")))) : null);
}

// ⚠️ EVERYTHING ON THIS TAB FOLLOWS THE PERIOD CHOSEN, 7 DAYS UNLESS ANOTHER IS (owner, 2026-10-06): the figures,
// the chart, by work, by model, every run and the tools.
export async function costs(days = 7) {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const c = await api("GET", `api/costs?days=${days}`);
  PROFILES = c.profiles || {};
  if (c.none) return fill($view, card("Costs", "The agent has not recorded anything yet (it has not run in agent mode)."));
  const period = dropdown([[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]], days, (v) => costs(Number(v)), "Period");
  // the four figures as the agent adds them up (status.costs: period, runs_count, per_run, busiest), never here
  const busiest = c.busiest || { day: null, cost: 0 };
  const kpis = figures([[`Last ${days} days`, usd(c.period)], ["Runs", String(c.runs_count)],
    ["Per run", usd(c.per_run || 0)],
    [busiest.day ? `Busiest day (${new Date(busiest.day + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" })})` : "Busiest day", usd(busiest.cost)]]);
  // the cost of each day: bars drawn in SVG, with a Y axis (US$) and its grid lines (owner, 2026-10-01: "always
  // the Y axis and grid lines"), and a date under every bar for a week, every few days for longer
  // ⚠️ DRAWN AT THE CARD'S OWN WIDTH (owner, 2026-10-08: "taking way too much vertical space"). It was 640 units wide
  // and stretched to the card: the wider page (0.12.83) made it — and its text — half again as tall. Now one unit is
  // one pixel, so the chart is ~180 px tall at any width and its labels keep their size.
  const W = Math.max(320, Math.round(($view.clientWidth || 684) - 44)), H = 150, L = 52, T = 8, n = c.by_day.length;
  // the Y axis is the server's (status.costs → vesta_shared.axis, the reports' own rule): this only draws it
  const max = c.axis.top, ticks = c.axis.ticks, slot = (W - L) / n;
  const y = (v) => T + H - (v / max) * H;
  const every = n <= 7 ? 1 : Math.ceil(n / 8);
  const chart = svg("svg", { viewBox: `0 0 ${W} ${T + H + 22}`, class: "bars", role: "img", "aria-label": "Cost per day, US$" },
    ...ticks.map((v) => svg("line", { x1: L, x2: W, y1: y(v).toFixed(1), y2: y(v).toFixed(1), class: v ? "grid" : "base" })),
    ...ticks.map((v, i) => svg("text", { x: L - 6, y: (y(v) + 3.5).toFixed(1), class: "axis", "text-anchor": "end" }, c.axis.labels[i])),
    ...c.by_day.map((d, i) => {
      const bh = d.cost > 0 ? Math.max(1.5, (d.cost / max) * H) : 0;
      return svg("rect", { x: (L + i * slot + slot * 0.18).toFixed(1), y: (T + H - bh).toFixed(1), width: (slot * 0.64).toFixed(1),
                           height: bh.toFixed(1), rx: 2, class: "bar" }, svg("title", {}, `${d.day}: ${usd(d.cost)}`));
    }),
    // a date every `every` days, and the last day too unless it would sit on top of the one before
    ...c.by_day.map((d, i) => i % every === 0 || (i === n - 1 && (n - 1) % every >= every / 2)
      ? svg("text", { x: (L + i * slot + slot / 2).toFixed(1), y: T + H + 16, class: "axis", "text-anchor": "middle" },
            n <= 7 ? new Date(d.day + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "numeric" }) : d.day.slice(5).replace("-", "/"))
      : null).filter(Boolean));
  const groupTable = (rows, title) => paged([title, { v: "Runs", cls: "num" }, { v: "Tokens in", cls: "num" }, { v: "Tokens out", cls: "num" },
    { v: "Cost", cls: "num" }, { v: "Per run", cls: "num" }], rows.map((g) => [g.name.replace(/^claude-/, ""), { v: g.runs, cls: "num" },
    { v: g.recorded ? ktok(g.tokens_in) : "—", cls: "num" }, { v: g.recorded ? ktok(g.tokens_out) : "—", cls: "num" }, { v: usd(g.cost), cls: "num" }, { v: usd(g.cost / g.runs), cls: "num" }]));
  const runRows = c.runs.map((r) => ({ more: (r.steps || []).length || r.asked ? runMore(r) : null, cells: [
    { v: new Date(r.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }), cls: "nowrap" },
    runWhat(r),
    r.without_ai ? "Without the AI" : r.no_result ? "—" : brain(r.profile, r.model),
    usedSkills(r.skills),
    { v: r.tokens_in === null || r.tokens_in === undefined ? "—" : `${ktok((r.tokens_in || 0) + (r.cache_read || 0) + (r.cache_write || 0))} / ${ktok(r.tokens_out)}`, cls: "num" },
    { v: r.interrupted && !r.cost ? "not reported" : usd(r.cost), cls: "num" },
    r.without_ai ? madeWithoutAi(r.without_ai)
      // a run that ended without sending its report (agent_records.JOB_NO_RESULT): the agent's words of why
      : r.no_result ? h("span", { class: "chips one-line" }, infoButton("Not sent", r.no_result.why), h("span", { class: "chip off" }, "not sent"))
      // the (!) a failed run has, its words in the tooltip (owner, 2026-10-15: "a single (!) icon, the details in tooltip")
      : r.interrupted ? alertButton("Stopped by a restart", () => h("div", {}, h("b", {}, "Stopped by a restart of the agent."),
        h("div", { class: "tooltip-detail" }, "It was still working when the agent restarted. Anthropic reports a run's cost when it ends, so this one's is not here: the Anthropic Console has it.")))
      : r.stopped ? h("span", { class: "chip off" }, "stopped at its limit") : r.error ? alertButton("This run failed", () => h("div", {}, h("b", {}, r.cause ? `This run failed: ${r.cause}.` : "This run failed."),
      r.what_to_do ? h("div", {}, r.what_to_do) : null, h("div", { class: "tooltip-detail" }, r.error))) : ""] }));
  fill($view,
    // the period's selector on the title's line, on the right (owner, 2026-10-06); the figures below a separator
    h("section", { class: "card" },
      titleWithInfo(place("cost"), "As the Anthropic API reported it for each run: a chat reply, or a run of an AI job. Tokens in count what the agent re-read from its cache too. Everything on this tab follows the period chosen here.", "h2", period),
      h("div", { class: "divided" }, kpis), h("div", { class: "divided" }, h("h2", {}, place("cost_day")), chart)),
    // ⚠️ TWO CARDS OF TWO TABS (owner, 2026-10-08): "By work" and "By model" are one question asked two ways, and so
    // are "Every run" and the tools those runs used — each pair is one card, its tab kept when the period changes
    tabbedCard(`${place("cost_split")} · last ${days} days`, "spend", [
      ["work", place("by_work"), "Chat replies, and each AI job.", () => groupTable(c.by_work, "Work")],
      ["model", place("by_model"), "Which model did the work.", () => groupTable(c.by_model, "Model")]]),
    tabbedCard(`${place("runs")} · last ${days} days`, "runs", [
      ["runs", place("every_run"), `${c.runs_count} runs, newest first. Open a run's steps to see what was asked, whole, and each tool it used (recorded from agent 0.6.42 on).`,
        () => paged([{ v: "When", half: true }, { v: "What", half: true }, "Brain · model", "Skills",
                     { v: "Tokens in / out", cls: "num", half: true }, { v: "Cost", cls: "num", half: true }, ""], runRows, 10,
                    // the columns named, the row's cells at their top (a long question no longer centres the others);
                    // When on one line (owner, 2026-10-20: the Tools called column's room went to it)
                    { cls: "runs", widths: ["14%", null, "12%", "14%", "11%", "9%", "44"] })],
      ["tools", place("tools_called"), `Each tool the AI called, in how many runs and how many times. A tool never called is a candidate to switch off (${where("tools")}).`,
        () => (c.tools && c.tools.length ? paged(["Tool", { v: "Runs", cls: "num" }, { v: "Calls", cls: "num" }],
          c.tools.map((t) => [h("code", {}, t.tool), { v: t.runs, cls: "num" }, { v: t.calls, cls: "num" }]))
          : h("p", { class: "muted" }, "No tool recorded in this period yet."))]]));
}


// A card of tabs (subTabs, each tab's own (i)): [key, label, what it is about, draw()]. Only the open tab is drawn.
export function tabbedCard(title, id, tabs) {
  const t = tabbed(id, tabs);          // its tab kept in page.tabs, so changing the period keeps the tab you were on
  return card(title, null, t.bar, t.body);
}

// A job its code steps made when the AI could not run (owner, 2026-10-07): the figures and charts were sent, said
// to be made without the AI; or the steps failed too, and only "could not be prepared" was sent.
// ⚠️ THE (i) FIRST (owner, 2026-10-08): it sits where a failed run's (!) sits, so every row's icon lines up in the column.
export function madeWithoutAi(w) {
  const ok = w.sent > 0 && !w.failed;
  return h("span", { class: "chips one-line" },
    infoButton(ok ? "Made without the AI" : "Not made", ok
      ? `${w.why} The report was still made from its figures and charts, and sent saying so; VESTA's readings are missing.`
      : `${w.why} Its figures could not be made either${w.failed ? ` (${w.failed} failed)` : ""}${w.sent ? "; part of it was sent" : ""}.`),
    h("span", { class: ok ? "chip warn" : "chip off" }, ok ? "without the AI" : "not made"));
}

// the skills a run used, in order, as the agent lists them (status.costs: the one it was started for, then those the AI
// read or ran a script of); a run recorded before agent 0.6.260 has none
export function usedSkills(skills) {
  return (skills || []).length ? h("div", { class: "chips" }, skills.map((k) => h("span", { class: "chip" }, k))) : "—";
}

