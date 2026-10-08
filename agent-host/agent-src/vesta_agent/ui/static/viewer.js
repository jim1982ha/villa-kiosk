// VESTA Agent page — THE ONE FILE VIEWER (owner, 2026-10-08: a skill's Markdown "formatted by default, a toggle to
// the raw version", then "do this for Rules (file) too"). Every file the page edits as text — policy.yaml, a skill's
// files — sits in a textarea; this adds, for the kinds it can show, a Formatted view and the Formatted / Raw switch.
// Markdown is drawn from markdown.js's blocks, YAML from yaml.js's pieces: plain data built with core.h, so a file
// never puts markup in the page, and nothing is fetched. The choice is one for every file, kept while the page is open.
import { fill, h, markDirty, page, saveWith, segmented, showBar, table } from "./core.js";
import { parse } from "./markdown.js";
import { lines } from "./yaml.js";

// A Markdown file as a reader sees it (markdown.js parses, this draws with h: no markup from the file reaches the page).
// A link opens only when it is a web address; a table is core.table, like every table on the page.
const inl = (list) => list.map((x) => x.t === "text" ? x.v : x.t === "code" ? h("code", {}, x.v) : x.t === "b" ? h("strong", {}, inl(x.c))
  : x.t === "i" ? h("em", {}, inl(x.c)) : /^https?:\/\//.test(x.href) ? h("a", { href: x.href, target: "_blank", rel: "noopener noreferrer" }, inl(x.c))
  : h("span", { title: x.href }, inl(x.c)));
function listView(items) {
  // nested by depth; a list of the other kind at the same depth starts beside it
  const root = { depth: -1, el: h("div"), last: null }, stack = [root];
  for (const it of items) {
    while (stack.length > 1 && stack[stack.length - 1].depth > it.depth) stack.pop();
    const tag = it.ordered ? "ol" : "ul";
    let top = stack[stack.length - 1];
    if (top.depth === it.depth && top.el.tagName.toLowerCase() !== tag) { stack.pop(); top = stack[stack.length - 1]; }
    if (top.depth < it.depth) {
      const list = h(tag);
      (top.last || top.el).append(list);
      top = { depth: it.depth, el: list, last: null }; stack.push(top);
    }
    top.last = h("li", {}, inl(it.inl)); top.el.append(top.last);
  }
  return [...root.el.childNodes];
}
export function markdownView(text) {
  // flatMap, never map: core.h and fill flatten ONE level, and a list is several nodes (an array inside lost them)
  return parse(text).flatMap((b) => b.t === "meta" ? h("dl", { class: "md-meta" }, b.rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))
    : b.t === "h" ? h(`h${b.level}`, {}, inl(b.inl)) : b.t === "p" ? h("p", {}, inl(b.inl)) : b.t === "list" ? listView(b.items)
    : b.t === "code" ? h("pre", {}, h("code", {}, b.text)) : b.t === "quote" ? h("blockquote", {}, inl(b.inl)) : b.t === "hr" ? h("hr")
    : table(b.head.map(inl), b.rows.map((r) => r.map(inl))));
}

// YAML as written, coloured piece by piece (yaml.js): the indent kept, a comment dimmed, keys, numbers and switches apart
export function yamlView(text) {
  return h("pre", { class: "yaml-view" }, lines(text).flatMap((pieces, i) => [i ? "\n" : "",
    ...pieces.map((p) => (p.t === "text" || p.t === "ind" ? p.v : h("span", { class: `y-${p.t}` }, p.v)))]));
}

const VIEWS = { md: markdownView, yaml: yamlView };
export const viewKind = (path) => (/\.md$/i.test(path || "") ? "md" : /\.ya?ml$/i.test(path || "") ? "yaml" : null);

// `ta`: the file's textarea; `path`: its name. Returns {toggle, box, show}: the switch (null for a kind with no
// formatted view), the formatted box, and show() to call after the textarea's text changes (a load). Formatted shows
// the text as it is in the editor, saved or not; editing is in Raw.
export function fileViewer(ta, path) {
  const kind = viewKind(path);
  const box = h("div", { class: `file-view ${kind === "md" ? "md-box" : "yaml-box"}`, hidden: true });
  const show = () => {
    const formatted = !!kind && page.fileView !== "raw";
    ta.hidden = formatted; box.hidden = !formatted;
    if (formatted) fill(box, VIEWS[kind](ta.value));
  };
  const toggle = kind ? segmented([["formatted", "View"], ["raw", "Edit"]], page.fileView || "formatted",
    (v) => { page.fileView = v; show(); }, "Show the file") : null;
  show();
  return { toggle, box, show };
}

// ⚠️ THE ONE FILE EDITOR (architecture review 9): Rules (file) and a skill's Files each built "a textarea, its version,
// the viewer, a save" — and differed already: Tab indented in a skill's YAML, not in policy.yaml, where indentation
// matters most. `path`: the file's name (its kind of view); `send(text, rev)`: the save request; `probs`: where a
// refusal is shown. Returns {ta, view, set(text, rev), save(okText)}: set() after a load, save() from the save bar.
export function fileEditor(path, send, probs) {
  const ta = h("textarea", { class: "editor", spellcheck: "false", oninput: markDirty });
  ta.addEventListener("keydown", (e) => {            // Tab indents instead of leaving the editor
    if (e.key !== "Tab") return;
    e.preventDefault();
    const s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end"); markDirty();
  });
  const view = fileViewer(ta, path);
  let rev = null;
  return {
    ta, view,
    set(text, r) { ta.value = text; rev = r; page.dirty = false; showBar(); fill(probs); view.show(); },
    async save(okText) {
      const res = await saveWith(probs, () => send(ta.value, rev), okText);
      if (res && res.rev) rev = res.rev;
      return res;
    },
  };
}

