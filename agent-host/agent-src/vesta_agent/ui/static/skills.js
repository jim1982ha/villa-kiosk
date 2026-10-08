// VESTA Agent page — the Skills tab.
import { api, ask, dropdown, field, fill, go, guard, h, infoButton, markDirty, page, paged, place, plural, popup, problemsBox, reasons, saveWith, setBar, showBar, subTabs, tabbed, tell, tileCard, titleWithInfo, toast, toggleCard, $view, where, withInfo } from "./core.js";
import { fileViewer } from "./viewer.js";

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
      catch (err) { e.target.checked = !now; tell("Not changed", reasons(err)); }
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
        h("div", { class: "d" }, s.off ? "Off · kept, not used" : s.ok ? s.description : s.line)),
      skillSwitch(s.name, !s.off, select))) : h("p", { class: "muted" }, "No skill yet. The starter skills are copied at the agent's first start."),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: newSkill }, "New skill")));
  const pane = h("div");
  side.classList.add("skills-side");
  fill($view, h("div", { class: "skills" }, side, pane));
  page.dirty = false; setBar(null);
  if (select) openSkill(select, pane, list.find((s) => s.name === select));
}

// where the tools a skill needs are switched (Tools it needs: its (i))
const WHERE_TOOLS = `Switched on or off in ${where("tools")}. A tool switched off there makes this skill "not working": its AI jobs do not run.`;

export async function setCommand(skill, script, command, on, box) {
  try { await api("PUT", `api/skills/${encodeURIComponent(skill)}/commands`, { script, command, on }); toast(`${command || script} switched ${on ? "on" : "off"} for the AI.`); }
  catch (e) { box.checked = !on; box.closest(".tool-card")?.classList.toggle("is-on", !on); tell("Not changed", reasons(e)); }
}

// 2C's one-press fix: the agent switches the tool on where its switch is (tool_access.switch_on), same checks as a save
export async function switchTool(b) {
  await api("POST", "api/tools/on", { tool: b.tool });
}

// A command's Offline Test: run by the agent on the live villa, exactly as the AI would — nothing is sent.
// ⚠️ OPENED FROM ITS OWN CARD (owner, 2026-10-08: the "Try a command" tab became an "Offline Test" pill on each
// command's card, in a popup): the script and the command are the card's, so only the options are asked; then Run.
export const FLAG_HELP = { date: "a day, e.g. 2026-10-05", text: "a word or a few", switch: "" };
export const OFFLINE_TEST_INFO = "Runs this command on the villa, exactly as the AI would: it changes nothing in Home Assistant, uses no AI and costs nothing. Messages or tickets it would create are shown here, never sent. A file it saves stays in the agent's out folder, for a next step.";
export function tryPanel(name, d, script, command = null) {
  const out = h("div");
  let values = {};
  const opts = h("div", { class: "try-opts" });
  const args = () => {
    const a = command ? [command] : [];
    for (const [flag, kind] of Object.entries(script.flags)) {
      const v = values[flag];
      if (kind === "switch") { if (v) a.push(flag); } else if (v) a.push(flag, String(v));
    }
    return a;
  };
  const draw = () => {
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
    } catch (e) { fill(out, problemsBox(reasons(e), "Not run:")); }
  }
  draw();
  return h("div", { class: "skill-sec try" },
    opts,
    h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: run }, "Run")),
    out);
}

// The pill on a command's card that opens its Offline Test (only while the AI may run it: switched off, it is not
// what the AI would run)
export function offlineTestPill(name, d, script, command) {
  return h("button", { type: "button", class: "pill-btn", onclick: () =>
    // the title names the script too: two scripts may share a command name (compose.py and facts.py both have fm-weekly);
    // no subtitle and no "Options" heading under it (owner, 2026-10-08: redundant)
    popup(`Offline Test · ${command ? `${script.script} ${command}` : script.script}`, tryPanel(name, d, script, command), OFFLINE_TEST_INFO) },
    // on a narrow card only "Test" (app.css: a container query on .tool-card)
    h("span", { class: "long" }, "Offline "), "Test");
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

// ⚠️ ONE "TAKE THE RELEASE VERSION" (owner, 2026-10-08: "i don't see any Take the release version button"): it was
// only in the banner, which "Keep mine" hides for the rest of the release — the Compare tab described a button that
// was not there. The banner and the Compare tab both draw this one.
export function takeReleaseButton(name) {
  const btn = h("button", { class: "btn primary", onclick: async () => {
    if (!(await ask({ title: "Take the release version?", ok: "Take the release version", danger: true,
      text: `The skill's files are replaced by the release's; this villa's own files (villa.*) are kept. Your edits are moved to skills/.trash, and Undo (${where("changes")}) brings them back.` }))) return;
    try { await api("POST", `api/skills/${encodeURIComponent(name)}/take-release`); toast("The release's version is in place."); skills(name); }
    catch (err) { tell("Not changed", reasons(err)); }
  } }, "Take the release version");
  return btn;
}

// Skills › Compare: an edited starter skill's file beside the release's, and the way back to the release's version
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
      h("div", { class: "actions" }, takeReleaseButton(name),
        infoButton("Take the release version", "The skill's files are replaced by the release's and this villa's own files (villa.*) are kept. Your edits are moved to skills/.trash, and Undo brings them back.")));
  };
  if (file) await draw(); else fill(box, h("p", { class: "muted" }, "No file differs."));
  return h("div", { class: "skill-sec" }, box);
}

export async function newSkill() {
  const name = await ask({ title: "New skill", text: "Its name: lower-case letters, digits, - and _.", ok: "Create", input: "e.g. pool-care" });
  if (!name || !(await guard())) return;
  try { await api("POST", "api/skills", { name }); toast(`Skill ${name} created.`); skills(name); }
  catch (e) { tell("Not created", reasons(e)); }
}

export let filesOpen = false;

export const ABOUT = "\u0000about", COMPARE = "\u0000compare";

// One skill: its name, state and switch on top, then four views (owner, 2026-10-06: "very messy" — one thing at a
// time). About: when it is called and the tools it uses (tabs), the commands it runs (each with its Offline Test).
// Files: the editor. Compare.
export async function openSkill(name, pane, info, path = ABOUT) {
  const enc = encodeURIComponent(name);
  const [{ files }, d] = await Promise.all([api("GET", `api/skills/${enc}/files`), api("GET", `api/skills/${enc}`)]);
  if (path === COMPARE && (d.release || {}).state !== "edited") path = ABOUT;
  const isFile = ![ABOUT, COMPARE].includes(path);
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
        try { await switchTool(b); toast(`${b.label} switched on.`); skills(name); } catch (err) { tell("Not changed", reasons(err)); }
      } }, `Switch ${b.label} on`)),
      h("button", { class: "btn ghost", onclick: async () => { if (await guard()) { page.jumpTo = "tools"; page.tabs.tools = "ha"; go("rules"); } } }, `Open ${where("tools")}`))) : null;
  const notLoaded = info && !info.ok && !(d.blocked && d.blocked.length) && !d.off ? problemsBox([info.problem], "The agent does not use this skill:") : null;
  const releaseBanner = rel.state === "edited" && !rel.kept ? h("div", { class: "banner" },
    h("div", {}, h("b", {}, "This version of the agent has another version of this skill."),
      h("div", { class: "muted" }, `It was edited here, so it was kept as it is (${plural(rel.differs.length, "file differs", "files differ")}).`)),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", onclick: () => goTo(COMPARE) }, "Compare"),
      h("button", { class: "btn ghost", onclick: async () => { await api("POST", `api/skills/${enc}/keep`); toast("Kept as it is."); skills(name); } }, "Keep mine"),
      takeReleaseButton(name))) : null;

  // ---- the views
  const FILES = "\u0000files";             // the Files tab stands for whichever file is open
  const tabs = subTabs([[ABOUT, place("skill_about")], [FILES, place("skill_files")],
                        rel.state === "edited" ? [COMPARE, place("skill_compare")] : null], isFile ? FILES : path,
                       (k) => goTo(k === FILES ? (isFile ? path : "SKILL.md") : k));
  // ⚠️ NO TITLE, NO DESCRIPTION, NO SWITCH HERE ON A WIDE SCREEN (owner, 2026-10-06): the list beside it holds the
  // name, the line and the switch. The name and the switch come back on a phone, where the list is hidden.
  const card = (...kids) => fill(pane, h("div", { class: "card skill-pane" }, back, head, blocked, notLoaded, releaseBanner,
    h("div", { class: "skill-bar" }, tabs, pill), ...kids));

  if (path === ABOUT) { card(aboutSkill(name, d)); setBar(null); return; }
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
  // ⚠️ A MARKDOWN OR YAML FILE OPENS FORMATTED (owner, 2026-10-08), the raw text one press away (viewer.fileViewer)
  const view = fileViewer(ta, path);
  const load = async (p) => {
    const f = await api("GET", `api/skills/${enc}/file?path=${encodeURIComponent(p)}`);
    ta.value = f.content; fileRev = f.rev; page.dirty = false; showBar(); fill(probs); view.show();
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
    const r = await saveWith(probs, () => api("PUT", `api/skills/${enc}/file?path=${encodeURIComponent(path)}`,
                                              { content: ta.value, rev: fileRev }), `${path} saved.`);
    if (r) fileRev = r.rev;
  };
  const newFile = async () => {
    const p = await ask({ title: "New file", text: `In ${name}. A folder may be part of the name.`, ok: "Create",
                          input: "e.g. scripts/check.py or templates/page.html" });
    if (!p || !(await guard())) return;
    try {
      await api("PUT", `api/skills/${enc}/file?path=${encodeURIComponent(p)}`, { content: p.endsWith(".py") ? "#!/usr/bin/env python3\n" : "", rev: null });
      toast(`${p} created.`); openSkill(name, pane, info, p);
    } catch (e) { tell("Not created", reasons(e)); }
  };
  const delFile = async () => {
    if (!(await ask({ title: `Delete ${path}?`, text: `It is removed from ${name}.`, ok: "Delete", danger: true }))) return;
    try { await api("DELETE", `api/skills/${enc}/file?path=${encodeURIComponent(path)}`); page.dirty = false; toast(`${path} deleted.`); openSkill(name, pane, info, "SKILL.md"); }
    catch (e) { fill(probs, problemsBox(reasons(e), "Not deleted:")); }
  };
  const delSkill = async () => {
    if (!(await ask({ title: `Delete the skill ${name}?`, ok: "Delete the skill", danger: true,
                      text: "The agent stops using it at once. It is kept in skills/.trash, and does not come back on its own." }))) return;
    try { await api("DELETE", `api/skills/${enc}`); page.dirty = false; toast(`Skill ${name} deleted.`); skills(); }
    catch (e) { tell("Not deleted", reasons(e)); }
  };
  card(h("div", { class: "files-row" }, fileList, more),
    (differs.size || villa.size || view.toggle) ? h("div", { class: "file-bar" }, (differs.size || villa.size) ? h("p", { class: "muted small legend" },
      differs.size ? [h("span", { class: "dot warn" }), " differs from the release  "] : null,
      villa.size ? [h("span", { class: "dot" }), " this villa's own file, kept by updates"] : null) : null, view.toggle) : null,
    probs, path ? [ta, view.box] : h("p", { class: "muted" }, "No file."),
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", onclick: newFile }, "New file"),
      path && !["SKILL.md", "skill.yaml"].includes(path) ? h("button", { class: "btn ghost", onclick: delFile }, "Delete this file") : null,
      h("button", { class: "btn danger push-right", onclick: delSkill }, "Delete the skill")));
  setBar({ save, discard: () => load(path), idle: path ? `Editing ${path}. Saves are checked before they are written.` : "" });
  if (path) await load(path);
}

// Skills › About (owner, 2026-10-08): on top when the skill is called; below it ONE section of two tabs — the commands
// it runs (each card with its Offline Test), the tools it uses (as cards).
export const ABOUT_TEXT = {
  when: place("skill_when"), tools: place("skill_tools"), commands: place("skill_commands"),
  switches: "Switch a command off and the AI cannot run it here. Saved in the skill's villa.skill.yaml: kept by updates, copied with the skill.",
};

export function aboutSkill(name, d) {
  if (!d.acts) return h("p", { class: "muted" }, "The agent cannot read this skill's skill.yaml: open Files to fix it.");
  // When the skill runs: the schedule first, then events, then the chats — a table like every other (core.paged)
  // rows as the agent sends them, in their order (server.skill_detail): drawn, never parsed
  const KIND = { ai: "AI job", code: "code, no AI" };
  const acts = () => paged(["When", "What runs"], d.acts.map((a) => [a.when,
    [a.job ? h("b", {}, a.job) : a.script ? h("code", {}, a.script) : h("span", { class: "muted" }, a.note || ""),
     a.kind ? h("span", { class: "chip gray tiny" }, KIND[a.kind]) : null]]));
  // Skill tools: a one-line verdict and its (i), then every tool as a card — core.tileCard, the commands'
  // own card without their switch (a tool is switched on or off in Rules, for every skill at once)
  const tools = () => {
    if (d.needs === null || d.needs === undefined) return h("p", { class: "muted" }, "Its skill.yaml lists none: its reports get every tool switched on.");
    if (!d.needs.length) return h("p", { class: "muted" }, "None: the AI needs no tool of its own for this skill.");
    const off = d.needs.filter((n) => !n.on);
    const verdict = off.length ? h("b", { class: "warn-text" }, `${off.length} of ${d.needs.length} not available`) : `${plural(d.needs.length, "tool", "tools")}, all switched on`;
    const state = { off: "off", missing: "not on this Home Assistant", never: "never available" };
    return [h("p", {}, withInfo(verdict, WHERE_TOOLS)),
      h("div", { class: "tool-grid three" }, d.needs.map((n) => tileCard(n.label, {
        on: n.on, chip: n.on ? null : h("span", { class: "chip off tiny" }, state[n.state] || "off"),
        words: h("div", { class: "muted" }, h("code", {}, n.tool)) })))];
  };
  // Skill commands: a card per command (core.toggleCard), three a line, each with its Offline Test
  const runs = () => (d.scripts || []).map((sc) => h("div", { class: "cmd-group" },
    h("div", { class: "cmd-script" }, h("code", {}, sc.script)),
    h("div", { class: "tool-grid three" }, sc.commands.length
      ? sc.commands.map((c) => toggleCard(c.on, (on, box) => setCommand(name, sc.script, c.name, on, box), c.name, {
          label: `${sc.script} ${c.name}`,
          words: c.words ? h("div", { class: "muted" }, c.words) : null,
          action: c.on ? offlineTestPill(name, d, sc, c.name) : null,
          meta: c.job_only ? h("span", { class: "muted small" }, `Asked for in a chat, it runs as the ${c.job_only} job.`) : null }))
      // a script without commands: what it does (skill.yaml `description`). ⚠️ NOT ITS OPTIONS (owner, 2026-10-08:
      // "--as-of, --out, --skip-raw: too much detail for this view") — they are in its Offline Test, where they are used
      : [toggleCard(!sc.whole_off, (on, box) => setCommand(name, sc.script, null, on, box), sc.script, {
          words: h("div", { class: "muted" }, sc.description || "The AI may run it."),
          action: !sc.whole_off ? offlineTestPill(name, d, sc, null) : null })])));
  // a skill without scripts has no Commands tab
  const hasRuns = !!(d.scripts && d.scripts.length);
  // what the switches do, behind the Commands tab's (i), as every other explanation on the page
  const tabs = tabbed("about", [hasRuns && ["commands", ABOUT_TEXT.commands, ABOUT_TEXT.switches, runs], ["tools", ABOUT_TEXT.tools, null, tools]]);
  return h("div", { class: "about" },
    h("section", { class: "about-sec" }, h("h3", {}, ABOUT_TEXT.when), acts()),
    h("section", { class: "about-sec" }, tabs.bar, tabs.body));
}
