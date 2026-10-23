// VESTA Agent page — the Limits tab: every limit on what the agent reads, says and keeps, on one page.
// ⚠️ SAVED WHERE IT LIVES (owner, 2026-10-20): a limit of the code in limits.yaml, a skill's number in the skill's
// settings, a rule in policy.yaml (ui/limits_tab.py) — so Rules and Skills show the same value, and this tab can go.
import { api, card, dropdown, fill, h, infoButton, page, paged, problemsBox, reasons, tabbed, toast, $view } from "./core.js";

let FILTER = "";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shown = (v) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "—" : String(v));

// the value's field: a number, a choice, or a list of words (ticked from the words it may hold)
function input(r, set) {
  if (r.kind === "measured") return h("b", {}, String(r.value));        // the villa's own setting: shown, never set here
  if (r.kind === "choice") {
    return dropdown((r.choices || []).map((c) => [c, c]), r.value, (v) => set(v), r.name);
  }
  if (r.kind === "list") {
    const all = [...new Set([...(r.choices || []), ...(r.default || []), ...(r.value || [])])].sort();
    const now = new Set(r.value || []);
    return h("div", { class: "limit-words" }, all.map((w) => h("label", { class: "limit-word" },
      h("input", { type: "checkbox", checked: now.has(w), onchange: (e) => { e.target.checked ? now.add(w) : now.delete(w); set([...now].sort()); } }), w)));
  }
  return h("input", { type: "number", step: "any", min: r.lo ?? null, max: r.hi ?? null, value: r.value, "aria-label": r.name,
    oninput: (e) => set(e.target.value === "" ? null : Number(e.target.value)) });
}

function row(r, probs, again) {
  let value = r.value;
  const save = h("button", { class: "btn", disabled: true, onclick: async () => {
    save.disabled = true;
    try {
      await api("PUT", "api/limits", { id: r.id, value });
      fill(probs); toast(`Saved: ${r.name} = ${shown(value)}`); again();
    } catch (e) {
      fill(probs, problemsBox(reasons(e), `${r.name} not saved:`)); save.disabled = false;
      probs.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
  } }, "Save");
  const field = input(r, (v) => { value = v; save.disabled = same(v, r.value) || v === null; });
  if (r.kind === "measured") save.hidden = true;
  const bounds = [r.lo !== null && r.lo !== undefined ? `from ${r.lo}` : "", r.hi !== null && r.hi !== undefined ? `to ${r.hi}` : ""].filter(Boolean).join(" ");
  // ⚠️ LOW ROWS (owner, 2026-10-20): what happens when it is reached is part of the limit's description, and the
  // value's unit, bounds and Save sit on the value's own line. Who is told has its own column (owner, 2026-10-22: the
  // pill sat at the end of the "Reached:" sentence), still a pill, grey when nobody is
  return [
    h("div", { class: "limit-what" },
      h("b", {}, r.label), " ", infoButton(r.name, `${r.name}, written at ${(r.where || []).join(", ")}`),
      r.reached ? h("div", { class: "limit-reached" }, `Reached: ${r.reached}`) : null,
      h("div", { class: "muted small" }, r.also,
        same(r.value, r.default) ? "" : ` Changed from its usual ${shown(r.default)}.`)),
    r.told ? h("span", { class: "chip tiny" + (r.told.startsWith("Nobody") ? " off" : "") }, r.told) : h("span", { class: "muted" }, "—"),
    h("div", { class: "limit-value" }, field, r.unit ? h("span", { class: "muted" }, r.unit) : null,
      bounds ? h("span", { class: "muted small" }, bounds) : null, save),
  ];
}

export async function limits() {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const data = await api("GET", "api/limits");
  const probs = h("div");
  const again = () => limits();
  const table = (list) => paged(["Limit", "Who is told", "Value"], list.map((r) => row(r, probs, again)), 10,
    { cls: "limits", widths: ["50%", "14%", "36%"] });
  const match = (r) => !FILTER || `${r.label} ${r.name} ${r.section} ${r.also}`.toLowerCase().includes(FILTER);
  // ⚠️ A SEARCH COUNTS IN EVERY TAB (owner, 2026-10-23: "reopen" found nothing — its limit sat in Skill settings while
  // another tab was open; "the numbers between brackets shall update in each tab title"): while text is typed, each
  // tab's (N) is its matches, and an open tab with none gives way to the first that has some
  const groupsNow = () => Object.entries(data.groups).map(([key, title]) => {
    const rows = data.rows.filter((r) => r.group === key);
    if (!rows.length) return null;
    const list = rows.filter(match);
    return [key, `${title} (${list.length})`, (data.group_info || {})[key] || null,
      () => (list.length ? table(list) : h("p", { class: "muted" }, "No limit here matches the search.")), list.length];
  });
  const bar = h("div"), body = h("div");
  const draw = () => {
    const groups = groupsNow();
    const open = groups.find((g) => g && g[0] === page.tabs.limits);
    const first = groups.find((g) => g && g[4] > 0);
    if (FILTER && first && (!open || open[4] === 0)) page.tabs.limits = first[0];
    const tabs = tabbed("limits", groups);
    bar.replaceChildren(tabs.bar); body.replaceChildren(tabs.body);
  };
  draw();
  const search = h("input", { type: "search", placeholder: "Search the limits", value: FILTER, "aria-label": "Search the limits",
    oninput: (e) => { FILTER = e.target.value.trim().toLowerCase(); draw(); } });
  fill($view, card("Limits",
    `Every limit on what the agent reads, tells and keeps, in one place: ${data.rows.length} in all. Each value is saved where the agent reads it, a limit of the agent's code in ${data.file}, a skill's setting in that skill's files, an agent rule in policy.yaml, so the Rules and Skills tabs show the same value. A change counts from the next answer or the next run.`,
    data.problems.length ? problemsBox(data.problems, "Limits the page could not read:") : null,
    h("div", { class: "limits-search" }, search), probs, bar, body));
}
