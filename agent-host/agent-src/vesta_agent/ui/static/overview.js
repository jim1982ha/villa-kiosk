// VESTA Agent page — the Overview tab: the agent's state, the changes made on these pages, copying the setup.
import { api, ask, bullets, button, capital, card, chip, fileBase64, fileButton, fill, go, h, heading, jobsBanner, loading, NEWEST_FIRST, none, note, paged, place, plural, problemsBox, reasons, setting, tabbedCard, tell, toast, $view, where } from "./core.js";

// ---------------------------------------------------------------- overview
export async function overview() {
  loading();
  const o = await api("GET", "api/overview");
  const off = o.skills.filter((s) => !s.ok && !s.off);
  const r = o.last_24h;
  const kids = [
    jobsBanner(o.jobs_not_set, () => go("overview")),
    // the Rules and Skills tabs are one click away: only what is wrong with them is shown here
    o.policy_problems.length ? problemsBox(o.policy_problems, "Rules to fix:") : null,
    // a chat of People that Telegram refused the last message to (status.unreachable: the words are the agent's)
    o.unreachable.length ? problemsBox(o.unreachable, `${plural(o.unreachable.length, "chat", "chats")} of ${where("people")} not reached:`) : null,
    off.length ? problemsBox(off.map((s) => `${s.name}: ${s.problem}`), `${plural(off.length, "skill", "skills")} not working:`) : null,
  ];
  if (r) {
    // ⚠️ THE SCHEDULED JOBS ONLY (owner, 2026-10-22): the counters moved to the Costs tab, over its period, and the
    // card's sub-title "Scheduled jobs run" went with them: it was the only thing left under the card's own title.
    // Each run's outcome in the agent's words (status.jobs_run `words`: done / not prepared (why) / stopped by a restart)
    // how far back is a setting (page.last_day_hours): the title says it, the lead links to it (core.setting)
    const lh = o.last_hours;
    kids.push(card(place("last_day", { hours: lh.value }), h("span", {}, "The scheduled jobs the agent ran in the last ",
      setting(`${lh.value} hours`, lh.ref), ", from its own records."),
      r.scheduled_jobs.length
        ? paged(["Job", "Ran at", "Outcome"], [...r.scheduled_jobs].reverse().map((j) => [j.label || j.job, j.at, j.words]), 10, { nav: NEWEST_FIRST })
        : none(`No scheduled job ran in the last ${lh.value} hours.`, "p")));
  } else {
    kids.push(card(place("last_day", { hours: o.last_hours.value }), "The agent has not recorded anything yet."));
  }
  kids.push(await historyCard(), setupCard(o.setup));
  fill($view, ...kids);
}

// ---------------------------------------------------------------- overview › changes made on these pages (4C)
export async function historyCard() {
  const { changes, kept_days: kept } = await api("GET", "api/history");
  const undo = (c) => async () => {
    if (!(await ask({ title: "Undo this change?", text: c.what, ok: "Undo" }))) return;
    try { await api("POST", `api/history/${c.id}/undo`); toast("Undone."); go("overview"); }
    catch (e) { tell("Not undone", reasons(e)); }
  };
  // how long they are kept: the agent rule's value now, a link to its row (core.setting), never a default written here
  const lead = h("span", {}, "Every save on the Rules and Skills tabs, newest first. Kept as long as the agent's other records (",
    setting(`${kept.value} days`, kept.ref), "), and trimmed with them every night. Undo writes the previous version back through the same checks as a save, and is itself recorded here.");
  return card(place("changes"), lead,
    changes.length ? paged(["When", "Where", "What changed", ""], changes.map((c) => [
      c.at,
      chip(c.place, c.chip),                                             // its status: history.CHIPS
      c.what,
      // the server says which changes Undo handles (server.undoable): the page kept its own list and left out the instructions
      c.undone_by ? none("undone") : c.undoable ? button("", { onclick: undo(c) }, "Undo") : ""]), 10, { nav: NEWEST_FIRST })
    : none("No change made here yet.", "p"));
}

// ---------------------------------------------------------------- overview › copy this setup to another villa (3A, 3B)
// the choices and their words are the agent's (setup_copy.offer): the page typed them, and one named a removed card
export function exportCard(offer) {
  const parts = Object.fromEntries(offer.parts.map((p) => [p.key, p.on]));
  const tick = (k, label, sub) => h("label", { class: "tick" }, h("input", { type: "checkbox", checked: parts[k], onchange: (e) => { parts[k] = e.target.checked; } }),
    h("span", {}, label, sub ? h("span", { class: "muted small block" }, sub) : null));
  const stay = (label, sub) => h("div", { class: "tick" }, h("span", { class: "lock" }, "✕"), h("span", {}, label, sub ? h("span", { class: "muted small block" }, sub) : null));
  const btn = button("primary", { onclick: async () => {
    btn.disabled = true;
    try {
      const { blob, name } = await api("POST", "api/setup/export", parts, { file: true });
      const a = h("a", { href: URL.createObjectURL(blob), download: name || "vesta-agent-setup.zip" });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { tell("Not downloaded", reasons(e)); }
    btn.disabled = false;
  } }, "Download the setup");
  return h("div", {}, h("p", { class: "muted" }, `One file with the skills and the shareable part of the rules. On the other villa: ${where("setup_in")}.`),
    h("div", { class: "grid two" },
      h("div", { class: "box" }, heading("Goes in the file"), offer.parts.map((p) => tick(p.key, p.words, p.note))),
      h("div", { class: "box" }, heading("Always stays here"), offer.stays.map((x) => stay(x.words, x.note)))),
    h("div", { class: "actions" }, btn));
}

// Overview › Copy the setup: Download and Import, two tabs of one card (owner, 2026-10-06: a cleaner overview)
export function setupCard(offer) {
  return tabbedCard(place("setup"), "setup", [["out", place("setup_out"), null, () => exportCard(offer)], ["in", place("setup_in"), null, importCard]],
    "The skills and the shareable part of the agent rules, in one file, and that file read on another villa. People, chats, devices, keys and records never leave a villa.");
}

export function importCard() {
  const out = h("div");
  let zip = null;
  async function look(file) {
    fill(out, h("p", { class: "muted" }, "Reading…"));
    zip = await fileBase64(file);
    try { show(file.name, await api("POST", "api/setup/import", { zip })); }
    catch (e) { fill(out, problemsBox(reasons(e), "Not a setup this agent can read:")); }
  }
  function show(name, p) {
    const CH = { same: "gray" };                 // a status each (core.STATUS): nothing to do is quiet, a change the page's own
    fill(out,
      h("p", { class: "muted" }, `${name}${p.made_with ? `, made with agent ${p.made_with}` : ""}. Nothing is written until you press Apply.`),
      // the shared table: 10 rows a page, each row a labelled card on a phone (a setup can carry many skills)
      paged(["What", "Change", "Detail"], p.rows.map((r) => [r.what,
        chip(capital(r.change), CH[r.change] || ""),
        { v: r.detail, cls: "muted" }])),
      p.misfits.length ? note("warn", `${plural(p.misfits.length, "thing does", "things do")} not fit this villa`, bullets(p.misfits)) : null,
      h("div", { class: "actions" },
        button("", { onclick: () => fill(out) }, "Cancel"),
        button("primary", { disabled: !p.changes, onclick: async () => {
          try { await api("POST", "api/setup/import", { zip, apply: true, fingerprint: p.fingerprint }); toast(`Imported. Every change is in ${where("changes")}.`); go("overview"); }
          catch (e) { tell("Not imported", reasons(e)); }
        } }, p.changes ? `Apply ${plural(p.changes, "change", "changes")}` : "Nothing to change")));
  }
  return h("div", {}, h("p", { class: "muted" }, "A file made by \"Download the setup\" on another villa. You see every change, and what does not fit this villa, before anything is written."),
    // the page's own file chooser (core.fileButton), as Skills' "Import skill"
    h("div", { class: "actions" }, fileButton(".zip,application/zip", look, "Choose the setup file")), out);
}
