// VESTA Agent UI. No framework, no build step, nothing fetched from the internet.
// Every text from the files is put in the page as text (never as HTML).

const $view = document.getElementById("view");
const $bar = document.getElementById("savebar");
const $toast = document.getElementById("toast");
let dirty = false;           // unsaved changes on the current screen
let current = "overview";

// ---------------------------------------------------------------- helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false)
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

// ⚠️ THE ONE DROPDOWN (owner, 2026-10-04: "a lot of dropdown menus are badly rendered"). A native <select>
// opens the platform's own list (Android: a grey sheet of radio buttons; iOS: a wheel) that no theme reaches.
// This draws a button like the device picker's box and its own list, fixed on the page body so a table cell
// or a card cannot clip it; under the button, or above when there is no room below. tests/test_ui.py refuses
// a native select element. `options`: [[value, label], …]; `pick(value)` on a change.
function dropdown(options, value, pick, label) {
  const ROW = 44;
  const textOf = (v) => (options.find(([k]) => String(k) === String(v)) || [null, ""])[1];
  const box = h("button", { type: "button", class: "picker-box dropdown", "aria-haspopup": "listbox", "aria-expanded": "false",
                            "aria-label": label ? `${label}: ${textOf(value)}` : null });
  const draw = () => box.replaceChildren(h("span", { class: "dropdown-value" }, textOf(value)), h("span", { class: "caret" }, "▾"));
  let list = null, active = 0;
  const rows = () => [...list.children];
  const mark = () => rows().forEach((r, i) => r.classList.toggle("active", i === active));
  function close(refocus = true) {
    if (!list) return;
    list.remove(); list = null; box.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true); window.removeEventListener("scroll", moved, true);
    window.removeEventListener("resize", moved);
    if (refocus) box.focus();
  }
  const outside = (e) => { if (list && !list.contains(e.target) && !box.contains(e.target)) close(false); };
  const moved = (e) => { if (list && !(e && e.target instanceof Node && list.contains(e.target))) close(false); };
  const choose = (i) => {
    const v = options[i][0];
    if (String(v) !== String(value)) { value = v; draw(); pick(v); }
    close();
  };
  function open() {
    const b = box.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const want = options.length * ROW + 8, below = vh - b.bottom - 12, above = b.top - 12;
    const up = want > below && above > below;
    const width = Math.min(Math.max(b.width, 180), vw - 16), left = Math.min(Math.max(b.left, 8), vw - 8 - width);
    active = Math.max(0, options.findIndex(([k]) => String(k) === String(value)));
    list = h("div", { class: "dropdown-list", role: "listbox", tabindex: "-1", "aria-label": label || null },
      options.map(([k, l], i) => h("div", { class: "dropdown-option" + (i === active ? " on" : ""), role: "option",
                                            "aria-selected": String(i === active), onclick: () => choose(i),
                                            onpointerenter: () => { active = i; mark(); } }, l)));
    Object.assign(list.style, { left: `${left}px`, width: `${width}px`, maxHeight: `${Math.max(2 * ROW, Math.min(want, up ? above : below))}px`,
                                ...(up ? { bottom: `${vh - b.top + 4}px` } : { top: `${b.bottom + 4}px` }) });
    list.addEventListener("keydown", (e) => {
      const last = options.length - 1;
      const step = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: last }[e.key];
      if (step !== undefined) { e.preventDefault(); active = Math.min(last, Math.max(0, step)); mark(); rows()[active].scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "Tab") close();
    });
    document.body.append(list); mark(); box.setAttribute("aria-expanded", "true");
    rows()[active].scrollIntoView({ block: "nearest" }); list.focus();
    document.addEventListener("pointerdown", outside, true); window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
  }
  box.addEventListener("click", () => (list ? close() : open()));
  box.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!list) open(); } });
  draw();
  return box;
}

// ⚠️ ONE EDITABLE TABLE (architecture review, 0.12.30): People and the services were each built by hand — their
// own tbody, redraw, remove button, Add button, markDirty — and their phone layouts were CSS keyed by
// nth-child to the column order written here, so moving a column broke the phone silently. Each column now
// says its width (a <col>, which the page's CSP allows where a style attribute is blocked) and where it goes
// on a phone: "a" / "b" the first line's two halves, "ab" both, "c" / "d" the second line's, "cd" all of it.
// The remove button is always at the end of the first line. Returns [table, its Add button].
function editTable(rows, { cls, columns, cell, blank, add, changed = () => {} }) {
  const body = h("tbody");
  const touched = () => { changed(); markDirty(); };
  const draw = () => body.replaceChildren(...rows.map((row, i) => h("tr", {},
    columns.map((c, k) => h("td", { class: `ph-${c.phone}` }, cell(row, k, touched))),
    h("td", { class: "x ph-x" }, h("button", { class: "btn icon ghost", title: "Remove", onclick: () => { rows.splice(i, 1); draw(); touched(); } }, "×")))));
  draw();
  const table = h("table", { class: `rows edit ${cls}` },
    h("colgroup", {}, columns.map((c) => h("col", { width: c.width || null })), h("col", { width: "44" })),
    h("thead", {}, h("tr", {}, columns.map((c) => h("th", {}, c.title)), h("th", {}, ""))), body);
  return [table, h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => { rows.push(blank()); draw(); touched(); } }, add))];
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.headers["X-Vesta-UI"] = "1";
    opts.body = JSON.stringify(body);
  } else if (method !== "GET") {
    opts.headers["Content-Type"] = "application/json";
    opts.headers["X-Vesta-UI"] = "1";
    opts.body = "{}";
  }
  const r = await fetch(path, opts);                 // relative: works under Home Assistant's Ingress path
  let data = {};
  try { data = await r.json(); } catch { /* an empty answer */ }
  if (!r.ok) { const e = new Error("refused"); e.problems = data.problems || [`Error ${r.status}`]; e.status = r.status; throw e; }
  return data;
}

// replaceChildren() prints a null as the text "null": the optional parts are filtered first.
function fill(el, ...kids) { el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false)); }

function toast(text) {
  $toast.textContent = text; $toast.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => ($toast.hidden = true), 3500);
}

function problemsBox(list, title = "Not saved:") {
  if (!list || !list.length) return null;
  return h("div", { class: "problems" }, h("b", {}, title), h("ul", {}, list.map((p) => h("li", {}, p))));
}

function card(title, lead, ...kids) {
  return h("section", { class: "card" }, h("h2", {}, title), lead ? h("p", { class: "lead" }, lead) : null, ...kids);
}

// A set of figures, each a number over its label: THE one way the page shows them (Overview's last
// 24 hours, the Costs). They sit side by side, as many to a row as the width allows — two on a
// phone, never one per line (owner, 2026-10-02: six figures stacked down a phone screen). The
// form fields keep .grid, one per line on a phone, which is right for inputs.
function figures(pairs) {
  return h("div", { class: "figures" },
    pairs.map(([label, value]) => h("div", { class: "kpi" }, h("div", { class: "n" }, value), h("div", { class: "l" }, label))));
}

function field(label, input, hint) {
  // a <label> forwards a click inside it to its first control: a picker (a box and a list) is in a <div>
  const tag = input && input.classList && input.classList.contains("picker") ? "div" : "label";
  return h(tag, { class: "field" }, h("span", {}, label), input, hint ? h("span", { class: "hint" }, hint) : null);
}

// A table of many rows, 10 to a page (owner, 2026-10-01): `head` the column titles, `rows` arrays of cells;
// a cell is a node, a text, or {v, cls}. Newest first is the caller's order.
function paged(head, rows, per = 10) {
  const body = h("tbody");
  const nav = h("div", { class: "pager" });
  const pages = Math.max(1, Math.ceil(rows.length / per));
  let page = 0;
  const cell = (c, tag) => (c && typeof c === "object" && "v" in c ? h(tag, { class: c.cls }, c.v) : h(tag, {}, c));
  const draw = () => {
    body.replaceChildren(...rows.slice(page * per, page * per + per).map((cells) => h("tr", {}, cells.map((c) => cell(c, "td")))));
    nav.replaceChildren(...(pages > 1 ? [
      h("button", { class: "btn ghost", disabled: page === 0, onclick: () => { page--; draw(); } }, "‹ Newer"),
      h("span", { class: "muted" }, `Page ${page + 1} of ${pages} · ${rows.length} rows`),
      h("button", { class: "btn ghost", disabled: page >= pages - 1, onclick: () => { page++; draw(); } }, "Older ›")] : []));
  };
  draw();
  return h("div", {}, h("div", { class: "tbl" }, h("table", { class: "rows data" },
    h("thead", {}, h("tr", {}, head.map((c) => cell(c, "th")))), body)), nav);
}

// an SVG element (the bars of a chart: sizes are attributes, never a style — the page's rule allows no inline style)
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

function markDirty() { dirty = true; showBar(); }
function guard() { return !dirty || confirm("You have unsaved changes. Leave without saving?"); }
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

let barState = null;
function setBar(state) { barState = state; showBar(); }
function showBar() {
  $bar.replaceChildren();
  if (!barState) { $bar.hidden = true; return; }
  $bar.hidden = false;
  $bar.append(h("span", { class: "msg" }, dirty ? "Unsaved changes" : barState.idle || ""),
    barState.discard ? h("button", { class: "btn ghost", disabled: !dirty, onclick: barState.discard }, "Discard") : null,
    h("button", { class: "btn primary", disabled: !dirty, onclick: barState.save }, barState.label || "Save"));
}

// ---------------------------------------------------------------- AI jobs not set
// A job policy.yaml does not name does not run (owner, 2026-10-01): say so where it is seen, and add them
// with the starter values their skill offers, in one press.
async function addMissingJobs() {
  const [doc, { jobs }] = await Promise.all([api("GET", "api/policy"), api("GET", "api/jobs")]);
  const form = doc.form;
  form.settings.jobs = form.settings.jobs || {};
  for (const j of jobs) if (!j.set) form.settings.jobs[j.name] = { ...j.default };
  await api("PUT", "api/policy/form", { form, rev: doc.rev });
}

function jobsBanner(names, after) {
  if (!names || !names.length) return null;
  const btn = h("button", { class: "btn primary", onclick: async () => {
    btn.disabled = true;
    try { await addMissingJobs(); toast("AI jobs added. Change their brain or limit under Rules."); after(); }
    catch (e) { btn.disabled = false; alert(e.problems.join("\n")); }
  } }, "Add them");
  return h("div", { class: "banner" },
    h("div", {}, h("b", {}, `${names.length} AI job${names.length > 1 ? "s are" : " is"} not set: ${names.length > 1 ? "they don't" : "it doesn't"} run.`),
      h("div", { class: "muted" }, names.join(", "), " — each needs a brain and a spending limit.")), btn);
}

// ---------------------------------------------------------------- costs
const usd = (v) => "US$ " + (v || 0).toFixed((v || 0) > 0 && v < 0.01 ? 4 : 2);
const ktok = (n) => (n === null || n === undefined ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(n >= 1e5 ? 0 : 1) + "k" : String(n));
const brain = (p, m) => [p ? (PROFILES[p] || p).replace(/ \(.*/, "") : null, m ? m.replace(/^claude-/, "") : null].filter(Boolean).join(" · ") || "—";

async function costs(days = 30) {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const c = await api("GET", `api/costs?days=${days}`);
  PROFILES = c.profiles || PROFILES;
  if (c.none) return fill($view, card("Costs", "The agent has not recorded anything yet (it has not run in agent mode)."));
  const period = dropdown([[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]], days, (v) => costs(Number(v)), "Period");
  const kpis = figures([["Today", usd(c.today)], ["Last 7 days", usd(c.last_7_days)], ["This month", usd(c.this_month)],
    [`Per run, last ${days} days (${c.runs_count} runs)`, usd(c.runs_count ? c.period / c.runs_count : 0)]]);
  // the cost of each day: bars drawn in SVG, with a Y axis (US$) and its grid lines (owner, 2026-10-01: "always
  // the Y axis and grid lines"), and a date under every bar for a week, every few days for longer
  const W = 640, H = 150, L = 52, T = 8, n = c.by_day.length;
  const top = Math.max(0.01, ...c.by_day.map((d) => d.cost));
  const raw = top / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const max = step * Math.ceil(top / step), slot = (W - L) / n;
  const y = (v) => T + H - (v / max) * H;
  const ticks = []; for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  const every = n <= 7 ? 1 : Math.ceil(n / 8);
  const money = (v) => "$" + (step < 0.1 ? v.toFixed(2) : step < 1 ? v.toFixed(1) : v.toFixed(0));
  const chart = svg("svg", { viewBox: `0 0 ${W} ${T + H + 22}`, class: "bars", role: "img", "aria-label": "Cost per day, US$" },
    ...ticks.map((v) => svg("line", { x1: L, x2: W, y1: y(v).toFixed(1), y2: y(v).toFixed(1), class: v ? "grid" : "base" })),
    ...ticks.map((v) => svg("text", { x: L - 6, y: (y(v) + 3.5).toFixed(1), class: "axis", "text-anchor": "end" }, money(v))),
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
    { v: g.name === "not recorded" ? "—" : ktok(g.tokens_in), cls: "num" }, { v: g.name === "not recorded" ? "—" : ktok(g.tokens_out), cls: "num" }, { v: usd(g.cost), cls: "num" }, { v: usd(g.cost / g.runs), cls: "num" }]));
  const runRows = c.runs.map((r) => [
    new Date(r.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
    h("div", {}, h("b", {}, r.kind === "job" ? r.work : `Reply to ${r.person || "someone"}`),
      r.kind === "chat" && r.chat ? h("span", { class: "muted" }, " · " + r.chat) : null,
      r.asked ? h("div", { class: "muted asked" }, "“" + r.asked + "”") : null),
    brain(r.profile, r.model),
    { v: r.tokens_in === null || r.tokens_in === undefined ? "—" : `${ktok((r.tokens_in || 0) + (r.cache_read || 0) + (r.cache_write || 0))} / ${ktok(r.tokens_out)}`, cls: "num" },
    { v: usd(r.cost), cls: "num" },
    r.stopped ? h("span", { class: "chip off" }, "stopped at its limit") : r.error ? h("span", { class: "chip off" }, r.error) : ""]);
  fill($view,
    card("What the AI cost", "As the Anthropic API reported it for each run: a chat reply, or a run of an AI job. Tokens in count what the agent re-read from its cache too.",
      // The period's label and its selector on one line, the figures below a separator (owner, 2026-10-03).
      h("label", { class: "field row" }, h("span", {}, "Period"), period),
      h("div", { class: "divided" }, kpis), h("div", { class: "divided" }, h("h2", {}, "Per day"), chart)),
    card("By work", "Chat replies, and each AI job.", groupTable(c.by_work, "Work")),
    card("By model", "Which model did the work.", groupTable(c.by_model, "Model")),
    card("Every run", `${c.runs_count} runs, newest first. The model and tokens are recorded from agent 0.6.9 on; older runs show —.`,
      paged(["When", "What", "Brain · model", { v: "Tokens in / out", cls: "num" }, { v: "Cost", cls: "num" }, ""], runRows)));
}

// ---------------------------------------------------------------- theme (Light / Auto / Dark)
function setTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("vesta-agent-theme", mode); } catch (e) { /* kept for this visit only */ }
  document.querySelectorAll("[data-theme-set]").forEach((b) => {
    b.classList.toggle("on", b.dataset.themeSet === mode);
    b.setAttribute("aria-checked", String(b.dataset.themeSet === mode));
  });
}
document.querySelectorAll("[data-theme-set]").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeSet)));
setTheme(document.documentElement.getAttribute("data-theme") || "auto");

// ---------------------------------------------------------------- tabs
// one "Rules (file)" tab (owner, 2026-10-01): "Rules" opens the forms, "(file)" the file itself
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab-file") ? "rules-file" : b.dataset.tab;
  if (tab === current || !guard()) return;
  go(tab);
}));

function go(tab) {
  current = tab; dirty = false; setBar(null);
  history.replaceState(null, "", "#" + tab);
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab.replace("-file", "")));
  document.querySelector(".tab-file").classList.toggle("on", tab === "rules-file");
  ({ overview, rules, "rules-file": () => rules("file"), skills, costs })[tab]();
}

// ---------------------------------------------------------------- overview
async function overview() {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const o = await api("GET", "api/overview");
  // Short, on the title's line (owner, 2026-10-03): the app's version, and the
  // channel when it is not the released one. The whole statement stays one
  // hover/long-press away.
  const ver = document.getElementById("ver");
  ver.textContent = `v${o.app_version || o.version}${o.instance && o.instance !== "prod" ? ` · ${o.instance}` : ""}`;
  ver.title = `${o.app_version ? `app ${o.app_version} · ` : ""}agent ${o.version} · ${o.instance}`;
  const off = o.skills.filter((s) => !s.ok);
  const r = o.last_24h;
  const count = (k) => (r && r.counts[k]) || 0;
  const kids = [
    jobsBanner(o.jobs_not_set, () => go("overview")),
    // the Rules and Skills tabs are one click away: only what is wrong with them is shown here
    o.policy_problems.length ? problemsBox(o.policy_problems, "Rules — to fix:") : null,
    off.length ? problemsBox(off.map((s) => `${s.name}: ${s.problem}`), "Skills not working:") : null,
  ];
  if (r) {
    kids.push(card("The last 24 hours", "From the agent's own records.",
      figures([["alerts followed", count("critical_event")], ["buttons pressed", count("ladder")],
        ["actions done", count("executed") + count("direct")], ["replies written", count("run")],
        ["AI cost (USD)", r.ai_cost_usd.toFixed(2)], ["failures", count("failed") + count("code_script_failed") + count("send_failed")]]),
      r.scheduled_jobs.length ? h("div", { class: "divided" }, h("h2", {}, "Scheduled jobs run"),
        paged(["Job", "Ran at"], [...r.scheduled_jobs].reverse().map((j) => [j.job, new Date(j.ran_at).toLocaleString()]))) : null));
  } else {
    kids.push(card("The last 24 hours", "The agent has not recorded anything yet (it has not run in agent mode)."));
  }
  fill($view, ...kids);
}

// ---------------------------------------------------------------- rules (policy.yaml)
// the rules, the lists and their domains, the siren's domains: policy.form_schema(), served with the file —
// the page keeps no copy (two copies had drifted: input_button offered, then refused on save)
let SCHEMA = { rules: {}, lists: [], actionable: [], siren_domains: [] };
// the brains as the server names them (policy.profile_labels): filled by the rules and costs pages
let PROFILES = {};
const RESETS = { daily_04_00: "Every day at 04:00", after_8h_silence: "After 8 hours of silence", never: "Never (/new only)" };
// the villa's devices, from the agent's knowledge pack: chosen by name, never typed as ids
const ENT = { list: [], byId: {} };

async function rules(sub = "forms") {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  let doc = await api("GET", "api/policy");
  SCHEMA = doc.schema || SCHEMA;
  PROFILES = doc.profiles || PROFILES;
  const { jobs } = await api("GET", "api/jobs");
  const { entities } = await api("GET", "api/entities");
  ENT.list = entities; ENT.byId = Object.fromEntries(entities.map((e) => [e.id, e]));
  dirty = false;
  // the forms are "Rules", the raw file is "Rules (file)": two tabs at the top, no sub-menu (owner, 2026-10-01)
  if (sub === "file" || !doc.form) return rulesFile(doc);
  return rulesForms(doc, jobs);
}

function rulesFile(doc) {
  const ta = h("textarea", { class: "editor", spellcheck: "false", oninput: markDirty });
  ta.value = doc.text;
  const probs = h("div");
  const save = async () => {
    try {
      doc = { ...doc, ...(await api("PUT", "api/policy/text", { text: ta.value, rev: doc.rev })) };
      dirty = false; fill(probs); showBar(); toast("policy.yaml saved. The agent uses it within seconds.");
    } catch (e) { fill(probs, problemsBox(e.problems)); }
  };
  setBar({ save, discard: () => rules("file"), idle: "Everything, including what the forms do not show." });
  fill($view, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    card("policy.yaml", "Comments start with #. Every save is checked with the agent's own rules first.", ta));
}

function rulesForms(doc, jobs = []) {
  const f = structuredClone(doc.form);
  const probs = h("div");
  const on = (fn) => (e) => { fn(e.target); markDirty(); };
  const num = (v) => (v === "" || v === null ? null : Number(v));

  // acting
  const acting = card("Acting on the villa",
    "Off: the agent informs only. On: it may act, within the rules below.",
    h("div", { class: "inline" },
      h("label", { class: "switch" }, h("input", { type: "checkbox", checked: f.act_enabled, onchange: on((t) => (f.act_enabled = t.checked)) }), "The agent may act on the villa"),
      field("An Approve button works for (minutes)",
        h("input", { type: "number", min: 1, max: 1440, value: f.approval_ttl_minutes, oninput: on((t) => (f.approval_ttl_minutes = num(t.value))) }))));

  // the AI
  const sel = (opts, value, set, label) => dropdown(Object.entries(opts), value, (v) => { set(v); markDirty(); }, label);
  // AI jobs: each skill's scheduled AI work, with its own brain and spending limit
  f.settings.jobs = f.settings.jobs || {};
  // The AI: one table, one row per piece of AI work (chat answers, then each skill's AI job), like
  // "What the agent may do"; then the conversation settings.
  const aiBody = h("tbody");
  const limitInput = (value, set, label, per) => h("div", {},
    h("input", { type: "number", step: "0.05", min: 0.05, value, "aria-label": label, oninput: on((t) => { set(num(t.value)); drawTotal(); }) }),
    h("div", { class: "muted" }, per));
  // how often a job runs, in words and per month: the scheduler's answer (/api/jobs), not re-parsed here
  const total = h("p", { class: "muted spaced" });
  const drawTotal = () => {
    const n = jobs.reduce((s, j) => s + ((f.settings.jobs[j.name] || {}).limit_usd || 0) * j.runs_per_month, 0);
    total.textContent = `At their limits, the scheduled runs cost at most about US$ ${n.toFixed(2)} a month. `
      + "Chat replies, and reports asked for in a chat, come on top: see the Costs tab for what was really spent.";
  };
  const drawAi = () => aiBody.replaceChildren(
    h("tr", {},
      h("td", {}, h("b", {}, "Chat answers"), h("div", { class: "muted" }, "replies in the chats; a reply at its limit offers Continue")),
      h("td", {}, sel(PROFILES, f.settings.profile, (v) => (f.settings.profile = v), "Brain")),
      h("td", {}, limitInput(f.settings.reply_limit_usd, (v) => (f.settings.reply_limit_usd = v), "Limit per reply (USD)", "for each reply")),
      h("td", { class: "x" })),
    ...jobs.map((j) => {
      const cur = f.settings.jobs[j.name];
      const what = h("td", {}, h("b", {}, j.name),
        h("div", { class: "muted" }, `${j.skill} · ${j.when_words}${j.on_request ? ", or when asked in a chat" : ""}`));
      if (!cur) {
        return h("tr", {}, what, h("td", { colspan: 2, class: "muted" }, "Not set: this job does not run."),
          h("td", { class: "x" }, h("button", { class: "btn icon ghost", title: "Set this job", onclick: () => { f.settings.jobs[j.name] = { ...j.default }; drawAi(); drawTotal(); markDirty(); } }, "+")));
      }
      return h("tr", {}, what,
        h("td", {}, sel(PROFILES, cur.profile, (v) => (cur.profile = v), "Brain")),
        h("td", {}, limitInput(cur.limit_usd, (v) => (cur.limit_usd = v), `Limit per run of ${j.name} (USD)`, "for each run")),
        h("td", { class: "x" }, h("button", { class: "btn icon ghost", title: "Stop this job", onclick: () => { delete f.settings.jobs[j.name]; drawAi(); drawTotal(); markDirty(); } }, "×")));
    }));
  drawAi(); drawTotal();
  const ai = card("The AI", "Which brain does each piece of work, and the most ONE piece of work may cost: one chat reply, or one run of a job. It is not a monthly budget. A reply that reaches its limit stops and offers Continue; a report that reaches it is still sent with what is done. A job that is not set does not run.",
    h("table", { class: "rows ai" }, h("thead", {}, h("tr", {}, ["Work", "Brain", "Most it may cost (US$)", ""].map((x) => h("th", {}, x)))), aiBody),
    total,
    h("div", { class: "inline spaced" },
      field("New conversation", sel(RESETS, f.settings.conversation_reset, (v) => (f.settings.conversation_reset = v), "New conversation")),
      h("label", { class: "switch" }, h("input", { type: "checkbox", checked: f.settings.web_search, onchange: on((t) => (f.settings.web_search = t.checked)) }), "Web search (weather warnings, manuals)")));
  const missing = jobs.filter((j) => !(f.settings.jobs || {})[j.name]).map((j) => j.name);

  // people
  const languages = (p) => ({ ...doc.languages, ...(p.language && !(p.language in doc.languages) ? { [p.language]: p.language } : {}) });
  const people = card("People", "Who the agent answers. Each person sends /whoami to the bot to read their Telegram id.",
    ...editTable(f.people, {
      cls: "people", add: "Add a person", blank: () => ({ telegram_id: "", name: "", role: "fm", language: "en" }),
      columns: [{ title: "Name", width: "26%", phone: "a" }, { title: "Telegram id", width: "22%", phone: "b" },
                { title: "Role", width: "22%", phone: "c" }, { title: "Language", phone: "d" }],
      cell: (p, k, touched) => [
        () => h("input", { type: "text", value: p.name ?? "", "aria-label": "Name", oninput: (e) => { p.name = e.target.value; touched(); } }),
        () => h("input", { type: "text", inputmode: "numeric", value: p.telegram_id ?? "", "aria-label": "Telegram id",
                          oninput: (e) => { const t = e.target.value.trim(); p.telegram_id = /^-?\d+$/.test(t) ? Number(t) : e.target.value; touched(); } }),
        () => sel({ owner: "Owner", fm: "Facility manager" }, p.role, (v) => (p.role = v), "Role"),
        () => sel(languages(p), p.language ?? "en", (v) => (p.language = v), "Language"),
      ][k](),
    }));

  // chats
  const chatId = (role) => h("input", { type: "text", inputmode: "numeric", value: f.chats[role] ?? "", oninput: on((t) => (f.chats[role] = t.value.trim() === "" ? null : (/^-?\d+$/.test(t.value.trim()) ? Number(t.value.trim()) : t.value))) });
  const chats = card("Chats", "Where the agent posts on its own. A group id is negative; /whoami in the chat shows it.",
    h("div", { class: "grid" },
      field("Owner chat", chatId("owner"), "Escalations, monthly report, owner-only approvals."),
      field("Facility manager chat", chatId("fm"), "Alerts, reminders, daily digest, weekly page.")));

  // services and their rule
  const svcRows = Object.entries(f.allowed_services);
  const ruleChoices = Object.entries(SCHEMA.rules).map(([k, l]) => [k, `${k} — ${l}`]);
  const services = card("What the agent may do", "One line per Home Assistant service, and who decides. Anything not listed is refused. Restarts, shell commands, toggles and the like are refused whatever this says.",
    ...editTable(svcRows, {
      cls: "svc", add: "Add a service", blank: () => ["", "any"],
      changed: () => { f.allowed_services = Object.fromEntries(svcRows.filter(([k]) => k)); },
      columns: [{ title: "Service", width: "38%", phone: "ab" }, { title: "Rule", phone: "cd" }],
      cell: (row, k, touched) => k === 0
        ? h("input", { type: "text", value: row[0], placeholder: "light.turn_on", "aria-label": "Service", oninput: (e) => { row[0] = e.target.value.trim(); touched(); } })
        : dropdown(ruleChoices, row[1], (v) => { row[1] = v; touched(); }, "Rule"),
    }));

  // devices: chosen from the villa's own, by name (owner, 2026-10-01: "free form text inputs are not
  // suitable"). A box like a menu shows what is chosen; it opens a list with a search and a checkbox per
  // device (name, room · id). `one`: a single device (the siren), chosen by a click.
  const picker = (get, set, domains, one = false) => {
    const box = h("div", { class: "picker" });
    const shown = h("button", { type: "button", class: "picker-box", "aria-haspopup": "listbox" });
    const panel = h("div", { class: "picker-panel", hidden: true });
    const search = h("input", { type: "search", placeholder: "Search by name, room or id…", "aria-label": "Search devices" });
    const list = h("div", { class: "picker-list", role: "listbox", "aria-multiselectable": String(!one) });
    const pool = ENT.list.filter((e) => !domains || domains.includes(e.id.split(".")[0]));
    const label = (id) => (ENT.byId[id] ? ENT.byId[id].name : id);
    const drawShown = () => {
      const cur = get();
      shown.replaceChildren(cur.length
        ? h("span", { class: "picker-chosen" }, cur.map((id) => h("span", { class: "tag" + (ENT.byId[id] ? "" : " unknown"), title: id }, label(id))))
        : h("span", { class: "muted" }, one ? "None — choose one…" : "None — choose…"),
        h("span", { class: "caret" }, "▾"));
    };
    const drawList = () => {
      const cur = get();
      const q = search.value.trim().toLowerCase();
      const rows = [...cur.filter((id) => !ENT.byId[id]).map((id) => ({ id, name: id, area: "not found in Home Assistant" })),
                    ...pool].filter((e) => !q || `${e.name} ${e.area} ${e.id}`.toLowerCase().includes(q));
      list.replaceChildren(...rows.slice(0, 300).map((e) => {
        const on = cur.includes(e.id);
        const cb = h("input", { type: one ? "radio" : "checkbox", checked: on, tabindex: -1, "aria-hidden": "true" });
        return h("div", { class: "picker-row" + (on ? " on" : ""), role: "option", "aria-selected": String(on) }, cb,
          h("span", { class: "picker-text" }, h("b", {}, e.name), h("small", {}, [e.area, e.id].filter(Boolean).join(" · "))));
      }));
      [...list.children].forEach((row, i) => row.addEventListener("click", (ev) => {
        ev.preventDefault();
        const id = rows[i].id;
        const now = get();
        set(one ? (now.includes(id) ? [] : [id]) : (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
        markDirty(); drawShown();
        if (one) close(); else drawList();
      }));
      if (!rows.length) list.append(h("p", { class: "muted pad" }, "No device matches."));
      if (rows.length > 300) list.append(h("p", { class: "muted pad" }, `${rows.length - 300} more: type to narrow the list.`));
    };
    const outside = (ev) => { if (!box.contains(ev.target)) close(); };
    const keys = (ev) => { if (ev.key === "Escape") close(); };
    function close() {
      panel.hidden = true; shown.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", keys);
    }
    shown.addEventListener("click", () => {
      if (!panel.hidden) return close();
      panel.hidden = false; shown.setAttribute("aria-expanded", "true");
      search.value = ""; drawList(); search.focus();
      document.addEventListener("mousedown", outside); document.addEventListener("keydown", keys);
    });
    search.addEventListener("input", drawList);
    panel.append(search, list,
      one ? null : h("div", { class: "picker-foot" }, h("span", { class: "muted" }, "Tick as many as needed."),
                                                    h("button", { type: "button", class: "btn ghost", onclick: close }, "Done")));
    drawShown();
    box.append(shown, panel);
    return box;
  };
  const many = (key, domains) => picker(() => f[key] || [], (v) => (f[key] = v), domains);
  const devices = card("Protected devices", "Devices that need more care than the rules above give them.",
    h("div", { class: "grid" },
      field("Only the owner may approve", many("owner_only_entities", SCHEMA.actionable), "An action on these waits for the owner's Approve, whoever asks (locks, the gate, the siren)."),
      field("Left alone", many("excluded_entities", null), "Never acted on, never reported (a test device)."),
      field("Siren", picker(() => (f.siren_entity ? [f.siren_entity] : []), (v) => (f.siren_entity = v[0] || null), SCHEMA.siren_domains, true),
            "The siren the alert desk may ask the owner to sound."),
      field("Siren stops after (minutes)", h("input", { type: "number", min: 1, max: 60, value: f.siren_auto_off_min, oninput: on((t) => (f.siren_auto_off_min = num(t.value))) }))));
  const lists = card("Allowed lists", "For a service whose rule above is \"only the devices in the lists below\": the agent may act only on the devices chosen here, and still asks for approval.",
    h("div", { class: "grid" }, SCHEMA.lists.map((l) => field(l.label, many(l.key, l.domains), l.hint))));

  const save = async () => {
    try {
      const res = await api("PUT", "api/policy/form", { form: f, rev: doc.rev });
      doc = { ...doc, ...res, problems: [] };
      dirty = false; fill(probs); showBar(); toast("Saved. The agent uses the new rules within seconds.");
    } catch (e) {
      fill(probs, problemsBox(e.problems)); probs.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  setBar({ save, discard: () => rules("forms"), idle: "Changes apply within seconds, no restart." });
  fill($view, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    jobsBanner(missing, () => rules("forms")), acting, people, chats, services, devices, lists, ai);
}

// ---------------------------------------------------------------- skills
async function skills(select = null) {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const { skills: list } = await api("GET", "api/skills");
  const side = h("div", { class: "card" },
    h("h2", {}, "Skills"),
    h("p", { class: "lead" }, "Each skill is a folder. A change counts at the agent's next use, no restart."),
    list.length ? list.map((s) => h("button", { class: "skill-item" + (s.name === select ? " on" : ""), onclick: () => { if (guard()) skills(s.name); } },
      h("div", {}, h("b", {}, s.name), s.ok ? null : [" ", h("span", { class: "chip off" }, "not working")]),
      h("div", { class: "d" }, s.ok ? s.description : s.problem))) : h("p", { class: "muted" }, "No skill yet. The starter skills are copied at the agent's first start."),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: newSkill }, "New skill")));
  const pane = h("div");
  fill($view, h("div", { class: "skills" }, side, pane));
  dirty = false; setBar(null);
  if (select) openSkill(select, pane, list.find((s) => s.name === select));
}

async function newSkill() {
  const name = (prompt("Name of the new skill (lower-case, digits, - and _), e.g. pool-care") || "").trim();
  if (!name || !guard()) return;
  try { await api("POST", "api/skills", { name }); toast(`Skill ${name} created.`); skills(name); }
  catch (e) { alert(e.problems.join("\n")); }
}

let filesOpen = false;

async function openSkill(name, pane, info, path = "SKILL.md") {
  const { files } = await api("GET", `api/skills/${encodeURIComponent(name)}/files`);
  if (!files.some((x) => x.path === path)) path = files.length ? files[0].path : null;
  const probs = h("div");
  const ta = h("textarea", { class: "editor", spellcheck: "false", oninput: markDirty });
  ta.addEventListener("keydown", (e) => {            // Tab indents instead of leaving the editor
    if (e.key !== "Tab") return;
    e.preventDefault();
    const s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end"); markDirty();
  });
  let fileRev = null;
  const load = async (p) => {
    const f = await api("GET", `api/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(p)}`);
    ta.value = f.content; fileRev = f.rev; dirty = false; showBar(); fill(probs);
  };
  // one line of files while collapsed (the open one first, so it always shows); a button shows them all,
  // and appears only when they do not fit on that line. Open or closed is kept from skill to skill.
  const fileList = h("div", { class: "files" + (filesOpen ? "" : " collapsed") }, files.map((x) => h("button", { class: x.path === path ? "on" : "", onclick: () => { if (x.path !== path && guard()) openSkill(name, pane, info, x.path); } }, x.path)));
  const more = h("button", { class: "btn ghost files-more", hidden: true, onclick: () => {
    filesOpen = !filesOpen; fileList.classList.toggle("collapsed", !filesOpen); fits(); } });
  const fits = () => {
    const overflow = fileList.scrollHeight > fileList.clientHeight + 1;
    more.hidden = !filesOpen && !overflow;
    more.textContent = filesOpen ? "Show fewer files" : `All ${files.length} files`;
  };
  // measured after layout and on a window resize (a ResizeObserver here loops: the button changes the width it watches)
  requestAnimationFrame(fits);
  const onResize = () => (fileList.isConnected ? fits() : window.removeEventListener("resize", onResize));
  window.addEventListener("resize", onResize);
  const fileBtns = h("div", { class: "files-row" }, fileList, more);
  const save = async () => {
    try {
      const r = await api("PUT", `api/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`, { content: ta.value, rev: fileRev });
      fileRev = r.rev; dirty = false; fill(probs); showBar(); toast(`${path} saved.`);
    } catch (e) { fill(probs, problemsBox(e.problems)); }
  };
  const newFile = async () => {
    const p = (prompt("New file, e.g. scripts/check.py or templates/page.html") || "").trim();
    if (!p || !guard()) return;
    try {
      await api("PUT", `api/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(p)}`, { content: p.endsWith(".py") ? "#!/usr/bin/env python3\n" : "", rev: null });
      toast(`${p} created.`); openSkill(name, pane, info, p);
    } catch (e) { alert(e.problems.join("\n")); }
  };
  const delFile = async () => {
    if (!confirm(`Delete ${path} from ${name}?`)) return;
    try { await api("DELETE", `api/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`); dirty = false; toast(`${path} deleted.`); openSkill(name, pane, info); }
    catch (e) { fill(probs, problemsBox(e.problems, "Not deleted:")); }
  };
  const delSkill = async () => {
    if (!confirm(`Delete the skill ${name}? The agent stops using it at once. It is kept in skills/.trash, and does not come back on its own.`)) return;
    try { await api("DELETE", `api/skills/${encodeURIComponent(name)}`); dirty = false; toast(`Skill ${name} deleted.`); skills(); }
    catch (e) { alert(e.problems.join("\n")); }
  };
  fill(pane, h("div", { class: "card" },
    h("h2", {}, name, info && !info.ok ? [" ", h("span", { class: "chip off" }, "not working")] : null),
    info && !info.ok ? problemsBox([info.problem], "The agent does not use this skill:") : null,
    fileBtns, probs, path ? ta : h("p", { class: "muted" }, "No file."),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", onclick: newFile }, "New file"),
      path && !["SKILL.md", "skill.yaml"].includes(path) ? h("button", { class: "btn ghost", onclick: delFile }, "Delete this file") : null,
      h("button", { class: "btn danger push-right", onclick: delSkill }, "Delete the skill"))));
  setBar({ save, discard: () => load(path), idle: path ? `Editing ${path}. Saves are checked before they are written.` : "" });
  if (path) await load(path);
}

go(["overview", "rules", "rules-file", "skills", "costs"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview");
