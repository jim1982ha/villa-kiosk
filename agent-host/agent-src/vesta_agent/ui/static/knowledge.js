// VESTA Agent page — the Knowledge tab: what the agent knows of the villa and keeps outside policy.yaml (owner,
// 2026-10-30: "the Rule tab exclusively contain feature defined in the policy.yaml file", every other one in ONE tab).
// Its sections (places.ORDER.knowledge): Asleep between reports and Translations, each a card, then Device kinds and
// Device links as the tabs of one tabbed section (places.TABBED; owner, 2026-10-31: the two cards were tabs too). Each
// is saved where it lives, at once (no save bar): a kind and a link through the page's one writer (ui/kinds.py,
// ui/links.py: in Page changes, undoable), the translations forgotten in the agent's memory.
import { api, ask, card, dropdown, fill, h, inOrder, paged, place, plural, problemsBox, reasons, tabbed, tabbedIn, tell, toast, $view } from "./core.js";

// a (i) in readable sections (owner, 2026-10-30: "barely understandable and very poorly formatted"): a heading, then
// its sentences or a list of [bold words, the rest]
const part = (title, ...body) => [h("p", { class: "tip-head" }, title), ...body];
const items = (pairs) => h("ul", { class: "tip-list" }, pairs.map(([b, rest]) => h("li", {}, h("b", {}, b), rest ? ` ${rest}` : "")));

export async function knowledge() {
  fill($view, h("p", { class: "muted" }, "Loading…"));
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
  const names = Object.fromEntries(data.kinds.map(([k, name]) => [k, name]));
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
      ["From the villa's system:", "what the device is made of there (a light, a fan, a climate unit)."],
      ["Guessed:", "from its name, when the villa's system does not say."],
      ["Chosen here:", "your choice, which always wins."]])),
    ...part("To correct a kind",
      h("p", {}, "Pick the right one in its list. It applies from the next night check and report. \"Back to the guess\" undoes it.")),
    ...part("\"light + fan\"",
      h("p", {}, "A wall switch driving a light and a fan on one power reading: VESTA checks the fan by its own on and off, reads the power only while the light is off, and counts the light in the energy figures only.")));
  const list = h("div");
  const save = async (r, kind) => {
    try {
      Object.assign(data, await api("PUT", "api/kinds", { slug: r.slug, kind }));
      fill(probs);
      toast(kind ? `Saved: ${r.name} is ${names[kind]}` : (r.guess ? `Saved: ${r.name} back to its guess, ${names[r.guess]}` : `Removed: ${r.name}`));
    } catch (e) {
      fill(probs, problemsBox(reasons(e), `${r.name} not saved:`));
      probs.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
    draw();
  };
  const row = (r) => [
    [h("b", {}, r.name), r.area ? h("span", { class: "muted" }, ` ${r.area}`) : null,
      r.parts ? h("span", { class: "muted" }, ` · ${r.parts}`) : null],
    dropdown(data.kinds.map(([k, name]) => [k, k === r.guess ? `${name} (${r.source === "system" ? "the villa's system" : "guess"})` : name]), r.kind, (v) => save(r, v), `${r.name}, kind`),
    h("span", { class: "chips" },
      r.gone ? h("span", { class: "chip warn" }, "No longer found")
        : h("span", { class: r.chosen ? "chip" : "chip gray" },
          r.chosen ? "Chosen here" : r.source === "system" ? "From the villa's system" : "Guessed"),
      r.chosen ? h("button", { type: "button", class: "btn ghost", onclick: () => save(r, null) }, r.gone ? "Remove" : "Back to the guess") : null),
  ];
  const draw = () => {
    const q = KIND_SEARCH.trim().toLowerCase();
    const shown = data.rows.filter((r) => !q || `${r.name} ${r.area} ${r.slug}`.toLowerCase().includes(q));
    fill(list, data.rows.length
      ? (shown.length ? paged(["Device", "Kind", "Set by"], shown.map(row), 10,
          { cls: "kinds", widths: ["44%", "26%", "30%"], nav: ["‹ Previous", "Next ›", "devices"] })
        : h("p", { class: "muted" }, "No device matches the search."))
      : h("p", { class: "muted" }, data.built ? "No device with a power or energy reading." : "The agent has not read the villa's devices yet."));
  };
  const search = h("input", { type: "search", placeholder: "Search the devices", value: KIND_SEARCH, "aria-label": "Search the devices",
    oninput: (e) => { KIND_SEARCH = e.target.value; draw(); } });
  draw();
  // which devices, said on the card itself too (owner, 2026-10-30: "where the device list is coming from?")
  const which = h("p", { class: "muted" }, `${data.rows.length} devices that measure their own power or energy.`);
  const c = card(place("kinds"), info, which, data.rows.length ? h("div", { class: "limits-search" }, search) : null, list);
  c.id = "knowledge-kinds";
  return c;
}

// ---------------------------------------------------------------- knowledge › device links
// ⚠️ A NAME WAS THE ONLY LINK (owner, 2026-10-30): a device's schedule, normal power and run hours were found only by
// the helper's name (schedule.<device>_expected_runtime), so a schedule named otherwise was never read and its
// run-hours check stayed off, unsaid. Each link: a drop-down of the villa's helpers of its type, by name, and None;
// where it comes from (Guessed, Chosen here, None linked); "Back to the guess". Saved at once (ui/links.py). The
// links' names and words are the agent's (asset_links.ROLES).
let LINK_SEARCH = "";
export function linksCard(data, probs) {
  const roles = data.roles.map(([k, name, , words]) => ({ k, name, words }));
  const info = h("div", { class: "tip-doc" },
    ...part("Which devices are listed",
      h("p", {}, `Every device that measures its own power or energy, as in Device kinds, and any other that has a link: ${data.rows.length} on this villa.`)),
    ...part("What each link is used for", items(roles.map((r) => [`${r.name}:`, r.words]))),
    ...part("Where a link comes from", items([
      ["Guessed:", "a helper of the villa's system whose name follows the agent's rule (the device's name, then what it is)."],
      ["Chosen here:", "your choice, which always wins, None included."],
      ["None linked:", "no helper found or chosen. That link does nothing."]])),
    ...part("To change a link",
      h("p", {}, "Pick the helper in its list, or None to switch the link off. It applies from the next night check. \"Back to the guess\" undoes it.")));
  const list = h("div");
  const nameOf = (role, id) => ((data.options[role] || []).find(([i]) => i === id) || [id, id])[1];
  const save = async (r, role, value) => {
    const link = roles.find((x) => x.k === role).name;
    try {
      Object.assign(data, await api("PUT", "api/links", { slug: r.slug, role, value }));
      fill(probs);
      toast(value === null ? `Saved: ${r.name}, ${link} back to its guess` : `Saved: ${r.name}, ${link} ${value ? nameOf(role, value) : "None"}`);
    } catch (e) {
      fill(probs, problemsBox(reasons(e), `${r.name} not saved:`));
      probs.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
    draw();
  };
  const cell = (r, role) => {
    const l = r.links[role.k] || { value: null, source: "none" };
    const opts = [["", "None"], ...(data.options[role.k] || []).map(([i, n]) => [i, i === l.guess ? `${n} (guess)` : n])];
    if (l.value && !opts.some(([i]) => i === l.value)) opts.push([l.value, l.name || l.value]);
    return h("div", { class: "link-cell" },
      r.gone ? null : dropdown(opts, l.value || "", (v) => save(r, role.k, v), `${r.name}, ${role.name}`),
      h("span", { class: "chips" },
        h("span", { class: l.source === "chosen" ? "chip" : "chip gray" },
          l.source === "chosen" ? "Chosen here" : l.source === "guessed" ? "Guessed" : "None linked"),
        l.source === "chosen" ? h("button", { type: "button", class: "btn ghost", onclick: () => save(r, role.k, null) }, r.gone ? "Remove" : "Back to the guess") : null),
      // the night check's run-hours check needs a schedule: the hours planned for each day
      role.k === "schedule" && !l.value && !r.gone ? h("span", { class: "muted small" }, "No schedule linked: the run-hours check is off for it") : null);
  };
  const row = (r) => [
    [h("b", {}, r.name), r.area ? h("span", { class: "muted" }, ` ${r.area}`) : null,
      r.gone ? h("span", { class: "chips" }, h("span", { class: "chip warn" }, "No longer found")) : null],
    ...roles.map((role) => cell(r, role)),
  ];
  const draw = () => {
    const q = LINK_SEARCH.trim().toLowerCase();
    const shown = data.rows.filter((r) => !q || `${r.name} ${r.area} ${r.slug}`.toLowerCase().includes(q));
    fill(list, data.rows.length
      ? (shown.length ? paged(["Device", ...roles.map((r) => r.name)], shown.map(row), 10,
          { cls: "links", widths: ["28%", null, null, null], nav: ["‹ Previous", "Next ›", "devices"] })
        : h("p", { class: "muted" }, "No device matches the search."))
      : h("p", { class: "muted" }, data.built ? "No device with a power or energy reading." : "The agent has not read the villa's devices yet."));
  };
  const search = h("input", { type: "search", placeholder: "Search the devices", value: LINK_SEARCH, "aria-label": "Search the devices",
    oninput: (e) => { LINK_SEARCH = e.target.value; draw(); } });
  draw();
  const which = h("p", { class: "muted" }, `${data.rows.length} devices, and the helpers of the villa's system that belong to each.`);
  const c = card(place("links"), info, which, data.rows.length ? h("div", { class: "limits-search" }, search) : null, list);
  c.id = "knowledge-links";
  return c;
}

// ---------------------------------------------------------------- knowledge › asleep between reports
// ⚠️ THE KIOSK'S LIST, SHOWN HERE (owner, 2026-10-21): one list, kept in the VESTA Kiosk; the agent reads it
// (vesta_shared.asleep) and never edits it, so it is shown, never offered as a field to change
function asleepCard(rows) {
  return card(place("asleep"), "Set in the VESTA Kiosk (Advanced Settings › Devices › Asleep between reports). The agent never reports these devices offline and reads their last real state.",
    h("div", { class: "chips" }, rows.length
      ? rows.map((r) => h("span", { class: "chip", title: r.id }, r.name))
      : [h("span", { class: "muted" }, "None")]));
}

// ---------------------------------------------------------------- knowledge › translations
// the alert translation's memory (phrases.py): "Forget Translations" forgets them all (every language but English:
// English is never translated; owner, 2026-10-23: no language menu), asked in the page's own dialog (core.ask:
// never the browser's confirm). Not a change of a file: done at once; the next alert cards are translated again.
function translationsCard(v) {
  const box = h("div");
  const draw = () => {
    if (!v.translations) return fill(box, h("p", { class: "muted" }, "No skill puts its alert cards in the chats' language."));
    const langs = Object.entries(v.translations).filter(([, n]) => n > 0);
    fill(box,
      langs.length
        ? h("ul", {}, langs.map(([k, n]) => h("li", { class: "block" }, `${(v.languages || {})[k] || k}: ${plural(n, "sentence kept", "sentences kept")}`)))
        : h("p", { class: "muted" }, "No translation kept yet."),
      h("button", { type: "button", class: "btn ghost", disabled: !langs.length, onclick: forget }, "Forget Translations"));
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
