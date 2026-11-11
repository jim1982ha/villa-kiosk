// VESTA Agent page — the Knowledge tab: what the agent knows of the villa and keeps outside policy.yaml (owner,
// 2026-10-30: "the Rule tab exclusively contain feature defined in the policy.yaml file", every other one in ONE tab).
// Its sections (places.ORDER.knowledge): Asleep between reports and Translations, each a card, then Device kinds and
// Device links as the tabs of one tabbed section (places.TABBED; owner, 2026-10-31: the two cards were tabs too). Each
// is saved where it lives, at once (no save bar): a kind and a link through the page's one writer (ui/kinds.py,
// ui/links.py: in Page changes, undoable), the translations forgotten in the agent's memory.
import { api, ask, button, card, chip, counted, DASH, dropdown, fill, folded, h, inOrder, loading, none, paged, place, plural, reasons, saveNow, searchBox, tabbed, tabbedIn, tell, toast, withInfo, $view } from "./core.js";

// a (i) in readable sections (owner, 2026-10-30: "barely understandable and very poorly formatted"): a heading, then
// its sentences or a list of [bold words, the rest]
const part = (title, ...body) => [h("p", { class: "tip-head" }, title), ...body];
const items = (pairs) => h("ul", { class: "tip-list" }, pairs.map(([b, rest]) => h("li", {}, h("b", {}, b), rest ? ` ${rest}` : "")));

// ⚠️ THE TWO DEVICE LISTS ARE ONE LIST (UI scan, 2026-11-10: Device kinds and Device links each wrote its search, its
// two empty states, its pager's words, its save and its way back to what was found): written once, here.
const DEVICES_NAV = ["‹ Previous", "Next ›", "devices"];
// the devices a search keeps (by name, room or id), and its box (`text`: the tab's own search, kept while the page
// is open; `typed(text)` on every key); no box while there is no device to search
const found = (data, text) => {
  const q = text.trim().toLowerCase();
  return data.rows.filter((r) => !q || `${r.name} ${r.area} ${r.slug}`.toLowerCase().includes(q));
};
const deviceSearch = (data, text, typed) => (data.rows.length ? searchBox("Search the devices", text, typed) : null);
// what the list says when it has nothing to show: no device read, or none the search keeps (null: draw `shown`)
const noDevice = (data, shown) => (shown.length ? null : none(
  !data.rows.length ? (data.built ? "No device with a power or energy reading." : "The agent has not read the villa's devices yet.")
    : "No device matches the search.", "p"));
// a choice made here saved at once (core.saveNow): the answer is the tab's new data, the toast the line Page changes
// keeps (the answer's `what`, ui/kinds.saved) — never a copy of it
const saveChoice = async (data, probs, r, path, body) => {
  const res = await saveNow(probs, () => api("PUT", path, { slug: r.slug, ...body }), (res) => `Saved: ${res.what}`, `${r.name} not saved:`);
  if (res) Object.assign(data, res);
};
// the way back from a choice made here to what the agent found (a device gone from the villa: its choice removed)
const useFound = (r, undo) => button("", { onclick: undo }, r.gone ? "Remove" : "Use the one found");
// where a kind or a link comes from, drawn one way on both lists (UI scan, 2026-11-10: a pill here, grey words there):
// your choice lit, what the agent found quiet
const setBy = (chosen, found = "Found by name") => chip(chosen ? "Set by you" : found, chosen ? "" : "gray");

export async function knowledge() {
  loading();
  const v = await api("GET", "api/knowledge");           // the tab in one answer (server.knowledge_view)
  const probs = h("div");
  const cards = {
    kinds: () => kindsCard(v.kinds, probs),
    links: () => linksCard(v.links, probs),
    asleep: () => asleepCard(v.asleep),
    translations: () => translationsCard(v),
  };
  // the tabbed section where its first tab sits in the order (its problems above its bar), every other section a card;
  // a tab kept from before (page.tabs) that is a card now opens the first tab (core.tabbed)
  const inTabs = tabbedIn("knowledge");
  const t = tabbed("knowledge", inTabs.map((k) => [k, place(k), null, cards[k]]));
  const sections = Object.fromEntries(Object.keys(cards).map((k) =>
    [k, !inTabs.includes(k) ? cards[k]() : k === inTabs[0] ? [probs, t.bar, t.body] : null]));
  // in the page, not behind a (i) (owner, 2026-10-15): hiding is done in the villa's system, not here (knowledge_pack)
  fill($view, h("p", { class: "muted" }, "Devices hidden in the villa's system are ignored by the agent: left out of the villa status, the reports, what the AI is told and every list of this tab."),
    ...inOrder("knowledge", sections));
}

// ---------------------------------------------------------------- knowledge › device kinds
// ⚠️ A PICKER, NEVER TYPED (owner, 2026-10-28): what each device is (vesta_shared.asset_kinds) was corrected by typing
// JSON into a helper of the villa's system. Each device the agent reads power or energy for is a row: its kind in a
// drop-down, whether it is the agent's guess or a choice made here, and a way back to the guess. SAVED AT ONCE, like a
// switch of the page's own (ui/kinds.py: through the page's one writer, in Page changes, undoable), so it never waits
// for a save bar (the agent rules are the Rules tab's). The kinds' names and words are the agent's.
let KIND_SEARCH = "";
export function kindsCard(data, probs) {
  // ⚠️ WHAT THE SECTION IS FOR, IN FULL (owner, 2026-10-30: "I still don't understand what the Device kinds section is
  // used for"), THEN READABLE (owner, 2026-10-30: "barely understandable and very poorly formatted" — one block of six
  // run-on paragraphs): which devices are listed and why, what each kind changes as a list, where the kind comes from,
  // how to correct it. The kinds' words are the agent's (asset_kinds.KINDS), split at their colon: what it is, what VESTA does.
  const kindItem = ([, name, words]) => {
    const at = words.indexOf(": ");
    return at < 0 ? [name, words] : [`${name} (${words.slice(0, at).toLowerCase()})`, words.slice(at + 2)];
  };
  const info = h("div", { class: "tip-doc" },
    ...part("Which devices are listed",
      h("p", {}, `Every device that measures its own power or energy (a smart plug, a relay with a meter, a power meter): ${data.rows.length} on this villa. Devices hidden in the villa's system are left out.`)),
    ...part("What the kind changes", items(data.kinds.map(kindItem))),
    ...part("Why it matters",
      h("p", {}, "A pump that runs longer, starts more often or draws a different power than usual is often the first sign of wear, a leak or a blockage. A light left on or a meter's total is not a fault.")),
    ...part("Where the kind comes from", items([
      ["From its link:", "a schedule, a normal power or a run hours count linked to it on Device links makes it a motor."],
      ["From the villa's system:", "what the device is made of there (a light, a fan, a climate unit)."],
      ["Found by name:", "from its name, when neither says."],
      ["Set by you:", "your choice, which always wins."]])),
    ...part("To correct a kind",
      h("p", {}, "Pick the right one in its list. It applies from the next night check and report. \"Use the one found\" undoes it.")),
    ...part("\"light + fan\"",
      h("p", {}, "A wall switch driving a light and a fan on one power reading: VESTA checks the fan by its own on and off, reads the power only while the light is off, and counts the light in the energy figures only.")));
  const list = h("div");
  // ⚠️ WHERE A GUESS CAME FROM, THE AGENT'S ANSWER (architecture review 20, card 4): ui/kinds.py's source, its link named
  // (knowledge_pack.kind_and_why); a device a linked schedule made a motor read "Found by name"
  const from = (r) => (r.source === "system" ? "From the villa's system" : r.source === "link" ? `From its link: ${r.link} linked on Device links` : "Found by name");
  const fromShort = (r) => (r.source === "system" ? "the villa's system" : r.source === "link" ? `its ${r.link} link` : "found by name");
  // ⚠️ THE SENTENCE RECORDED, NEVER A COPY (architecture review 20, card 6): saveChoice's toast
  const save = async (r, kind) => { await saveChoice(data, probs, r, "api/kinds", { kind }); draw(); };
  const row = (r) => [
    [h("b", {}, r.name), r.area ? h("span", { class: "muted" }, ` ${r.area}`) : null,
      r.parts ? h("span", { class: "muted" }, ` · ${r.parts}`) : null],
    dropdown(data.kinds.map(([k, name]) => [k, k === r.guess ? `${name} (${fromShort(r)})` : name]), r.kind, (v) => save(r, v), `${r.name}, kind`),
    h("span", { class: "chips" },
      r.gone ? chip("No longer found", "warn") : setBy(r.chosen, from(r)),
      r.chosen ? useFound(r, () => save(r, null)) : null),
  ];
  const draw = () => {
    const shown = found(data, KIND_SEARCH);
    fill(list, noDevice(data, shown) || paged(["Device", "Kind", "Set by"], shown.map(row), 10,
      { widths: ["44%", "26%", "30%"], nav: DEVICES_NAV }));
  };
  draw();
  // which devices, said on the card itself too (owner, 2026-10-30: "where the device list is coming from?")
  const which = h("p", { class: "muted" }, `${plural(data.rows.length, "device that measures its", "devices that measure their")} own power or energy.`);
  const c = card(place("kinds"), info, which, deviceSearch(data, KIND_SEARCH, (text) => { KIND_SEARCH = text; draw(); }), list);
  c.id = "knowledge-kinds";
  return c;
}

// ---------------------------------------------------------------- knowledge › device links
// ⚠️ A NAME WAS THE ONLY LINK (owner, 2026-10-30): a device's schedule, normal power and run hours were found only by
// the helper's name (schedule.<device>_expected_runtime), so a schedule named otherwise was never read and its
// run-hours check stayed off, unsaid. Saved at once (ui/links.py). The links' names and words are the agent's
// (asset_links.ROLES).
// ⚠️ READ FIRST, CHANGED ON ASK (owner, 2026-11-04: "Device links section is hardly understandable"): it was three
// drop-downs and three "Guessed / Chosen here / None linked" tags per device, the columns' meaning behind one (i).
// Now each device is one line that says what VESTA uses, each column its own (i); the drop-downs open for one device
// on its Set or Change. The devices whose run-hours check is off come first, the others folded under "Schedule
// linked"; a device the villa no longer has, last. One set of words with Device kinds: Found by name, Set by you,
// "Use the one found".
let LINK_SEARCH = "";
let LINK_EDITING = null;
export function linksCard(data, probs) {
  const roles = data.roles.map(([k, name, , words]) => ({ k, name, words }));
  const info = h("div", { class: "tip-doc" },
    ...part("Which devices are listed",
      h("p", {}, `Every device that measures its own power or energy, as in Device kinds, and any other that has a link: ${data.rows.length} on this villa.`)),
    ...part("What each link is used for", items(roles.map((r) => [`${r.name}:`, r.words]))),
    ...part("Where a link comes from", items([
      ["Found by name:", "a helper of the villa's system whose name follows the agent's rule (the device's name, then what it is)."],
      ["Set by you:", "your choice, which always wins, None included."],
      [`${DASH}:`, "nothing found or set. That link does nothing."],
      ["No longer in the villa's system:", "the helper was deleted or renamed there. That link does nothing until you pick another, or None."]])),
    ...part("To change a link",
      h("p", {}, "Press Set or Change on its device, then pick the helper in its list, or None to switch the link off. It applies from the next night check. \"Use the one found\" undoes your choice.")));
  const list = h("div");
  const rowOf = (slug) => data.rows.find((x) => x.slug === slug);
  // a row's cells are boxes filled in place: Set, Change and a save redraw that one device, never the page it is on
  const boxes = new Map();
  const show = (r) => {
    const b = boxes.get(r.slug);
    if (!b) return;
    const editing = LINK_EDITING === r.slug;
    roles.forEach((role, i) => fill(b.links[i], editing ? editCell(r, role) : readCell(r, role)));
    fill(b.button, button("", {
      onclick: () => { const was = LINK_EDITING; LINK_EDITING = editing ? null : r.slug;
        if (editing) draw(); else { if (was && rowOf(was)) show(rowOf(was)); show(r); } } },
      editing ? "Done" : r.links.schedule?.value || r.gone ? "Change" : "Set"));
  };
  // saved as on Device kinds (saveChoice)
  const save = async (r, role, value) => {
    await saveChoice(data, probs, r, "api/links", { role, value });
    const now = rowOf(r.slug);
    if (now) show(now); else { LINK_EDITING = null; draw(); }       // a gone device's last link removed: its row goes
  };
  // ⚠️ A HELPER GONE FROM THE VILLA IS SAID (architecture review 20, card 3): a schedule deleted or renamed there read as
  // its id, "Set by you", and was offered as an ordinary choice; its line says so now (ui/links.py's `gone`)
  const GONE = "No longer in the villa's system";
  // what VESTA uses: the helper's name and where it comes from, or a dash
  const readCell = (r, role) => {
    const l = r.links[role.k] || { value: null, source: "none" };
    if (!l.value && l.source !== "chosen") return none();
    return h("span", { class: "link-read" }, l.value ? h("span", {}, l.name || l.value) : none("None"),
      l.gone ? chip(GONE, "warn") : setBy(l.source === "chosen"));
  };
  const editCell = (r, role) => {
    const l = r.links[role.k] || { value: null, source: "none" };
    const opts = [["", "None"], ...(data.options[role.k] || []).map(([i, n]) => [i, i === l.guess ? `${n} (found by name)` : n])];
    if (l.value && !opts.some(([i]) => i === l.value)) opts.push([l.value, `${l.name || l.value} (${GONE.toLowerCase()})`]);
    return h("div", { class: "link-cell" },
      r.gone ? readCell(r, role) : dropdown(opts, l.value || "", (v) => save(r, role.k, v), `${r.name}, ${role.name}`),
      l.source === "chosen" ? h("span", { class: "chips" }, setBy(true), useFound(r, () => save(r, role.k, null))) : null);
  };
  const row = (r) => {
    const b = { links: roles.map(() => h("div")), button: h("div") };
    boxes.set(r.slug, b);
    show(r);
    return [[h("b", {}, r.name), r.area ? h("span", { class: "muted" }, ` ${r.area}`) : null,
      !r.gone && !r.run_hours.on ? h("div", { class: "muted small" }, r.run_hours.why) : null], ...b.links, b.button];
  };
  const head = ["Device", ...roles.map((r) => withInfo(r.name, r.words)), ""];
  const group = (title, rows, open) => rows.length
    ? folded(counted(title, rows.length), null, open,
        paged(head, rows.map(row), 10, { widths: ["24%", null, null, null, "88px"], nav: DEVICES_NAV }))
    : null;
  const draw = () => {
    boxes.clear();
    const shown = found(data, LINK_SEARCH);
    // ⚠️ GROUPED BY THE NIGHT CHECK'S OWN VERDICT (architecture review 20, card 2): a linked schedule filed a device under
    // "Schedule linked" while the night check had its run-hours check off; ui/links.py serves its run_hours
    // (vesta_shared.run_hours), the why under each line that is off
    const off = shown.filter((r) => !r.gone && !r.run_hours.on);
    fill(list, noDevice(data, shown) || [group("Run-hours check off", off, true),
      group("Schedule linked", shown.filter((r) => !r.gone && r.run_hours.on), !off.length),
      group("No longer found", shown.filter((r) => r.gone), true)]);
  };
  draw();
  const which = h("p", { class: "muted" }, `${plural(data.rows.length, "device", "devices")}, and the helpers of the villa's system that belong to each.`);
  const c = card(place("links"), info, which, deviceSearch(data, LINK_SEARCH, (text) => { LINK_SEARCH = text; draw(); }), list);
  c.id = "knowledge-links";
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
