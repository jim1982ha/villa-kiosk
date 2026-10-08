// VESTA Agent page — the shared pieces: the page's state, the helpers every tab draws with, the dialog, the tab switch.

// what several tabs read and change: one object (a module cannot assign another module's variables)
export const page = {
  dirty: false,           // unsaved changes on the current screen
  current: "overview",
  PROFILES: {},           // the brains as the server names them (policy.profile_labels): filled by Rules and Costs
  jumpTo: null,             // "tools": open Rules on "What the AI can use" (a skill's "Open Rules › What the AI can use")
  toolsTab: "ha",
  views: {},                // the tabs, by name: filled by app.js
};


export const $view = document.getElementById("view");
export const $bar = document.getElementById("savebar");
export const $toast = document.getElementById("toast");


// ---------------------------------------------------------------- helpers
export function h(tag, attrs = {}, ...kids) {
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
export function floating(anchor, panel, { width = null, center = false, onClose = () => {} } = {}) {
  panel.classList.add("floating");
  // inside an open popup (a modal <dialog>, the top layer), a panel on the body would draw UNDER it
  (anchor.closest && anchor.closest("dialog[open]") || document.body).append(panel);
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
export function dropdown(options, value, pick, label) {
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
export function editTable(rows, { cls, columns, cell, blank, add, changed = () => {}, per = PER_PAGE }) {
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

export async function api(method, path, body) {
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
  // ⚠️ EVERY FAILURE SAYS WHY (architecture review 7): a dropped connection (an Ingress session ended, the agent
  // restarting) threw an error with no reasons, and the page showed an empty box or a "Not changed" with no words
  let r;
  try {
    r = await fetch(path, opts);                     // relative: works under Home Assistant's Ingress path
  } catch {
    throw Object.assign(new Error("unreachable"), { status: 0, problems: [UNREACHABLE] });
  }
  let data = {};
  try { data = await r.json(); } catch { /* an empty answer */ }
  if (!r.ok) {
    const problems = Array.isArray(data.problems) && data.problems.length ? data.problems
      : [r.status === 401 || r.status === 403 ? "The Home Assistant session has ended: reload the page." : `The agent answered with error ${r.status}.`];
    throw Object.assign(new Error("refused"), { problems, status: r.status });
  }
  return data;
}

export const UNREACHABLE = "The VESTA Agent could not be reached (the connection dropped, or the app is restarting). Reload the page, then try again.";

// The reasons of any error, in words: a refusal's own, or what went wrong.
export const reasons = (e) => (e && Array.isArray(e.problems) && e.problems.length ? e.problems : [String(e || "Something went wrong.")]);

// ⚠️ ONE SAVE (review 7: three copies): send it, then mark the page clean, clear the problems and say so — or show
// why it was not saved, in view.
export async function saveWith(probs, send, okText) {
  try {
    const res = await send();
    page.dirty = false; fill(probs); showBar(); toast(okText);
    return res;
  } catch (e) {
    fill(probs, problemsBox(reasons(e)));
    probs.scrollIntoView?.({ behavior: "smooth", block: "center" });
    return null;
  }
}

// replaceChildren() prints a null as the text "null": the optional parts are filtered first.
export function fill(el, ...kids) { el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false)); }

export function toast(text) {
  $toast.textContent = text; $toast.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => ($toast.hidden = true), 3500);
}

export function problemsBox(list, title = "Not saved:") {
  if (!list || !list.length) return null;
  return h("div", { class: "problems" }, h("b", {}, title), h("ul", {}, list.map((p) => h("li", {}, p))));
}

// A card: its title, and what it is about behind an (i) beside it (owner, 2026-10-06: no description paragraph
// under every title). Hover shows it; a tap (a phone has no hover) opens it under the title. A card with nothing
// else in it (an empty state) keeps its text in view: there it IS the content.
export function card(title, lead, ...kids) {
  const content = kids.flat().filter((k) => k !== null && k !== undefined && k !== false);
  if (!lead || !content.length) return h("section", { class: "card" }, h("h2", {}, title), lead ? h("p", { class: "lead" }, lead) : null, ...kids);
  return h("section", { class: "card" }, titleWithInfo(title, lead), ...kids);
}

// A title, its (i), and an optional control on the same line, right-aligned (the Costs' period).
// ⚠️ THE TEXT IS A TOOLTIP, NEVER INSERTED IN THE PAGE (owner, 2026-10-06): it floats over the page on hover or
// keyboard focus, and on a tap (a phone has no hover); a second tap, a tap elsewhere, Escape or scrolling closes it.
export function titleWithInfo(title, text, tag = "h2", right = null) {
  const btn = h("button", { type: "button", class: "info", "aria-label": `About ${title}: ${text}`, "aria-expanded": "false" }, "i");
  infoTip(btn, text);
  return h("div", { class: "card-title" }, h(tag, {}, title, btn), right ? h("div", { class: "card-title-right" }, right) : null);
}

// a label with its (i) — a column heading, a field: the (i) takes the size of the text it sits in (app.css em units)
export function withInfo(label, text) {
  return h("span", { class: "with-info" }, label, infoButton(label, text));
}

// A switch as a card (owner, 2026-10-06/07): its title and switch on one line, what it does under it, a small line
// of facts at the bottom. The one card for every switch the page draws as cards — Rules › What the AI can use and
// Skills › What the AI may run — laid out by `.tool-grid` (four a line; `.tool-grid.three`: three).
// onChange(checked, input): the card's own look follows at once.
// ⚠️ ONE CARD (owner, 2026-10-08: a skill's tools "the same way cards are used to display commands"): its title,
// a chip, what it is, a line under it — and on the right whatever the caller puts there (a switch: toggleCard).
export function tileCard(title, { chip = null, words = null, meta = null, side = null, on = true, cls = "" } = {}) {
  return h("div", { class: "tool-card" + (on ? " is-on" : "") + (cls ? " " + cls : "") },
    h("div", { class: "tool-card-head" }, h("b", {}, title, chip), side),
    words, h("div", { class: "tool-meta" }, meta));
}

// `action`: a button on the card's top line, left of its switch (owner, 2026-10-08: the Offline Test pill there,
// not a line of its own)
export function toggleCard(on, onChange, title, { chip = null, words = null, meta = null, label = null, action = null } = {}, disabled = false) {
  let card = null;
  const sw = h("label", { class: "switch" }, h("input", { type: "checkbox", checked: on, disabled, "aria-label": label || title,
    onchange: (e) => { card.classList.toggle("is-on", e.target.checked); onChange(e.target.checked, e.target); } }));
  card = tileCard(title, { chip, words, meta, side: action ? h("div", { class: "tool-card-side" }, action, sw) : sw, on,
                           cls: disabled ? "locked" : "" });
  return card;
}

// an alert's (!): the (i)'s behaviour — hover, tap — in the alert colour, for what went wrong (owner, 2026-10-07: "api error
// 400" was a pill in the table)
export function alertButton(about, text) {
  const btn = h("button", { type: "button", class: "info alert", "aria-label": `${about}: details`, "aria-expanded": "false" }, "!");
  infoTip(btn, text, "alert");
  return btn;
}

// the (i) itself, its text shown on hover and on a tap (infoTip)
export function infoButton(about, text) {
  const btn = h("button", { type: "button", class: "info", "aria-label": `About ${about}`, "aria-expanded": "false" }, "i");
  infoTip(btn, text);
  return btn;
}

export let openTip = null;
export function infoTip(btn, text, kind = "") {
  let float = null, pinned = false;
  const close = () => { if (float) float.close(); };
  const open = () => {
    if (float) return;
    if (openTip) openTip();
    float = floating(btn, h("div", { class: "tooltip" + (kind ? " " + kind : ""), role: "tooltip" }, typeof text === "function" ? text() : text), { width: 360, center: true,
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
export function figures(pairs) {
  return h("div", { class: "figures" },
    pairs.map(([label, value]) => h("div", { class: "kpi" }, h("div", { class: "n" }, value), h("div", { class: "l" }, label))));
}

export function field(label, input, hint) {
  // a <label> forwards a click inside it to its first control: a picker (a box and a list) is in a <div>
  const tag = input && input.classList && input.classList.contains("picker") ? "div" : "label";
  return h(tag, { class: "field" }, h("span", {}, label), input, hint ? h("span", { class: "hint" }, hint) : null);
}

// A table of many rows, 10 to a page (owner, 2026-10-01): `head` the column titles, `rows` arrays of cells;
// a cell is a node, a text, or {v, cls}. Newest first is the caller's order.
export function paged(head, rows, per = 10) {
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
export function subTabs(items, current, pick) {
  return h("div", { class: "subtabs", role: "tablist" }, items.filter(Boolean).map(([k, l, info]) => {
    const tab = h("button", { type: "button", role: "tab", class: k === current ? "on" : "", "aria-selected": String(k === current), onclick: () => pick(k) }, l);
    return info ? h("span", { class: "subtab-with-info" + (k === current ? " on" : "") }, tab, infoButton(l, info)) : tab;
  }));
}

// Pages of at most `per` lines for an editable list (owner, 2026-10-06: "max 15 lines, so the UI stays consistent").
// `draw(slice, offset)` fills the page; returns [box, nav, api]: api.redraw() after a change, api.last() to show the
// last page (after Add).
export const PER_PAGE = 15;
export function pagedBlock(count, draw, per = PER_PAGE, [prev, next, unit] = ["‹ Previous", "Next ›", "lines"]) {
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
export function svg(tag, attrs = {}, ...kids) {
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
export function ask({ title, text = "", ok = "OK", cancel = "Cancel", danger = false, input = null }) {
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
export const tell = (title, text) => ask({ title, text, cancel: null });

// A part of the page in a popup over it (owner, 2026-10-08: a command's Offline Test opens from its card): the
// same <dialog> as ask(), wider, closed by its Close button, Escape or a click on the backdrop.
export function popup(title, body, info = null) {
  const dlg = h("dialog", { class: "ask wide" },
    h("div", { class: "popup-head" }, h("h3", {}, info ? withInfo(title, info) : title),
      h("button", { type: "button", class: "btn ghost", autofocus: true, onclick: () => dlg.close() }, "Close")),
    body);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function markDirty() { page.dirty = true; showBar(); }
export async function guard() {
  return !page.dirty || ask({ title: "Unsaved changes", text: "Leave without saving? Your changes will be lost.",
                         ok: "Leave without saving", cancel: "Stay", danger: true });
}
window.addEventListener("beforeunload", (e) => { if (page.dirty) { e.preventDefault(); e.returnValue = ""; } });

export let barState = null;
export function setBar(state) { barState = state; showBar(); }
export function showBar() {
  $bar.replaceChildren();
  if (!barState) { $bar.hidden = true; return; }
  $bar.hidden = false;
  $bar.append(h("span", { class: "msg" }, page.dirty ? "Unsaved changes" : barState.idle || ""),
    barState.discard ? h("button", { class: "btn ghost", disabled: !page.dirty, onclick: barState.discard }, "Discard") : null,
    h("button", { class: "btn primary", disabled: !page.dirty, onclick: barState.save }, barState.label || "Save"));
}

// ---------------------------------------------------------------- AI jobs not set
// A job policy.yaml does not name does not run (owner, 2026-10-01): say so where it is seen, and add them
// with the starter values their skill offers, in one press.
export async function addMissingJobs() {
  const [doc, { jobs }] = await Promise.all([api("GET", "api/policy"), api("GET", "api/jobs")]);
  const form = doc.form;
  form.settings.jobs = form.settings.jobs || {};
  for (const j of jobs) if (!j.set) form.settings.jobs[j.name] = { ...j.default };
  await api("PUT", "api/policy/form", { form, rev: doc.rev });
}

export function jobsBanner(names, after) {
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

export function go(tab) {
  page.current = tab; page.dirty = false; setBar(null);
  history.replaceState(null, "", "#" + tab);
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab.replace("-file", "")));
  document.querySelector(".tab-file").classList.toggle("on", tab === "rules-file");
  page.views[tab]();          // filled by app.js: the tabs
}
// a link to another card of the Rules page: scrolls to it and outlines it a moment
export function jump(id, label) {
  return h("a", { href: `#${id}`, class: "jump", onclick: (e) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
  } }, label);
}           // "tools": open Rules on "What the AI can use" (a skill's "Open Rules › What the AI can use")
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
