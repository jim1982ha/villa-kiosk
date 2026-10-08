// VESTA Agent page — a YAML file's lines as coloured pieces (owner, 2026-10-08: Rules (file) "formatted" like a skill's
// Markdown). Plain data, no HTML string: the viewer draws the pieces with core.h. Line by line, as a reader scans
// policy.yaml: a comment, the indent, a list's dash, a key, its value (a number, a switch, a quoted text or a word),
// then the line's own comment. Nothing is checked here: a save is checked by the agent's own rules.
//
// lines(text) → [[{t, v}, …], …], t one of: "ind" (the indent), "com" (a comment), "dash", "key", "colon", "num",
// "bool" (true, false, null, yes, no, ~), "str" (a quoted text), "val" (any other value), "text" (spaces between).

const NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const SWITCH = /^(true|false|null|yes|no|on|off|~)$/i;
const KEY = /^("[^"]*"|'[^']*'|[^\s#'"{[\-][^:#]*?|-[^\s:#][^:#]*?)(:)(?=\s|$)/;

// where a line's own comment starts: a " #" outside quotes (a "#" inside a word or a quoted text is kept)
function commentAt(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return i;
  }
  return -1;
}

function value(v) {
  const word = v.trim();
  if (!word) return [{ t: "text", v }];
  const lead = v.slice(0, v.indexOf(word)), tail = v.slice(v.indexOf(word) + word.length);
  const t = NUMBER.test(word) ? "num" : SWITCH.test(word) ? "bool" : /^(["']).*\1$/.test(word) ? "str" : "val";
  return [lead ? { t: "text", v: lead } : null, { t, v: word }, tail ? { t: "text", v: tail } : null].filter(Boolean);
}

export function lines(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const out = [];
    const ind = line.match(/^\s*/)[0];
    if (ind) out.push({ t: "ind", v: ind });
    let rest = line.slice(ind.length);
    if (rest.startsWith("#")) return [...out, { t: "com", v: rest }];
    const at = commentAt(rest);
    const com = at >= 0 ? rest.slice(at) : "";
    if (at >= 0) rest = rest.slice(0, at);
    for (let m; (m = rest.match(/^-(\s+|$)/)); rest = rest.slice(m[0].length)) out.push({ t: "dash", v: "-" }, { t: "text", v: m[1] });
    const k = rest.match(KEY);
    if (k) { out.push({ t: "key", v: k[1] }, { t: "colon", v: ":" }); rest = rest.slice(k[0].length); }
    if (rest) out.push(...value(rest));
    if (com) out.push({ t: "com", v: com });
    return out.filter((p) => p.v !== "");
  });
}
