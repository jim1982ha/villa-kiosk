// VESTA Agent page — the Rules tab (policy.yaml): the forms, the file, and What the AI can use.
import { $view, api, card, dropdown, editTable, field, fill, floating, h, infoTip, jobsBanner, jump, markDirty, page, pagedBlock, plural, problemsBox, setBar, showBar, subTabs, tell, titleWithInfo, toast, withInfo } from "./core.js";

// ---------------------------------------------------------------- rules (policy.yaml)
// the rules, the lists and their domains, the siren's domains: policy.form_schema(), served with the file —
// the page keeps no copy (two copies had drifted: input_button offered, then refused on save)
export let SCHEMA = { rules: {}, lists: [], actionable: [], siren_domains: [] };

export const RESETS = { daily_04_00: "Every day at 04:00", after_8h_silence: "After 8 hours of silence", never: "Never (/new only)" };
// the villa's devices, from the agent's knowledge pack: chosen by name, never typed as ids
export const ENT = { list: [], byId: {} };

export async function rules(sub = "forms") {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  let doc = await api("GET", "api/policy");
  SCHEMA = doc.schema || SCHEMA;
  page.PROFILES = doc.profiles || page.PROFILES;
  const { jobs } = await api("GET", "api/jobs");
  const { entities } = await api("GET", "api/entities");
  ENT.list = entities; ENT.byId = Object.fromEntries(entities.map((e) => [e.id, e]));
  page.dirty = false;
  // the forms are "Rules", the raw file is "Rules (file)": two tabs at the top, no sub-menu (owner, 2026-10-01)
  if (sub === "file" || !doc.form) return rulesFile(doc);
  const tools = await api("GET", "api/tools");
  return rulesForms(doc, jobs, tools);
}

export function rulesFile(doc) {
  const ta = h("textarea", { class: "editor", spellcheck: "false", oninput: markDirty });
  ta.value = doc.text;
  const probs = h("div");
  const save = async () => {
    try {
      doc = { ...doc, ...(await api("PUT", "api/policy/text", { text: ta.value, rev: doc.rev })) };
      page.dirty = false; fill(probs); showBar(); toast("policy.yaml saved. The agent uses it within seconds.");
    } catch (e) { fill(probs, problemsBox(e.problems)); }
  };
  setBar({ save, discard: () => rules("file"), idle: "Everything, including what the forms do not show." });
  fill($view, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    card("policy.yaml", "Comments start with #. Every save is checked with the agent's own rules first.", ta));
}

export function rulesForms(doc, jobs = [], tools = null) {
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
      h("td", {}, sel(page.PROFILES, f.settings.profile, (v) => (f.settings.profile = v), "Brain")),
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
        h("td", {}, sel(page.PROFILES, cur.profile, (v) => (cur.profile = v), "Brain")),
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
      page.dirty = false; fill(probs); showBar(); toast("Saved. The agent uses the new rules within seconds.");
    } catch (e) {
      fill(probs, problemsBox(e.problems)); probs.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  acting.id = "rules-acting"; services.id = "rules-services";
  setBar({ save, discard: () => rules("forms"), idle: "Changes apply within seconds, no restart." });
  const canUse = tools ? toolsCard(f, tools, () => rules("forms")) : null;
  fill($view, doc.problems.length ? problemsBox(doc.problems, "To fix in this file:") : null, probs,
    jobsBanner(missing, () => rules("forms")), acting, people, chats, services, devices, canUse, ai);
  if (page.jumpTo === "tools" && canUse) { page.jumpTo = null; requestAnimationFrame(() => canUse.scrollIntoView({ block: "start" })); }
}

// ---------------------------------------------------------------- rules › what the AI can use
// Three switches in policy.yaml (tool_access.py on the agent's side): the Home Assistant tools it may read with
// (ha_read_tools), the agent's own tools a villa may switch off (agent_tools; web search is settings.web_search),
// and what the facility manager may make it use (tool_access.fm). Saved with the rest of the form.


export function toolsCard(f, t, reload) {
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
    fill(tabs, subTabs([["ha", "Reading Home Assistant"], ["own", "The agent's own tools"], ["roles", "Who may use what"]], page.toolsTab,
                       (k) => { page.toolsTab = k; draw(); }));
    fill(body, ...({ ha, own, roles })[page.toolsTab]());
  }
  draw();
  const c = card("What the AI can use", "Each tool the AI may call. A tool switched off does not exist for it, in chats and in reports. Changes count at the next message.", tabs, body);
  c.id = "rules-tools";
  return c;
}
