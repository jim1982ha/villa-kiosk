// VESTA Agent page — the shared pieces: the page's state, the helpers every tab draws with, the dialog, the tab switch.
import { afterMove } from "./float.js";   // what a floating panel does when the page moves under it

// ⚠️ THE PAGE'S PLACES (owner, 2026-10-08: one name per place). vesta_agent/places.py names every card and tab, and
// the server writes that table into the page: a title is place("tools"), a sentence that sends the reader there says
// where("tools") — "Rules › AI tools". No section name is written anywhere else (tests/test_ui.py).
const PAGE = (() => { try { return JSON.parse(document.getElementById("places").textContent); } catch { return {}; } })();
const PLACES = PAGE.places || {};
// a {slot} in a title is filled from `names` ({skill: "reports"}), or left out with its space (places.title, the same rule)
export const place = (k, names = {}) => (PLACES[k] || [k])[0].replace(/\{(\w+)\} ?/g, (_, v) => (names[v] ? `${names[v]} ` : ""));
// a tab's sections in their order (places.ORDER): `sections` by place key → the nodes, top to bottom
export const inOrder = (tab, sections) => (PAGE.order?.[tab] || Object.keys(sections)).map((k) => sections[k]);
export const where = (k) => (PLACES[k] ? `${PLACES[k][1]} › ${place(k)}` : k);

// what several tabs read and change: one object (a module cannot assign another module's variables)
export const page = {
  dirty: false,           // unsaved changes on the current screen
  current: "overview",
  tabs: {},                 // the tab each tabbed section shows, by its id (core.tabbed): kept while the page is open
  focusLimit: null,         // the Limits row a press on a value (core.setting) asked for: read once by the Limits tab
  place: [],                // the tab's own place in it (placed): a skill and its file, Costs' period; go() opens it again
  shown: new Map(),         // the tabbed sections drawn since the tab was opened, each with its first tab (address)
  back: null,               // where a press on a value came from: {tab, place, y} — the Limits tab's Back (goBack)
  views: {},                // the tabs, by name: filled by app.js
  fileView: null,           // a file shown formatted or raw (viewer.js): one choice for every file, while the page is open
};

export const $view = document.getElementById("view");
const $bar = document.getElementById("savebar");
const $toast = document.getElementById("toast");

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
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false)
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

// ⚠️ THE ONE FLOATING PANEL (owner, 2026-10-06: "use the same code for similar features"). The dropdown's list, the
// device picker's list and the (i)'s tooltip all float over the page the same way: on the page body, fixed, so a
// table cell or a card cannot clip or squeeze them (the picker's list inside a table cell took the cell's input
// rules); under the anchor, or above it when there is no room below; closed by a click outside, Escape, a scroll
// of the page or a resize — placed again instead while the focus is inside it (float.afterMove: a phone's keyboard
// opening is a resize). `width`: a fixed width (else the anchor's, at least 180 px); `center`: centred on it.
// `fit`: a text to read (the tooltip): when neither below nor above holds it, it takes the screen's height, over its
// anchor, rather than a box to scroll that hides most of it (owner, 2026-11-11: "I can't see all the text")
export function floating(anchor, panel, { width = null, center = false, fit = false, onClose = () => {} } = {}) {
  panel.classList.add("floating");
  // inside an open popup (a modal <dialog>, the top layer), a panel on the body would draw UNDER it
  (anchor.closest && anchor.closest("dialog[open]") || document.body).append(panel);
  const place = () => {
    const b = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(width || Math.max(b.width, 180), vw - 16);
    const left = Math.min(Math.max(8, center ? b.left + b.width / 2 - w / 2 : b.left), vw - 8 - w);
    Object.assign(panel.style, { width: `${w}px`, left: `${left}px`, top: "", bottom: "", maxHeight: "" });
    const want = panel.scrollHeight, below = vh - b.bottom - 12, above = b.top - 12;
    if (fit && want > Math.max(below, above)) {
      Object.assign(panel.style, { top: `${Math.max(8, (vh - want) / 2)}px`, maxHeight: `${vh - 16}px` });
      return;
    }
    const up = want > below && above > below;
    panel.style.maxHeight = `${Math.max(120, Math.min(want, up ? above : below))}px`;
    if (up) panel.style.bottom = `${vh - b.top + 6}px`; else panel.style.top = `${b.bottom + 6}px`;
  };
  const outside = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(); };
  const moved = (e) => {
    const did = afterMove(!!(e && e.target instanceof Node && panel.contains(e.target)), panel.contains(document.activeElement));
    if (did === "close") close(); else if (did === "place") place();
  };
  // the keyboard of a phone moves the visual viewport (iOS Safari: often without a window resize); absent: window's only
  const vv = window.visualViewport || null;
  const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); if (anchor.focus) anchor.focus(); } };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    panel.remove();
    document.removeEventListener("pointerdown", outside, true); window.removeEventListener("scroll", moved, true);
    window.removeEventListener("resize", moved); document.removeEventListener("keydown", esc, true);
    if (vv) { vv.removeEventListener("resize", moved); vv.removeEventListener("scroll", moved); }
    onClose();
  }
  place();
  document.addEventListener("pointerdown", outside, true); window.addEventListener("scroll", moved, true);
  window.addEventListener("resize", moved); document.addEventListener("keydown", esc, true);
  if (vv) { vv.addEventListener("resize", moved); vv.addEventListener("scroll", moved); }
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
// on a phone, a line of its own each: "ab" the first, "cd" the second, "ef" the third (app.css .ph-*).
// The remove button is always at the end of the first line. Returns [table, its Add button].
export function editTable(rows, { columns, cell: draw, blank, add, changed = () => {}, per = PER_PAGE }) {
  const body = h("tbody");
  const touched = () => { changed(); markDirty(); };
  const pager = pagedBlock(() => rows.length, (from, to) => body.replaceChildren(...rows.slice(from, to).map((row, k) => tableRow([
    ...columns.map((c, j) => ({ cls: `ph-${c.phone}`, v: draw(row, j, touched, () => pager.redraw()) })),
    { cls: "x ph-x", v: button("icon", { title: "Remove", onclick: () => { rows.splice(from + k, 1); pager.redraw(); touched(); } }, "×") }]))), per);
  pager.redraw();
  return [table([...columns.map((c) => c.title), ""], body, { cls: "edit", widths: [...columns.map((c) => c.width), "44"] }), pager.nav, h("div", { class: "actions" }, button("", { onclick: () => { rows.push(blank()); pager.last(); touched(); } }, add))];
}

// A file the person picked, as base64 for a JSON body (an imported setup, a .skill file): read in slices, so a large
// file never overflows String.fromCharCode's arguments.
export async function fileBase64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// `file`: the answer is a file to save ({blob, name}); its refusal still comes as reasons (the export used its own
// fetch and its own error handling, architecture review 9)
export async function api(method, path, body, { file = false } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined || method !== "GET") {          // a write: the page's header, and a body (an empty one too)
    opts.headers = { "Content-Type": "application/json", "X-Vesta-UI": "1" };
    opts.body = JSON.stringify(body !== undefined ? body : {});
  }
  // ⚠️ EVERY FAILURE SAYS WHY (architecture review 7): a dropped connection (an Ingress session ended, the agent
  // restarting) threw an error with no reasons, and the page showed an empty box or a "Not changed" with no words
  let r;
  try {
    r = await fetch(path, opts);                     // relative: works under Home Assistant's Ingress path
  } catch {
    throw Object.assign(new Error("unreachable"), { status: 0, problems: [UNREACHABLE] });
  }
  if (file && r.ok) return { blob: await r.blob(), name: (r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] };
  let data = {};
  try { data = await r.json(); } catch { /* an empty answer */ }
  if (!r.ok) {
    const problems = Array.isArray(data.problems) && data.problems.length ? data.problems
      : [r.status === 401 || r.status === 403 ? "Your session in the villa's system has ended: reload the page." : `The agent answered with error ${r.status}.`];
    throw Object.assign(new Error("refused"), { problems, status: r.status });
  }
  return data;
}

const UNREACHABLE = "The VESTA Agent could not be reached (the connection dropped, or the app is restarting). Reload the page, then try again.";

// The reasons of any error, in words: a refusal's own, or what went wrong.
export const reasons = (e) => (e && Array.isArray(e.problems) && e.problems.length ? e.problems : [String(e || "Something went wrong.")]);

// ⚠️ ONE SAVE (review 7: three copies; UI scan 2026-11-10: three more, the rows saved at once): send it, clear the
// problems and say so — or show why it was not saved, in view. `okText`: the words, or (answer) => the words;
// `title`: the refusal's heading. Returns the answer, null when it was refused.
export async function saveNow(probs, send, okText, title = "Not saved:") {
  try {
    const res = await send();
    fill(probs); toast(typeof okText === "function" ? okText(res) : okText);
    return res;
  } catch (e) {
    fill(probs, problemsBox(reasons(e), title));
    probs.scrollIntoView?.({ behavior: "smooth", block: "center" });
    return null;
  }
}
// the save bar's save: the same, and the page is clean again
export async function saveWith(probs, send, okText) {
  const res = await saveNow(probs, send, okText);
  if (res !== null) { page.dirty = false; showBar(); }
  return res;
}

// replaceChildren() prints a null as the text "null": the optional parts are filtered first.
export function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); }

// what every tab shows while its answer is on the way (its tabbed sections are drawn again after it: none shown yet)
export const loading = () => { page.shown.clear(); fill($view, h("p", { class: "muted" }, "Loading…")); };

// ⚠️ THE ADDRESS SAYS WHERE YOU ARE (owner's UI scan, 2026-11-10: he checks each update by reloading and looking at one
// screen, and a reload gave the tab alone: the card back on its first tab, the open skill closed). The address is
// "#tab/place?section=tab": the tab, its own place in it (placed: a skill and its file, Costs' period) and every
// tabbed section that is not on its first tab. Written here only, at each move; read once, when the page opens
// (opened). A search and the page of a list are not in it: they start fresh.
function address() {
  const subs = [...page.shown].filter(([id, first]) => page.tabs[id] !== first).map(([id]) => [id, page.tabs[id]]);
  history.replaceState(null, "", "#" + [page.current, ...page.place].map(encodeURIComponent).join("/")
    + (subs.length ? "?" + new URLSearchParams(subs) : ""));
}
// a tab's own place in it, for the address: the words its view is opened with again (go's `place`)
export function placed(...words) { page.place = words; address(); }
// the address read: [tab, place]; its tabbed sections are put where core.tabbed looks for them. An address the page
// does not have opens Overview.
export function opened(hash) {
  try {
    const [path, subs] = hash.replace(/^#/, "").split("?");
    const [tab, ...place] = path.split("/").map(decodeURIComponent);
    if (!Object.hasOwn(page.views, tab)) return ["overview", []];
    new URLSearchParams(subs || "").forEach((key, id) => { page.tabs[id] = key; });
    return [tab, place];
  } catch (e) { return ["overview", []]; }               // an address cut or typed wrong
}

// ⚠️ A MOMENT IS THE SERVER'S WORDS, NEVER WRITTEN HERE (owner's UI scan, 2026-11-10): every answer says its moments
// and days in the villa's time, as the messages write them (server._said). The page turned the stored moments into
// words itself, in the browser's zone and country format, so the same run read differently here and on Telegram.

// The search over a list (Limits, Knowledge's two device lists): `words` its placeholder and its name, `typed(text)`
// on every key.
export function searchBox(words, value, typed) {
  return h("div", { class: "search-box" }, h("input", { type: "search", placeholder: words, value, "aria-label": words,
    oninput: (e) => typed(e.target.value) }));
}

export function toast(text) {
  $toast.textContent = text; $toast.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => ($toast.hidden = true), 3500);
}

// ---------------------------------------------------------------- the page's pieces, each drawn by one builder
// ⚠️ ONE DEFINITION PER PIECE (owner, 2026-11-10: "only 1 definition for all similar UI elements … changing 1 code
// will naturally waterfall and apply by design to all UI elements using this code"). A button, a pill, a switch, a
// note, a heading, an empty state: each is built here and styled once in app.css; a tab never writes their classes.

// ⚠️ ONE STATUS TABLE: a status is a NAME, its look is here (its two colours once in app.css, read by whatever shows
// a status: .chip, .note, .dot). The server names a status too (history.CHIPS, limits_tab.TOLD), never a look.
// Red is "alert", needs attention, and nothing else: a tool switched off or never available is quiet, not wrong.
const STATUS = {
  "": "",             // fine, or simply a name: the page's green
  warn: "warn",       // worth a look: amber
  alert: "alert",     // needs attention: red
  gray: "gray",       // quiet: off, locked, nobody is told
};
const look = (base, status) => `${base} ${STATUS[status || ""] ?? ""}`.trim();

// the one pill of words: a status ("Not working"), or a name (a device, a skill, a tool); `title`: its tooltip
export const chip = (words, status = "", title = null) => h("span", { class: look("chip", status), title }, words);

// The one button. `kind`: "" the usual one, "primary" the screen's main action, "danger" one that deletes, "icon" a
// square one ("×"); its place on its line may follow ("danger push-right").
export const button = (kind, attrs, ...words) => h("button", { type: "button", class: `btn ${kind}`.trim(), ...attrs }, ...words);
// the one small pill-shaped button: a run's "3 steps ▸" (moreButton), a command's Offline Test, a list's "more ▾"
export const pillButton = (attrs, ...words) => h("button", { type: "button", class: "pill-btn", ...attrs }, ...words);

// The one switch. `change(on, input)` on a press (none: it is only shown, locked); `label` names it for a screen
// reader; `words` are said beside it.
export function toggle(on, change, label, { disabled = false, title = null, cls = "", words = null } = {}) {
  return h("label", { class: `switch ${cls}`.trim(), title }, h("input", { type: "checkbox", checked: on, disabled, "aria-label": label,
    onchange: change ? (e) => change(e.target.checked, e.target) : null }), words);
}

// The one file chooser: a button of the page's own, the browser's input behind it (its "Choose file… No file chosen"
// follows no theme). `picked(file)` on a choice; the same file may be chosen again.
export function fileButton(accept, picked, label) {
  const input = h("input", { type: "file", accept, hidden: true, onchange: () => {
    const file = input.files[0];
    input.value = "";
    if (file) picked(file);
  } });
  return [button("", { onclick: () => input.click() }, label), input];
}

// The one note over what it is about: a bold line, its words or its list, its buttons at the right. "alert": refused
// or broken (problemsBox); "warn": it works, and there is something to look at or to do.
export function note(status, title, words = null, actions = null) {
  return h("div", { class: look("note", status) }, h("div", {}, h("b", {}, title), words),
    actions ? h("div", { class: "actions" }, actions) : null);
}
export const bullets = (list) => h("ul", {}, list.map((l) => h("li", {}, l)));
export function problemsBox(list, title = "Not saved:") {
  if (!list || !list.length) return null;
  return note("alert", title, bullets(list));
}

// The one heading inside a card (the card's own title is its h2): a group of tools, a part of a skill's About, the
// cost per day. `words`: a quiet note after it ("2 of 3 on").
export const heading = (title, words = null) => h("h3", {}, title, words ? h("span", { class: "muted" }, ` ${words}`) : null);
// The one group inside a card: a hairline, its heading, what it holds. `folded`: the same, opened and closed by a
// press on its heading.
export const group = (title, words, ...kids) => h("div", { class: "group" }, heading(title, words), ...kids);
export const folded = (title, words, open, ...kids) => h("details", { class: "group", open }, h("summary", {}, heading(title, words)), ...kids);
// the one small round mark of a status, beside a name (a file that differs from the release) and in its legend
export const dot = (status = "") => h("span", { class: look("dot", status) });
// a title and how many it holds: "Pumps (11)"
export const counted = (title, n) => `${title} (${n})`;

// ⚠️ NOTHING TO SHOW IS SAID ONE WAY: "—" where a value is missing, a few words where a list is empty ("None", "No
// change made here yet."); `tag` "p" when it stands alone under a title.
export const DASH = "—";
export const none = (words = DASH, tag = "span") => h(tag, { class: "none" }, words);

// A card: its title, and what it is about behind an (i) beside it (owner, 2026-10-06: no description paragraph
// under every title). Hover shows it; a tap (a phone has no hover) opens it under the title. A card with nothing
// else in it (an empty state) keeps its text in view: there it IS the content.
// No title: a card that is one place's whole screen (an open skill), its heading drawn by its caller.
const cardBox = (head, kids) => h("section", { class: "card" }, head, ...kids);
export function card(title, lead, ...kids) {
  const content = kids.flat().filter((k) => k !== null && k !== undefined && k !== false);
  if (!title) return cardBox(null, kids);
  if (!lead || !content.length) return cardBox([h("h2", {}, title), lead ? h("p", { class: "lead" }, lead) : null], kids);
  return cardBox(cardTitle(title, lead), kids);
}

// A card whose title's line holds a control, on the right: Costs' period, Allowed actions' Approve time, Limits' Back,
// the switch of "The agent may act".
export function cardWith(right, title, lead, ...kids) {
  return cardBox(cardTitle(title, lead, right), kids);
}

// A title, its (i), and an optional control on the same line, right-aligned (cardWith).
// ⚠️ THE TEXT IS A TOOLTIP, NEVER INSERTED IN THE PAGE (owner, 2026-10-06): it floats over the page on hover or
// keyboard focus, and on a tap (a phone has no hover); a second tap, a tap elsewhere, Escape or scrolling closes it.
function cardTitle(title, text, right = null) {
  return h("div", { class: "card-title" }, h("h2", {}, title, infoButton(title, text)), right ? h("div", { class: "card-title-right" }, right) : null);
}

// a label with its (i) — a column heading, a field: the (i) takes the size of the text it sits in (app.css em units)
export function withInfo(label, text) {
  return h("span", { class: "with-info" }, label, infoButton(label, text));
}

// A switch as a card (owner, 2026-10-06/07): its title and switch on one line, what it does under it, a small line
// of facts at the bottom. The one card for every switch the page draws as cards — Rules › AI tools and
// Skills › About › Skill commands — laid out by `.tool-grid` (four a line; `.tool-grid.three`: three).
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
  const sw = toggle(on, (checked, input) => { card.classList.toggle("is-on", checked); onChange(checked, input); }, label || title, { disabled });
  card = tileCard(title, { chip, words, meta, side: action ? h("div", { class: "tool-card-side" }, action, sw) : sw, on,
                           cls: disabled ? "locked" : "" });
  return card;
}

// an alert's (!): the (i)'s behaviour — hover, tap — in the alert colour, for what went wrong (owner, 2026-10-07: "api error
// 400" was a pill in the table)
export const alertButton = (about, text) => tipButton("alert", `${about}: details`, text);

// the (i) itself, its text shown on hover and on a tap (infoTip)
export function infoButton(about, text) {
  // read aloud with its words when they are known now: a text, or a node showing a value a person can change
  // (core.setting); a text made when it opens is only named
  const words = text instanceof Node ? text.textContent : typeof text === "string" ? text : "";
  return tipButton("", words ? `About ${about}: ${words}` : `About ${about}`, text);
}

// the round button both are: `kind` "" the (i), "alert" the (!)
function tipButton(kind, label, text) {
  const btn = h("button", { type: "button", class: `info ${kind}`.trim(), "aria-label": label, "aria-expanded": "false" }, kind ? "!" : "i");
  infoTip(btn, text, kind);
  return btn;
}

let openTip = null;
// ⚠️ 540 WIDE, AND IT STAYS OPEN UNDER THE POINTER (owner, 2026-11-11: a long (i) was cut, and it closed as soon as the
// pointer left the (i), so its scroll could not be reached): the pointer may move from the (i) onto the text
const TIP_WIDTH = 540;
function infoTip(btn, text, kind = "") {
  let float = null, pinned = false, leaving = null;
  const close = () => { clearTimeout(leaving); if (float) float.close(); };
  const later = () => { clearTimeout(leaving); if (!pinned) leaving = setTimeout(close, 200); };
  const open = () => {
    clearTimeout(leaving);
    if (float) return;
    if (openTip) openTip();
    const panel = h("div", { class: "tooltip" + (kind ? " " + kind : ""), role: "tooltip" }, typeof text === "function" ? text() : text);
    panel.addEventListener("mouseenter", () => clearTimeout(leaving));
    panel.addEventListener("mouseleave", later);
    float = floating(btn, panel, { width: TIP_WIDTH, center: true, fit: true,
      onClose: () => { float = null; pinned = false; btn.setAttribute("aria-expanded", "false"); if (openTip === close) openTip = null; } });
    btn.setAttribute("aria-expanded", "true");
    openTip = close;
  };
  btn.addEventListener("mouseenter", open);
  btn.addEventListener("mouseleave", later);
  btn.addEventListener("focus", open);
  btn.addEventListener("blur", () => { if (!pinned) close(); });
  btn.addEventListener("click", (e) => { e.preventDefault(); if (pinned) close(); else { open(); pinned = true; } });
}

// A set of figures, each a number over its label: THE one way the page shows them (the Costs; Overview's
// 24-hour counters moved there, owner 2026-10-22). They sit side by side, as many to a row as the width allows — two on a
// phone, never one per line (owner, 2026-10-02: six figures stacked down a phone screen). The
// form fields keep .grid, one per line on a phone, which is right for inputs.
export function figures(pairs) {
  return h("div", { class: "figures" },
    pairs.map(([label, value]) => h("div", { class: "kpi" }, h("div", { class: "n" }, value), h("div", { class: "l" }, label))));
}

// `hint`: a small note under it; `after`: what follows the input on its own line (a unit, an (i)): the label, the
// input and they then sit on one line
export function field(label, input, hint = null, after = null) {
  // a <label> forwards a click inside it to its first control: a picker (a box and a list) is in a <div>
  const tag = input && input.classList && input.classList.contains("picker") ? "div" : "label";
  return h(tag, { class: "field" + (after ? " row-inline" : "") }, h("span", {}, label), input, after,
    hint ? h("span", { class: "muted small" }, hint) : null);
}

// A table of many rows, 10 to a page (owner, 2026-10-01): `head` the column titles, `rows` arrays of cells;
// a cell is a node, a text, or {v, cls}. `nav`: the pager's words, "‹ Previous", "Next ›" unless the caller says
// otherwise: NEWEST_FIRST for a list in time's order, its own unit for one that has a name ("devices", "limits").
// ⚠️ "NEWER / OLDER" ONLY WHERE THE LIST IS BY TIME (UI scan, 2026-11-10): it was the default, so the Limits tab, a
// skill's "When it runs" and the Costs tab's tables by skill, by model and by tool turned to "Older" pages.
export const NEWEST_FIRST = ["‹ Newer", "Older ›", "rows"];
const NAV = ["‹ Previous", "Next ›", "rows"];
export function paged(head, rows, per = PER_PAGE, { cls = "", widths = null, nav = NAV } = {}) {
  const body = h("tbody");
  // each cell carries its column's name: on a phone the row becomes a card, every value on its own line, its name on
  // the left (app.css; owner, 2026-10-31: no two columns sharing a line any more, their values left and right)
  // a heading with its (i) (withInfo: Knowledge › Devices' Run hours) is named by its words, never by the node
  const label = head.map((c) => (c instanceof Node ? c.firstChild?.textContent || "" : String(isCell(c) ? c.v : c || "")));
  const line = (cells) => h("tr", {}, cells.map((c, i) => cell(c, "td", { label: label[i] })));
  // a row is its cells, or {cells, more}: `more` drawn on its own line under the row, across every column, while the
  // row's moreButton is open (Costs › Every run: a run's question and steps, owner 2026-10-19 — they were squeezed
  // into the What column and pushed the row tall)
  // (each row's two lines are made once: a page turned and back keeps a row open with its button saying so)
  const made = new Map();
  const drawn = (r) => {
    if (Array.isArray(r)) return [line(r)];
    if (!made.has(r)) made.set(r, r.more ? [line(r.cells), h("tr", { class: "row-more", hidden: true }, cell({ v: r.more, colspan: head.length }))] : [line(r.cells)]);
    return made.get(r);
  };
  // the one pager (pagedBlock)
  const pager = pagedBlock(() => rows.length, (from, to) => body.replaceChildren(...rows.slice(from, to).flatMap(drawn)),
    per, nav);
  pager.redraw();
  return h("div", {}, h("div", { class: "tbl" }, table(head, body, { cls: `data ${cls}`.trim(), widths })), pager.nav);
}

// The button that opens a paged row's `more` (the line under it): "11 steps ▸", "▾" while open.
export function moreButton(label) {
  const btn = pillButton({ "aria-expanded": "false" }, label, h("span", { class: "caret" }, "▸"));
  btn.addEventListener("click", () => {
    const more = btn.closest("tr")?.nextElementSibling;
    if (!more || !more.classList.contains("row-more")) return;
    more.hidden = !more.hidden;
    btn.setAttribute("aria-expanded", String(!more.hidden));
    btn.lastChild.textContent = more.hidden ? "▸" : "▾";
  });
  return btn;
}

// ⚠️ THE ONE TABLE (DRY, owner 2026-10-08: "all the tables formatted the same way, from the same code"). Every table on
// the page is built here and styled by table.rows: paged (read-only, 10 a page), editTable (rows added and removed),
// the AI's work and the tools by role (Rules). `head`: the column titles; `body`: rows of cells, or a <tbody> its caller
// fills; `widths`: one <col> each (the page's CSP blocks a style attribute). A cell is a node, a text, or {v, cls, colspan}.
const isCell = (c) => !!c && typeof c === "object" && !(c instanceof Node) && "v" in c;
function cell(c, tag = "td", { cls = null, label = null } = {}) {
  const v = isCell(c) ? c.v : c;
  // ⚠️ SEVERAL PIECES ARE ONE VALUE (owner, 2026-10-08, a phone: "fm-daily" sat mid-card, its "AI job" chip at the
  // edge): a labelled cell becomes "label … value" on a phone, and the card spread the pieces apart; held together
  const many = label !== null && Array.isArray(v) && v.filter((x) => x !== null && x !== undefined && x !== false && x !== "").length > 1;
  return h(tag, { class: [isCell(c) ? c.cls : null, cls].filter(Boolean).join(" ") || null, colspan: isCell(c) ? c.colspan : null,
                  "data-label": label }, many ? h("span", { class: "cell-v" }, v) : v);
}
export const tableRow = (cells) => h("tr", {}, cells.map((c) => cell(c)));
export function table(head, body, { cls = "", widths = null } = {}) {
  return h("table", { class: `rows ${cls}`.trim() },
    // a width, or {width, cls}: a column a phone rule names by its class, never by its position (nth-child)
    widths ? h("colgroup", {}, widths.map((w) => h("col", w && typeof w === "object" ? { width: w.width || null, class: w.cls } : { width: w || null }))) : null,
    h("thead", {}, h("tr", {}, head.map((c) => cell(c, "th")))),
    body instanceof Node ? body : h("tbody", {}, body.map(tableRow)));
}

// ⚠️ THE ONE TAB BAR (DRY, owner 2026-10-06): AI tools, a skill's views, Copy the setup. `items`: [[key,
// label], …]; `current`: the key shown; `pick(key)` on a press.
// [key, label, info?]: a tab with an info text gets its (i) beside it (a button cannot hold another button)
export function subTabs(items, current, pick) {
  return h("div", { class: "subtabs", role: "tablist" }, items.filter(Boolean).map(([k, l, info]) => {
    const tab = h("button", { type: "button", role: "tab", class: k === current ? "on" : "", "aria-selected": String(k === current), onclick: () => pick(k) }, l);
    return info ? h("span", { class: "subtab-with-info" }, tab, infoButton(l, info)) : tab;
  }));
}

// A small switch between a few views (Skills › Files: Formatted / Raw), drawn like the Light / Auto / Dark one.
// `options`: [[value, label, its tooltip?], …]; `pick(value)` on a press. The header's Light / Auto / Dark is one too
// (app.js: its markup was a second copy in index.html).
export function segmented(options, value, pick, label) {
  const box = h("div", { class: "seg", role: "radiogroup", "aria-label": label || null });
  const draw = (v) => fill(box, options.map(([k, l, title]) => h("button", { type: "button", role: "radio", class: k === v ? "on" : "",
    title: title || null, "aria-checked": String(k === v), onclick: () => { draw(k); pick(k); } }, l)));
  draw(value);
  return box;
}

// ⚠️ THE ONE TABBED SECTION (DRY, owner 2026-10-08): a tab bar over the open tab's body — Costs' two cards, Copy the
// setup, AI tools, a skill's About. `items`: [[key, label, info?, draw()], …] (a falsy item is left out);
// only the open tab is drawn; its key is kept in page.tabs[id], so the section reopens on it (the first tab otherwise).
// Returns {bar, body, redraw}: redraw() draws the open tab again after a change.
export function tabbed(id, items) {
  const bar = h("div"), body = h("div");
  const list = items.filter(Boolean);
  const show = (k) => {
    const tab = list.find((t) => t[0] === k) || list[0];
    page.tabs[id] = tab[0];
    page.shown.set(id, list[0][0]); address();
    fill(bar, subTabs(list.map(([key, label, info]) => [key, label, info]), tab[0], show));
    fill(body, tab[3]());
  };
  show(page.tabs[id]);
  return { bar, body, redraw: () => show(page.tabs[id]) };
}

// A card of tabs (subTabs, each tab's own (i)): [key, label, what it is about, draw()]; `lead`: the card's own (i).
// Its tab is kept in page.tabs, so Costs' period changed keeps the tab you were on.
export function tabbedCard(title, id, tabs, lead = null) {
  const t = tabbed(id, tabs);
  return card(title, lead, t.bar, t.body);
}

// Pages of at most `per` lines: ten, for every list of the page (owner, 2026-10-06: "so the UI stays consistent";
// the tools' cards say 16, four rows of four).
// `draw(slice, offset)` fills the page; returns [box, nav, api]: api.redraw() after a change, api.last() to show the
// last page (after Add).
const PER_PAGE = 10;
export function pagedBlock(count, draw, per = PER_PAGE, [prev, next, unit] = NAV) {
  const nav = h("div", { class: "pager" });
  let page = 0;
  const pages = () => Math.max(1, Math.ceil(count() / per));
  const redraw = () => {
    page = Math.min(page, pages() - 1);
    draw(page * per, Math.min(count(), page * per + per));
    nav.replaceChildren(...(pages() > 1 ? [
      button("", { disabled: page === 0, onclick: () => { page--; redraw(); } }, prev),
      h("span", { class: "muted" }, `Page ${page + 1} of ${pages()} · ${count()} ${unit}`),
      button("", { disabled: page >= pages() - 1, onclick: () => { page++; redraw(); } }, next)] : []));
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
        h("h2", {}, title),
        lines.length > 1 ? bullets(lines) : (lines[0] ? h("p", {}, lines[0]) : null),
        field,
        h("div", { class: "actions" },
          cancel ? button("", { value: "cancel", type: "submit" }, cancel) : null,
          button(danger ? "danger" : "primary", { value: "ok", type: "submit" }, ok))));
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
    h("div", { class: "popup-head" }, h("h2", {}, info ? withInfo(title, info) : title),
      button("", { autofocus: true, onclick: () => dlg.close() }, "Close")),
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

let barState = null;
export function setBar(state) { barState = state; showBar(); }
export function showBar() {
  $bar.replaceChildren();
  if (!barState) { $bar.hidden = true; return; }
  $bar.hidden = false;
  $bar.append(h("span", { class: "msg" }, page.dirty ? "Unsaved changes" : barState.idle || ""),
    barState.discard ? button("", { disabled: !page.dirty, onclick: barState.discard }, "Discard") : null,
    button("primary", { disabled: !page.dirty, onclick: barState.save }, barState.label || "Save"));
}

// ---------------------------------------------------------------- AI jobs not set
// A job policy.yaml does not name does not run (owner, 2026-10-01): say so where it is seen, and add them
// with the starter values their skill offers, in one press.
// written by the agent (POST api/jobs/missing): the page no longer reads, changes and writes the whole form for it
export function jobsBanner(names, after) {
  if (!names || !names.length) return null;
  const btn = button("primary", { onclick: async () => {
    btn.disabled = true;
    try { await api("POST", "api/jobs/missing", {}); toast("AI jobs added. Change their skill's brain or limit under Rules."); after(); }
    catch (e) { btn.disabled = false; tell("Not added", e.problems); }
  } }, "Add them");
  return note("warn", `${plural(names.length, "AI job is", "AI jobs are")} not set: ${names.length > 1 ? "they don't" : "it doesn't"} run.`,
    h("div", { class: "muted" }, names.join(", "), ": their skill needs a brain and a spending limit per run."), btn);
}

// `place`: the tab's own place in it, as the address keeps it (placed); none: the tab as it opens
export function go(tab, place = []) {
  if (tab !== "limits") page.back = null;                 // left the Limits tab another way: nothing to go back to
  page.current = tab; page.dirty = false; setBar(null);
  page.place = []; page.shown.clear(); address();
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab.replace("-file", "")));
  document.querySelector(".tab-file").classList.toggle("on", tab === "rules-file");
  // ⚠️ A TAB THAT FAILS SAYS WHY (architecture review 9): an error left "Loading…" on screen for good
  Promise.resolve().then(() => page.views[tab](...place)).catch((e) => {          // filled by app.js: the tabs
    if (page.current === tab) fill($view, problemsBox(reasons(e), "This tab could not be shown:"));
  });
}
// ⚠️ A VALUE A PERSON CAN CHANGE LOOKS LIKE ONE (owner, 2026-10-23: "highlight all the limits and values that can be
// changed with a specific visually identifiable style … a link to the Limits dashboard focusing directly on the
// specific contextual limit value"): `text` drawn as a .setting chip; a press opens the Limits tab on that row, `ref`
// (limits_tab.ref): its exact name searched, its tab open, the row scrolled to and lit (limits.js). No ref: the value as
// plain text, never a link to the wrong row.
export function setting(text, ref) {
  if (!ref) return String(text);
  return h("a", { href: "#limits", class: "setting", title: "Change it on the Limits tab", "data-limit": ref,
    onclick: async (e) => {
      e.preventDefault();
      if (!(await guard())) return;
      page.focusLimit = ref;
      page.back = { tab: page.current, place: page.place, y: window.scrollY };
      go("limits");
    } }, String(text));
}

// ⚠️ BACK WHERE THE VALUE WAS PRESSED (owner, 2026-10-24: "a back button, so that I can come back to the same page I
// clicked from, after having edited or not the value"): the tab, its own place in it (a skill and its file: `place`,
// what the address keeps) and the scroll, as they were; null when the Limits tab was not opened from a value
async function goBack() {
  const b = page.back;
  if (!b || !(await guard())) return;
  page.back = null;
  go(b.tab, b.place);
  await new Promise((r) => setTimeout(r, 300));          // the place drawn (its reads answered), then its scroll
  window.scrollTo({ top: b.y });
}

// The Back button itself: "‹ Back", named after the tab it returns to. `words` and `back`: another way back, said
// by its own words (Skills on a phone: "‹ All skills").
export function backButton(words = null, back = null) {
  if (back) return button("", { onclick: back }, words);
  if (!page.back) return null;
  const label = document.querySelector(`.tabs button[data-tab="${page.back.tab.replace("-file", "")}"]`)?.textContent?.trim();
  const title = label ? `Back to ${label}` : "Back";
  return button("", { title, "aria-label": title, onclick: goBack }, "‹ Back");
}

// ⚠️ ONE "MEASURED ON THE PAGE" (UI scan, 2026-11-10: a role's pill and a skill's line of files each wired it): `fit`
// runs after layout, when the fonts arrive (they widen the words) and on every resize; a node gone from the page stops
// listening. (A ResizeObserver loops where `fit` changes the width it would watch.)
export function measured(node, fit) {
  const again = () => (node.isConnected ? fit() : window.removeEventListener("resize", again));
  requestAnimationFrame(again);
  document.fonts?.ready.then(again);
  window.addEventListener("resize", again);
}

// a link to another card of the Rules page: scrolls to it and outlines it a moment
export function jump(id, label) {
  return h("a", { href: `#${id}`, class: "link", onclick: (e) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
  } }, label);
}

// ---------------------------------------------------------------- the words of a figure, each written once
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const usd = (v) => "US$ " + (v || 0).toFixed((v || 0) > 0 && v < 0.01 ? 4 : 2);
export const seconds = (n) => `${n}s`;                          // a duration, its unit joined: "30s"
export const lastDays = (n) => `last ${n} days`;                // a period, in a title or a sentence
export const capital = (words) => words[0].toUpperCase() + words.slice(1);
