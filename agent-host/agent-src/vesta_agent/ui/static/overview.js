// VESTA Agent page — the Overview tab: the agent's state, the changes made on these pages, copying the setup.
import { $view, api, ask, card, figures, fill, go, h, jobsBanner, paged, plural, problemsBox, subTabs, tell, toast } from "./core.js";

// ---------------------------------------------------------------- overview
export async function overview() {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const o = await api("GET", "api/overview");
  // Short, on the title's line (owner, 2026-10-03): the app's version, and the
  // channel when it is not the released one. The whole statement stays one
  // hover/long-press away.
  const ver = document.getElementById("ver");
  ver.textContent = `v${o.app_version || o.version}${o.instance && o.instance !== "prod" ? ` · ${o.instance}` : ""}`;
  ver.title = `${o.app_version ? `app ${o.app_version} · ` : ""}agent ${o.version} · ${o.instance}`;
  const off = o.skills.filter((s) => !s.ok && !s.off);
  const r = o.last_24h;
  const count = (k) => (r && r.counts[k]) || 0;
  const kids = [
    jobsBanner(o.jobs_not_set, () => go("overview")),
    // the Rules and Skills tabs are one click away: only what is wrong with them is shown here
    o.policy_problems.length ? problemsBox(o.policy_problems, "Rules — to fix:") : null,
    off.length ? problemsBox(off.map((s) => `${s.name}: ${s.problem}`), `${plural(off.length, "skill", "skills")} not working:`) : null,
  ];
  if (r) {
    kids.push(card("The last 24 hours", "From the agent's own records.",
      figures([["alerts followed", count("critical_event")], ["buttons pressed", count("ladder")],
        ["actions done", count("executed") + count("direct")], ["replies written", count("run")],
        ["AI cost (USD)", r.ai_cost_usd.toFixed(2)], ["failures", count("failed") + count("script_failed") + count("code_script_failed") + count("send_failed")]]),
      r.scheduled_jobs.length ? h("div", { class: "divided" }, h("h2", {}, "Scheduled jobs run"),
        paged(["Job", "Ran at"], [...r.scheduled_jobs].reverse().map((j) => [j.job, new Date(j.ran_at).toLocaleString()]))) : null));
  } else {
    kids.push(card("The last 24 hours", "The agent has not recorded anything yet."));
  }
  kids.push(await historyCard(), setupCard());
  fill($view, ...kids);
}

// ---------------------------------------------------------------- overview › changes made on these pages (4C)
export async function historyCard() {
  const { changes } = await api("GET", "api/history");
  const undo = (c) => async () => {
    if (!(await ask({ title: "Undo this change?", text: c.what, ok: "Undo" }))) return;
    try { await api("POST", `api/history/${c.id}/undo`); toast("Undone."); go("overview"); }
    catch (e) { tell("Not undone", e.problems); }
  };
  const PLACE = { Rules: "", Skills: "warn", Release: "gray", Import: "", Undo: "gray" };
  return card("Changes made on these pages", "Every save on the Rules and Skills tabs, newest first. Kept as long as the agent's other records (Rules (file) › settings.keep.records_days, 90 days by default), and trimmed with them every night. Undo writes the previous version back through the same checks as a save, and is itself recorded here.",
    changes.length ? paged(["When", "Where", "What changed", ""], changes.map((c) => [
      new Date(c.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
      h("span", { class: "chip " + (PLACE[c.place] || "") }, c.place),
      c.what,
      c.undone_by ? h("span", { class: "muted" }, "undone") : c.place === "Release" || c.target.kind === "release" || c.target.kind === "instructions" ? ""
        : h("button", { class: "btn ghost", onclick: undo(c) }, "Undo")])) : h("p", { class: "muted" }, "No change made here yet."));
}

// ---------------------------------------------------------------- overview › copy this setup to another villa (3A, 3B)
export function exportCard() {
  const parts = { skills: true, villa_files: true, ai: true, actions: true, tools: true, keep: true, instructions: false };
  const tick = (k, label, sub) => h("label", { class: "tick" }, h("input", { type: "checkbox", checked: parts[k], onchange: (e) => { parts[k] = e.target.checked; } }),
    h("span", {}, label, sub ? h("span", { class: "muted small block" }, sub) : null));
  const stay = (label, sub) => h("div", { class: "tick" }, h("span", { class: "lock" }, "✕"), h("span", {}, label, sub ? h("span", { class: "muted small block" }, sub) : null));
  const btn = h("button", { class: "btn primary", onclick: async () => {
    btn.disabled = true;
    try {
      const r = await fetch("api/setup/export", { method: "POST", headers: { "Content-Type": "application/json", "X-Vesta-UI": "1" }, body: JSON.stringify(parts) });
      if (!r.ok) throw Object.assign(new Error("refused"), { problems: ((await r.json().catch(() => ({}))).problems) || [`Error ${r.status}`] });
      const name = (r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "vesta-agent-setup.zip";
      const a = h("a", { href: URL.createObjectURL(await r.blob()), download: name });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { tell("Not downloaded", e.problems || [String(e)]); }
    btn.disabled = false;
  } }, "Download the setup");
  return h("div", {}, h("p", { class: "muted" }, "One file with the skills and the shareable part of the rules. On the other villa: Import a setup."),
    h("div", { class: "grid two" },
      h("div", { class: "box" }, h("div", { class: "eyebrow" }, "Goes in the file"),
        tick("skills", "The skills, every file"), tick("villa_files", "This villa's own choices inside the skills",
          "the skills' villa.* files: e.g. which speech-to-text to use, the villa's extra report entries, the commands switched off on the Skills tab. Untick to send the skills as released, without them."),
        tick("ai", "The AI: brains, spending limits, when the conversation context is deleted, web search"),
        tick("actions", "What the agent may do: each service and who decides"),
        tick("tools", "What the AI can use: tool switches, per role, skills switched off"),
        tick("keep", "How long records are kept"), tick("instructions", "instructions.md", "your standing rules for the agent")),
      h("div", { class: "box" }, h("div", { class: "eyebrow" }, "Always stays here"),
        stay("People and their Telegram ids"), stay("Chat ids (owner, facility manager)"),
        stay("Devices: protected, excluded, allowed lists, the siren", "entity ids are this villa's"),
        stay("Keys and tokens", "never in any file the page makes"), stay("Records, transcripts, costs"))),
    h("div", { class: "actions" }, btn));
}

// Overview › Copy the setup: Download and Import, two tabs of one card (owner, 2026-10-06: a cleaner overview)
export let setupTab = "out";
export function setupCard() {
  const body = h("div");
  const tabs = h("div");
  const draw = () => {
    fill(tabs, subTabs([["out", "Download this villa's setup"], ["in", "Import a setup"]], setupTab, (k) => { setupTab = k; draw(); }));
    fill(body, setupTab === "out" ? exportCard() : importCard());
  };
  draw();
  return card("Copy the setup to another villa", "The skills and the shareable part of the rules, in one file, and that file read on another villa. People, chats, devices, keys and records never leave a villa.", tabs, body);
}

export function importCard() {
  const out = h("div");
  const input = h("input", { type: "file", accept: ".zip,application/zip", onchange: () => input.files[0] && look(input.files[0]) });
  let zip = null;
  async function look(file) {
    fill(out, h("p", { class: "muted" }, "Reading…"));
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    zip = btoa(bin);
    try { show(file.name, await api("POST", "api/setup/import", { zip })); }
    catch (e) { fill(out, problemsBox(e.problems, "Not a setup this agent can read:")); }
  }
  function show(name, p) {
    const CH = { added: "", replaced: "", changed: "", same: "gray" };
    fill(out,
      h("p", { class: "muted" }, `${name}${p.made_with ? ` — made with agent ${p.made_with}` : ""}. Nothing is written until you press Apply.`),
      // the shared table: 10 rows a page, each row a labelled card on a phone (a setup can carry many skills)
      paged(["What", "Change", "Detail"], p.rows.map((r) => [r.what,
        h("span", { class: "chip " + (CH[r.change] || "") }, r.change[0].toUpperCase() + r.change.slice(1)),
        { v: r.detail, cls: "muted" }])),
      p.misfits.length ? h("div", { class: "banner warnbox" }, h("div", {}, h("b", {}, `${plural(p.misfits.length, "thing does", "things do")} not fit this villa`),
        h("ul", {}, p.misfits.map((m) => h("li", { class: "muted" }, m))))) : null,
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", onclick: () => { fill(out); input.value = ""; } }, "Cancel"),
        h("button", { class: "btn primary", disabled: !p.changes, onclick: async () => {
          try { await api("POST", "api/setup/import", { zip, apply: true, fingerprint: p.fingerprint }); toast("Imported. Every change is in Changes made on these pages."); go("overview"); }
          catch (e) { tell("Not imported", e.problems); }
        } }, p.changes ? `Apply ${plural(p.changes, "change", "changes")}` : "Nothing to change")));
  }
  return h("div", {}, h("p", { class: "muted" }, "A file made by \"Download the setup\" on another villa. You see every change, and what does not fit this villa, before anything is written."),
    h("label", { class: "field" }, h("span", {}, "Setup file"), input), out);
}
