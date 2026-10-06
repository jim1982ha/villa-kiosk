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

// ⚠️ THE ONE FLOATING PANEL (owner, 2026-10-06: "use the same code for similar features"). The dropdown's list, the
// device picker's list and the (i)'s tooltip all float over the page the same way: on the page body, fixed, so a
// table cell or a card cannot clip or squeeze them (the picker's list inside a table cell took the cell's input
// rules); under the anchor, or above it when there is no room below; closed by a click outside, Escape, a scroll
// of the page or a resize. `width`: a fixed width (else the anchor's, at least 180 px); `center`: centred on it.
function floating(anchor, panel, { width = null, center = false, onClose = () => {} } = {}) {
  panel.classList.add("floating");
  document.body.append(panel);
  const place = () => {
    const b = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(width || Math.max(b.width, 180), vw - 16);
    const left = Math.min(Math.max(8, center ? b.left + b.width / 2 - w / 2 : b.left), vw - 8 - w);
    Object.assign(panel.style, { width: `${w}px`, left: `${left}px`, top: "", bottom: "", maxHeight: "" });
    const want = panel.scrollHeight, below = vh - b.bottom - 12, above = b.top - 12;
    const up = want > below && above > below;
    panel.style.maxHeight = `${Math.max(120, Math.min(want, up ? above : below))}px`;
    if (up) panel.style.bottom = `${vh - b.top + 6}px`; else panel.style.top = `${b.bottom + 6}px`;
  };
  const outside = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(); };
  const moved = (e) => { if (!(e && e.target instanceof Node && panel.contains(e.target))) close(); };
  const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); if (anchor.focus) anchor.focus(); } };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    panel.remove();
    document.removeEventListener("pointerdown", outside, true); window.removeEventListener("scroll", moved, true);
    window.removeEventListener("resize", close); document.removeEventListener("keydown", esc, true);
    onClose();
  }
  place();
  document.addEventListener("pointerdown", outside, true); window.addEventListener("scroll", moved, true);
  window.addEventListener("resize", close); document.addEventListener("keydown", esc, true);
  return { close, place };
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
  let list = null, float = null, active = 0;
  const rows = () => [...list.children];
  const mark = () => rows().forEach((r, i) => r.classList.toggle("active", i === active));
  const close = (refocus = true) => { if (float) float.close(); if (refocus) box.focus(); };
  const choose = (i) => {
    const v = options[i][0];
    if (String(v) !== String(value)) { value = v; draw(); pick(v); }
    close();
  };
  function open() {
    active = Math.max(0, options.findIndex(([k]) => String(k) === String(value)));
    list = h("div", { class: "dropdown-list", role: "listbox", tabindex: "-1", "aria-label": label || null },
      options.map(([k, l], i) => h("div", { class: "dropdown-option" + (i === active ? " on" : ""), role: "option",
                                            "aria-selected": String(i === active), onclick: () => choose(i),
                                            onpointerenter: () => { active = i; mark(); } }, l)));
    list.addEventListener("keydown", (e) => {
      const last = options.length - 1;
      const step = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: last }[e.key];
      if (step !== undefined) { e.preventDefault(); active = Math.min(last, Math.max(0, step)); mark(); rows()[active].scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
      else if (e.key === "Tab") close(false);
    });
    float = floating(box, list, { onClose: () => { list = null; float = null; box.setAttribute("aria-expanded", "false"); } });
    mark(); box.setAttribute("aria-expanded", "true");
    rows()[active].scrollIntoView({ block: "nearest" }); list.focus({ preventScroll: true });
  }
  box.addEventListener("click", () => (list ? close(false) : open()));
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
function editTable(rows, { cls, columns, cell, blank, add, changed = () => {}, per = PER_PAGE }) {
  const body = h("tbody");
  const touched = () => { changed(); markDirty(); };
  const pager = pagedBlock(() => rows.length, (from, to) => body.replaceChildren(...rows.slice(from, to).map((row, k) => h("tr", {},
    columns.map((c, j) => h("td", { class: `ph-${c.phone}` }, cell(row, j, touched, () => pager.redraw()))),
    h("td", { class: "x ph-x" }, h("button", { class: "btn icon ghost", title: "Remove", onclick: () => { rows.splice(from + k, 1); pager.redraw(); touched(); } }, "×"))))), per);
  pager.redraw();
  const table = h("table", { class: `rows edit ${cls}` },
    h("colgroup", {}, columns.map((c) => h("col", { width: c.width || null })), h("col", { width: "44" })),
    h("thead", {}, h("tr", {}, columns.map((c) => h("th", {}, c.title)), h("th", {}, ""))), body);
  return [table, pager.nav, h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => { rows.push(blank()); pager.last(); touched(); } }, add))];
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

// A card: its title, and what it is about behind an (i) beside it (owner, 2026-10-06: no description paragraph
// under every title). Hover shows it; a tap (a phone has no hover) opens it under the title. A card with nothing
// else in it (an empty state) keeps its text in view: there it IS the content.
function card(title, lead, ...kids) {
  const content = kids.flat().filter((k) => k !== null && k !== undefined && k !== false);
  if (!lead || !content.length) return h("section", { class: "card" }, h("h2", {}, title), lead ? h("p", { class: "lead" }, lead) : null, ...kids);
  return h("section", { class: "card" }, titleWithInfo(title, lead), ...kids);
}

// A title, its (i), and an optional control on the same line, right-aligned (the Costs' period).
// ⚠️ THE TEXT IS A TOOLTIP, NEVER INSERTED IN THE PAGE (owner, 2026-10-06): it floats over the page on hover or
// keyboard focus, and on a tap (a phone has no hover); a second tap, a tap elsewhere, Escape or scrolling closes it.
function titleWithInfo(title, text, tag = "h2", right = null) {
  const btn = h("button", { type: "button", class: "info", "aria-label": `About ${title}: ${text}`, "aria-expanded": "false" }, "i");
  infoTip(btn, text);
  return h("div", { class: "card-title" }, h(tag, {}, title, btn), right ? h("div", { class: "card-title-right" }, right) : null);
}

// a label with its (i) — a column heading, a field: the (i) takes the size of the text it sits in (app.css em units)
function withInfo(label, text) {
  return h("span", { class: "with-info" }, label, infoButton(label, text));
}

// the (i) itself, its text shown on hover and on a tap (infoTip)
function infoButton(about, text) {
  const btn = h("button", { type: "button", class: "info", "aria-label": `About ${about}`, "aria-expanded": "false" }, "i");
  infoTip(btn, text);
  return btn;
}

let openTip = null;
function infoTip(btn, text) {
  let float = null, pinned = false;
  const close = () => { if (float) float.close(); };
  const open = () => {
    if (float) return;
    if (openTip) openTip();
    float = floating(btn, h("div", { class: "tooltip", role: "tooltip" }, typeof text === "function" ? text() : text), { width: 360, center: true,
      onClose: () => { float = null; pinned = false; btn.setAttribute("aria-expanded", "false"); if (openTip === close) openTip = null; } });
    btn.setAttribute("aria-expanded", "true");
    openTip = close;
  };
  btn.addEventListener("mouseenter", open);
  btn.addEventListener("mouseleave", () => { if (!pinned) close(); });
  btn.addEventListener("focus", open);
  btn.addEventListener("blur", () => { if (!pinned) close(); });
  btn.addEventListener("click", (e) => { e.preventDefault(); if (pinned) close(); else { open(); pinned = true; } });
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
  // each cell carries its column's name: on a phone the row becomes a card, every value labelled (app.css);
  // a column whose head says `half` shares its line there with the next half one (owner, 2026-10-05)
  const label = head.map((c) => String(c && typeof c === "object" && "v" in c ? c.v : c || ""));
  const half = head.map((c) => !!(c && typeof c === "object" && c.half));
  const cell = (c, tag, i) => {
    const td = tag === "td";
    const cls = [c && typeof c === "object" && "v" in c ? c.cls : null, td && half[i] ? "ph-half" : null].filter(Boolean).join(" ") || null;
    return h(tag, { class: cls, "data-label": td ? label[i] : null }, c && typeof c === "object" && "v" in c ? c.v : c);
  };
  // newest first: the pages go to "older" (the one pager, pagedBlock)
  const pager = pagedBlock(() => rows.length, (from, to) => body.replaceChildren(...rows.slice(from, to).map((cells) =>
    h("tr", {}, cells.map((c, i) => cell(c, "td", i))))), per, ["‹ Newer", "Older ›", "rows"]);
  pager.redraw();
  return h("div", {}, h("div", { class: "tbl" }, h("table", { class: "rows data" },
    h("thead", {}, h("tr", {}, head.map((c, i) => cell(c, "th", i)))), body)), pager.nav);
}

// ⚠️ THE ONE TAB BAR (DRY, owner 2026-10-06): What the AI can use, a skill's views, Copy the setup. `items`: [[key,
// label], …]; `current`: the key shown; `pick(key)` on a press.
// [key, label, info?]: a tab with an info text gets its (i) beside it (a button cannot hold another button)
function subTabs(items, current, pick) {
  return h("div", { class: "subtabs", role: "tablist" }, items.filter(Boolean).map(([k, l, info]) => {
    const tab = h("button", { type: "button", role: "tab", class: k === current ? "on" : "", "aria-selected": String(k === current), onclick: () => pick(k) }, l);
    return info ? h("span", { class: "subtab-with-info" + (k === current ? " on" : "") }, tab, infoButton(l, info)) : tab;
  }));
}

// Pages of at most `per` lines for an editable list (owner, 2026-10-06: "max 15 lines, so the UI stays consistent").
// `draw(slice, offset)` fills the page; returns [box, nav, api]: api.redraw() after a change, api.last() to show the
// last page (after Add).
const PER_PAGE = 15;
function pagedBlock(count, draw, per = PER_PAGE, [prev, next, unit] = ["‹ Previous", "Next ›", "lines"]) {
  const nav = h("div", { class: "pager" });
  let page = 0;
  const pages = () => Math.max(1, Math.ceil(count() / per));
  const redraw = () => {
    page = Math.min(page, pages() - 1);
    draw(page * per, Math.min(count(), page * per + per));
    nav.replaceChildren(...(pages() > 1 ? [
      h("button", { type: "button", class: "btn ghost", disabled: page === 0, onclick: () => { page--; redraw(); } }, prev),
      h("span", { class: "muted" }, `Page ${page + 1} of ${pages()} · ${count()} ${unit}`),
      h("button", { type: "button", class: "btn ghost", disabled: page >= pages() - 1, onclick: () => { page++; redraw(); } }, next)] : []));
  };
  return { nav, redraw, last: () => { page = pages() - 1; redraw(); } };
}

// an SVG element (the bars of a chart: sizes are attributes, never a style — the page's rule allows no inline style)
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

// ---------------------------------------------------------------- the page's own dialog
// ⚠️ NEVER confirm(), alert() or prompt() (owner, 2026-10-06): the browser draws those in its own style,
// titled with the site's address. Every question goes through ask(): a <dialog> in the page's style.
// Resolves true/false, or the text typed (null when cancelled) when `input` is given.
// (Closing or reloading the TAB with unsaved changes still shows the browser's own "Leave site?":
// a page may ask for that warning, never draw it.)
function ask({ title, text = "", ok = "OK", cancel = "Cancel", danger = false, input = null }) {
  return new Promise((resolve) => {
    const field = input ? h("input", { type: "text", placeholder: input, spellcheck: "false" }) : null;
    const lines = Array.isArray(text) ? text : [text];
    const dlg = h("dialog", { class: "ask" },
      h("form", { method: "dialog" },
        h("h3", {}, title),
        lines.length > 1 ? h("ul", {}, lines.map((l) => h("li", {}, l))) : (lines[0] ? h("p", {}, lines[0]) : null),
        field,
        h("div", { class: "actions" },
          cancel ? h("button", { class: "btn ghost", value: "cancel", type: "submit" }, cancel) : null,
          h("button", { class: "btn " + (danger ? "danger" : "primary"), value: "ok", type: "submit" }, ok))));
    dlg.addEventListener("close", () => {
      const yes = dlg.returnValue === "ok";
      dlg.remove();
      resolve(input ? (yes ? field.value.trim() || null : null) : yes);
    });
    document.body.append(dlg);
    dlg.showModal();
    (field || dlg.querySelector(".btn:last-child")).focus();
  });
}
const tell = (title, text) => ask({ title, text, cancel: null });

function markDirty() { dirty = true; showBar(); }
async function guard() {
  return !dirty || ask({ title: "Unsaved changes", text: "Leave without saving? Your changes will be lost.",
                         ok: "Leave without saving", cancel: "Stay", danger: true });
}
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
    catch (e) { btn.disabled = false; tell("Not added", e.problems); }
  } }, "Add them");
  return h("div", { class: "banner" },
    h("div", {}, h("b", {}, `${names.length} AI job${names.length > 1 ? "s are" : " is"} not set: ${names.length > 1 ? "they don't" : "it doesn't"} run.`),
      h("div", { class: "muted" }, names.join(", "), " — each needs a brain and a spending limit.")), btn);
}

// ---------------------------------------------------------------- costs
const usd = (v) => "US$ " + (v || 0).toFixed((v || 0) > 0 && v < 0.01 ? 4 : 2);
const ktok = (n) => (n === null || n === undefined ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(n >= 1e5 ? 0 : 1) + "k" : String(n));
const brain = (p, m) => [p ? (PROFILES[p] || p).replace(/ \(.*/, "") : null, m ? m.replace(/^claude-/, "") : null].filter(Boolean).join(" · ") || "—";

// A run's "What": its label alone in the table; where it came from and what was asked as its tooltip
// (owner, 2026-10-04: "don't show the details directly in the table"). A tap shows the same lines under
// it — a phone has no hover, and the detail must stay reachable there.
function runWhat(r) {
  const label = r.kind === "job" ? r.work : `Reply to ${r.person || "someone"}`;
  const details = [r.kind === "chat" && r.chat ? r.chat : null, r.asked ? `“${r.asked}”` : null].filter(Boolean);
  const steps = r.steps || [];
  if (!details.length && !steps.length) return h("b", {}, label);
  // what was asked, then each tool the AI called, in order (4A): a tap shows them under the run
  const box = h("div", { class: "what-tip", title: details.join("\n"), tabindex: "0", role: "button", "aria-expanded": "false" },
    h("b", {}, label), h("div", { class: "muted what-detail" }, details.map((d) => h("div", {}, d)),
      steps.length ? h("ol", { class: "steps" }, steps.map((x) => h("li", {}, h("code", {}, x.tool), x.input ? ` ${x.input}` : ""))) : null));
  const toggle = () => box.setAttribute("aria-expanded", String(box.getAttribute("aria-expanded") !== "true"));
  box.addEventListener("click", toggle);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  return box;
}

// ⚠️ EVERYTHING ON THIS TAB FOLLOWS THE PERIOD CHOSEN, 7 DAYS UNLESS ANOTHER IS (owner, 2026-10-06): the figures,
// the chart, by work, by model, every run and the tools.
async function costs(days = 7) {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const c = await api("GET", `api/costs?days=${days}`);
  PROFILES = c.profiles || PROFILES;
  if (c.none) return fill($view, card("Costs", "The agent has not recorded anything yet (it has not run in agent mode)."));
  const period = dropdown([[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]], days, (v) => costs(Number(v)), "Period");
  const busiest = c.by_day.reduce((m, d) => (d.cost > m.cost ? d : m), { day: null, cost: 0 });
  const kpis = figures([[`Last ${days} days`, usd(c.period)], ["Runs", String(c.runs_count)],
    ["Per run", usd(c.runs_count ? c.period / c.runs_count : 0)],
    [busiest.day ? `Busiest day (${new Date(busiest.day + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" })})` : "Busiest day", usd(busiest.cost)]]);
  // the cost of each day: bars drawn in SVG, with a Y axis (US$) and its grid lines (owner, 2026-10-01: "always
  // the Y axis and grid lines"), and a date under every bar for a week, every few days for longer
  const W = 640, H = 150, L = 52, T = 8, n = c.by_day.length;
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
    { v: g.name === "not recorded" ? "—" : ktok(g.tokens_in), cls: "num" }, { v: g.name === "not recorded" ? "—" : ktok(g.tokens_out), cls: "num" }, { v: usd(g.cost), cls: "num" }, { v: usd(g.cost / g.runs), cls: "num" }]));
  const runRows = c.runs.map((r) => [
    new Date(r.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
    runWhat(r),
    brain(r.profile, r.model),
    usedTools(r.steps),
    { v: r.tokens_in === null || r.tokens_in === undefined ? "—" : `${ktok((r.tokens_in || 0) + (r.cache_read || 0) + (r.cache_write || 0))} / ${ktok(r.tokens_out)}`, cls: "num" },
    { v: usd(r.cost), cls: "num" },
    r.stopped ? h("span", { class: "chip off" }, "stopped at its limit") : r.error ? h("span", { class: "chip off" }, r.error) : ""]);
  fill($view,
    // the period's selector on the title's line, on the right (owner, 2026-10-06); the figures below a separator
    h("section", { class: "card" },
      titleWithInfo("What the AI cost", "As the Anthropic API reported it for each run: a chat reply, or a run of an AI job. Tokens in count what the agent re-read from its cache too. Everything on this tab follows the period chosen here.", "h2", period),
      h("div", { class: "divided" }, kpis), h("div", { class: "divided" }, h("h2", {}, "Per day"), chart)),
    card(`By work · last ${days} days`, "Chat replies, and each AI job.", groupTable(c.by_work, "Work")),
    card(`By model · last ${days} days`, "Which model did the work.", groupTable(c.by_model, "Model")),
    card(`Every run · last ${days} days`, `${c.runs_count} runs, newest first. Press a run to see what was asked and which tools it used (recorded from agent 0.6.42 on).`,
      paged([{ v: "When", half: true }, { v: "What", half: true }, "Brain · model", "Tools used",
             { v: "Tokens in / out", cls: "num", half: true }, { v: "Cost", cls: "num", half: true }, ""], runRows)),
    card(`Tools in the last ${days} days`, "Each tool the AI called, in how many runs and how many times. A tool never used is a candidate to switch off (Rules › What the AI can use).",
      c.tools && c.tools.length ? paged(["Tool", { v: "Runs", cls: "num" }, { v: "Calls", cls: "num" }],
        c.tools.map((t) => [h("code", {}, t.tool), { v: t.runs, cls: "num" }, { v: t.calls, cls: "num" }]))
        : h("p", { class: "muted" }, "No tool recorded in this period yet.")));
}

function usedTools(steps) {
  const n = {};
  for (const x of steps || []) n[x.tool] = (n[x.tool] || 0) + 1;
  const keys = Object.keys(n);
  return keys.length ? h("div", { class: "chips" }, keys.map((k) => h("span", { class: "chip" }, n[k] > 1 ? `${k} ×${n[k]}` : k))) : "—";
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
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", async (e) => {
  const tab = e.target.closest(".tab-file") ? "rules-file" : b.dataset.tab;
  if (tab === current || !(await guard())) return;
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
  const off = o.skills.filter((s) => !s.ok && !s.off);
  const r = o.last_24h;
  const count = (k) => (r && r.counts[k]) || 0;
  const kids = [
    jobsBanner(o.jobs_not_set, () => go("overview")),
    // the Rules and Skills tabs are one click away: only what is wrong with them is shown here
    o.policy_problems.length ? problemsBox(o.policy_problems, "Rules — to fix:") : null,
    off.length ? problemsBox(off.map((s) => `${s.name}: ${s.problem}`), `${plural(off.length, "skill", "skills")} not working:`) : null,
  ];
  if (r) {
    kids.push(card("The last 24 hours", "From the agent's own records.",
      figures([["alerts followed", count("critical_event")], ["buttons pressed", count("ladder")],
        ["actions done", count("executed") + count("direct")], ["replies written", count("run")],
        ["AI cost (USD)", r.ai_cost_usd.toFixed(2)], ["failures", count("failed") + count("code_script_failed") + count("send_failed")]]),
      r.scheduled_jobs.length ? h("div", { class: "divided" }, h("h2", {}, "Scheduled jobs run"),
        paged(["Job", "Ran at"], [...r.scheduled_jobs].reverse().map((j) => [j.job, new Date(j.ran_at).toLocaleString()]))) : null));
  } else {
    kids.push(card("The last 24 hours", "The agent has not recorded anything yet."));
  }
  kids.push(await historyCard(), setupCard());
  fill($view, ...kids);
}

// ---------------------------------------------------------------- overview › changes made on these pages (4C)
async function historyCard() {
  const { changes } = await api("GET", "api/history");
  const undo = (c) => async () => {
    if (!(await ask({ title: "Undo this change?", text: c.what, ok: "Undo" }))) return;
    try { await api("POST", `api/history/${c.id}/undo`); toast("Undone."); go("overview"); }
    catch (e) { tell("Not undone", e.problems); }
  };
  const PLACE = { Rules: "", Skills: "warn", Release: "gray", Import: "", Undo: "gray" };
  return card("Changes made on these pages", "Every save on the Rules and Skills tabs, newest first. Kept as long as the agent's other records (Rules (file) › settings.keep.records_days, 90 days by default), and trimmed with them every night. Undo writes the previous version back through the same checks as a save, and is itself recorded here.",
    changes.length ? paged(["When", "Where", "What changed", ""], changes.map((c) => [
      new Date(c.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
      h("span", { class: "chip " + (PLACE[c.place] || "") }, c.place),
      c.what,
      c.undone_by ? h("span", { class: "muted" }, "undone") : c.place === "Release" || c.target.kind === "release" || c.target.kind === "instructions" ? ""
        : h("button", { class: "btn ghost", onclick: undo(c) }, "Undo")])) : h("p", { class: "muted" }, "No change made here yet."));
}

// ---------------------------------------------------------------- overview › copy this setup to another villa (3A, 3B)
function exportCard() {
  const parts = { skills: true, villa_files: true, ai: true, actions: true, tools: true, keep: true, instructions: false };
  const tick = (k, label, sub) => h("label", { class: "tick" }, h("input", { type: "checkbox", checked: parts[k], onchange: (e) => { parts[k] = e.target.checked; } }),
    h("span", {}, label, sub ? h("span", { class: "muted small block" }, sub) : null));
  const stay = (label, sub) => h("div", { class: "tick" }, h("span", { class: "lock" }, "✕"), h("span", {}, label, sub ? h("span", { class: "muted small block" }, sub) : null));
  const btn = h("button", { class: "btn primary", onclick: async () => {
    btn.disabled = true;
    try {
      const r = await fetch("api/setup/export", { method: "POST", headers: { "Content-Type": "application/json", "X-Vesta-UI": "1" }, body: JSON.stringify(parts) });
      if (!r.ok) throw Object.assign(new Error("refused"), { problems: ((await r.json().catch(() => ({}))).problems) || [`Error ${r.status}`] });
      const name = (r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "vesta-agent-setup.zip";
      const a = h("a", { href: URL.createObjectURL(await r.blob()), download: name });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { tell("Not downloaded", e.problems || [String(e)]); }
    btn.disabled = false;
  } }, "Download the setup");
  return h("div", {}, h("p", { class: "muted" }, "One file with the skills and the shareable part of the rules. On the other villa: Import a setup."),
    h("div", { class: "grid two" },
      h("div", { class: "box" }, h("div", { class: "eyebrow" }, "Goes in the file"),
        tick("skills", "The skills, every file"), tick("villa_files", "This villa's own choices inside the skills",
          "the skills' villa.* files: e.g. which speech-to-text to use, the villa's extra report entries, the commands switched off on the Skills tab. Untick to send the skills as released, without them."),
        tick("ai", "The AI: brains, spending limits, when the conversation context is deleted, web search"),
        tick("actions", "What the agent may do: each service and who decides"),
        tick("tools", "What the AI can use: tool switches, per role, skills switched off"),
        tick("keep", "How long records are kept"), tick("instructions", "instructions.md", "your standing rules for the agent")),
      h("div", { class: "box" }, h("div", { class: "eyebrow" }, "Always stays here"),
        stay("People and their Telegram ids"), stay("Chat ids (owner, facility manager)"),
        stay("Devices: protected, excluded, allowed lists, the siren", "entity ids are this villa's"),
        stay("Keys and tokens", "never in any file the page makes"), stay("Records, transcripts, costs"))),
    h("div", { class: "actions" }, btn));
}

// Overview › Copy the setup: Download and Import, two tabs of one card (owner, 2026-10-06: a cleaner overview)
let setupTab = "out";
function setupCard() {
  const body = h("div");
  const tabs = h("div");
  const draw = () => {
    fill(tabs, subTabs([["out", "Download this villa's setup"], ["in", "Import a setup"]], setupTab, (k) => { setupTab = k; draw(); }));
    fill(body, setupTab === "out" ? exportCard() : importCard());
  };
  draw();
  return card("Copy the setup to another villa", "The skills and the shareable part of the rules, in one file, and that file read on another villa. People, chats, devices, keys and records never leave a villa.", tabs, body);
}

function importCard() {
  const out = h("div");
  const input = h("input", { type: "file", accept: ".zip,application/zip", onchange: () => input.files[0] && look(input.files[0]) });
  let zip = null;
  async function look(file) {
    fill(out, h("p", { class: "muted" }, "Reading…"));
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    zip = btoa(bin);
    try { show(file.name, await api("POST", "api/setup/import", { zip })); }
    catch (e) { fill(out, problemsBox(e.problems, "Not a setup this agent can read:")); }
  }
  function show(name, p) {
    const CH = { added: "", replaced: "", changed: "", same: "gray" };
    fill(out,
      h("p", { class: "muted" }, `${name}${p.made_with ? ` — made with agent ${p.made_with}` : ""}. Nothing is written until you press Apply.`),
      h("table", { class: "rows data" }, h("thead", {}, h("tr", {}, ["What", "Change", "Detail"].map((x) => h("th", {}, x)))),
        h("tbody", {}, p.rows.map((r) => h("tr", {}, h("td", {}, r.what), h("td", {}, h("span", { class: "chip " + (CH[r.change] || "") }, r.change[0].toUpperCase() + r.change.slice(1))),
          h("td", { class: "muted" }, r.detail))))),
      p.misfits.length ? h("div", { class: "banner warnbox" }, h("div", {}, h("b", {}, `${plural(p.misfits.length, "thing does", "things do")} not fit this villa`),
        h("ul", {}, p.misfits.map((m) => h("li", { class: "muted" }, m))))) : null,
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", onclick: () => { fill(out); input.value = ""; } }, "Cancel"),
        h("button", { class: "btn primary", disabled: !p.changes, onclick: async () => {
          try { await api("POST", "api/setup/import", { zip, apply: true, fingerprint: p.fingerprint }); toast("Imported. Every change is in Changes made on these pages."); go("overview"); }
          catch (e) { tell("Not imported", e.problems); }
        } }, p.changes ? `Apply ${plural(p.changes, "change", "changes")}` : "Nothing to change")));
  }
  return h("div", {}, h("p", { class: "muted" }, "A file made by \"Download the setup\" on another villa. You see every change, and what does not fit this villa, before anything is written."),
    h("label", { class: "field" }, h("span", {}, "Setup file"), input), out);
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
  const tools = await api("GET", "api/tools");
  return rulesForms(doc, jobs, tools);
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

function rulesForms(doc, jobs = [], tools = null) {
  const f = structuredClone(doc.form);
  const probs = h("div");
  const on = (fn) => (e) => { fn(e.target); markDirty(); };
  const num = (v) => (v === "" || v === null ? null : Number(v));

  // acting: the switch before the title, nothing else (owner, 2026-10-06); how long an Approve button works sits with
  // the services that ask for one ("What the agent may do")
  const acting = h("section", { class: "card" }, h("div", { class: "card-title" },
    h("label", { class: "switch title-switch" }, h("input", { type: "checkbox", checked: f.act_enabled, "aria-label": "The agent may act on the villa",
      onchange: on((t) => { f.act_enabled = t.checked; actState.textContent = t.checked ? "On: it may act, within the rules below." : "Off: the agent informs only."; }) })),
    h("h2", {}, "Acting on the villa", (() => { const b = h("button", { type: "button", class: "info", "aria-label": "About Acting on the villa" }, "i");
      infoTip(b, "Off: the agent informs only, and never offers to do anything. On: it may act, within the rules below; every action still goes through \"What the agent may do\"."); return b; })()),
    h("span", { class: "muted", id: "act-state" })));
  const actState = acting.querySelector("#act-state");
  actState.textContent = f.act_enabled ? "On: it may act, within the rules below." : "Off: the agent informs only.";

  // the AI
  const sel = (opts, value, set, label) => dropdown(Object.entries(opts), value, (v) => { set(v); markDirty(); }, label);
  // AI jobs: each skill's scheduled AI work, with its own brain and spending limit
  f.settings.jobs = f.settings.jobs || {};
  // The AI: one table, one row per piece of AI work (chat answers, then each skill's AI job), like
  // "What the agent may do"; then the conversation settings.
  const aiBody = h("tbody");
  const limitInput = (value, set, label, per) => h("div", {},
    h("input", { type: "number", step: "0.05", min: 0.05, value, "aria-label": label, oninput: on((t) => set(num(t.value))) }),
    h("div", { class: "muted" }, per));
  // how often a job runs, in words and per month: the scheduler's answer (/api/jobs), not re-parsed here
  // the month's ceiling: computed when the (i) of "Limit (US$)" opens, from the limits as they are on the page
  const limitNote = () => {
    const n = jobs.reduce((s, j) => s + ((f.settings.jobs[j.name] || {}).limit_usd || 0) * j.runs_per_month, 0);
    return `The most ONE piece of work may cost: one chat reply, or one run of a job — not a monthly budget. At their limits, `
      + `the scheduled runs cost at most about US$ ${n.toFixed(2)} a month. Chat replies, and reports asked for in a chat, come on top: `
      + "see the Costs tab for what was really spent.";
  };
  const drawAi = () => aiBody.replaceChildren(
    h("tr", {},
      h("td", {}, h("b", {}, "Chat answers"), h("div", { class: "muted" }, "replies in the chats; a reply at its limit offers Continue")),
      h("td", {}, sel(PROFILES, f.settings.profile, (v) => (f.settings.profile = v), "Brain")),
      h("td", {}, limitInput(f.settings.reply_limit_usd, (v) => (f.settings.reply_limit_usd = v), "Limit per reply (USD)", "for each reply")),
      // the chats' own setting, on the chats' line (owner, 2026-10-06): their tools are "everything switched on, by
      // role" — said in the (i) of "Tools it gets"
      // the menu on the line of the brain and the limit, its name under it like theirs ("for each reply")
      h("td", { class: "with-caption" }, sel(RESETS, f.settings.conversation_reset, (v) => (f.settings.conversation_reset = v), "Delete conversation context at"),
        h("div", { class: "muted" }, "Delete conversation context at")),
      h("td", { class: "x" })),
    ...jobs.map((j) => {
      const cur = f.settings.jobs[j.name];
      const what = h("td", {}, h("b", {}, j.name),
        h("div", { class: "muted" }, `${j.skill} · ${j.when_words}${j.on_request ? ", or when asked in a chat" : ""}`));
      // 1D: a report gets only the tools its skill lists (skill.yaml `tools`), among those switched on
      // one line ("12 tools from reports"), the list unfolded on demand (owner, 2026-10-06: the chips were a wall)
      const got = h("td", { class: "tools-got" }, j.tools === null || j.tools === undefined
        ? h("span", { class: "muted" }, "Everything switched on")
        : !j.tools.length ? h("span", { class: "muted" }, "None of its own")
        : h("details", { class: "fold" }, h("summary", {}, `${plural(j.tools.length, "tool", "tools")} from ${j.skill}`),
            h("ul", { class: "tool-list" }, j.tools.map((t) => h("li", {}, t)))));
      if (!cur) {
        return h("tr", {}, what, h("td", { colspan: 2, class: "muted" }, "Not set: this job does not run."), got,
          h("td", { class: "x" }, h("button", { class: "btn icon ghost", title: "Set this job", onclick: () => { f.settings.jobs[j.name] = { ...j.default }; drawAi(); markDirty(); } }, "+")));
      }
      return h("tr", {}, what,
        h("td", {}, sel(PROFILES, cur.profile, (v) => (cur.profile = v), "Brain")),
        h("td", {}, limitInput(cur.limit_usd, (v) => (cur.limit_usd = v), `Limit per run of ${j.name} (USD)`, "for each run")), got,
        h("td", { class: "x" }, h("button", { class: "btn icon ghost", title: "Stop this job", onclick: () => { delete f.settings.jobs[j.name]; drawAi(); markDirty(); } }, "×")));
    }));
  drawAi();
  const ai = card("The AI", "Which brain does each piece of work, the most ONE piece of work may cost (one chat reply, or one run of a job — not a monthly budget), and which tools a report gets: only those its skill lists. A reply that reaches its limit stops and offers Continue; a report that reaches it is still sent with what is done. A job that is not set does not run.",
    h("table", { class: "rows ai" }, h("thead", {}, h("tr", {},
      h("th", {}, "Work"), h("th", {}, "Brain"), h("th", {}, withInfo("Limit (US$)", limitNote)),
      h("th", {}, withInfo("Tools it gets", "Chat answers get every tool switched on in What the AI can use, by the person's role. A report gets only the tools its skill lists, among those switched on: to change them, edit the skill's tools list on the Skills tab — the choice then travels with the skill.")),
      h("th", {}, ""))), aiBody));
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

  // devices: chosen from the villa's own, by name (owner, 2026-10-01: "free form text inputs are not
  // suitable"). A box like a menu shows what is chosen; it opens a list with a search and a checkbox per
  // device (name, room · id). `one`: a single device (the siren), chosen by a click.
  const picker = (get, set, domains, one = false) => {
    const box = h("div", { class: "picker" });
    const shown = h("button", { type: "button", class: "picker-box", "aria-haspopup": "listbox" });
    const panel = h("div", { class: "picker-panel" });
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
    let float = null;
    function close() { if (float) float.close(); }
    shown.addEventListener("click", () => {
      if (float) return close();
      search.value = ""; drawList();
      float = floating(shown, panel, { width: Math.max(shown.getBoundingClientRect().width, 340),
                                       onClose: () => { float = null; shown.setAttribute("aria-expanded", "false"); } });
      shown.setAttribute("aria-expanded", "true"); search.focus({ preventScroll: true });   // a scroll would close it
    });
    search.addEventListener("input", () => { drawList(); if (float) float.place(); });
    panel.append(search, list,
      one ? null : h("div", { class: "picker-foot" }, h("span", { class: "muted" }, "Tick as many as needed."),
                                                    h("button", { type: "button", class: "btn ghost", onclick: close }, "Done")));
    drawShown();
    box.append(shown);
    return box;
  };
  const many = (key, domains) => picker(() => f[key] || [], (v) => (f[key] = v), domains);
  // services, who decides, and — for "only the devices in the lists" — which devices (owner, 2026-10-06: no separate
  // "Allowed lists" card; the list opens where the rule that needs it is chosen). A domain's list is shared by its
  // services (switch.turn_on and switch.turn_off): it is shown at the first of them, the others point to it.
  const svcRows = Object.entries(f.allowed_services);
  const ruleChoices = Object.entries(SCHEMA.rules).map(([k, l]) => [k, l[0].toUpperCase() + l.slice(1)]);
  const listOf = Object.fromEntries(SCHEMA.lists.flatMap((l) => l.domains.map((d) => [d, l])));
  const devicesCell = (row) => {
    const dom = (row[0] || "").split(".")[0];
    const l = listOf[dom];
    if (row[1] !== "listed") return h("span", { class: "muted small na" }, "—");      // nothing to choose (hidden on a phone)
    if (!l) return h("span", { class: "chip off" }, `no list for ${dom || "this service"}`);
    const first = svcRows.find(([k, r]) => r === "listed" && k.split(".")[0] === dom);
    if (first && first !== row) return h("span", { class: "muted small" }, `same list as ${first[0]}`);
    const box = many(l.key, l.domains);
    box.title = l.hint;
    return box;
  };
  // how long an Approve button works: with the services that ask for one, on the title's line (owner, 2026-10-06)
  const ttl = h("label", { class: "field row-inline" }, h("span", {}, withInfo("Approve buttons work for", "An Approve or Refuse button older than this does nothing: the person asks again.")),
    h("input", { type: "number", min: 1, max: 1440, value: f.approval_ttl_minutes, "aria-label": "Approve buttons work for (minutes)",
                 oninput: on((t) => (f.approval_ttl_minutes = num(t.value))) }), h("span", {}, "min"));
  const services = h("section", { class: "card" },
    titleWithInfo("What the agent may do", "One line per Home Assistant service, and who decides. Anything not listed is refused. Restarts, shell commands, toggles and the like are refused whatever this says. For \"Only the devices chosen beside it\", choose the devices on the same line: the agent may act only on those, and still asks for approval.", "h2", ttl),
    ...editTable(svcRows, {
      cls: "svc", add: "Add a service", blank: () => ["", "any"], per: 10,      // 10 lines a page (owner, 2026-10-06)
      changed: () => { f.allowed_services = Object.fromEntries(svcRows.filter(([k]) => k)); },
      columns: [{ title: "Service", width: "26%", phone: "ab" }, { title: "Who decides", width: "36%", phone: "cd" }, { title: "Devices it may act on", phone: "ef" }],
      cell: (row, k, touched, refresh) => [
        () => h("input", { type: "text", value: row[0], placeholder: "light.turn_on", "aria-label": "Service",
                           oninput: (e) => { row[0] = e.target.value.trim(); touched(); }, onchange: refresh }),
        () => dropdown(ruleChoices, row[1], (v) => { row[1] = v; touched(); refresh(); }, "Who decides"),
        () => devicesCell(row),
      ][k](),
    }));

  const devices = card("Protected devices", "Devices that need more care than the rules above give them.",
    h("div", { class: "grid" },
      field("Only the owner may approve", many("owner_only_entities", SCHEMA.actionable), "An action on these waits for the owner's Approve, whoever asks (locks, the gate, the siren)."),
      field("Left alone", many("excluded_entities", null), "Never acted on, never reported (a test device)."),
      field("Siren", picker(() => (f.siren_entity ? [f.siren_entity] : []), (v) => (f.siren_entity = v[0] || null), SCHEMA.siren_domains, true),
            "The siren the alert desk may ask the owner to sound."),
      field("Siren stops after (minutes)", h("input", { type: "number", min: 1, max: 60, value: f.siren_auto_off_min, oninput: on((t) => (f.siren_auto_off_min = num(t.value))) }))));

  const save = async () => {
    try {
      const res = await api("PUT", "api/policy/form", { form: f, rev: doc.rev });
      doc = { ...doc, ...res, problems: [] };
      dirty = false; fill(probs); showBar(); toast("Saved. The agent uses the new rules within seconds.");
    } catch (e) {
      fill(probs, problemsBox(e.problems)); probs.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  acting.id = "rules-acting"; services.id = "rules-services";
  setBar({ save, discard: () => rules("forms"), idle: "Changes apply within seconds, no restart." });
  const canUse = tools ? toolsCard(f, tools, () => rules("forms")) : null;
  fill($view, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    jobsBanner(missing, () => rules("forms")), acting, people, chats, services, devices, canUse, ai);
  if (jumpTo === "tools" && canUse) { jumpTo = null; requestAnimationFrame(() => canUse.scrollIntoView({ block: "start" })); }
}

// ---------------------------------------------------------------- rules › what the AI can use
// Three switches in policy.yaml (tool_access.py on the agent's side): the Home Assistant tools it may read with
// (ha_read_tools), the agent's own tools a villa may switch off (agent_tools; web search is settings.web_search),
// and what the facility manager may make it use (tool_access.fm). Saved with the rest of the form.
let toolsTab = "ha";
// a link to another card of the Rules page: scrolls to it and outlines it a moment
function jump(id, label) {
  return h("a", { href: `#${id}`, class: "jump", onclick: (e) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
  } }, label);
}
let jumpTo = null;           // "tools": open Rules on "What the AI can use" (a skill's "Open Rules › What the AI can use")
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function toolsCard(f, t, reload) {
  f.ha_read_tools = f.ha_read_tools || []; f.agent_tools = f.agent_tools || {}; f.tool_access = f.tool_access || {};
  const body = h("div");
  // ⚠️ ONE CARD PER TOOL, BOTH TABS (owner, 2026-10-06): its name and switch on top, what it does, then its id and
  // notes; at most 4 a row, fewer on a narrower screen (app.css .tool-grid)
  const toolCard = (on, set, title, { chip = null, words, meta }, disabled = false) => h("div", { class: "tool-card" + (on ? " is-on" : "") + (disabled ? " locked" : "") },
    h("div", { class: "tool-card-head" }, h("b", {}, title, chip),
      h("label", { class: "switch" }, h("input", { type: "checkbox", checked: on, disabled, "aria-label": title,
                                                   onchange: (e) => { set(e.target.checked); markDirty(); draw(); } }))),
    words, h("div", { class: "tool-meta" }, meta));
  const used = (n) => (n ? h("span", { class: "badge" }, `used ${n}× this week`) : null);
  const ha = () => {
    const on = new Set(f.ha_read_tools);
    const refresh = h("button", { class: "btn ghost", onclick: async () => {
      refresh.disabled = true; refresh.textContent = "Reading…";
      try { Object.assign(t, await api("POST", "api/tools/refresh")); toast("The list was read again."); }
      catch (e) { tell("Not read", e.problems); }
      draw();
    } }, "Read the list again");
    const head = h("div", { class: "tools-head" },
      h("div", {}, h("b", {}, t.count ? `${[...on].filter((n) => t.groups.some((g) => g.tools.some((x) => x.name === n))).length} of ${t.count} tools on.` : "The list is not read yet."),
        h("span", { class: "muted" }, t.read_at ? ` From Home Assistant's MCP server${t.server ? " " + t.server : ""}, read ${new Date(t.read_at).toLocaleString()}.` : " The agent reads it when it starts.")),
      t.new_off ? h("span", { class: "chip warn" }, `${plural(t.new_off, "new tool", "new tools")} since an update — off`) : null, refresh);
    // every tool in its group's order, 16 cards a page (four rows of four); a group's heading where its cards start
    const lines = t.groups.flatMap((g) => g.tools.map((x) => ({ g, x })));
    const list = h("div");
    const pages = pagedBlock(() => lines.length, (from, to) => {
      const parts = [];
      for (const { g, x } of lines.slice(from, to)) {
        if (!parts.length || parts[parts.length - 1].g !== g) parts.push({ g, cards: [] });
        parts[parts.length - 1].cards.push(toolCard(on.has(x.name),
          (v) => { f.ha_read_tools = v ? [...f.ha_read_tools, x.name] : f.ha_read_tools.filter((n) => n !== x.name); }, x.title,
          { chip: x.new ? h("span", { class: "chip warn" }, "New") : null, words: h("div", { class: "muted" }, x.description),
            meta: [h("code", {}, x.name), x.note ? h("span", { class: "badge" }, x.note) : null, used(x.used)] }));
      }
      list.replaceChildren(...parts.flatMap(({ g, cards }) => [
        h("div", { class: "tool-group-head tool-group" }, h("b", {}, g.label),
          h("span", { class: "muted" }, ` ${g.tools.filter((y) => on.has(y.name)).length} of ${g.tools.length} on`)),
        h("div", { class: "tool-grid" }, cards)]));
    }, 16, ["‹ Previous", "Next ›", "tools"]);
    pages.redraw();
    const groups = [list, pages.nav];
    const unknown = t.unknown.length ? problemsBox(t.unknown.map((n) => `${n}: named in the file, but this Home Assistant's MCP server has no such tool.`), "Not on this Home Assistant:") : null;
    const never = t.never.length ? h("details", { class: "tool-group never" },
      h("summary", {}, h("b", {}, "Never available"), h("span", { class: "muted" }, ` ${plural(t.never.length, "tool", "tools")} that change Home Assistant — locked by the agent, whatever is chosen here`)),
      h("div", { class: "chips" }, t.never.map((x) => h("span", { class: "chip off", title: x.description }, x.title)))) : null;
    return [head, unknown, ...groups, never];
  };
  const own = () => {
    const kinds = [["choose", "You choose", null], ["elsewhere", "Set elsewhere", null], ["always", "Always on", "the agent cannot work without them"]];
    return kinds.map(([kind, title, sub]) => h("div", { class: "tool-group" },
      h("div", { class: "tool-group-head" }, h("b", {}, title), sub ? h("span", { class: "muted" }, ` — ${sub}`) : null),
      h("div", { class: "tool-grid" }, t.own.filter((x) => x.kind === kind).map((x) => {
        const isWeb = x.key === "web_search";
        const on = kind !== "choose" ? true : isWeb ? !!f.settings.web_search : f.agent_tools[x.key] !== false;
        const set = (v) => { if (isWeb) f.settings.web_search = v; else if (v) delete f.agent_tools[x.key]; else f.agent_tools[x.key] = false; };
        // "set elsewhere": a link to each section that decides it (owner, 2026-10-06)
        const words = x.kind === "elsewhere"
          ? h("div", { class: "muted" }, "Decided by ", jump("rules-acting", "Acting on the villa"), " and ", jump("rules-services", "What the agent may do"), ": every action goes through those rules.")
          : h("div", { class: "muted" }, x.description);
        return toolCard(on, set, x.label, { words, meta: [h("code", {}, x.key === "web_search" ? "WebSearch" : x.key), used(x.used)] },
          kind !== "choose");
      }))));
  };
  const roles = () => {
    const fm = f.tool_access.fm || {};
    return [h("p", { class: "muted" }, "When a person writes, the AI only gets the tools their role allows; in the facility manager's chat, never more than the facility manager's. A tool switched off in the first two tabs is off for everyone. Guests: the agent answers only the people in Rules › People (owner or facility manager), so a guest gets no answer at all for now."),
      h("table", { class: "rows roles" },
        h("colgroup", {}, h("col", {}), h("col", { width: "18%" }), h("col", { width: "18%" }), h("col", { width: "14%" })),
        h("thead", {}, h("tr", {}, ["Tools", "Owner", "Facility manager", "Guest"].map((x) => h("th", {}, x)))),
        h("tbody", {}, t.roles.map((g) => h("tr", {},
          h("td", {}, h("b", {}, g.label)),
          h("td", {}, h("label", { class: "switch" }, h("input", { type: "checkbox", checked: true, disabled: true, "aria-label": `${g.label}: owner` }))),
          h("td", {}, h("label", { class: "switch" }, h("input", { type: "checkbox", checked: fm[g.key] !== false, "aria-label": `${g.label}: facility manager`,
            onchange: (e) => { const m = { ...(f.tool_access.fm || {}) }; if (e.target.checked) delete m[g.key]; else m[g.key] = false;
                               if (Object.keys(m).length) f.tool_access.fm = m; else delete f.tool_access.fm; markDirty(); } }))),
          h("td", { class: "muted", title: "There is no guest role yet: the agent answers only the owner and the facility manager" }, "—"))))),
      h("p", { class: "muted" }, "Asking for an action is decided by \"What the agent may do\": who approves stays there.")];
  };
  const tabs = h("div");
  function draw() {
    fill(tabs, subTabs([["ha", "Reading Home Assistant"], ["own", "The agent's own tools"], ["roles", "Who may use what"]], toolsTab,
                       (k) => { toolsTab = k; draw(); }));
    fill(body, ...({ ha, own, roles })[toolsTab]());
  }
  draw();
  const c = card("What the AI can use", "Each tool the AI may call. A tool switched off does not exist for it, in chats and in reports. Changes count at the next message.", tabs, body);
  c.id = "rules-tools";
  return c;
}

// ---------------------------------------------------------------- skills
// A skill's state against this release: it follows the releases (never edited here), it was edited here (updates
// paused), or it is the villa's own. Its on/off switch is the villa's (policy.yaml skills_off).
const STATE_WORDS = { follows: "Follows the releases", edited: "Edited here · updates paused", own: "This villa's own skill" };

function skillChips(s) {
  return [s.off ? h("span", { class: "chip gray" }, "Off") : null,
          !s.off && !s.ok ? h("span", { class: "chip off" }, "Not working") : null,
          s.state === "edited" ? h("span", { class: "chip warn" }, "edited here") : null];
}

function skillSwitch(name, on, select) {
  return h("label", { class: "switch skill-switch", title: on ? "On: the agent uses it" : "Off: kept, not used" },
    h("input", { type: "checkbox", checked: on, "aria-label": `${name} on`, onchange: async (e) => {
      const now = e.target.checked;
      if (!now && !(await ask({ title: `Switch ${name} off?`, ok: "Switch off", danger: true,
        text: "The agent stops using it at once: no schedule, no alert hook, not read in a chat. Its files are kept; switch it on again here." }))) { e.target.checked = true; return; }
      if (!(await guard())) { e.target.checked = !now; return; }
      try { await api("PUT", `api/skills/${encodeURIComponent(name)}/on`, { on: now }); toast(`${name} switched ${now ? "on" : "off"}.`); skills(select); }
      catch (err) { e.target.checked = !now; tell("Not changed", err.problems); }
    } }));
}

async function skills(select = null) {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const { skills: list } = await api("GET", "api/skills");
  const side = h("div", { class: "card" },
    titleWithInfo("Skills", "Each skill is a folder of files. A change counts at the agent's next use, no restart. The switch beside a skill turns it on or off for this villa."),
    // each skill: its name and line (opens it), and its On/Off switch beside it (owner, 2026-10-06)
    list.length ? list.map((s) => h("div", { class: "skill-item" + (s.name === select ? " on" : "") + (s.off ? " is-off" : "") },
      h("button", { type: "button", class: "skill-open", onclick: async () => { if (await guard()) skills(s.name); } },
        h("div", { class: "skill-name" }, h("b", {}, s.name), ...skillChips(s)),
        h("div", { class: "d" }, s.off ? "Off · kept, not used" : s.ok ? s.description : s.problem.startsWith("It needs") ? "A tool it needs is switched off." : s.problem)),
      skillSwitch(s.name, !s.off, select))) : h("p", { class: "muted" }, "No skill yet. The starter skills are copied at the agent's first start."),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: newSkill }, "New skill")));
  const pane = h("div");
  side.classList.add("skills-side");
  fill($view, h("div", { class: "skills" }, side, pane));
  dirty = false; setBar(null);
  if (select) openSkill(select, pane, list.find((s) => s.name === select));
}

async function setCommand(skill, script, command, on, box) {
  try { await api("PUT", `api/skills/${encodeURIComponent(skill)}/commands`, { script, command, on }); toast(`${command || script} switched ${on ? "on" : "off"} for the AI.`); }
  catch (e) { box.checked = !on; tell("Not changed", e.problems); }
}

// 2C's one-press fix: the tool switched on through the same save as the Rules form
async function switchTool(b) {
  const doc = await api("GET", "api/policy");
  const form = doc.form;
  if (b.fix === "ha") form.ha_read_tools = [...new Set([...(form.ha_read_tools || []), b.tool])];
  else if (b.tool === "web_search") form.settings.web_search = true;
  else { form.agent_tools = { ...(form.agent_tools || {}) }; delete form.agent_tools[b.tool]; }
  await api("PUT", "api/policy/form", { form, rev: doc.rev });
}

// Skills › Try a command: run by the agent on the live villa, exactly as the AI would — nothing is sent.
// Two steps (owner, 2026-10-06: "badly rendered, not understandable"): what to run, its options in words; then Run.
const FLAG_HELP = { date: "a day, e.g. 2026-10-05", text: "a word or a few", switch: "" };
function tryPanel(name, d) {
  const out = h("div");
  const runnable = d.scripts.filter((sc) => !sc.whole_off);
  if (!runnable.length) return h("p", { class: "muted" }, "Every script of this skill is switched off for the AI.");
  let script = runnable[0], command = null, values = {};
  const what = h("div", { class: "try-row" }), opts = h("div", { class: "try-opts" });
  const args = () => {
    const a = command ? [command] : [];
    for (const [flag, kind] of Object.entries(script.flags)) {
      const v = values[flag];
      if (kind === "switch") { if (v) a.push(flag); } else if (v) a.push(flag, String(v));
    }
    return a;
  };
  const draw = () => {
    const cmds = script.commands.filter((c) => c.on);
    if (!cmds.some((c) => c.name === command)) command = cmds.length ? cmds[0].name : null;
    fill(what,
      field("Script", dropdown(runnable.map((sc) => [sc.script, sc.script]), script.script, (v) => { script = runnable.find((x) => x.script === v); values = {}; draw(); }, "Script")),
      cmds.length ? field("Command", dropdown(cmds.map((c) => [c.name, c.words ? `${c.name} — ${c.words}` : c.name]), command, (v) => { command = v; }, "Command")) : null);
    // A file it reads is one an earlier step left in the out folder (a page's --facts: the file the step before it
    // wrote): chosen among them, the one named after the option first. A file it writes is named here, for the next
    // step (--energy: the week's energy, saved by another skill's script, 2026-10-06)
    const flags = Object.entries(script.flags);
    fill(opts, flags.length ? flags.map(([flag, kind]) => {
      const label = flag.replace(/^--/, "").replace(/-/g, " ");
      if (kind === "infile" && values[flag] === undefined) {
        const own = (d.out_files || []).find((f) => f.replace(/\.[^.]+$/, "") === flag.replace(/^--/, ""));
        values[flag] = own || "";
      }
      const input = kind === "outfile"
        ? h("input", { type: "text", value: values[flag] || "", placeholder: "not saved, e.g. week.json", "aria-label": label,
            oninput: (e) => { values[flag] = e.target.value.trim(); } })
        : kind === "infile"
        ? dropdown([["", "not given"], ...(d.out_files || []).map((f) => [f, f])], values[flag], (v) => { values[flag] = v; }, label)
        : Array.isArray(kind)
        ? dropdown([["", "not set"], ...kind.map((k) => [k, k])], values[flag] || "", (v) => { values[flag] = v; }, label)
        : kind === "switch"
          ? h("label", { class: "switch" }, h("input", { type: "checkbox", checked: !!values[flag], "aria-label": label,
              onchange: (e) => { values[flag] = e.target.checked; } }), "yes")
          : h("input", { type: "text", value: values[flag] || "", placeholder: FLAG_HELP[kind] || "", "aria-label": label,
              oninput: (e) => { values[flag] = e.target.value.trim(); } });
      return field(label[0].toUpperCase() + label.slice(1), input,
        kind === "infile" ? `${flag} · a file an earlier step left` : kind === "outfile" ? `${flag} · saved for a next step`
          : Array.isArray(kind) ? `one of: ${kind.join(", ")}` : flag);
    }) : h("p", { class: "muted small" }, "This command takes no options."));
  };
  // the answer is asked for every second: a command may run for minutes (nightly.py), longer than a page request lives
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function waitFor(rid) {
    const t0 = Date.now();
    for (;;) {
      const r = await api("GET", `api/tries/${encodeURIComponent(rid)}`);
      if (!r.pending) return r;
      const s = Math.round((Date.now() - t0) / 1000);
      if (!r.started && s > 30) return { ok: false, error: "The agent did not start it: it is stopped, or waiting for a setting (see its log)." };
      fill(out, h("p", { class: "muted" }, r.started ? `Running on the villa… ${s} s` : "Waiting for the agent…"));
      await sleep(1000);
    }
  }
  async function run() {
    fill(out, h("p", { class: "muted" }, "Running on the villa…"));
    try {
      const { pending } = await api("POST", `api/skills/${encodeURIComponent(name)}/try`, { script: script.script, args: args() });
      const r = await waitFor(pending);
      // a file it saved is offered to the next step at once
      try { d.out_files = (await api("GET", `api/skills/${encodeURIComponent(name)}`)).out_files; draw(); } catch { /* kept */ }
      fill(out, r.ok === false && r.exit === undefined ? problemsBox([r.error], "Not run:") : [
        h("div", { class: "try-result" }, h("span", { class: "chip" + (r.exit === 0 ? "" : r.exit === 2 ? " warn" : " off") },
          r.exit === 0 ? "Done" : r.exit === 2 ? "Nothing to do, or a setting is missing" : `Stopped (exit ${r.exit})`),
          h("span", { class: "muted small" }, `${r.seconds} s · the answer the AI would get · nothing was sent`)),
        r.error ? problemsBox([r.error], "The script stopped:") : null,
        h("pre", { class: "out" }, pretty(r.output))]);
    } catch (e) { fill(out, problemsBox(e.problems, "Not run:")); }
  }
  draw();
  return h("div", { class: "skill-sec try" },
    h("h3", {}, "1 · What to run"), what,
    h("h3", {}, "2 · Options"), opts,
    h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: run }, "Run")),
    out);
}

function pretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text || "(no output)"; }
}

function shown(rows, around = 2) {
  const keep = rows.map(() => false);
  rows.forEach((r, i) => { if (!r.same) for (let k = Math.max(0, i - around); k <= Math.min(rows.length - 1, i + around); k++) keep[k] = true; });
  const out = [];
  rows.forEach((r, i) => { if (keep[i]) out.push(r); else if (out.length && out[out.length - 1] !== null) out.push(null); });
  if (out.length && out[out.length - 1] === null) out.pop();
  if (rows.length && !keep[0] && out[0] !== null) out.unshift(null);
  return out;
}

// Skills › Compare with the release: an edited starter skill's file beside the release's
async function comparePanel(name, rel) {
  const box = h("div");
  const list = rel.differs || [];
  let file = list.find((f) => !(rel.only_here || []).includes(f)) || list[0];
  const draw = async () => {
    const { rows } = await api("GET", `api/skills/${encodeURIComponent(name)}/compare?path=${encodeURIComponent(file)}`);
    fill(box,
      h("div", { class: "files" }, list.map((f) => h("button", { class: f === file ? "on" : "", onclick: () => { file = f; draw(); } },
        f + ((rel.only_here || []).includes(f) ? " · only here" : (rel.only_release || []).includes(f) ? " · only in the release" : "")))),
      h("div", { class: "compare" },
        h("div", { class: "compare-head" }, h("b", {}, "Here"), h("b", {}, "The release")),
        // only the changed lines and 2 around each; "…" where the files agree (on a phone: one column, labelled)
        shown(rows).map((r) => r === null ? h("div", { class: "compare-gap" }, "…") : h("div", { class: "compare-row" + (r.same ? "" : " diff") },
          h("pre", { class: r.here === null ? "gap" : "", "data-side": "here" }, r.here ?? ""),
          h("pre", { class: r.release === null ? "gap" : "", "data-side": "release" }, r.release ?? "")))),
      h("p", { class: "muted small" }, "\"Take the release version\" replaces the skill's files with the release's and keeps this villa's own files (villa.*). Your edits are moved to skills/.trash."));
  };
  if (file) await draw(); else fill(box, h("p", { class: "muted" }, "No file differs."));
  return h("div", { class: "skill-sec" }, box);
}

async function newSkill() {
  const name = await ask({ title: "New skill", text: "Its name: lower-case letters, digits, - and _.", ok: "Create", input: "e.g. pool-care" });
  if (!name || !(await guard())) return;
  try { await api("POST", "api/skills", { name }); toast(`Skill ${name} created.`); skills(name); }
  catch (e) { tell("Not created", e.problems); }
}

let filesOpen = false;

const ABOUT = "\u0000about", TRY = "\u0000try", COMPARE = "\u0000compare";

// One skill: its name, state and switch on top, then four views (owner, 2026-10-06: "very messy" — one thing at a
// time). About: when it acts, what the AI may run, the tools it needs. Files: the editor. Try a command. Compare.
async function openSkill(name, pane, info, path = ABOUT) {
  const enc = encodeURIComponent(name);
  const [{ files }, d] = await Promise.all([api("GET", `api/skills/${enc}/files`), api("GET", `api/skills/${enc}`)]);
  if (path === COMPARE && (d.release || {}).state !== "edited") path = ABOUT;
  if (path === TRY && !(d.scripts && d.scripts.length)) path = ABOUT;
  const isFile = ![ABOUT, TRY, COMPARE].includes(path);
  if (isFile && !files.some((x) => x.path === path)) path = files.length ? files[0].path : null;
  const rel = d.release || {};
  const goTo = async (p) => { if (p !== path && await guard()) openSkill(name, pane, info, p); };
  pane.closest(".skills")?.classList.add("has-open");

  // ---- the head (a phone only: the list is hidden there) and the state pill, which sits on the tabs' line
  const pill = rel.state ? h("span", { class: "chip" + (rel.state === "edited" ? " warn" : rel.state === "own" ? " gray" : "") }, STATE_WORDS[rel.state]) : null;
  const back = h("button", { class: "btn ghost back-to-list", onclick: async () => { if (await guard()) skills(); } }, "‹ All skills");
  const head = h("div", { class: "skill-head" },
    h("div", { class: "skill-title" }, h("h2", {}, name), pill ? pill.cloneNode(true) : null,     // the phone's place for the pill
      d.off ? h("span", { class: "chip gray" }, "Off") : !d.ok ? h("span", { class: "chip off" }, "Not working") : null),
    skillSwitch(name, !d.off, name));

  // ---- what needs the owner's attention, above everything
  const fixes = (d.blocked || []).filter((b) => b.fix);
  const blocked = d.blocked && d.blocked.length ? h("div", { class: "problems" },
    h("b", {}, "The agent cannot use this skill right now."),
    h("ul", {}, d.blocked.map((b) => h("li", {}, b.why))),
    h("p", { class: "muted" }, "Its AI jobs (reports) do not run, and a reply that needed it says which setting stops it."),
    h("div", { class: "actions" },
      ...fixes.map((b) => h("button", { class: "btn primary", onclick: async () => {
        try { await switchTool(b); toast(`${b.label} switched on.`); skills(name); } catch (err) { tell("Not changed", err.problems); }
      } }, `Switch ${b.label} on`)),
      h("button", { class: "btn ghost", onclick: async () => { if (await guard()) { jumpTo = "tools"; toolsTab = "ha"; go("rules"); } } }, "Open Rules › What the AI can use"))) : null;
  const notLoaded = info && !info.ok && !(d.blocked && d.blocked.length) && !d.off ? problemsBox([info.problem], "The agent does not use this skill:") : null;
  const releaseBanner = rel.state === "edited" && !rel.kept ? h("div", { class: "banner" },
    h("div", {}, h("b", {}, "This version of the agent has another version of this skill."),
      h("div", { class: "muted" }, `It was edited here, so it was kept as it is (${plural(rel.differs.length, "file differs", "files differ")}).`)),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", onclick: () => goTo(COMPARE) }, "Compare"),
      h("button", { class: "btn ghost", onclick: async () => { await api("POST", `api/skills/${enc}/keep`); toast("Kept as it is."); skills(name); } }, "Keep mine"),
      h("button", { class: "btn primary", onclick: async () => {
        if (!(await ask({ title: "Take the release version?", ok: "Take the release version", danger: true,
          text: "The skill's files are replaced by the release's; this villa's own files (villa.*) are kept. Your edits are moved to skills/.trash, and Undo (Overview › Changes) brings them back." }))) return;
        try { await api("POST", `api/skills/${enc}/take-release`); toast("The release's version is in place."); skills(name); }
        catch (err) { tell("Not changed", err.problems); }
      } }, "Take the release version"))) : null;

  // ---- the views
  const FILES = "\u0000files";             // the Files tab stands for whichever file is open
  const tabs = subTabs([[ABOUT, "About"], [FILES, "Files"], d.scripts && d.scripts.length ? [TRY, "Try a command", "Runs one of this skill's commands on the villa, exactly as the AI would: it changes nothing in Home Assistant, uses no AI and costs nothing. Messages or tickets it would create are shown here, never sent. A file it saves stays in the agent's out folder, for a next step."] : null,
                        rel.state === "edited" ? [COMPARE, "Compare"] : null], isFile ? FILES : path,
                       (k) => goTo(k === FILES ? (isFile ? path : "SKILL.md") : k));
  // ⚠️ NO TITLE, NO DESCRIPTION, NO SWITCH HERE ON A WIDE SCREEN (owner, 2026-10-06): the list beside it holds the
  // name, the line and the switch. The name and the switch come back on a phone, where the list is hidden.
  const card = (...kids) => fill(pane, h("div", { class: "card skill-pane" }, back, head, blocked, notLoaded, releaseBanner,
    h("div", { class: "skill-bar" }, tabs, pill), ...kids));

  if (path === ABOUT) { card(aboutSkill(name, d)); setBar(null); return; }
  if (path === TRY) { card(tryPanel(name, d)); setBar(null); return; }
  if (path === COMPARE) { card(await comparePanel(name, rel)); setBar(null); return; }

  // ---- Files: the list, the editor, the file's actions
  const probs = h("div");
  const ta = h("textarea", { class: "editor", spellcheck: "false", oninput: markDirty });
  ta.addEventListener("keydown", (e) => {            // Tab indents instead of leaving the editor
    if (e.key !== "Tab") return;
    e.preventDefault();
    const s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end"); markDirty();
  });
  let fileRev = null;
  const load = async (p) => {
    const f = await api("GET", `api/skills/${enc}/file?path=${encodeURIComponent(p)}`);
    ta.value = f.content; fileRev = f.rev; dirty = false; showBar(); fill(probs);
  };
  // one line of files while collapsed (the open one first, so it always shows); a button shows them all,
  // and appears only when they do not fit on that line. Open or closed is kept from skill to skill.
  const differs = new Set(rel.differs || []), villa = new Set(rel.villa || []);
  const fileList = h("div", { class: "files" + (filesOpen ? "" : " collapsed") },
    files.map((x) => h("button", { class: x.path === path ? "on" : "", title: [differs.has(x.path) ? "differs from the release" : "", villa.has(x.path) ? "this villa's own file, kept by updates" : ""].filter(Boolean).join(" · ") || null,
      onclick: () => goTo(x.path) }, x.path, differs.has(x.path) ? h("span", { class: "dot warn" }) : null, villa.has(x.path) ? h("span", { class: "dot" }) : null)));
  const more = h("button", { class: "btn ghost files-more", hidden: true, onclick: () => {
    filesOpen = !filesOpen; fileList.classList.toggle("collapsed", !filesOpen); fits(); } });
  const fits = () => {
    const overflow = fileList.scrollHeight > fileList.clientHeight + 1;
    more.hidden = !filesOpen && !overflow;
    more.textContent = filesOpen ? "Fewer" : `All ${files.length} files`;
  };
  // measured after layout and on a window resize (a ResizeObserver here loops: the button changes the width it watches)
  requestAnimationFrame(fits);
  const onResize = () => (fileList.isConnected ? fits() : window.removeEventListener("resize", onResize));
  window.addEventListener("resize", onResize);
  const save = async () => {
    try {
      const r = await api("PUT", `api/skills/${enc}/file?path=${encodeURIComponent(path)}`, { content: ta.value, rev: fileRev });
      fileRev = r.rev; dirty = false; fill(probs); showBar(); toast(`${path} saved.`);
    } catch (e) { fill(probs, problemsBox(e.problems)); }
  };
  const newFile = async () => {
    const p = await ask({ title: "New file", text: `In ${name}. A folder may be part of the name.`, ok: "Create",
                          input: "e.g. scripts/check.py or templates/page.html" });
    if (!p || !(await guard())) return;
    try {
      await api("PUT", `api/skills/${enc}/file?path=${encodeURIComponent(p)}`, { content: p.endsWith(".py") ? "#!/usr/bin/env python3\n" : "", rev: null });
      toast(`${p} created.`); openSkill(name, pane, info, p);
    } catch (e) { tell("Not created", e.problems); }
  };
  const delFile = async () => {
    if (!(await ask({ title: `Delete ${path}?`, text: `It is removed from ${name}.`, ok: "Delete", danger: true }))) return;
    try { await api("DELETE", `api/skills/${enc}/file?path=${encodeURIComponent(path)}`); dirty = false; toast(`${path} deleted.`); openSkill(name, pane, info, "SKILL.md"); }
    catch (e) { fill(probs, problemsBox(e.problems, "Not deleted:")); }
  };
  const delSkill = async () => {
    if (!(await ask({ title: `Delete the skill ${name}?`, ok: "Delete the skill", danger: true,
                      text: "The agent stops using it at once. It is kept in skills/.trash, and does not come back on its own." }))) return;
    try { await api("DELETE", `api/skills/${enc}`); dirty = false; toast(`Skill ${name} deleted.`); skills(); }
    catch (e) { tell("Not deleted", e.problems); }
  };
  card(h("div", { class: "files-row" }, fileList, more),
    (differs.size || villa.size) ? h("p", { class: "muted small legend" },
      differs.size ? [h("span", { class: "dot warn" }), " differs from the release  "] : null,
      villa.size ? [h("span", { class: "dot" }), " this villa's own file, kept by updates"] : null) : null,
    probs, path ? ta : h("p", { class: "muted" }, "No file."),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", onclick: newFile }, "New file"),
      path && !["SKILL.md", "skill.yaml"].includes(path) ? h("button", { class: "btn ghost", onclick: delFile }, "Delete this file") : null,
      h("button", { class: "btn danger push-right", onclick: delSkill }, "Delete the skill")));
  setBar({ save, discard: () => load(path), idle: path ? `Editing ${path}. Saves are checked before they are written.` : "" });
  if (path) await load(path);
}

// Skills › About: three short sections, each a list of aligned rows
function aboutSkill(name, d) {
  if (!d.acts) return h("p", { class: "muted" }, "The agent cannot read this skill's skill.yaml: open Files to fix it.");
  const row = (left, right, extra) => h("div", { class: "kv" }, h("div", { class: "kv-k" }, left), h("div", { class: "kv-v" }, right), extra || null);
  // When it acts: the schedule first, then events, then the chats
  const acts = [...d.acts.slice(1), d.acts[0]].map((a) => {          // the schedule first, the chats last
    const [when, job] = a.when.split(" — ");
    const kind = a.how === "AI job" ? "AI job" : a.how ? "code, no AI" : null;
    return row(when.replace(/^every chat message, when the AI reads it$/, "in a chat"),
      [job ? h("b", {}, job) : a.how && a.how !== "AI job" ? h("code", {}, a.how.split(" ")[0]) : h("span", { class: "muted" }, "when a person asks about it"),
       kind ? h("span", { class: "chip gray tiny" }, kind) : null]);
  });
  // What the AI may run: a switch per command, its words under it
  const runs = (d.scripts || []).map((sc) => h("div", { class: "cmd-group" },
    h("div", { class: "cmd-script" }, h("code", {}, sc.script)),
    sc.commands.length ? sc.commands.map((c) => h("div", { class: "cmd-row" },
      h("label", { class: "switch" }, h("input", { type: "checkbox", checked: c.on, "aria-label": `${sc.script} ${c.name}`,
        onchange: (e) => setCommand(name, sc.script, c.name, e.target.checked, e.target) })),
      h("div", { class: "cmd-text" }, h("b", {}, c.name), c.words ? h("div", { class: "muted" }, c.words) : null,
        c.job_only ? h("div", { class: "muted small" }, `Asked for in a chat, it runs as the ${c.job_only} job.`) : null)))
      : h("div", { class: "cmd-row" },
        h("label", { class: "switch" }, h("input", { type: "checkbox", checked: !sc.whole_off, "aria-label": sc.script,
          onchange: (e) => setCommand(name, sc.script, null, e.target.checked, e.target) })),
        // a script without commands: what it does (skill.yaml `description`), then its options, each as written
        h("div", { class: "cmd-text" }, h("span", { class: "plain" }, sc.description || "The AI may run it."),
          Object.keys(sc.flags).length ? h("div", { class: "chips" }, Object.keys(sc.flags).map((fl) => h("code", { class: "flag" }, fl))) : null))));
  // Tools it needs: a one-line verdict; the list folded unless something is off
  let tools;
  if (d.needs === null || d.needs === undefined) tools = h("p", { class: "muted" }, "Its skill.yaml lists none: its reports get every tool switched on.");
  else if (!d.needs.length) tools = h("p", { class: "muted" }, "None: the AI needs no tool of its own for this skill.");
  else {
    const off = d.needs.filter((n) => !n.on);
    const chip = (n) => h("span", { class: "chip" + (n.on ? "" : " off"), title: n.tool },
      n.label + ({ off: " — off", missing: " — not on this Home Assistant", never: " — never available" }[n.state] || ""));
    tools = [h("p", {}, off.length ? h("b", { class: "warn-text" }, `${off.length} of ${d.needs.length} not available`) : h("span", {}, `${plural(d.needs.length, "tool", "tools")}, all switched on`)),
      off.length ? h("div", { class: "chips" }, off.map(chip)) : null,
      h("details", { class: "fold" }, h("summary", {}, off.length ? "All of them" : "Show them"), h("div", { class: "chips" }, d.needs.map(chip)))];
  }
  return h("div", { class: "about" },
    h("section", { class: "about-sec" }, h("h3", {}, "When it acts"), acts),
    d.scripts && d.scripts.length ? h("section", { class: "about-sec" }, h("h3", {}, "What the AI may run"),
      h("p", { class: "muted small" }, "Switch a command off and the AI cannot run it here. Saved in the skill's villa.skill.yaml: kept by updates, copied with the skill."), runs) : null,
    h("section", { class: "about-sec" }, h("h3", {}, "Tools it needs"), tools,
      h("p", { class: "muted small" }, "Switched on or off in Rules › What the AI can use.")));
}

go(["overview", "rules", "rules-file", "skills", "costs"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview");
