// VESTA Agent page — the Knowledge tab: what the agent knows of the villa and keeps outside policy.yaml (owner,
// 2026-10-30: "the Rule tab exclusively contain feature defined in the policy.yaml file", every other one in ONE tab).
// Its sections (places.ORDER.knowledge): Asleep between reports, Translations and Devices, each a card. A device's kind
// and links are saved at once (no save bar) through the page's one writer (ui/kinds.py, ui/links.py: in Page changes,
// undoable), the translations forgotten in the agent's memory.
import { api, ask, button, card, chip, DASH, dropdown, field, fill, h, inOrder, loading, moreButton, none, paged, place, plural, reasons, saveNow, searchBox, segmented, tell, toast, withInfo, $view } from "./core.js";

// a (i) in readable sections (owner, 2026-10-30: "barely understandable and very poorly formatted"): a heading, then
// its sentences or a list of [bold words, the rest]
const part = (title, ...body) => [h("p", { class: "tip-head" }, title), ...body];
const items = (pairs) => h("ul", { class: "tip-list" }, pairs.map(([b, rest]) => h("li", {}, h("b", {}, b), rest ? ` ${rest}` : "")));

export async function knowledge() {
  loading();
  const v = await api("GET", "api/knowledge");           // the tab in one answer (server.knowledge_view)
  const sections = { devices: devicesCard(v), asleep: asleepCard(v.asleep), translations: translationsCard(v) };
  // in the page, not behind a (i) (owner, 2026-10-15): hiding is done in the villa's system, not here (knowledge_pack)
  fill($view, h("p", { class: "muted" }, "Devices hidden in the villa's system are ignored by the agent: left out of the villa status, the reports, what the AI is told and every list of this tab."),
    ...inOrder("knowledge", sections));
}

// ---------------------------------------------------------------- knowledge › devices
// ⚠️ ONE LIST OF DEVICES (owner, 2026-11-11: Device kinds and Device links were two tabs over the same devices, the links
// split into "Run-hours check off" and "Schedule linked", "too intricate": "the Onsen pump appears in Run-hours check off
// rather than Schedule linked", while a schedule WAS linked). Each device is one line: what it is (its kind), whether the
// night check compares its running hours with a schedule, and why not in plain words (vesta_shared.run_hours, the
// night's own verdict), and its Edit opens, under the line, its kind and its three links, each a list to pick from.
// ⚠️ A PICKER, NEVER TYPED (owner, 2026-10-28; 2026-10-30: a link was found only by the helper's name). The kinds' and
// links' names and words are the agent's (asset_kinds.KINDS, asset_links.ROLES). Found by name, Set by you, "Use the one
// found": one set of words for a kind and a link.
let DEVICE_SEARCH = "";
let DEVICE_SHOW = "all";
// a helper deleted or renamed in the villa's system (architecture review 20, card 3: it read as its id, "Set by you")
const GONE = "No longer in the villa's system";
// where a kind or a link comes from: your choice lit, what the agent found quiet
const setBy = (chosen, found = "Found by name") => chip(chosen ? "Set by you" : found, chosen ? "" : "gray");

function devicesCard(v) {
  const probs = h("div"), list = h("div");
  const kindName = (k) => (v.kinds.kinds.find(([key]) => key === k) || [k, k])[1];
  const roles = () => v.links.roles.map(([k, name, , words]) => ({ k, name, words }));
  // the devices: one per slug, its kind row and its link row side by side (ui/kinds.py and ui/links.py list the same
  // devices; a device that has a link only, or a choice for a device gone from the villa, is in one of them)
  const devices = () => {
    const by = new Map();
    for (const r of v.kinds.rows) by.set(r.slug, { slug: r.slug, name: r.name, area: r.area, kind: r, link: null });
    for (const r of v.links.rows) {
      const d = by.get(r.slug) || { slug: r.slug, name: r.name, area: r.area, kind: null, link: null };
      d.link = r;
      by.set(r.slug, d);
    }
    return [...by.values()].map((d) => ({ ...d, gone: !!(d.kind?.gone || d.link?.gone), checked: !!d.link?.run_hours.on }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  };
  const info = () => h("div", { class: "tip-doc" },
    ...part("Which devices are listed",
      h("p", {}, `Every device that measures its own power or energy (a smart plug, a relay with a meter, a power meter): ${devices().length} on this villa. Devices hidden in the villa's system are left out.`)),
    ...part("Kind: what the device is", items(v.kinds.kinds.map(([, name, words]) => {
      const at = words.indexOf(": ");
      return at < 0 ? [`${name}:`, words] : [`${name} (${words.slice(0, at).toLowerCase()}):`, words.slice(at + 2)];
    }))),
    ...part("Run hours: checked or not",
      h("p", {}, "Checked: each night, the hours the device ran are compared with its schedule, and running much longer or shorter is reported (often the first sign of wear, a leak or a blockage). It needs a Motor or Appliance kind, a schedule linked, and that schedule used by an automation that is switched on. When it is not checked, the line says why.")),
    ...part("Links: the villa's helpers that belong to the device", items(roles().map((r) => [`${r.name}:`, r.words]))),
    ...part("Where a kind or a link comes from", items([
      ["Found by name:", "the agent's guess, from the device's name, or what the villa's system says it is made of."],
      ["Set by you:", "your choice, which always wins. \"Use the one found\" undoes it."],
      [`${GONE}:`, "the helper was deleted or renamed there; pick another, or None."]])),
    ...part("To change", h("p", {}, "Press Edit on the device, then pick in its lists. It applies from the next night check and report.")));

  // a choice saved at once, then the tab read again: a kind or a link changes the run-hours check too (ui/links.py)
  const save = async (d, path, body) => {
    const res = await saveNow(probs, () => api("PUT", path, { slug: d.slug, ...body }), (r) => `Saved: ${r.what}`, `${d.name} not saved:`);
    if (!res) return;
    try { Object.assign(v, await api("GET", "api/knowledge")); } catch { /* the line keeps what it showed */ }
    refresh(d.slug);
  };
  // a kind's or a link's list, and under it where it comes from and, for a choice, the way back to what was found
  const choice = (input, chosen, gone, undo, { helperGone = false, nothing = false, found = undefined } = {}) => h("div", { class: "link-cell" }, input,
    h("span", { class: "chips" }, helperGone ? chip(GONE, "warn") : nothing ? null : setBy(chosen, found),
      chosen ? button("", { onclick: undo }, gone ? "Remove" : "Use the one found") : null));

  // the line's pieces, each a box filled again after a save, so the line and its open editor stay where they are
  const boxes = new Map();
  // where a guessed kind came from (knowledge_pack.kind_and_why, ui/kinds.py's source; architecture review 20, card 4)
  const kindFrom = (k) => (k.source === "system" ? "From the villa's system" : k.source === "link" ? `From its ${k.link} link` : "Found by name");
  const kindCell = (d) => (!d.kind ? none()
    : [h("div", {}, kindName(d.kind.kind)),
      d.kind.gone ? chip("No longer found", "warn") : setBy(d.kind.chosen, kindFrom(d.kind))]);
  const checkCell = (d) => {
    const rh = d.link?.run_hours;
    if (!rh) return none();
    return [chip(rh.on ? "Checked" : "Not checked", rh.on ? "" : "gray"), h("div", { class: "muted small" }, rh.why)];
  };
  const editor = (d) => {
    const fields = [];
    if (d.kind) {
      const k = d.kind;
      fields.push(field("Kind", choice(d.kind.gone ? h("span", {}, kindName(k.kind))
        : dropdown(v.kinds.kinds.map(([key, name]) => [key, key === k.guess ? `${name} (the one found)` : name]), k.kind, (val) => save(d, "api/kinds", { kind: val }), `${d.name}, kind`),
        k.chosen, k.gone, () => save(d, "api/kinds", { kind: null }), { found: kindFrom(k) })));
    }
    if (d.link) {
      for (const role of roles()) {
        const l = d.link.links[role.k] || { value: null, source: "none" };
        const opts = [["", "None"], ...(v.links.options[role.k] || []).map(([i, n]) => [i, i === l.guess ? `${n} (found by name)` : n])];
        if (l.value && !opts.some(([i]) => i === l.value)) opts.push([l.value, `${l.name || l.value} (${GONE.toLowerCase()})`]);
        fields.push(field(withInfo(role.name, role.words), choice(
          d.link.gone ? h("span", {}, l.name || l.value || DASH) : dropdown(opts, l.value || "", (val) => save(d, "api/links", { role: role.k, value: val }), `${d.name}, ${role.name}`),
          l.source === "chosen", d.link.gone, () => save(d, "api/links", { role: role.k, value: null }),
          { helperGone: l.gone, nothing: !l.value && l.source !== "chosen" })));
      }
    }
    return h("div", { class: "grid" }, fields);
  };
  const refresh = (slug) => {
    const d = devices().find((x) => x.slug === slug), b = boxes.get(slug);
    if (!b) return;
    if (!d) { draw(); return; }                              // a gone device's last choice removed: its line goes
    fill(b.kind, kindCell(d)); fill(b.check, checkCell(d)); fill(b.editor, editor(d));
  };
  const row = (d) => {
    const b = { kind: h("div"), check: h("div"), editor: h("div") };
    boxes.set(d.slug, b);
    fill(b.kind, kindCell(d)); fill(b.check, checkCell(d)); fill(b.editor, editor(d));
    return { cells: [[h("b", {}, d.name), d.area ? h("span", { class: "muted" }, ` ${d.area}`) : null,
      d.kind?.parts ? h("div", { class: "muted small" }, d.kind.parts) : null,
      d.gone ? h("div", {}, chip("No longer found", "warn")) : null], b.kind, b.check, moreButton("Edit")], more: b.editor };
  };
  const views = h("div");
  const draw = () => {
    boxes.clear();
    const all = devices();
    const q = DEVICE_SEARCH.trim().toLowerCase();
    const found = all.filter((d) => !q || `${d.name} ${d.area} ${d.slug}`.toLowerCase().includes(q));
    const shown = found.filter((d) => DEVICE_SHOW === "all" || (DEVICE_SHOW === "on") === d.checked);
    const on = found.filter((d) => d.checked).length;
    fill(views, all.length ? segmented([["all", `All (${found.length})`], ["on", `Checked (${on})`], ["off", `Not checked (${found.length - on})`]],
      DEVICE_SHOW, (k) => { DEVICE_SHOW = k; draw(); }, "Which devices") : null);
    fill(list, shown.length ? paged(["Device", "Kind", withInfo("Run hours", "Whether the night check compares the hours it ran with its schedule, and why not."), ""],
      shown.map(row), 10, { widths: ["32%", "22%", null, "96px"], nav: ["‹ Previous", "Next ›", "devices"] })
      : none(!all.length ? (v.kinds.built ? "No device with a power or energy reading." : "The agent has not read the villa's devices yet.")
        : "No device matches.", "p"));
  };
  draw();
  const search = devices().length ? searchBox("Search the devices", DEVICE_SEARCH, (text) => { DEVICE_SEARCH = text; draw(); }) : null;
  const c = card(place("devices"), info, h("div", { class: "toolbar" }, search, views), probs, list);
  c.id = "knowledge-devices";
  return c;
}

// ---------------------------------------------------------------- knowledge › asleep between reports
// ⚠️ THE KIOSK'S LIST, SHOWN HERE (owner, 2026-10-21): one list, kept in the VESTA Kiosk; the agent reads it
// (vesta_shared.asleep) and never edits it, so it is shown, never offered as a field to change
function asleepCard(rows) {
  return card(place("asleep"), "Set in the VESTA UI (Advanced Settings › Devices › Asleep between reports). The agent never reports these devices offline and reads their last real state.",
    rows.length ? h("div", { class: "chips" }, rows.map((r) => chip(r.name, "", r.id))) : none("None"));
}

// ---------------------------------------------------------------- knowledge › translations
// the alert translation's memory (phrases.py): "Forget Translations" forgets them all (every language but English:
// English is never translated; owner, 2026-10-23: no language menu), asked in the page's own dialog (core.ask:
// never the browser's confirm). Not a change of a file: done at once; the next alert cards are translated again.
function translationsCard(v) {
  const box = h("div");
  const draw = () => {
    if (!v.translations) return fill(box, none("No skill puts its alert cards in the chats' language.", "p"));
    const langs = Object.entries(v.translations).filter(([, n]) => n > 0);
    fill(box,
      langs.length
        ? h("ul", {}, langs.map(([k, n]) => h("li", { class: "block" }, `${(v.languages || {})[k] || k}: ${plural(n, "sentence kept", "sentences kept")}`)))
        : none("No translation kept yet.", "p"),
      button("", { disabled: !langs.length, onclick: forget }, "Forget Translations"));
  };
  async function forget() {
    if (!(await ask({ title: "Forget every translation?", ok: "Forget", danger: true,
      text: "The next alert cards are translated again by the AI, at the cost of each run." }))) return;
    try {
      const res = await api("POST", "api/translations/forget", { lang: null });
      v.translations = res.kept; draw();
      toast(`${plural(res.forgot, "translation", "translations")} forgotten.`);
    } catch (e) { tell("Not forgotten", reasons(e)); }
  }
  draw();
  return card(place("translations"), "The sentences of the alert cards the AI put in each chat's language, kept so the next card with the same sentence costs nothing. Forget them after changing how the cards are worded: the next cards are translated again, at the cost of each run.", box);
}
