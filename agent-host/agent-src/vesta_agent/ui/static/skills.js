// VESTA Agent page — the Skills tab.
import { $view, api, ask, dropdown, field, fill, go, guard, h, markDirty, page, plural, problemsBox, setBar, showBar, subTabs, tell, titleWithInfo, toast } from "./core.js";

// ---------------------------------------------------------------- skills
// A skill's state against this release: it follows the releases (never edited here), it was edited here (updates
// paused), or it is the villa's own. Its on/off switch is the villa's (policy.yaml skills_off).
export const STATE_WORDS = { follows: "Follows the releases", edited: "Edited here · updates paused", own: "This villa's own skill" };

export function skillChips(s) {
  return [s.off ? h("span", { class: "chip gray" }, "Off") : null,
          !s.off && !s.ok ? h("span", { class: "chip off" }, "Not working") : null,
          s.state === "edited" ? h("span", { class: "chip warn" }, "edited here") : null];
}

export function skillSwitch(name, on, select) {
  return h("label", { class: "switch skill-switch", title: on ? "On: the agent uses it" : "Off: kept, not used" },
    h("input", { type: "checkbox", checked: on, "aria-label": `${name} on`, onchange: async (e) => {
      const now = e.target.checked;
      if (!now && !(await ask({ title: `Switch ${name} off?`, ok: "Switch off", danger: true,
        text: "The agent stops using it at once: no schedule, no alert hook, not read in a chat. Its files are kept; switch it on again here." }))) { e.target.checked = true; return; }
      if (!(await guard())) { e.target.checked = !now; return; }
      try { await api("PUT", `api/skills/${encodeURIComponent(name)}/on`, { on: now }); toast(`${name} switched ${now ? "on" : "off"}.`); skills(select); }
      catch (err) { e.target.checked = !now; tell("Not changed", err.problems); }
    } }));
}

export async function skills(select = null) {
  fill($view, h("p", { class: "muted" }, "Loading…"));
  const { skills: list } = await api("GET", "api/skills");
  const side = h("div", { class: "card" },
    titleWithInfo("Skills", "Each skill is a folder of files. A change counts at the agent's next use, no restart. The switch beside a skill turns it on or off for this villa."),
    // each skill: its name and line (opens it), and its On/Off switch beside it (owner, 2026-10-06)
    list.length ? list.map((s) => h("div", { class: "skill-item" + (s.name === select ? " on" : "") + (s.off ? " is-off" : "") },
      h("button", { type: "button", class: "skill-open", onclick: async () => { if (await guard()) skills(s.name); } },
        h("div", { class: "skill-name" }, h("b", {}, s.name), ...skillChips(s)),
        h("div", { class: "d" }, s.off ? "Off · kept, not used" : s.ok ? s.description : s.problem.startsWith("It needs") ? "A tool it needs is switched off." : s.problem)),
      skillSwitch(s.name, !s.off, select))) : h("p", { class: "muted" }, "No skill yet. The starter skills are copied at the agent's first start."),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: newSkill }, "New skill")));
  const pane = h("div");
  side.classList.add("skills-side");
  fill($view, h("div", { class: "skills" }, side, pane));
  page.dirty = false; setBar(null);
  if (select) openSkill(select, pane, list.find((s) => s.name === select));
}

export async function setCommand(skill, script, command, on, box) {
  try { await api("PUT", `api/skills/${encodeURIComponent(skill)}/commands`, { script, command, on }); toast(`${command || script} switched ${on ? "on" : "off"} for the AI.`); }
  catch (e) { box.checked = !on; tell("Not changed", e.problems); }
}

// 2C's one-press fix: the tool switched on through the same save as the Rules form
export async function switchTool(b) {
  const doc = await api("GET", "api/policy");
  const form = doc.form;
  if (b.fix === "ha") form.ha_read_tools = [...new Set([...(form.ha_read_tools || []), b.tool])];
  else if (b.tool === "web_search") form.settings.web_search = true;
  else { form.agent_tools = { ...(form.agent_tools || {}) }; delete form.agent_tools[b.tool]; }
  await api("PUT", "api/policy/form", { form, rev: doc.rev });
}

// Skills › Try a command: run by the agent on the live villa, exactly as the AI would — nothing is sent.
// Two steps (owner, 2026-10-06: "badly rendered, not understandable"): what to run, its options in words; then Run.
export const FLAG_HELP = { date: "a day, e.g. 2026-10-05", text: "a word or a few", switch: "" };
export function tryPanel(name, d) {
  const out = h("div");
  const runnable = d.scripts.filter((sc) => !sc.whole_off);
  if (!runnable.length) return h("p", { class: "muted" }, "Every script of this skill is switched off for the AI.");
  let script = runnable[0], command = null, values = {};
  const what = h("div", { class: "try-row" }), opts = h("div", { class: "try-opts" });
  const args = () => {
    const a = command ? [command] : [];
    for (const [flag, kind] of Object.entries(script.flags)) {
      const v = values[flag];
      if (kind === "switch") { if (v) a.push(flag); } else if (v) a.push(flag, String(v));
    }
    return a;
  };
  const draw = () => {
    const cmds = script.commands.filter((c) => c.on);
    if (!cmds.some((c) => c.name === command)) command = cmds.length ? cmds[0].name : null;
    fill(what,
      field("Script", dropdown(runnable.map((sc) => [sc.script, sc.script]), script.script, (v) => { script = runnable.find((x) => x.script === v); values = {}; draw(); }, "Script")),
      cmds.length ? field("Command", dropdown(cmds.map((c) => [c.name, c.words ? `${c.name} — ${c.words}` : c.name]), command, (v) => { command = v; }, "Command")) : null);
    // A file it reads is one an earlier step left in the out folder (a page's --facts: the file the step before it
    // wrote): chosen among them, the one named after the option first. A file it writes is named here, for the next
    // step (--energy: the week's energy, saved by another skill's script, 2026-10-06)
    const flags = Object.entries(script.flags);
    fill(opts, flags.length ? flags.map(([flag, kind]) => {
      const label = flag.replace(/^--/, "").replace(/-/g, " ");
      if (kind === "infile" && values[flag] === undefined) {
        const own = (d.out_files || []).find((f) => f.replace(/\.[^.]+$/, "") === flag.replace(/^--/, ""));
        values[flag] = own || "";
      }
      const input = kind === "outfile"
        ? h("input", { type: "text", value: values[flag] || "", placeholder: "not saved, e.g. week.json", "aria-label": label,
            oninput: (e) => { values[flag] = e.target.value.trim(); } })
        : kind === "infile"
        ? dropdown([["", "not given"], ...(d.out_files || []).map((f) => [f, f])], values[flag], (v) => { values[flag] = v; }, label)
        : Array.isArray(kind)
        ? dropdown([["", "not set"], ...kind.map((k) => [k, k])], values[flag] || "", (v) => { values[flag] = v; }, label)
        : kind === "switch"
          ? h("label", { class: "switch" }, h("input", { type: "checkbox", checked: !!values[flag], "aria-label": label,
              onchange: (e) => { values[flag] = e.target.checked; } }), "yes")
          : h("input", { type: "text", value: values[flag] || "", placeholder: FLAG_HELP[kind] || "", "aria-label": label,
              oninput: (e) => { values[flag] = e.target.value.trim(); } });
      return field(label[0].toUpperCase() + label.slice(1), input,
        kind === "infile" ? `${flag} · a file an earlier step left` : kind === "outfile" ? `${flag} · saved for a next step`
          : Array.isArray(kind) ? `one of: ${kind.join(", ")}` : flag);
    }) : h("p", { class: "muted small" }, "This command takes no options."));
  };
  // the answer is asked for every second: a command may run for minutes (nightly.py), longer than a page request lives
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function waitFor(rid) {
    const t0 = Date.now();
    for (;;) {
      const r = await api("GET", `api/tries/${encodeURIComponent(rid)}`);
      if (!r.pending) return r;
      const s = Math.round((Date.now() - t0) / 1000);
      if (!r.started && s > 30) return { ok: false, error: "The agent did not start it: it is stopped, or waiting for a setting (see its log)." };
      fill(out, h("p", { class: "muted" }, r.started ? `Running on the villa… ${s} s` : "Waiting for the agent…"));
      await sleep(1000);
    }
  }
  async function run() {
    fill(out, h("p", { class: "muted" }, "Running on the villa…"));
    try {
      const { pending } = await api("POST", `api/skills/${encodeURIComponent(name)}/try`, { script: script.script, args: args() });
      const r = await waitFor(pending);
      // a file it saved is offered to the next step at once
      try { d.out_files = (await api("GET", `api/skills/${encodeURIComponent(name)}`)).out_files; draw(); } catch { /* kept */ }
      fill(out, r.ok === false && r.exit === undefined ? problemsBox([r.error], "Not run:") : [
        // the verdict is the agent's (script_run.py), the same for every run: not worked out again here
        h("div", { class: "try-result" }, h("span", { class: "chip" + ({ done: "", nothing: " warn" }[r.verdict] ?? " off") },
          { done: "Done", nothing: "Nothing to do, or a setting is missing" }[r.verdict] || `Stopped (exit ${r.exit})`),
          h("span", { class: "muted small" }, `${r.seconds} s · the script's own answer · nothing was sent`)),
        r.error ? problemsBox([r.error], "The script stopped:") : null,
        h("pre", { class: "out" }, pretty(r.output))]);
    } catch (e) { fill(out, problemsBox(e.problems, "Not run:")); }
  }
  draw();
  return h("div", { class: "skill-sec try" },
    h("h3", {}, "1 · What to run"), what,
    h("h3", {}, "2 · Options"), opts,
    h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: run }, "Run")),
    out);
}

export function pretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text || "(no output)"; }
}

export function shown(rows, around = 2) {
  const keep = rows.map(() => false);
  rows.forEach((r, i) => { if (!r.same) for (let k = Math.max(0, i - around); k <= Math.min(rows.length - 1, i + around); k++) keep[k] = true; });
  const out = [];
  rows.forEach((r, i) => { if (keep[i]) out.push(r); else if (out.length && out[out.length - 1] !== null) out.push(null); });
  if (out.length && out[out.length - 1] === null) out.pop();
  if (rows.length && !keep[0] && out[0] !== null) out.unshift(null);
  return out;
}

// Skills › Compare with the release: an edited starter skill's file beside the release's
export async function comparePanel(name, rel) {
  const box = h("div");
  const list = rel.differs || [];
  let file = list.find((f) => !(rel.only_here || []).includes(f)) || list[0];
  const draw = async () => {
    const { rows } = await api("GET", `api/skills/${encodeURIComponent(name)}/compare?path=${encodeURIComponent(file)}`);
    fill(box,
      h("div", { class: "files" }, list.map((f) => h("button", { class: f === file ? "on" : "", onclick: () => { file = f; draw(); } },
        f + ((rel.only_here || []).includes(f) ? " · only here" : (rel.only_release || []).includes(f) ? " · only in the release" : "")))),
      h("div", { class: "compare" },
        h("div", { class: "compare-head" }, h("b", {}, "Here"), h("b", {}, "The release")),
        // only the changed lines and 2 around each; "…" where the files agree (on a phone: one column, labelled)
        shown(rows).map((r) => r === null ? h("div", { class: "compare-gap" }, "…") : h("div", { class: "compare-row" + (r.same ? "" : " diff") },
          h("pre", { class: r.here === null ? "gap" : "", "data-side": "here" }, r.here ?? ""),
          h("pre", { class: r.release === null ? "gap" : "", "data-side": "release" }, r.release ?? "")))),
      h("p", { class: "muted small" }, "\"Take the release version\" replaces the skill's files with the release's and keeps this villa's own files (villa.*). Your edits are moved to skills/.trash."));
  };
  if (file) await draw(); else fill(box, h("p", { class: "muted" }, "No file differs."));
  return h("div", { class: "skill-sec" }, box);
}

export async function newSkill() {
  const name = await ask({ title: "New skill", text: "Its name: lower-case letters, digits, - and _.", ok: "Create", input: "e.g. pool-care" });
  if (!name || !(await guard())) return;
  try { await api("POST", "api/skills", { name }); toast(`Skill ${name} created.`); skills(name); }
  catch (e) { tell("Not created", e.problems); }
}

export let filesOpen = false;

export const ABOUT = "\u0000about", TRY = "\u0000try", COMPARE = "\u0000compare";

// One skill: its name, state and switch on top, then four views (owner, 2026-10-06: "very messy" — one thing at a
// time). About: when it acts, what the AI may run, the tools it needs. Files: the editor. Try a command. Compare.
export async function openSkill(name, pane, info, path = ABOUT) {
  const enc = encodeURIComponent(name);
  const [{ files }, d] = await Promise.all([api("GET", `api/skills/${enc}/files`), api("GET", `api/skills/${enc}`)]);
  if (path === COMPARE && (d.release || {}).state !== "edited") path = ABOUT;
  if (path === TRY && !(d.scripts && d.scripts.length)) path = ABOUT;
  const isFile = ![ABOUT, TRY, COMPARE].includes(path);
  if (isFile && !files.some((x) => x.path === path)) path = files.length ? files[0].path : null;
  const rel = d.release || {};
  const goTo = async (p) => { if (p !== path && await guard()) openSkill(name, pane, info, p); };
  pane.closest(".skills")?.classList.add("has-open");

  // ---- the head (a phone only: the list is hidden there) and the state pill, which sits on the tabs' line
  const pill = rel.state ? h("span", { class: "chip" + (rel.state === "edited" ? " warn" : rel.state === "own" ? " gray" : "") }, STATE_WORDS[rel.state]) : null;
  const back = h("button", { class: "btn ghost back-to-list", onclick: async () => { if (await guard()) skills(); } }, "‹ All skills");
  const head = h("div", { class: "skill-head" },
    h("div", { class: "skill-title" }, h("h2", {}, name), pill ? pill.cloneNode(true) : null,     // the phone's place for the pill
      d.off ? h("span", { class: "chip gray" }, "Off") : !d.ok ? h("span", { class: "chip off" }, "Not working") : null),
    skillSwitch(name, !d.off, name));

  // ---- what needs the owner's attention, above everything
  const fixes = (d.blocked || []).filter((b) => b.fix);
  const blocked = d.blocked && d.blocked.length ? h("div", { class: "problems" },
    h("b", {}, "The agent cannot use this skill right now."),
    h("ul", {}, d.blocked.map((b) => h("li", {}, b.why))),
    h("p", { class: "muted" }, "Its AI jobs (reports) do not run, and a reply that needed it says which setting stops it."),
    h("div", { class: "actions" },
      ...fixes.map((b) => h("button", { class: "btn primary", onclick: async () => {
        try { await switchTool(b); toast(`${b.label} switched on.`); skills(name); } catch (err) { tell("Not changed", err.problems); }
      } }, `Switch ${b.label} on`)),
      h("button", { class: "btn ghost", onclick: async () => { if (await guard()) { page.jumpTo = "tools"; page.toolsTab = "ha"; go("rules"); } } }, "Open Rules › What the AI can use"))) : null;
  const notLoaded = info && !info.ok && !(d.blocked && d.blocked.length) && !d.off ? problemsBox([info.problem], "The agent does not use this skill:") : null;
  const releaseBanner = rel.state === "edited" && !rel.kept ? h("div", { class: "banner" },
    h("div", {}, h("b", {}, "This version of the agent has another version of this skill."),
      h("div", { class: "muted" }, `It was edited here, so it was kept as it is (${plural(rel.differs.length, "file differs", "files differ")}).`)),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", onclick: () => goTo(COMPARE) }, "Compare"),
      h("button", { class: "btn ghost", onclick: async () => { await api("POST", `api/skills/${enc}/keep`); toast("Kept as it is."); skills(name); } }, "Keep mine"),
      h("button", { class: "btn primary", onclick: async () => {
        if (!(await ask({ title: "Take the release version?", ok: "Take the release version", danger: true,
          text: "The skill's files are replaced by the release's; this villa's own files (villa.*) are kept. Your edits are moved to skills/.trash, and Undo (Overview › Changes) brings them back." }))) return;
        try { await api("POST", `api/skills/${enc}/take-release`); toast("The release's version is in place."); skills(name); }
        catch (err) { tell("Not changed", err.problems); }
      } }, "Take the release version"))) : null;

  // ---- the views
  const FILES = "\u0000files";             // the Files tab stands for whichever file is open
  const tabs = subTabs([[ABOUT, "About"], [FILES, "Files"], d.scripts && d.scripts.length ? [TRY, "Try a command", "Runs one of this skill's commands on the villa, exactly as the AI would: it changes nothing in Home Assistant, uses no AI and costs nothing. Messages or tickets it would create are shown here, never sent. A file it saves stays in the agent's out folder, for a next step."] : null,
                        rel.state === "edited" ? [COMPARE, "Compare"] : null], isFile ? FILES : path,
                       (k) => goTo(k === FILES ? (isFile ? path : "SKILL.md") : k));
  // ⚠️ NO TITLE, NO DESCRIPTION, NO SWITCH HERE ON A WIDE SCREEN (owner, 2026-10-06): the list beside it holds the
  // name, the line and the switch. The name and the switch come back on a phone, where the list is hidden.
  const card = (...kids) => fill(pane, h("div", { class: "card skill-pane" }, back, head, blocked, notLoaded, releaseBanner,
    h("div", { class: "skill-bar" }, tabs, pill), ...kids));

  if (path === ABOUT) { card(aboutSkill(name, d)); setBar(null); return; }
  if (path === TRY) { card(tryPanel(name, d)); setBar(null); return; }
  if (path === COMPARE) { card(await comparePanel(name, rel)); setBar(null); return; }

  // ---- Files: the list, the editor, the file's actions
  const probs = h("div");
  const ta = h("textarea", { class: "editor", spellcheck: "false", oninput: markDirty });
  ta.addEventListener("keydown", (e) => {            // Tab indents instead of leaving the editor
    if (e.key !== "Tab") return;
    e.preventDefault();
    const s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end"); markDirty();
  });
  let fileRev = null;
  const load = async (p) => {
    const f = await api("GET", `api/skills/${enc}/file?path=${encodeURIComponent(p)}`);
    ta.value = f.content; fileRev = f.rev; page.dirty = false; showBar(); fill(probs);
  };
  // one line of files while collapsed (the open one first, so it always shows); a button shows them all,
  // and appears only when they do not fit on that line. Open or closed is kept from skill to skill.
  const differs = new Set(rel.differs || []), villa = new Set(rel.villa || []);
  const fileList = h("div", { class: "files" + (filesOpen ? "" : " collapsed") },
    files.map((x) => h("button", { class: x.path === path ? "on" : "", title: [differs.has(x.path) ? "differs from the release" : "", villa.has(x.path) ? "this villa's own file, kept by updates" : ""].filter(Boolean).join(" · ") || null,
      onclick: () => goTo(x.path) }, x.path, differs.has(x.path) ? h("span", { class: "dot warn" }) : null, villa.has(x.path) ? h("span", { class: "dot" }) : null)));
  const more = h("button", { class: "btn ghost files-more", hidden: true, onclick: () => {
    filesOpen = !filesOpen; fileList.classList.toggle("collapsed", !filesOpen); fits(); } });
  const fits = () => {
    const overflow = fileList.scrollHeight > fileList.clientHeight + 1;
    more.hidden = !filesOpen && !overflow;
    more.textContent = filesOpen ? "Fewer" : `All ${files.length} files`;
  };
  // measured after layout and on a window resize (a ResizeObserver here loops: the button changes the width it watches)
  requestAnimationFrame(fits);
  const onResize = () => (fileList.isConnected ? fits() : window.removeEventListener("resize", onResize));
  window.addEventListener("resize", onResize);
  const save = async () => {
    try {
      const r = await api("PUT", `api/skills/${enc}/file?path=${encodeURIComponent(path)}`, { content: ta.value, rev: fileRev });
      fileRev = r.rev; page.dirty = false; fill(probs); showBar(); toast(`${path} saved.`);
    } catch (e) { fill(probs, problemsBox(e.problems)); }
  };
  const newFile = async () => {
    const p = await ask({ title: "New file", text: `In ${name}. A folder may be part of the name.`, ok: "Create",
                          input: "e.g. scripts/check.py or templates/page.html" });
    if (!p || !(await guard())) return;
    try {
      await api("PUT", `api/skills/${enc}/file?path=${encodeURIComponent(p)}`, { content: p.endsWith(".py") ? "#!/usr/bin/env python3\n" : "", rev: null });
      toast(`${p} created.`); openSkill(name, pane, info, p);
    } catch (e) { tell("Not created", e.problems); }
  };
  const delFile = async () => {
    if (!(await ask({ title: `Delete ${path}?`, text: `It is removed from ${name}.`, ok: "Delete", danger: true }))) return;
    try { await api("DELETE", `api/skills/${enc}/file?path=${encodeURIComponent(path)}`); page.dirty = false; toast(`${path} deleted.`); openSkill(name, pane, info, "SKILL.md"); }
    catch (e) { fill(probs, problemsBox(e.problems, "Not deleted:")); }
  };
  const delSkill = async () => {
    if (!(await ask({ title: `Delete the skill ${name}?`, ok: "Delete the skill", danger: true,
                      text: "The agent stops using it at once. It is kept in skills/.trash, and does not come back on its own." }))) return;
    try { await api("DELETE", `api/skills/${enc}`); page.dirty = false; toast(`Skill ${name} deleted.`); skills(); }
    catch (e) { tell("Not deleted", e.problems); }
  };
  card(h("div", { class: "files-row" }, fileList, more),
    (differs.size || villa.size) ? h("p", { class: "muted small legend" },
      differs.size ? [h("span", { class: "dot warn" }), " differs from the release  "] : null,
      villa.size ? [h("span", { class: "dot" }), " this villa's own file, kept by updates"] : null) : null,
    probs, path ? ta : h("p", { class: "muted" }, "No file."),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", onclick: newFile }, "New file"),
      path && !["SKILL.md", "skill.yaml"].includes(path) ? h("button", { class: "btn ghost", onclick: delFile }, "Delete this file") : null,
      h("button", { class: "btn danger push-right", onclick: delSkill }, "Delete the skill")));
  setBar({ save, discard: () => load(path), idle: path ? `Editing ${path}. Saves are checked before they are written.` : "" });
  if (path) await load(path);
}

// Skills › About: three short sections, each a list of aligned rows
export function aboutSkill(name, d) {
  if (!d.acts) return h("p", { class: "muted" }, "The agent cannot read this skill's skill.yaml: open Files to fix it.");
  const row = (left, right, extra) => h("div", { class: "kv" }, h("div", { class: "kv-k" }, left), h("div", { class: "kv-v" }, right), extra || null);
  // When it acts: the schedule first, then events, then the chats
  const acts = [...d.acts.slice(1), d.acts[0]].map((a) => {          // the schedule first, the chats last
    const [when, job] = a.when.split(" — ");
    const kind = a.how === "AI job" ? "AI job" : a.how ? "code, no AI" : null;
    return row(when.replace(/^every chat message, when the AI reads it$/, "in a chat"),
      [job ? h("b", {}, job) : a.how && a.how !== "AI job" ? h("code", {}, a.how.split(" ")[0]) : h("span", { class: "muted" }, "when a person asks about it"),
       kind ? h("span", { class: "chip gray tiny" }, kind) : null]);
  });
  // What the AI may run: a switch per command, its words under it
  const runs = (d.scripts || []).map((sc) => h("div", { class: "cmd-group" },
    h("div", { class: "cmd-script" }, h("code", {}, sc.script)),
    sc.commands.length ? sc.commands.map((c) => h("div", { class: "cmd-row" },
      h("label", { class: "switch" }, h("input", { type: "checkbox", checked: c.on, "aria-label": `${sc.script} ${c.name}`,
        onchange: (e) => setCommand(name, sc.script, c.name, e.target.checked, e.target) })),
      h("div", { class: "cmd-text" }, h("b", {}, c.name), c.words ? h("div", { class: "muted" }, c.words) : null,
        c.job_only ? h("div", { class: "muted small" }, `Asked for in a chat, it runs as the ${c.job_only} job.`) : null)))
      : h("div", { class: "cmd-row" },
        h("label", { class: "switch" }, h("input", { type: "checkbox", checked: !sc.whole_off, "aria-label": sc.script,
          onchange: (e) => setCommand(name, sc.script, null, e.target.checked, e.target) })),
        // a script without commands: what it does (skill.yaml `description`), then its options, each as written
        h("div", { class: "cmd-text" }, h("span", { class: "plain" }, sc.description || "The AI may run it."),
          Object.keys(sc.flags).length ? h("div", { class: "chips" }, Object.keys(sc.flags).map((fl) => h("code", { class: "flag" }, fl))) : null))));
  // Tools it needs: a one-line verdict; the list folded unless something is off
  let tools;
  if (d.needs === null || d.needs === undefined) tools = h("p", { class: "muted" }, "Its skill.yaml lists none: its reports get every tool switched on.");
  else if (!d.needs.length) tools = h("p", { class: "muted" }, "None: the AI needs no tool of its own for this skill.");
  else {
    const off = d.needs.filter((n) => !n.on);
    const chip = (n) => h("span", { class: "chip" + (n.on ? "" : " off"), title: n.tool },
      n.label + ({ off: " — off", missing: " — not on this Home Assistant", never: " — never available" }[n.state] || ""));
    tools = [h("p", {}, off.length ? h("b", { class: "warn-text" }, `${off.length} of ${d.needs.length} not available`) : h("span", {}, `${plural(d.needs.length, "tool", "tools")}, all switched on`)),
      off.length ? h("div", { class: "chips" }, off.map(chip)) : null,
      h("details", { class: "fold" }, h("summary", {}, off.length ? "All of them" : "Show them"), h("div", { class: "chips" }, d.needs.map(chip)))];
  }
  return h("div", { class: "about" },
    h("section", { class: "about-sec" }, h("h3", {}, "When it acts"), acts),
    d.scripts && d.scripts.length ? h("section", { class: "about-sec" }, h("h3", {}, "What the AI may run"),
      h("p", { class: "muted small" }, "Switch a command off and the AI cannot run it here. Saved in the skill's villa.skill.yaml: kept by updates, copied with the skill."), runs) : null,
    h("section", { class: "about-sec" }, h("h3", {}, "Tools it needs"), tools,
      h("p", { class: "muted small" }, "Switched on or off in Rules › What the AI can use.")));
}
