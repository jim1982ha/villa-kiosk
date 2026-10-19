// VESTA Agent page — the Limits tab: every limit on what the agent reads, says and keeps, on one page.
// ⚠️ SAVED WHERE IT LIVES (owner, 2026-10-20): a limit of the code in limits.yaml, a skill's number in the skill's
// settings, a rule in policy.yaml (ui/limits_tab.py) — so Rules and Skills show the same value, and this tab can go.
import { api, card, dropdown, fill, h, infoButton, paged, problemsBox, reasons, tabbed, toast, $view } from "./core.js";

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
  return [
    h("div", { class: "limit-what" },
      h("b", {}, r.label), " ", infoButton(r.name, `${r.name} — written at ${(r.where || []).join(", ")}`),
      h("div", { class: "muted" }, r.also),
      same(r.value, r.default) ? null : h("div", { class: "muted" }, `Changed from its usual ${shown(r.default)}.`)),
    h("div", { class: "limit-value" }, field, r.unit ? h("span", { class: "muted" }, r.unit) : null, save,
      bounds ? h("div", { class: "muted limit-bounds" }, bounds) : null),
    h("div", {}, r.reached || "—", r.told ? h("div", {}, h("span", { class: "chip" + (r.told.startsWith("Nobody") ? " off" : "") }, r.told)) : null),
  ];
}

export async function limits() {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const data = await api("GET", "api/limits");
  const probs = h("div");
  const again = () => limits();
  const match = (r) => !FILTER || `${r.label} ${r.name} ${r.section} ${r.also}`.toLowerCase().includes(FILTER);
  const groups = Object.entries(data.groups).map(([key, title]) => {
    const rows = data.rows.filter((r) => r.group === key);
    return rows.length ? [key, `${title} (${rows.length})`, null, () => {
      const list = rows.filter(match);
      if (!list.length) return h("p", { class: "muted" }, "No limit here matches the search.");
      return paged(["Limit", "Value", "When it is reached"],
        list.map((r) => row(r, probs, again)), 10, { cls: "limits", widths: ["48%", "26%", "26%"] });
    }] : null;
  });
  const tabs = tabbed("limits", groups);
  const search = h("input", { type: "search", placeholder: "Search the limits", value: FILTER, "aria-label": "Search the limits",
    oninput: (e) => { FILTER = e.target.value.trim().toLowerCase(); tabs.redraw(); } });
  fill($view, card("Limits",
    `Every limit on what the agent reads, tells and keeps, in one place: ${data.rows.length} in all. Each value is saved where the agent reads it — a limit of the agent's code in ${data.file}, a skill's setting in that skill's files, a rule in policy.yaml — so the Rules and Skills tabs show the same value. A change counts from the next answer or the next run.`,
    data.problems.length ? problemsBox(data.problems, "Limits the page could not read:") : null,
    h("div", { class: "limits-search" }, search), probs, tabs.bar, tabs.body));
}
