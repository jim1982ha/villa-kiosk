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

// ---------------------------------------------------------------- tabs
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.tab === current || !guard()) return;
  go(b.dataset.tab);
}));

function go(tab) {
  current = tab; dirty = false; setBar(null);
  history.replaceState(null, "", "#" + tab);
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  ({ overview, rules, skills })[tab]();
}

// ---------------------------------------------------------------- overview
async function overview() {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const o = await api("GET", "api/overview");
  document.getElementById("ver").textContent = `agent ${o.version} · ${o.instance}`;
  const off = o.skills.filter((s) => !s.ok);
  const r = o.last_24h;
  const count = (k) => (r && r.counts[k]) || 0;
  const kids = [
    card("Rules", "policy.yaml: who the agent answers, what it may do.",
      o.policy_problems.length ? problemsBox(o.policy_problems, "To fix:") : h("p", { class: "ok" }, "No problem found."),
      h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => go("rules") }, "Open the rules"))),
    card("Skills", `${o.skills.length - off.length} on, ${off.length} switched off.`,
      off.length ? h("ul", { class: "plain" }, off.map((s) => h("li", {}, h("b", {}, s.name), " — ", s.problem))) : null,
      h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => go("skills") }, "Open the skills"))),
  ];
  if (r) {
    kids.push(card("The last 24 hours", "From the agent's own records.",
      h("div", { class: "grid" },
        [["alerts followed", count("critical_event")], ["buttons pressed", count("ladder")],
         ["actions done", count("executed") + count("direct")], ["replies written", count("run")],
         ["AI cost (USD)", r.ai_cost_usd.toFixed(2)], ["failures", count("failed") + count("code_script_failed") + count("send_failed")]]
          .map(([l, n]) => h("div", { class: "kpi" }, h("div", { class: "n" }, n), h("div", { class: "l" }, l)))),
      r.scheduled_jobs.length ? h("div", {}, h("h2", { style: "margin-top:18px" }, "Scheduled jobs run"),
        h("ul", { class: "plain" }, r.scheduled_jobs.map((j) => h("li", {}, j.job, h("span", { class: "muted" }, "  " + new Date(j.ran_at).toLocaleString()))))) : null));
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
  ["switch_entities", "Switches", "The switches an action may name (switch.turn_on/off set to listed)."],
  ["scene_allowlist", "Scenes", "A scene can hold any action: add one only after reading it."],
  ["script_allowlist", "Scripts", "Same for scripts."],
  ["button_allowlist", "Buttons", "Never a restart button."],
];

async function rules(sub = "forms") {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  let doc = await api("GET", "api/policy");
  const tabs = h("div", { class: "subtabs" },
    h("button", { class: sub === "forms" ? "on" : "", onclick: () => { if (sub !== "forms" && guard()) rules("forms"); } }, "Forms"),
    h("button", { class: sub === "file" ? "on" : "", onclick: () => { if (sub !== "file" && guard()) rules("file"); } }, "The file"));
  dirty = false;
  if (sub === "file" || !doc.form) return rulesFile(doc, tabs);
  return rulesForms(doc, tabs);
}

function rulesFile(doc, tabs) {
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
  fill($view, tabs, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    card("policy.yaml", "Comments start with #. Every save is checked with the agent's own rules first.", ta));
}

function rulesForms(doc, tabs) {
  const f = structuredClone(doc.form);
  const probs = h("div");
  const on = (fn) => (e) => { fn(e.target); markDirty(); };
  const num = (v) => (v === "" || v === null ? null : Number(v));

  // acting
  const acting = card("Acting on the villa",
    "Off: the agent informs only. On: it may act, within the rules below.",
    h("label", { class: "switch" }, h("input", { type: "checkbox", checked: f.act_enabled, onchange: on((t) => (f.act_enabled = t.checked)) }), "The agent may act on the villa"),
    h("div", { class: "grid" }, field("An Approve button works for (minutes)",
      h("input", { type: "number", min: 1, max: 1440, value: f.approval_ttl_minutes, oninput: on((t) => (f.approval_ttl_minutes = num(t.value))) }))));

  // the AI
  const sel = (opts, value, set) => h("select", { onchange: on((t) => set(t.value)) },
    Object.entries(opts).map(([k, l]) => h("option", { value: k, selected: k === value }, l)));
  const ai = card("The AI", "How the agent thinks and what one reply may cost.",
    h("div", { class: "grid" },
      field("Brain", sel(PROFILES, f.settings.profile, (v) => (f.settings.profile = v))),
      field("Limit per reply (USD)", h("input", { type: "number", step: "0.05", min: 0.05, value: f.settings.reply_limit_usd, oninput: on((t) => (f.settings.reply_limit_usd = num(t.value))) }),
        "A reply that reaches it stops and offers Continue."),
      field("New conversation", sel(RESETS, f.settings.conversation_reset, (v) => (f.settings.conversation_reset = v)))),
    h("label", { class: "switch" }, h("input", { type: "checkbox", checked: f.settings.web_search, onchange: on((t) => (f.settings.web_search = t.checked)) }), "Web search (weather warnings, manuals)"));

  // people
  const peopleBody = h("tbody");
  const drawPeople = () => peopleBody.replaceChildren(...f.people.map((p, i) => h("tr", {},
    h("td", {}, h("input", { type: "text", value: p.name ?? "", "aria-label": "Name", oninput: on((t) => (p.name = t.value)) })),
    h("td", {}, h("input", { type: "text", inputmode: "numeric", value: p.telegram_id ?? "", "aria-label": "Telegram id", oninput: on((t) => (p.telegram_id = /^-?\d+$/.test(t.value.trim()) ? Number(t.value.trim()) : t.value)) })),
    h("td", {}, sel({ owner: "Owner", fm: "Facility manager" }, p.role, (v) => (p.role = v))),
    h("td", {}, h("input", { type: "text", value: p.language ?? "en", size: 4, "aria-label": "Language", oninput: on((t) => (p.language = t.value)) })),
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

  // devices and lists (one entity id per line)
  const lines = (key) => {
    const ta = h("textarea", { rows: 3, spellcheck: "false", oninput: on((t) => (f[key] = t.value.split(/\s+/).map((x) => x.trim()).filter(Boolean))) });
    ta.value = (f[key] || []).join("\n");
    return ta;
  };
  const devices = card("Protected devices", "One entity id per line.",
    h("div", { class: "grid" },
      field("Owner only", lines("owner_only_entities"), "Only the owner can approve an action on these (locks, the gate, the siren)."),
      field("Excluded", lines("excluded_entities"), "Never acted on, never reported (a test lock)."),
      field("Siren", h("input", { type: "text", value: f.siren_entity ?? "", placeholder: "switch.your_siren", oninput: on((t) => (f.siren_entity = t.value.trim() || null)) }), "What the alert desk may ask the owner to sound."),
      field("Siren stops after (minutes)", h("input", { type: "number", min: 1, max: 60, value: f.siren_auto_off_min, oninput: on((t) => (f.siren_auto_off_min = num(t.value))) }))));
  const lists = card("Allowed lists", "For the services whose rule is listed. One entity id per line.",
    h("div", { class: "grid" }, LISTS.map(([key, label, hint]) => field(label, lines(key), hint))));

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
  fill($view, tabs, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    acting, people, chats, services, devices, lists, ai);
}

// ---------------------------------------------------------------- skills
async function skills(select = null) {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const { skills: list } = await api("GET", "api/skills");
  const side = h("div", { class: "card" },
    h("h2", {}, "Skills"),
    h("p", { class: "lead" }, "Each skill is a folder. A change counts at the agent's next use, no restart."),
    list.length ? list.map((s) => h("button", { class: "skill-item" + (s.name === select ? " on" : ""), onclick: () => { if (guard()) skills(s.name); } },
      h("div", {}, h("b", {}, s.name), " ", h("span", { class: "chip" + (s.ok ? "" : " off") }, s.ok ? "on" : "off")),
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
  const fileBtns = h("div", { class: "files" }, files.map((x) => h("button", { class: x.path === path ? "on" : "", onclick: () => { if (x.path !== path && guard()) openSkill(name, pane, info, x.path); } }, x.path)));
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
    h("h2", {}, name, " ", info ? h("span", { class: "chip" + (info.ok ? "" : " off") }, info.ok ? "on" : "switched off") : null),
    info && !info.ok ? problemsBox([info.problem], "The agent does not use this skill:") : null,
    fileBtns, probs, path ? ta : h("p", { class: "muted" }, "No file."),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", onclick: newFile }, "New file"),
      path && !["SKILL.md", "skill.yaml"].includes(path) ? h("button", { class: "btn ghost", onclick: delFile }, "Delete this file") : null,
      h("button", { class: "btn danger", onclick: delSkill, style: "margin-left:auto" }, "Delete the skill"))));
  setBar({ save, discard: () => load(path), idle: path ? `Editing ${path}. Saves are checked before they are written.` : "" });
  if (path) await load(path);
}

go(["overview", "rules", "skills"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview");
