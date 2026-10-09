// VESTA Agent page — the Rules tab (policy.yaml): the forms, the file, and AI tools.
import { api, card, dropdown, editTable, field, fill, floating, go, h, infoButton, inOrder, jobsBanner, jump, markDirty, page, pagedBlock, place, plural, problemsBox, reasons, saveWith, setBar, tabbed, table, tableRow, tell, titleWithInfo, toast, toggleCard, $view, where, withInfo } from "./core.js";
import { fileEditor } from "./viewer.js";

// ---------------------------------------------------------------- rules (policy.yaml)
// the rules, the lists and their domains, the siren's domains: policy.form_schema(), served with the file —
// the page keeps no copy (two copies had drifted: input_button offered, then refused on save)
export let SCHEMA = { rules: {}, lists: [], actionable: [], siren_domains: [], words: {}, resets: {} };

// the settings' names and choices are the agent's (policy.FIELDS, RESET_WORDS), served in SCHEMA: never a copy here
const W = (path) => SCHEMA.words[path] || path;
// the villa's devices, from the agent's knowledge pack: chosen by name, never typed as ids
export const ENT = { list: [], byId: {} };

let PROFILES = {};                     // the brains' names, from this tab's own answer (no shared page field)
// Rules › AI tools › Home Assistant tools, opened from elsewhere (a skill's "Open Rules › AI tools"): Rules keeps its
// own tab keys and scroll (the skill page wrote page.tabs.tools = "ha" and page.jumpTo itself, architecture review 9)
let jumpToTools = false;
export function openTools() {
  jumpToTools = true; page.tabs.tools = "ha"; go("rules");
}

export async function rules(sub = "forms") {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  page.dirty = false;
  // the forms are "Rules", the raw file is "Rules (file)": two tabs at the top, no sub-menu (owner, 2026-10-01).
  // ⚠️ THE FILE ASKS FOR THE FILE ONLY (architecture review 9): it is where a broken policy.yaml is repaired, and it
  // hung on "Loading…" behind the jobs and devices it never uses
  if (sub === "file") return rulesFile(await api("GET", "api/policy"));
  const v = await api("GET", "api/rules");           // the tab in one answer (server.rules_view)
  SCHEMA = v.schema || SCHEMA;
  PROFILES = v.profiles || {};
  ENT.list = v.entities; ENT.byId = Object.fromEntries(v.entities.map((e) => [e.id, e]));
  if (!v.form) return rulesFile(v);
  return rulesForms(v, v.jobs, v.tools);
}

export function rulesFile(doc) {
  const probs = h("div");
  // the one file editor (viewer.fileEditor), as a skill's files: formatted by default, Tab indents, one save
  const ed = fileEditor("policy.yaml", (text, rev) => api("PUT", "api/policy/text", { text, rev }), probs);
  setBar({ save: () => ed.save("policy.yaml saved. The agent uses it within seconds."), discard: () => rules("file"),
           idle: "Everything, including what the forms do not show." });
  fill($view, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    card("policy.yaml", "Comments start with #. Every save is checked with the agent's own rules first.",
      h("div", { class: "file-bar" }, ed.view.toggle), ed.ta, ed.view.box));
  ed.set(doc.text, doc.rev);
}

export function rulesForms(doc, jobs = [], tools = null) {
  const f = structuredClone(doc.form);
  const probs = h("div");
  const on = (fn) => (e) => { fn(e.target); markDirty(); };
  const num = (v) => (v === "" || v === null ? null : Number(v));

  // acting: the title, its (i), then the switch — as every other title with a switch (owner, 2026-10-07: the
  // switch came first, and a line repeated what the (i) says); how long an Approve button works sits with the
  // services that ask for one (Allowed actions)
  const acting = h("section", { class: "card" }, h("div", { class: "card-title" },
    h("h2", {}, place("acting"), infoButton(place("acting"), `Off: the agent informs only, and never offers to do anything. On: it may act, within the rules below; every action still goes through "${place("actions")}".`),
      h("label", { class: "switch title-switch" }, h("input", { type: "checkbox", checked: f.act_enabled, "aria-label": W("act_enabled"),
        onchange: on((t) => { f.act_enabled = t.checked; }) })))));

  // the AI
  const sel = (opts, value, set, label) => dropdown(Object.entries(opts), value, (v) => { set(v); markDirty(); }, label);
  // AI jobs: each skill's scheduled AI work, with its own brain and spending limit
  f.settings.jobs = f.settings.jobs || {};
  // The AI: one table, one row per piece of AI work (chat answers, then each skill's AI job), like
  // Allowed actions; then the conversation settings.
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
  // a line of the table (core.table): its cells, each a node, nodes, or {v, cls, colspan}
  const drawAi = () => aiBody.replaceChildren(
    tableRow([
      [h("b", {}, "Chat answers"), h("div", { class: "muted" }, "replies in the chats; a reply at its limit offers Continue")],
      sel(PROFILES, f.settings.profile, (v) => (f.settings.profile = v), "Brain"),
      limitInput(f.settings.reply_limit_usd, (v) => (f.settings.reply_limit_usd = v), W("settings.reply_limit_usd"), "for each reply"),
      // the chats' own setting, on the chats' line (owner, 2026-10-06): their tools are "everything switched on, by
      // role" — said in the (i) of its "AI tools" column
      // the menu on the line of the brain and the limit, its name under it like theirs ("for each reply")
      { cls: "with-caption", v: [sel(SCHEMA.resets, f.settings.conversation_reset, (v) => (f.settings.conversation_reset = v), W("settings.conversation_reset")),
        h("div", { class: "muted" }, W("settings.conversation_reset"))] },
      { cls: "x", v: null }]),
    ...jobs.map((j) => {
      const cur = f.settings.jobs[j.name];
      const what = [h("b", {}, j.name),
        h("div", { class: "muted" }, `${j.skill} · ${j.when_words}${j.on_request ? ", or when asked in a chat" : ""}`)];
      // ⚠️ WHO ASKS DECIDES, NEVER THE SKILL (owner, 2026-10-10): on schedule everything switched on; asked for in a
      // chat, what that person may use there. Its skill's list is shown on the skill's page, as what it uses.
      const got = { cls: "tools-got", v: h("span", { class: "muted" }, "By who asks") };
      if (!cur) {
        return tableRow([what, { colspan: 2, cls: "muted", v: "Not set: this job does not run." }, got,
          { cls: "x", v: h("button", { class: "btn icon ghost", title: "Set this job", onclick: () => { f.settings.jobs[j.name] = { ...j.default }; drawAi(); markDirty(); } }, "+") }]);
      }
      return tableRow([what,
        sel(PROFILES, cur.profile, (v) => (cur.profile = v), "Brain"),
        limitInput(cur.limit_usd, (v) => (cur.limit_usd = v), `Limit per run of ${j.name} (USD)`, "for each run"), got,
        { cls: "x", v: h("button", { class: "btn icon ghost", title: "Stop this job", onclick: () => { delete f.settings.jobs[j.name]; drawAi(); markDirty(); } }, "×") }]);
    }));
  drawAi();
  const ai = card(place("ai"), "Which brain does each piece of work, the most ONE piece of work may cost (one chat reply, or one run of a job — not a monthly budget), and which tools a report gets: what the person who asks may use (on schedule, everything switched on). A reply that reaches its limit stops and offers Continue; a report that reaches it is still sent with what is done. A job that is not set does not run.",
    table(["Work", "Brain", withInfo("Limit (US$)", limitNote),
      withInfo(place("tools"), `Every answer and every report gets the tools switched on in ${where("tools")}, by the role of the person who asks: the owner everything, the facility manager (and anyone in their chat) less what ${where("tools")} refuses them. A report on schedule gets everything switched on. A skill's own list limits nothing: the AI works without what a run lacks.`),
      ""], aiBody, { cls: "ai", widths: ["30%", "22%", "15%", null, "44"] }));
  const missing = jobs.filter((j) => !j.set).map((j) => j.name);      // the agent's answer (server._jobs)

  // people
  const languages = (p) => ({ ...doc.languages, ...(p.language && !(p.language in doc.languages) ? { [p.language]: p.language } : {}) });
  const people = card(W("people"), "Who the agent answers. Each person sends /whoami to the bot to read their Telegram id.",
    ...editTable(f.people, {
      cls: "people", add: "Add a person", blank: () => ({ telegram_id: "", name: "", role: "fm", language: "en" }),
      columns: [{ title: "Name", width: "26%", phone: "a" }, { title: "Telegram id", width: "22%", phone: "b" },
                { title: "Role", width: "22%", phone: "c" }, { title: "Language", phone: "d" }],
      cell: (p, k, touched) => [
        () => h("input", { type: "text", value: p.name ?? "", "aria-label": "Name", oninput: (e) => { p.name = e.target.value; touched(); } }),
        () => h("input", { type: "text", inputmode: "numeric", value: p.telegram_id ?? "", "aria-label": "Telegram id",
                          oninput: (e) => { const t = e.target.value.trim(); p.telegram_id = /^-?\d+$/.test(t) ? Number(t) : e.target.value; touched(); } }),
        () => sel(SCHEMA.roles, p.role, (v) => (p.role = v), "Role"),            // policy.ROLE_WORDS
        () => sel(languages(p), p.language ?? "en", (v) => (p.language = v), "Language"),
      ][k](),
    }));

  // chats
  const chatId = (role) => h("input", { type: "text", inputmode: "numeric", value: f.chats[role] ?? "", oninput: on((t) => (f.chats[role] = t.value.trim() === "" ? null : (/^-?\d+$/.test(t.value.trim()) ? Number(t.value.trim()) : t.value))) });
  const chats = card(W("chats"), "Where the agent posts on its own. A group id is negative; /whoami in the chat shows it.",
    h("div", { class: "grid" },
      field(W("chats.owner"), chatId("owner"), "Escalations, monthly report, owner-only approvals."),
      field(W("chats.fm"), chatId("fm"), "Alerts, reminders, daily digest, weekly page.")));

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
  // its (i) after the unit (owner, 2026-10-07): "Approve buttons work for [15] min (i)"
  const ttl = h("label", { class: "field row-inline" }, h("span", {}, W("approval_ttl_minutes").replace(/ \(minutes\)$/, "")),
    h("input", { type: "number", min: 1, max: 1440, value: f.approval_ttl_minutes, "aria-label": W("approval_ttl_minutes"),
                 oninput: on((t) => (f.approval_ttl_minutes = num(t.value))) }), h("span", {}, "min"),
    infoButton(W("approval_ttl_minutes"), "An Approve or Refuse button older than this does nothing: the person asks again."))
  const services = h("section", { class: "card" },
    titleWithInfo(place("actions"), "One line per Home Assistant service, and who decides. Anything not listed is refused. Restarts, shell commands, toggles and the like are refused whatever this says. For \"Only the devices chosen beside it\", choose the devices on the same line: the agent may act only on those, and still asks for approval.", "h2", ttl),
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

  const devices = card(place("protected"), "Devices that need more care than the rules above give them.",
    h("div", { class: "grid" },
      field(W("owner_only_entities"), many("owner_only_entities", SCHEMA.actionable), "An action on these waits for the owner's Approve, whoever asks (locks, the gate, the siren)."),
      field(W("excluded_entities"), many("excluded_entities", null), "Never acted on, never reported (a test device)."),
      field(W("siren_entity"), picker(() => (f.siren_entity ? [f.siren_entity] : []), (v) => (f.siren_entity = v[0] || null), SCHEMA.siren_domains, true),
            "The siren the alert desk may ask the owner to sound."),
      field(W("siren_auto_off_min"), h("input", { type: "number", min: 1, max: 60, value: f.siren_auto_off_min, oninput: on((t) => (f.siren_auto_off_min = num(t.value))) }))));

  const save = async () => {
    const res = await saveWith(probs, () => api("PUT", "api/policy/form", { form: f, rev: doc.rev }),
                               "Saved. The agent uses the new rules within seconds.");
    if (res) doc = { ...doc, ...res, problems: [] };
  };
  acting.id = "rules-acting"; services.id = "rules-services";
  setBar({ save, discard: () => rules("forms"), idle: "Changes apply within seconds, no restart." });
  const canUse = tools ? toolsCard(f, tools, () => rules("forms")) : null;
  fill($view, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    jobsBanner(missing, () => rules("forms")),
    inOrder("rules", { acting, people, chats, actions: services, protected: devices, ai, tools: canUse }));   // places.ORDER
  if (jumpToTools && canUse) { jumpToTools = false; requestAnimationFrame(() => canUse.scrollIntoView({ block: "start" })); }
}

// ---------------------------------------------------------------- rules › what the AI can use
// Three switches in policy.yaml (tool_access.py on the agent's side): the Home Assistant tools it may read with
// (ha_read_tools), the agent's own tools a villa may switch off (agent_tools; web search is settings.web_search),
// and what the facility manager may make it use (tool_access.fm). Saved with the rest of the form.


export function toolsCard(f, t, reload) {
  f.ha_read_tools = f.ha_read_tools || []; f.agent_tools = f.agent_tools || {}; f.tool_access = f.tool_access || {};
  let draw = () => {};                 // the open tab drawn again (core.tabbed's redraw, once the tabs exist)
  // ⚠️ ONE CARD PER TOOL, BOTH TABS (owner, 2026-10-06): its name and switch on top, what it does, then its id and
  // notes; at most 4 a row, fewer on a narrower screen (app.css .tool-grid)
  // core.toggleCard, the one card for a switch: saved with the form, then the tab drawn again
  const toolCard = (on, set, title, parts, disabled = false) =>
    toggleCard(on, (v) => { set(v); markDirty(); draw(); }, title, parts, disabled);
  const used = (n) => (n ? h("span", { class: "badge" }, `used ${n}× this week`) : null);
  // the Home Assistant tools tab's (i), worked out when it opens: the count follows the switches
  const haInfo = () => {
    const on = new Set(f.ha_read_tools);
    return (t.count ? `${[...on].filter((n) => t.groups.some((g) => g.tools.some((x) => x.name === n))).length} of ${t.count} tools on. ` : "The list is not read yet. ")
      + (t.read_at ? `From Home Assistant's MCP server${t.server ? " " + t.server : ""}, read ${new Date(t.read_at).toLocaleString()}.` : "The agent reads it when it starts.");
  };
  const ha = () => {
    const on = new Set(f.ha_read_tools);
    const refresh = h("button", { class: "btn ghost", onclick: async () => {
      refresh.disabled = true; refresh.textContent = "Reading…";
      try { Object.assign(t, await api("POST", "api/tools/refresh")); toast("The list was read again."); }
      catch (e) { tell("Not read", reasons(e)); }
      draw();
    } }, "Read the list again");
    // how many are on, and where the list comes from: the (i) of the tab (haInfo), not a line here (owner, 2026-10-08)
    const head = h("div", { class: "tools-head" }, h("div"),
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
        // the form says on/off for each (policy_doc.to_form): where the file keeps it is the agent's business
        const on = kind !== "choose" ? true : f.agent_tools[x.key];
        const set = (v) => { f.agent_tools[x.key] = v; };
        // "set elsewhere": a link to each section that decides it (owner, 2026-10-06)
        const words = x.kind === "elsewhere"
          ? h("div", { class: "muted" }, "Decided by ", jump("rules-acting", place("acting")), " and ", jump("rules-services", place("actions")), ": every action goes through those rules.")
          : h("div", { class: "muted" }, x.description);
        return toolCard(on, set, x.label, { words, meta: [h("code", {}, x.code), used(x.used)] },
          kind !== "choose");
      }))));
  };
  // what a role changes: the (i) of its tab (owner, 2026-10-08: a paragraph above the table became a tooltip)
  const ROLES_INFO = `When a person writes, the AI only gets the tools their role allows; in the facility manager's chat, never more than the facility manager's. A tool switched off in ${place("ha_tools")} or ${place("agent_tools")} is off for everyone. Guests: the agent answers only the people in ${where("people")} (owner or facility manager), so a guest gets no answer at all for now.`;
  const roles = () => {
    const fm = f.tool_access.fm;             // group → allowed, as the form says it (policy_doc.to_form)
    return [
      table(["Tools", SCHEMA.roles.owner, SCHEMA.roles.fm, "Guest"], t.roles.map((g) => [
          h("b", {}, g.label),
          h("label", { class: "switch" }, h("input", { type: "checkbox", checked: true, disabled: true, "aria-label": `${g.label}: owner` })),
          h("label", { class: "switch" }, h("input", { type: "checkbox", checked: fm[g.key], "aria-label": `${g.label}: facility manager`,
            onchange: (e) => { fm[g.key] = e.target.checked; markDirty(); } })),
          { cls: "muted", v: h("span", { title: "There is no guest role yet: the agent answers only the owner and the facility manager" }, "—") }]),
        { cls: "roles", widths: [null, { width: "18%", cls: "owner" }, { width: "18%", cls: "fm" }, { width: "14%", cls: "guest" }] }),
      h("p", { class: "muted" }, `Asking for an action is decided by "${place("actions")}": who approves stays there.`)];
  };
  const tabs = tabbed("tools", [["ha", place("ha_tools"), haInfo, ha], ["own", place("agent_tools"), null, own],
                                ["roles", place("tool_roles"), ROLES_INFO, roles]]);
  draw = tabs.redraw;
  const c = card(place("tools"), "Each tool the AI may call. A tool switched off does not exist for it, in chats and in reports. Changes count at the next message.", tabs.bar, tabs.body);
  c.id = "rules-tools";
  return c;
}
