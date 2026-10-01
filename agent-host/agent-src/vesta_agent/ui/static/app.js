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

function field(label, input, hint) {
  return h("label", { class: "field" }, label, input, hint ? h("span", { class: "hint" }, hint) : null);
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
  if (c.none) return fill($view, card("Costs", "The agent has not recorded anything yet (it has not run in agent mode)."));
  const period = h("select", { "aria-label": "Period", onchange: (e) => costs(Number(e.target.value)) },
    [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]].map(([v, l]) => h("option", { value: v, selected: v === days }, l)));
  const kpis = h("div", { class: "grid" }, [["Today", c.today], ["Last 7 days", c.last_7_days], ["This month", c.this_month],
    [`Last ${days} days`, c.period]].map(([l, v]) => h("div", { class: "kpi" }, h("div", { class: "n" }, usd(v)), h("div", { class: "l" }, l))));
  // the cost of each day: bars drawn in SVG
  const W = 600, H = 120, n = c.by_day.length, max = Math.max(0.01, ...c.by_day.map((d) => d.cost)), slot = W / n;
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H + 18}`, class: "bars", role: "img", "aria-label": "Cost per day" },
    ...c.by_day.map((d, i) => {
      const bh = Math.max(d.cost > 0 ? 2 : 0, (d.cost / max) * H);
      return svg("rect", { x: (i * slot + slot * 0.15).toFixed(1), y: (H - bh).toFixed(1), width: (slot * 0.7).toFixed(1), height: bh.toFixed(1), rx: 2, class: "bar" },
        svg("title", {}, `${d.day}: ${usd(d.cost)}`));
    }),
    svg("text", { x: 0, y: H + 14, class: "axis" }, c.by_day[0].day.slice(5)),
    svg("text", { x: W, y: H + 14, class: "axis", "text-anchor": "end" }, c.by_day[n - 1].day.slice(5)),
    svg("text", { x: W, y: 10, class: "axis", "text-anchor": "end" }, "max " + usd(max)));
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
      h("div", { class: "inline" }, field("Period", period)), kpis, h("div", { class: "divided" }, h("h2", {}, "Per day"), chart)),
    card("By work", "Chat replies, and each AI job.", groupTable(c.by_work, "Work")),
    card("By model", "Which model did the work.", groupTable(c.by_model, "Model")),
    card("Every run", `${c.runs_count} runs, newest first. The model and tokens are recorded from agent 0.6.9 on; older runs show —.`,
      paged(["When", "What", "Brain · model", { v: "Tokens in / out", cls: "num" }, { v: "Cost", cls: "num" }, ""], runRows)));
}

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
  document.getElementById("ver").textContent = `${o.app_version ? `app ${o.app_version} · ` : ""}agent ${o.version} · ${o.instance}`;
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
      h("div", { class: "grid" },
        [["alerts followed", count("critical_event")], ["buttons pressed", count("ladder")],
         ["actions done", count("executed") + count("direct")], ["replies written", count("run")],
         ["AI cost (USD)", r.ai_cost_usd.toFixed(2)], ["failures", count("failed") + count("code_script_failed") + count("send_failed")]]
          .map(([l, n]) => h("div", { class: "kpi" }, h("div", { class: "n" }, n), h("div", { class: "l" }, l)))),
      r.scheduled_jobs.length ? h("div", { class: "divided" }, h("h2", {}, "Scheduled jobs run"),
        paged(["Job", "Ran at"], [...r.scheduled_jobs].reverse().map((j) => [j.job, new Date(j.ran_at).toLocaleString()]))) : null));
  } else {
    kids.push(card("The last 24 hours", "The agent has not recorded anything yet (it has not run in agent mode)."));
  }
  fill($view, ...kids);
}

// ---------------------------------------------------------------- rules (policy.yaml)
const RULES = {
  any: "the owner or the facility manager approves",
  owner: "only the owner approves",
  listed: "only the devices in the lists below, then approval",
  direct: "no approval when a registered person asks",
};
const PROFILES = { auto: "Auto (Sonnet)", economy: "Economy (Haiku)", performance: "Performance (Opus)" };
const RESETS = { daily_04_00: "Every day at 04:00", after_8h_silence: "After 8 hours of silence", never: "Never (/new only)" };
const LISTS = [
  ["switch_entities", "Switches it may turn on or off", ["switch"], "Only for the switch services set to \"listed\"."],
  ["scene_allowlist", "Scenes it may start", ["scene"], "A scene can do anything: add one only after reading it."],
  ["script_allowlist", "Scripts it may run", ["script"], "Same care as scenes."],
  ["button_allowlist", "Buttons it may press", ["button", "input_button"], "Never a restart button."],
];
// what an action can be asked on: the devices "owner only" makes sense for
const ACTIONABLE = ["lock", "cover", "switch", "light", "fan", "climate", "script", "scene", "button", "input_button",
                    "siren", "input_boolean", "media_player", "valve", "water_heater", "vacuum", "alarm_control_panel"];
// the villa's devices, from the agent's knowledge pack: chosen by name, never typed as ids
const ENT = { list: [], byId: {} };

async function rules(sub = "forms") {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  let doc = await api("GET", "api/policy");
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
  const sel = (opts, value, set) => h("select", { onchange: on((t) => set(t.value)) },
    Object.entries(opts).map(([k, l]) => h("option", { value: k, selected: k === value }, l)));
  // AI jobs: each skill's scheduled AI work, with its own brain and spending limit
  f.settings.jobs = f.settings.jobs || {};
  // The AI: one table, one row per piece of AI work (chat answers, then each skill's AI job), like
  // "What the agent may do"; then the conversation settings.
  const aiBody = h("tbody");
  const limitInput = (value, set, label, per) => h("div", {},
    h("input", { type: "number", step: "0.05", min: 0.05, value, "aria-label": label, oninput: on((t) => { set(num(t.value)); drawTotal(); }) }),
    h("div", { class: "muted" }, per));
  // how often a job runs on schedule, in words, and per month (for the most the schedule can cost)
  const cadence = (when) => /^\d{1,2}:\d{2}$/.test(when) ? ["every day at " + when, 30]
    : /^[A-Z][a-z]{2} /.test(when) ? [`every ${({ Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" })[when.slice(0, 3)] || when.slice(0, 3)} at ${when.slice(4)}`, 4.35]
    : [`on day ${when.split(" ")[0]} of each month at ${when.split(" ")[1]}`, 1];
  const total = h("p", { class: "muted spaced" });
  const drawTotal = () => {
    const n = jobs.reduce((s, j) => s + ((f.settings.jobs[j.name] || {}).limit_usd || 0) * cadence(j.when)[1], 0);
    total.textContent = `At their limits, the scheduled runs cost at most about US$ ${n.toFixed(2)} a month. `
      + "Chat replies, and reports asked for in a chat, come on top: see the Costs tab for what was really spent.";
  };
  const drawAi = () => aiBody.replaceChildren(
    h("tr", {},
      h("td", {}, h("b", {}, "Chat answers"), h("div", { class: "muted" }, "replies in the chats; a reply at its limit offers Continue")),
      h("td", {}, sel(PROFILES, f.settings.profile, (v) => (f.settings.profile = v))),
      h("td", {}, limitInput(f.settings.reply_limit_usd, (v) => (f.settings.reply_limit_usd = v), "Limit per reply (USD)", "for each reply")),
      h("td", { class: "x" })),
    ...jobs.map((j) => {
      const cur = f.settings.jobs[j.name];
      const what = h("td", {}, h("b", {}, j.name),
        h("div", { class: "muted" }, `${j.skill} · ${cadence(j.when)[0]}${j.on_request ? ", or when asked in a chat" : ""}`));
      if (!cur) {
        return h("tr", {}, what, h("td", { colspan: 2, class: "muted" }, "Not set: this job does not run."),
          h("td", { class: "x" }, h("button", { class: "btn icon ghost", title: "Set this job", onclick: () => { f.settings.jobs[j.name] = { ...j.default }; drawAi(); drawTotal(); markDirty(); } }, "+")));
      }
      return h("tr", {}, what,
        h("td", {}, sel(PROFILES, cur.profile, (v) => (cur.profile = v))),
        h("td", {}, limitInput(cur.limit_usd, (v) => (cur.limit_usd = v), `Limit per run of ${j.name} (USD)`, "for each run")),
        h("td", { class: "x" }, h("button", { class: "btn icon ghost", title: "Stop this job", onclick: () => { delete f.settings.jobs[j.name]; drawAi(); drawTotal(); markDirty(); } }, "×")));
    }));
  drawAi(); drawTotal();
  const ai = card("The AI", "Which brain does each piece of work, and the most ONE piece of work may cost: one chat reply, or one run of a job. It is not a monthly budget. A reply that reaches its limit stops and offers Continue; a report that reaches it is still sent with what is done. A job that is not set does not run.",
    h("table", { class: "rows ai" }, h("thead", {}, h("tr", {}, ["Work", "Brain", "Most it may cost (US$)", ""].map((x) => h("th", {}, x)))), aiBody),
    total,
    h("div", { class: "inline spaced" },
      field("New conversation", sel(RESETS, f.settings.conversation_reset, (v) => (f.settings.conversation_reset = v))),
      h("label", { class: "switch" }, h("input", { type: "checkbox", checked: f.settings.web_search, onchange: on((t) => (f.settings.web_search = t.checked)) }), "Web search (weather warnings, manuals)")));
  const missing = jobs.filter((j) => !(f.settings.jobs || {})[j.name]).map((j) => j.name);

  // people
  const peopleBody = h("tbody");
  const drawPeople = () => peopleBody.replaceChildren(...f.people.map((p, i) => h("tr", {},
    h("td", {}, h("input", { type: "text", value: p.name ?? "", "aria-label": "Name", oninput: on((t) => (p.name = t.value)) })),
    h("td", {}, h("input", { type: "text", inputmode: "numeric", value: p.telegram_id ?? "", "aria-label": "Telegram id", oninput: on((t) => (p.telegram_id = /^-?\d+$/.test(t.value.trim()) ? Number(t.value.trim()) : t.value)) })),
    h("td", {}, sel({ owner: "Owner", fm: "Facility manager" }, p.role, (v) => (p.role = v))),
    h("td", {}, sel({ ...doc.languages, ...(p.language && !(p.language in doc.languages) ? { [p.language]: p.language } : {}) },
                    p.language ?? "en", (v) => (p.language = v))),
    h("td", { class: "x" }, h("button", { class: "btn icon ghost", title: "Remove", onclick: () => { f.people.splice(i, 1); drawPeople(); markDirty(); } }, "×")))));
  drawPeople();
  const people = card("People", "Who the agent answers. Each person sends /whoami to the bot to read their Telegram id.",
    h("table", { class: "rows" }, h("thead", {}, h("tr", {}, ["Name", "Telegram id", "Role", "Language", ""].map((x) => h("th", {}, x)))), peopleBody),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => { f.people.push({ telegram_id: "", name: "", role: "fm", language: "en" }); drawPeople(); markDirty(); } }, "Add a person")));

  // chats
  const chatId = (role) => h("input", { type: "text", inputmode: "numeric", value: f.chats[role] ?? "", oninput: on((t) => (f.chats[role] = t.value.trim() === "" ? null : (/^-?\d+$/.test(t.value.trim()) ? Number(t.value.trim()) : t.value))) });
  const chats = card("Chats", "Where the agent posts on its own. A group id is negative; /whoami in the chat shows it.",
    h("div", { class: "grid" },
      field("Owner chat", chatId("owner"), "Escalations, monthly report, owner-only approvals."),
      field("Facility manager chat", chatId("fm"), "Alerts, reminders, daily digest, weekly page.")));

  // services and their rule
  const svcBody = h("tbody");
  let svcRows = Object.entries(f.allowed_services);
  const syncSvc = () => { f.allowed_services = Object.fromEntries(svcRows.filter(([k]) => k)); };
  const drawSvc = () => svcBody.replaceChildren(...svcRows.map((row, i) => h("tr", {},
    h("td", {}, h("input", { type: "text", value: row[0], placeholder: "light.turn_on", "aria-label": "Service", oninput: on((t) => { row[0] = t.value.trim(); syncSvc(); }) })),
    h("td", {}, h("select", { "aria-label": "Rule", onchange: on((t) => { row[1] = t.value; syncSvc(); }) },
      Object.entries(RULES).map(([k, l]) => h("option", { value: k, selected: k === row[1] }, `${k} — ${l}`)))),
    h("td", { class: "x" }, h("button", { class: "btn icon ghost", title: "Remove", onclick: () => { svcRows.splice(i, 1); syncSvc(); drawSvc(); markDirty(); } }, "×")))));
  drawSvc();
  const services = card("What the agent may do", "One line per Home Assistant service, and who decides. Anything not listed is refused. Restarts, shell commands, toggles and the like are refused whatever this says.",
    h("table", { class: "rows" }, h("thead", {}, h("tr", {}, ["Service", "Rule", ""].map((x) => h("th", {}, x)))), svcBody),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => { svcRows.push(["", "any"]); drawSvc(); markDirty(); } }, "Add a service")));

  // devices: chosen from the villa's own, by name; each chosen one a tag with its × (owner, 2026-10-01:
  // "free form text inputs are not suitable")
  const picker = (get, set, domains, one = false) => {
    const box = h("div", { class: "picker" });
    const listId = "dl-" + Math.random().toString(36).slice(2);
    const draw = () => {
      const cur = get();
      const input = h("input", { type: "text", list: listId, "aria-label": "Add a device",
                                 placeholder: one && cur.length ? "Choose another…" : "Type a name to add a device…" });
      input.addEventListener("change", () => {
        const m = input.value.match(/\(([a-z_]+\.[\w-]+)\)$/);
        if (!m) return;
        set(one ? [m[1]] : [...cur.filter((x) => x !== m[1]), m[1]]); draw(); markDirty();
      });
      const choices = ENT.list.filter((e) => (!domains || domains.includes(e.id.split(".")[0])) && !cur.includes(e.id));
      box.replaceChildren(
        cur.length ? h("div", { class: "tags" }, cur.map((id) => {
          const e = ENT.byId[id];
          return h("span", { class: "tag" + (e ? "" : " unknown") }, e ? e.name : id,
            h("small", {}, e ? (e.area ? `${e.area} · ${id}` : id) : "not found in Home Assistant"),
            h("button", { title: "Remove", "aria-label": `Remove ${e ? e.name : id}`, onclick: () => { set(cur.filter((x) => x !== id)); draw(); markDirty(); } }, "×"));
        })) : h("div", { class: "muted" }, "None."),
        input,
        h("datalist", { id: listId }, choices.map((e) => h("option", { value: `${e.name}${e.area ? " · " + e.area : ""} (${e.id})` }))));
    };
    draw();
    return box;
  };
  const many = (key, domains) => picker(() => f[key] || [], (v) => (f[key] = v), domains);
  const devices = card("Protected devices", "Devices that need more care than the rules above give them.",
    h("div", { class: "grid" },
      field("Only the owner may approve", many("owner_only_entities", ACTIONABLE), "An action on these waits for the owner's Approve, whoever asks (locks, the gate, the siren)."),
      field("Left alone", many("excluded_entities", null), "Never acted on, never reported (a test device)."),
      field("Siren", picker(() => (f.siren_entity ? [f.siren_entity] : []), (v) => (f.siren_entity = v[0] || null), ["switch", "siren"], true),
            "The siren the alert desk may ask the owner to sound."),
      field("Siren stops after (minutes)", h("input", { type: "number", min: 1, max: 60, value: f.siren_auto_off_min, oninput: on((t) => (f.siren_auto_off_min = num(t.value))) }))));
  const lists = card("Allowed lists", "For a service whose rule above is \"only the devices in the lists below\": the agent may act only on the devices chosen here, and still asks for approval.",
    h("div", { class: "grid" }, LISTS.map(([key, label, domains, hint]) => field(label, many(key, domains), hint))));

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
